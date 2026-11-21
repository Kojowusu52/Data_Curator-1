import {
  GlobalCurationConfig,
  HistogramBin,
  RawEvent,
  RulConfig,
  RulCycleRow,
  RulEntitySummary,
  RulPreparationResult,
  RulRiskTier,
  RulRiskTierSummary,
  RulSlidingWindowSample,
  RulTemporalTrendPoint,
  SplitName,
} from '../types/curation';
import { assignEntitySplit, groupEventsByEntity } from './curationEngine';

function percentileSorted(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function buildHistogram(values: number[], binCount = 8): HistogramBin[] {
  if (values.length === 0) return [];
  const minVal = Math.min(...values);
  const maxVal = Math.max(...values);
  const span = Math.max(1, maxVal - minVal);
  const step = span / binCount;
  const bins: HistogramBin[] = Array.from({ length: binCount }, (_, i) => {
    const lo = Math.round(minVal + i * step);
    const hi = i === binCount - 1 ? Math.round(maxVal) : Math.round(minVal + (i + 1) * step);
    return {
      label: `${lo}-${hi}`,
      min: lo,
      max: hi,
      count: 0,
    };
  });
  for (const v of values) {
    const idx = Math.min(binCount - 1, Math.max(0, Math.floor(((v - minVal) / span) * binCount)));
    bins[idx].count += 1;
  }
  return bins;
}

export function buildRulDataset(
  events: RawEvent[],
  config: RulConfig,
  globalConfig: GlobalCurationConfig
): RulPreparationResult {
  const grouped = groupEventsByEntity(events);
  const unitSummaries: RulEntitySummary[] = [];
  const allCycleRows: RulCycleRow[] = [];

  const splitCounts: Record<SplitName, number> = { train: 0, val: 0, test: 0 };

  for (const [entityId, rawList] of grouped.entries()) {
    const split = assignEntitySplit(entityId, globalConfig);
    if (config.splitFilter !== 'all' && split !== config.splitFilter) continue;

    const list = [...rawList].sort((a, b) => a.timestampDay - b.timestampDay);
    if (list.length === 0) continue;

    // Determine End-Of-Life cycle: first large inactivity gap or final observed cycle
    let eolIndex = list.length - 1;
    for (let i = 1; i < list.length; i++) {
      if (list[i].timestampDay - list[i - 1].timestampDay >= config.eolInactivityGapDays) {
        eolIndex = i - 1;
        break;
      }
    }
    const activeSlice = list.slice(0, eolIndex + 1);
    const firstDay = activeSlice[0].timestampDay;
    const eolDay = activeSlice[activeSlice.length - 1].timestampDay;

    // Simple OLS slope of engagementScore across unit lifetime
    const n = activeSlice.length;
    const meanDay = activeSlice.reduce((a, b) => a + b.timestampDay, 0) / n;
    const meanEng = activeSlice.reduce((a, b) => a + b.engagementScore, 0) / n;
    let num = 0;
    let den = 0;
    for (const ev of activeSlice) {
      const dx = ev.timestampDay - meanDay;
      num += dx * (ev.engagementScore - meanEng);
      den += dx * dx;
    }
    const degradationSlope = den > 1e-6 ? num / den : 0;

    let spikeCount = 0;
    const unitRows: RulCycleRow[] = [];

    for (let i = 0; i < activeSlice.length; i++) {
      const ev = activeSlice[i];
      const winStart = Math.max(0, i - 3);
      const history = activeSlice.slice(winStart, i + 1).map((x) => x.spendAmount);
      const hMean = history.reduce((a, b) => a + b, 0) / history.length;
      const hVar =
        history.length > 1
          ? history.reduce((a, b) => a + (b - hMean) ** 2, 0) / history.length
          : 0;
      const hStd = Math.sqrt(hVar);
      const zScoreAnomaly = hStd > 1e-4 ? (ev.spendAmount - hMean) / hStd : 0;
      const isAnomalySpike = i >= 2 && Math.abs(zScoreAnomaly) >= 1.75;
      if (isAnomalySpike) spikeCount += 1;

      const rulRaw = Math.max(0, eolDay - ev.timestampDay);
      const rulCapped = Math.min(config.rulCap, rulRaw);

      const row: RulCycleRow = {
        entityId,
        split,
        eventId: ev.eventId,
        timestampDay: ev.timestampDay,
        cycleIndex: i + 1,
        channel: ev.channel,
        actionLabel: ev.actionLabel,
        spendAmount: Math.round(ev.spendAmount * 100) / 100,
        engagementScore: ev.engagementScore,
        reward: Math.round(ev.reward * 100) / 100,
        propensity: ev.propensity,
        rulRaw,
        rulCapped,
        rollingMeanSpend: Math.round(hMean * 100) / 100,
        zScoreAnomaly: Math.round(zScoreAnomaly * 100) / 100,
        isAnomalySpike,
      };
      unitRows.push(row);
      allCycleRows.push(row);
    }

    const stride = Math.max(1, config.stride);
    const windowCount =
      unitRows.length <= config.windowLength
        ? 1
        : Math.floor((unitRows.length - config.windowLength) / stride) + 1;

    const finalEngagement = unitRows[unitRows.length - 1].engagementScore;
    const finalHealthPct = Math.round(finalEngagement * 1000) / 10;
    const unitMeanRulCapped =
      Math.round((unitRows.reduce((a, r) => a + r.rulCapped, 0) / unitRows.length) * 10) / 10;

    let riskTier: RulRiskTier = 'nominal';
    if (finalEngagement < 0.35 || degradationSlope <= -0.0028) {
      riskTier = 'critical';
    } else if (finalEngagement < 0.65 || degradationSlope <= -0.0008 || spikeCount >= 2) {
      riskTier = 'warning';
    }

    splitCounts[split] += 1;
    unitSummaries.push({
      entityId,
      split,
      firstDay,
      eolDay,
      cycleSpanDays: Math.max(1, eolDay - firstDay),
      eventCount: unitRows.length,
      windowCount,
      meanSignal:
        Math.round((unitRows.reduce((a, r) => a + r.spendAmount, 0) / unitRows.length) * 100) /
        100,
      meanRulCapped: unitMeanRulCapped,
      finalEngagement,
      finalHealthPct,
      degradationSlope: Math.round(degradationSlope * 10000) / 10000,
      anomalousSpikeCount: spikeCount,
      riskTier,
    });
  }

  // Fit 4-feature scaler strictly on train cycle rows (zero leakage)
  const trainRows = allCycleRows.filter((r) => r.split === 'train');
  const fitSource = trainRows.length > 0 ? trainRows : allCycleRows;

  const featureExtractors: Array<{ name: string; extract: (r: RulCycleRow) => number }> = [
    { name: 'signal_spend', extract: (r) => r.spendAmount },
    { name: 'health_engagement', extract: (r) => r.engagementScore },
    { name: 'rolling_baseline', extract: (r) => r.rollingMeanSpend },
    { name: 'reward_margin', extract: (r) => r.reward },
  ];

  const featureScalerStats = featureExtractors.map((fe) => {
    const vals = fitSource.map(fe.extract);
    if (vals.length === 0) return { name: fe.name, mean: 0, std: 1, min: 0, max: 1 };
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const variance = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length;
    const std = Math.max(1e-4, Math.sqrt(variance));
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    return {
      name: fe.name,
      mean: Math.round(mean * 1000) / 1000,
      std: Math.round(std * 1000) / 1000,
      min: Math.round(min * 1000) / 1000,
      max: Math.round(max * 1000) / 1000,
    };
  });

  const scaleRow = (r: RulCycleRow): number[] => {
    return featureExtractors.map((fe, idx) => {
      const raw = fe.extract(r);
      const stat = featureScalerStats[idx];
      if (config.normalization === 'minmax') {
        const span = Math.max(1e-4, stat.max - stat.min);
        return Math.round(((raw - stat.min) / span) * 10000) / 10000;
      }
      if (config.normalization === 'log1p_zscore') {
        const signed = raw >= 0 ? Math.log1p(raw) : -Math.log1p(Math.abs(raw));
        const statMean = stat.mean >= 0 ? Math.log1p(stat.mean) : 0;
        return Math.round(((signed - statMean) / Math.max(0.25, Math.log1p(stat.std))) * 10000) / 10000;
      }
      return Math.round(((raw - stat.mean) / stat.std) * 10000) / 10000;
    });
  };

  // Build sliding-window RUL tensors [N, W, 4]
  const rowsByUnit = new Map<string, RulCycleRow[]>();
  for (const r of allCycleRows) {
    const arr = rowsByUnit.get(r.entityId) ?? [];
    arr.push(r);
    rowsByUnit.set(r.entityId, arr);
  }

  const windowSamples: RulSlidingWindowSample[] = [];
  const W = Math.max(2, config.windowLength);
  const stride = Math.max(1, config.stride);

  for (const [entityId, uRows] of rowsByUnit.entries()) {
    if (uRows.length <= W) {
      const padCount = W - uRows.length;
      const tensor = [
        ...Array.from({ length: padCount }, () => [0, 0, 0, 0]),
        ...uRows.map(scaleRow),
      ];
      const last = uRows[uRows.length - 1];
      windowSamples.push({
        sampleId: `${entityId}-W0`,
        entityId,
        split: last.split,
        startDay: uRows[0].timestampDay,
        endDay: last.timestampDay,
        rulTargetRaw: last.rulRaw,
        rulTargetCapped: last.rulCapped,
        tensor,
      });
    } else {
      for (let start = 0; start <= uRows.length - W; start += stride) {
        const slice = uRows.slice(start, start + W);
        const last = slice[slice.length - 1];
        windowSamples.push({
          sampleId: `${entityId}-W${start}`,
          entityId,
          split: last.split,
          startDay: slice[0].timestampDay,
          endDay: last.timestampDay,
          rulTargetRaw: last.rulRaw,
          rulTargetCapped: last.rulCapped,
          tensor: slice.map(scaleRow),
        });
      }
    }
  }

  // Lifecycle degradation curve across 10 normalized progress deciles + Split Parity
  const deciles = Array.from({ length: 10 }, (_, idx) => ({
    cycleBucket: `${idx * 10}-${(idx + 1) * 10}%`,
    signals: [] as number[],
    engs: [] as number[],
    ruls: [] as number[],
    trainRuls: [] as number[],
    valRuls: [] as number[],
    testRuls: [] as number[],
    anomalyCount: 0,
  }));

  for (const unit of unitSummaries) {
    const uRows = rowsByUnit.get(unit.entityId) ?? [];
    const span = Math.max(1, unit.eolDay - unit.firstDay);
    for (const r of uRows) {
      const pct = Math.min(0.999, Math.max(0, (r.timestampDay - unit.firstDay) / span));
      const dIdx = Math.floor(pct * 10);
      deciles[dIdx].signals.push(r.spendAmount);
      deciles[dIdx].engs.push(r.engagementScore);
      deciles[dIdx].ruls.push(r.rulCapped);
      if (r.split === 'train') deciles[dIdx].trainRuls.push(r.rulCapped);
      else if (r.split === 'val') deciles[dIdx].valRuls.push(r.rulCapped);
      else deciles[dIdx].testRuls.push(r.rulCapped);
      if (r.isAnomalySpike) deciles[dIdx].anomalyCount += 1;
    }
  }

  const avgOrNull = (arr: number[]) =>
    arr.length > 0 ? Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 10) / 10 : null;

  const degradationCurve = deciles.map((d) => {
    const rawCount = d.signals.length;
    const c = rawCount || 1;
    const meanEngagement = Math.round((d.engs.reduce((a, b) => a + b, 0) / c) * 1000) / 1000;
    return {
      cycleBucket: d.cycleBucket,
      meanSignal: Math.round((d.signals.reduce((a, b) => a + b, 0) / c) * 100) / 100,
      meanEngagement,
      meanHealthPct: Math.round(meanEngagement * 1000) / 10,
      meanRulCapped: Math.round((d.ruls.reduce((a, b) => a + b, 0) / c) * 10) / 10,
      trainMeanRul: avgOrNull(d.trainRuls),
      valMeanRul: avgOrNull(d.valRuls),
      testMeanRul: avgOrNull(d.testRuls),
      anomalyRatePct: rawCount > 0 ? Math.round((d.anomalyCount / rawCount) * 1000) / 10 : 0,
      count: rawCount,
    };
  });

  // Chronological temporal RUL trends across calendar cycle buckets
  const temporalTrends: RulTemporalTrendPoint[] = [];
  if (allCycleRows.length > 0) {
    const minDay = Math.min(...allCycleRows.map((r) => r.timestampDay));
    const maxDay = Math.max(...allCycleRows.map((r) => r.timestampDay));
    const totalSpan = Math.max(1, maxDay - minDay);
    const bucketCount = Math.min(10, Math.max(4, Math.ceil(totalSpan / 30)));
    const stepSize = totalSpan / bucketCount;

    for (let b = 0; b < bucketCount; b++) {
      const lo = Math.round(minDay + b * stepSize);
      const hi = b === bucketCount - 1 ? maxDay : Math.round(minDay + (b + 1) * stepSize - 1);
      const inBucket = allCycleRows.filter((r) =>
        b === bucketCount - 1
          ? r.timestampDay >= lo && r.timestampDay <= hi
          : r.timestampDay >= lo && r.timestampDay <= hi
      );
      if (inBucket.length === 0) continue;

      const sortedCapped = inBucket.map((r) => r.rulCapped).sort((a, c) => a - c);
      const p25 = Math.round(percentileSorted(sortedCapped, 0.25) * 10) / 10;
      const p50 = Math.round(percentileSorted(sortedCapped, 0.5) * 10) / 10;
      const p75 = Math.round(percentileSorted(sortedCapped, 0.75) * 10) / 10;
      const meanCapped =
        Math.round((inBucket.reduce((a, r) => a + r.rulCapped, 0) / inBucket.length) * 10) / 10;
      const meanRaw =
        Math.round((inBucket.reduce((a, r) => a + r.rulRaw, 0) / inBucket.length) * 10) / 10;
      const meanHealthPct =
        Math.round(
          ((inBucket.reduce((a, r) => a + r.engagementScore, 0) / inBucket.length) * 100) * 10
        ) / 10;
      const meanSignal =
        Math.round((inBucket.reduce((a, r) => a + r.spendAmount, 0) / inBucket.length) * 100) /
        100;
      const spikeHits = inBucket.filter((r) => r.isAnomalySpike).length;
      const uniqueUnits = new Set(inBucket.map((r) => r.entityId)).size;

      const tRuls = inBucket.filter((r) => r.split === 'train').map((r) => r.rulCapped);
      const vRuls = inBucket.filter((r) => r.split === 'val').map((r) => r.rulCapped);
      const teRuls = inBucket.filter((r) => r.split === 'test').map((r) => r.rulCapped);

      temporalTrends.push({
        dayRange: `d${lo}–${hi}`,
        midDay: Math.round((lo + hi) / 2),
        meanRulCapped: meanCapped,
        meanRulRaw: meanRaw,
        p25RulCapped: p25,
        p50RulCapped: p50,
        p75RulCapped: p75,
        p25Base: p25,
        iqrSpan: Math.max(0, Math.round((p75 - p25) * 10) / 10),
        trainMeanRul: avgOrNull(tRuls),
        valMeanRul: avgOrNull(vRuls),
        testMeanRul: avgOrNull(teRuls),
        meanHealthPct,
        meanSignal,
        anomalyRatePct: Math.round((spikeHits / inBucket.length) * 1000) / 10,
        activeUnitCount: uniqueUnits,
        cycleCount: inBucket.length,
      });
    }
  }

  // Fleet RUL temporal slope (cycles/day across chronological trend points)
  let rulTrendSlopePerDay = 0;
  if (temporalTrends.length >= 2) {
    const mX = temporalTrends.reduce((a, p) => a + p.midDay, 0) / temporalTrends.length;
    const mY = temporalTrends.reduce((a, p) => a + p.meanRulCapped, 0) / temporalTrends.length;
    let sNum = 0;
    let sDen = 0;
    for (const pt of temporalTrends) {
      sNum += (pt.midDay - mX) * (pt.meanRulCapped - mY);
      sDen += (pt.midDay - mX) ** 2;
    }
    rulTrendSlopePerDay = sDen > 1e-6 ? Math.round((sNum / sDen) * 1000) / 1000 : 0;
  }

  // Early (0-30%) vs Late (70-100%) lifecycle anomaly surge
  const earlyRows = deciles.slice(0, 3);
  const lateRows = deciles.slice(7, 10);
  const earlyCount = earlyRows.reduce((a, d) => a + d.signals.length, 0);
  const earlyAnom = earlyRows.reduce((a, d) => a + d.anomalyCount, 0);
  const lateCount = lateRows.reduce((a, d) => a + d.signals.length, 0);
  const lateAnom = lateRows.reduce((a, d) => a + d.anomalyCount, 0);
  const earlyRate = earlyCount > 0 ? (earlyAnom / earlyCount) * 100 : 0;
  const lateRate = lateCount > 0 ? (lateAnom / lateCount) * 100 : 0;
  const anomalyTrendDeltaPct = Math.round((lateRate - earlyRate) * 10) / 10;

  // Risk tier breakdown across units
  const tierMeta: Array<{ tier: RulRiskTier; label: string; criteriaLabel: string }> = [
    {
      tier: 'critical',
      label: 'Critical Decay',
      criteriaLabel: 'Final health <35% or decay ≤-0.28%/d',
    },
    {
      tier: 'warning',
      label: 'Watch / Moderate',
      criteriaLabel: 'Health <65%, decay ≤-0.08%/d, or ≥2 spikes',
    },
    {
      tier: 'nominal',
      label: 'Nominal Health',
      criteriaLabel: 'Stable health ≥65% & low signal variance',
    },
  ];
  const totalUnits = unitSummaries.length || 1;
  const riskTierBreakdown: RulRiskTierSummary[] = tierMeta.map((meta) => {
    const group = unitSummaries.filter((u) => u.riskTier === meta.tier);
    const gc = group.length || 1;
    return {
      tier: meta.tier,
      label: meta.label,
      criteriaLabel: meta.criteriaLabel,
      unitCount: group.length,
      sharePct: Math.round((group.length / totalUnits) * 1000) / 10,
      meanSlopePctPer100d:
        group.length > 0
          ? Math.round(
              ((group.reduce((a, u) => a + u.degradationSlope, 0) / gc) * 10000) * 10
            ) / 10
          : 0,
      meanSpikes:
        group.length > 0
          ? Math.round((group.reduce((a, u) => a + u.anomalousSpikeCount, 0) / gc) * 10) / 10
          : 0,
      meanRulCapped:
        group.length > 0
          ? Math.round((group.reduce((a, u) => a + u.meanRulCapped, 0) / gc) * 10) / 10
          : 0,
    };
  });

  const meanDegradationSlope =
    unitSummaries.length > 0
      ? Math.round(
          (unitSummaries.reduce((a, u) => a + u.degradationSlope, 0) / unitSummaries.length) *
            10000
        ) / 10000
      : 0;
  const fleetDecayRatePctPer100d = Math.round(meanDegradationSlope * 10000 * 10) / 10;

  const sortedEols = unitSummaries.map((u) => u.eolDay).sort((a, b) => a - b);
  const medianEolDay =
    sortedEols.length > 0 ? sortedEols[Math.floor(sortedEols.length / 2)] : 0;

  const meanRulRaw =
    allCycleRows.length > 0
      ? Math.round(
          (allCycleRows.reduce((a, r) => a + r.rulRaw, 0) / allCycleRows.length) * 10
        ) / 10
      : 0;

  const meanRulCapped =
    allCycleRows.length > 0
      ? Math.round(
          (allCycleRows.reduce((a, r) => a + r.rulCapped, 0) / allCycleRows.length) * 10
        ) / 10
      : 0;

  const anomalySpikeCount = allCycleRows.filter((r) => r.isAnomalySpike).length;

  return {
    unitCount: unitSummaries.length,
    cycleRowCount: allCycleRows.length,
    windowCount: windowSamples.length,
    tensorShape: [windowSamples.length, W, 4],
    meanRulRaw,
    meanRulCapped,
    medianEolDay,
    anomalySpikeCount,
    meanDegradationSlope,
    fleetDecayRatePctPer100d,
    rulTrendSlopePerDay,
    anomalyTrendDeltaPct,
    splitCounts,
    unitSummaries,
    cycleRows: allCycleRows,
    windowSamples,
    rulHistogram: buildHistogram(allCycleRows.map((r) => r.rulCapped), 8),
    degradationCurve,
    temporalTrends,
    riskTierBreakdown,
    featureScalerStats,
  };
}

export function exportRulDatasetCsv(result: RulPreparationResult): string {
  const header =
    'entity_id,split,event_id,cycle_index,timestamp_day,channel,action_label,signal_spend,health_engagement,rolling_mean_signal,zscore_anomaly,is_anomaly_spike,rul_raw,rul_capped';
  const lines = result.cycleRows.map((r) =>
    [
      r.entityId,
      r.split,
      r.eventId,
      r.cycleIndex,
      r.timestampDay,
      `"${r.channel.replace(/"/g, '""')}"`,
      `"${r.actionLabel.replace(/"/g, '""')}"`,
      r.spendAmount,
      r.engagementScore,
      r.rollingMeanSpend,
      r.zScoreAnomaly,
      r.isAnomalySpike ? 1 : 0,
      r.rulRaw,
      r.rulCapped,
    ].join(',')
  );
  return [header, ...lines].join('\n');
}

export function exportRulTensorBundle(
  result: RulPreparationResult,
  config: RulConfig,
  datasetName: string
) {
  return {
    metadata: {
      datasetName,
      format: 'stratum_rul_sliding_window_v1',
      tensorShape: result.tensorShape,
      rulCap: config.rulCap,
      windowLength: config.windowLength,
      stride: config.stride,
      normalization: config.normalization,
      featureNames: result.featureScalerStats.map((s) => s.name),
      scalerStatsFitOnTrain: result.featureScalerStats,
    },
    sample_ids: result.windowSamples.map((s) => s.sampleId),
    entity_ids: result.windowSamples.map((s) => s.entityId),
    splits: result.windowSamples.map((s) => s.split),
    y_rul_capped: result.windowSamples.map((s) => s.rulTargetCapped),
    y_rul_raw: result.windowSamples.map((s) => s.rulTargetRaw),
    X_windows: result.windowSamples.map((s) => s.tensor),
  };
}

export type RulProjectionMethod = 'off' | 'ema' | 'linear';
export type RulForecastAnchor = 'mid_life_65' | 'obs_cutoff' | 'latest_observed';
export type RulCompareAxisMode = 'lifecycle_pct' | 'calendar_day' | 'relative_age';
export type RulCompareMetricMode = 'rul_capped' | 'rul_raw' | 'health_pct' | 'signal';

export interface EntityProjectionSummary {
  entityId: string;
  anchorX: number;
  anchorY: number;
  slopePerX: number;
  methodUsed: RulProjectionMethod;
  failureThreshold: number;
  failureDirection: 'down' | 'up';
  projectedFailureX: number | null;
  actualEolX: number;
  errorVsActualX: number | null;
  remainingToFailureX: number | null;
  status: 'already_failed' | 'imminent' | 'projected' | 'beyond_horizon' | 'stable';
  projectedPoints: Array<{ x: number; y: number }>;
  anchorObservedPoints: Array<{ x: number; y: number }>;
}

export function extractRulCompareMetric(
  row: RulCycleRow,
  metricMode: RulCompareMetricMode
): number {
  if (metricMode === 'rul_raw') return row.rulRaw;
  if (metricMode === 'health_pct') return Math.round(row.engagementScore * 1000) / 10;
  if (metricMode === 'signal') return row.spendAmount;
  return row.rulCapped;
}

function fitLinearRegression(points: Array<{ x: number; y: number }>): {
  slope: number;
  intercept: number;
} {
  if (points.length < 2) {
    return { slope: 0, intercept: points[0]?.y ?? 0 };
  }
  const n = points.length;
  const meanX = points.reduce((a, p) => a + p.x, 0) / n;
  const meanY = points.reduce((a, p) => a + p.y, 0) / n;
  let num = 0;
  let den = 0;
  for (const p of points) {
    const dx = p.x - meanX;
    num += dx * (p.y - meanY);
    den += dx * dx;
  }
  const slope = den > 1e-6 ? num / den : 0;
  const intercept = meanY - slope * meanX;
  return { slope, intercept };
}

function fitHoltEmaTrend(
  points: Array<{ x: number; y: number }>,
  alpha: number
): {
  level: number;
  slopePerX: number;
} {
  if (points.length === 0) return { level: 0, slopePerX: 0 };
  if (points.length === 1) return { level: points[0].y, slopePerX: 0 };

  const clampedAlpha = Math.min(0.9, Math.max(0.15, alpha));
  const beta = Math.min(0.6, Math.max(0.1, clampedAlpha * 0.5));

  let level = points[0].y;
  const firstDx = Math.max(1e-3, points[1].x - points[0].x);
  let trendPerX = (points[1].y - points[0].y) / firstDx;

  for (let i = 1; i < points.length; i++) {
    const dx = Math.max(1e-3, points[i].x - points[i - 1].x);
    const prevLevel = level;
    const expected = prevLevel + trendPerX * dx;
    level = clampedAlpha * points[i].y + (1 - clampedAlpha) * expected;
    const instantSlope = (level - prevLevel) / dx;
    trendPerX = beta * instantSlope + (1 - beta) * trendPerX;
  }

  return { level, slopePerX: trendPerX };
}

export function computeEntityRulProjection(params: {
  entityId: string;
  unitRows: RulCycleRow[];
  summary: RulEntitySummary;
  axisMode: RulCompareAxisMode;
  metricMode: RulCompareMetricMode;
  method: RulProjectionMethod;
  anchorMode: RulForecastAnchor;
  obsCutoffDay: number;
  emaAlpha: number;
  horizonX: number;
  rulCap: number;
  signalFailureCeiling: number;
}): EntityProjectionSummary {
  const {
    entityId,
    unitRows,
    summary,
    axisMode,
    metricMode,
    method,
    anchorMode,
    obsCutoffDay,
    emaAlpha,
    horizonX,
    rulCap,
    signalFailureCeiling,
  } = params;

  const sorted = [...unitRows].sort((a, b) => a.timestampDay - b.timestampDay);
  const firstDay = summary.firstDay ?? sorted[0]?.timestampDay ?? 0;
  const eolDay = summary.eolDay ?? sorted[sorted.length - 1]?.timestampDay ?? firstDay + 1;
  const totalSpanDays = Math.max(1, eolDay - firstDay);

  const toAxisX = (day: number): number => {
    if (axisMode === 'lifecycle_pct') {
      return Math.round(((day - firstDay) / totalSpanDays) * 1000) / 10;
    }
    if (axisMode === 'relative_age') {
      return day - firstDay;
    }
    return day;
  };

  const actualEolX = toAxisX(eolDay);
  const allPoints = sorted.map((r) => ({
    day: r.timestampDay,
    x: toAxisX(r.timestampDay),
    y: extractRulCompareMetric(r, metricMode),
  }));

  let observedSlice = allPoints;
  if (method !== 'off' && allPoints.length >= 3) {
    if (anchorMode === 'mid_life_65') {
      const targetCount = Math.max(3, Math.ceil(allPoints.length * 0.65));
      observedSlice = allPoints.slice(0, Math.min(allPoints.length, targetCount));
    } else if (anchorMode === 'obs_cutoff') {
      const preCutoff = allPoints.filter((p) => p.day <= obsCutoffDay);
      if (preCutoff.length >= 2) {
        observedSlice = preCutoff;
      } else {
        observedSlice = allPoints.slice(0, Math.min(allPoints.length, 3));
      }
    }
  }

  const failureDirection: 'down' | 'up' = metricMode === 'signal' ? 'up' : 'down';
  const failureThreshold =
    metricMode === 'health_pct'
      ? 25
      : metricMode === 'signal'
      ? signalFailureCeiling
      : 0;

  if (observedSlice.length === 0) {
    return {
      entityId,
      anchorX: 0,
      anchorY: 0,
      slopePerX: 0,
      methodUsed: method,
      failureThreshold,
      failureDirection,
      projectedFailureX: null,
      actualEolX,
      errorVsActualX: null,
      remainingToFailureX: null,
      status: 'stable',
      projectedPoints: [],
      anchorObservedPoints: [],
    };
  }

  const anchorPt = observedSlice[observedSlice.length - 1];
  const anchorObservedPoints = observedSlice.map((p) => ({ x: p.x, y: p.y }));

  if (method === 'off') {
    return {
      entityId,
      anchorX: anchorPt.x,
      anchorY: anchorPt.y,
      slopePerX: 0,
      methodUsed: 'off',
      failureThreshold,
      failureDirection,
      projectedFailureX: null,
      actualEolX,
      errorVsActualX: null,
      remainingToFailureX: null,
      status: 'stable',
      projectedPoints: [],
      anchorObservedPoints,
    };
  }

  // Fit slope either via time-normalized Holt EMA or trailing OLS linear extrapolation
  const startY = anchorPt.y;
  let slopePerX = 0;

  let activeSlice = observedSlice;
  if (metricMode === 'rul_capped') {
    const nonCapIdx = observedSlice.findIndex((p) => p.y < rulCap - 0.5);
    if (nonCapIdx >= 0 && observedSlice.length - nonCapIdx >= 2) {
      activeSlice = observedSlice.slice(Math.max(0, nonCapIdx - 1));
    }
  }

  if (method === 'ema') {
    const ema = fitHoltEmaTrend(activeSlice, emaAlpha);
    slopePerX = ema.slopePerX;
  } else {
    let fitWindow = activeSlice;
    if (metricMode !== 'rul_capped' && activeSlice.length > 5) {
      fitWindow = activeSlice.slice(Math.floor(activeSlice.length * 0.3));
    } else if (metricMode === 'rul_capped' && activeSlice === observedSlice && observedSlice.length > 4) {
      fitWindow = observedSlice.slice(Math.floor(observedSlice.length * 0.35));
    }
    const ols = fitLinearRegression(fitWindow);
    slopePerX = ols.slope;
  }

  const alreadyFailed =
    failureDirection === 'down'
      ? anchorPt.y <= failureThreshold
      : anchorPt.y >= failureThreshold;

  let projectedFailureX: number | null = null;
  let remainingToFailureX: number | null = null;
  let status: EntityProjectionSummary['status'] = 'stable';

  if (alreadyFailed) {
    projectedFailureX = anchorPt.x;
    remainingToFailureX = 0;
    status = 'already_failed';
  } else {
    const movingTowardFailure =
      failureDirection === 'down' ? slopePerX < -1e-4 : slopePerX > 1e-4;
    if (movingTowardFailure) {
      const deltaToThreshold = (failureThreshold - startY) / slopePerX;
      if (deltaToThreshold > 0 && Number.isFinite(deltaToThreshold)) {
        projectedFailureX = Math.round((anchorPt.x + deltaToThreshold) * 10) / 10;
        remainingToFailureX = Math.round(deltaToThreshold * 10) / 10;
        if (deltaToThreshold <= horizonX) {
          const imminentCutoff = axisMode === 'lifecycle_pct' ? 15 : 30;
          status = deltaToThreshold <= imminentCutoff ? 'imminent' : 'projected';
        } else {
          status = 'beyond_horizon';
        }
      }
    }
  }

  // Generate projected trajectory points from anchorX up to min(anchorX + horizonX, projectedFailureX)
  const effectiveEndDelta =
    projectedFailureX !== null && projectedFailureX > anchorPt.x
      ? Math.min(horizonX, projectedFailureX - anchorPt.x)
      : horizonX;

  const projectedPoints: Array<{ x: number; y: number }> = [];
  if (!alreadyFailed && effectiveEndDelta > 0) {
    const stepCount = axisMode === 'lifecycle_pct' ? 8 : 10;
    projectedPoints.push({ x: anchorPt.x, y: Math.round(anchorPt.y * 10) / 10 });
    for (let s = 1; s <= stepCount; s++) {
      const dx = (effectiveEndDelta * s) / stepCount;
      const rawX = Math.round((anchorPt.x + dx) * 10) / 10;
      let rawY = startY + slopePerX * dx;
      if (failureDirection === 'down') {
        rawY = Math.max(failureThreshold, rawY);
      }
      if (metricMode === 'health_pct') {
        rawY = Math.min(100, Math.max(0, rawY));
      }
      projectedPoints.push({
        x: rawX,
        y: Math.round(rawY * 10) / 10,
      });
    }
  }

  const errorVsActualX =
    projectedFailureX !== null && anchorMode !== 'latest_observed'
      ? Math.round((projectedFailureX - actualEolX) * 10) / 10
      : null;

  return {
    entityId,
    anchorX: Math.round(anchorPt.x * 10) / 10,
    anchorY: Math.round(anchorPt.y * 10) / 10,
    slopePerX: Math.round(slopePerX * 1000) / 1000,
    methodUsed: method,
    failureThreshold,
    failureDirection,
    projectedFailureX,
    actualEolX: Math.round(actualEolX * 10) / 10,
    errorVsActualX,
    remainingToFailureX,
    status,
    projectedPoints,
    anchorObservedPoints,
  };
}

export interface FailurePdfPoint {
  dayOffset: number;
  dayLabel: string;
  density: number; // probability per day
  densityPctPer10d: number; // density * 1000 for readable % per 10-day band
  windowDensityPctPer10d: number | null;
  cumulativePct: number;
}

export interface FailurePdfResult {
  activeUnitCount: number;
  alreadyEolCount: number;
  excludedShortCount: number;
  windowStartDays: number;
  windowEndDays: number;
  windowProbabilityPct: number;
  expectedFailureUnits: number;
  peakDay: number;
  peakDensityPctPer10d: number;
  medianTtfDay: number | null;
  meanTtfDay: number | null;
  p90TtfDay: number | null;
  meanUncertaintyDays: number;
  points: FailurePdfPoint[];
}

// Abramowitz & Stegun normal CDF approximation (error < 7.5e-8)
function normalCdf(z: number): number {
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t +
      0.254829592) *
      t *
      Math.exp(-x * x);
  return 0.5 * (1 + sign * y);
}

export function buildFailureProbabilityDensity(params: {
  unitSummaries: RulEntitySummary[];
  cycleRows: RulCycleRow[];
  method: 'ema' | 'linear';
  anchorMode: 'obs_cutoff' | 'mid_life_65';
  obsCutoffDay: number;
  emaAlpha: number;
  rulCap: number;
  windowStartDays: number;
  windowEndDays: number;
  maxHorizonDays?: number;
}): FailurePdfResult {
  const {
    unitSummaries,
    cycleRows,
    method,
    anchorMode,
    obsCutoffDay,
    emaAlpha,
    rulCap,
    windowStartDays,
    windowEndDays,
    maxHorizonDays = 240,
  } = params;

  const wStart = Math.max(0, Math.min(maxHorizonDays, windowStartDays));
  const wEnd = Math.max(wStart, Math.min(maxHorizonDays, windowEndDays));

  const rowsByEntity = new Map<string, RulCycleRow[]>();
  for (const r of cycleRows) {
    const arr = rowsByEntity.get(r.entityId) ?? [];
    arr.push(r);
    rowsByEntity.set(r.entityId, arr);
  }

  let alreadyEolCount = 0;
  let excludedShortCount = 0;
  const components: Array<{ mu: number; sigma: number; normFactor: number }> = [];

  for (const u of unitSummaries) {
    const uRows = (rowsByEntity.get(u.entityId) ?? []).sort(
      (a, b) => a.timestampDay - b.timestampDay
    );
    if (uRows.length < 2) {
      excludedShortCount += 1;
      continue;
    }

    if (anchorMode === 'obs_cutoff' && u.eolDay <= obsCutoffDay) {
      alreadyEolCount += 1;
      continue;
    }

    // Check active observation slice
    let obsRows = uRows;
    if (anchorMode === 'obs_cutoff') {
      const pre = uRows.filter((r) => r.timestampDay <= obsCutoffDay);
      if (pre.length < 2) {
        excludedShortCount += 1;
        continue;
      }
      obsRows = pre;
    } else {
      const targetCount = Math.max(2, Math.ceil(uRows.length * 0.65));
      obsRows = uRows.slice(0, Math.min(uRows.length, targetCount));
    }

    // Primary trend estimate from Health Index (%) trajectory
    const healthProj = computeEntityRulProjection({
      entityId: u.entityId,
      unitRows: uRows,
      summary: u,
      axisMode: 'calendar_day',
      metricMode: 'health_pct',
      method,
      anchorMode,
      obsCutoffDay,
      emaAlpha,
      horizonX: maxHorizonDays,
      rulCap,
      signalFailureCeiling: 150,
    });

    // Backup / calibration countdown from RUL raw trajectory
    const rulProj = computeEntityRulProjection({
      entityId: u.entityId,
      unitRows: uRows,
      summary: u,
      axisMode: 'calendar_day',
      metricMode: 'rul_raw',
      method,
      anchorMode,
      obsCutoffDay,
      emaAlpha,
      horizonX: maxHorizonDays,
      rulCap,
      signalFailureCeiling: 150,
    });

    let muDays: number | null = null;
    if (
      healthProj.remainingToFailureX !== null &&
      healthProj.remainingToFailureX > 0 &&
      healthProj.remainingToFailureX <= maxHorizonDays * 1.6
    ) {
      if (rulProj.remainingToFailureX !== null && rulProj.remainingToFailureX > 0) {
        // Blend health-trend crossing with RUL countdown so both velocity & cycle budget inform mu
        muDays = 0.65 * healthProj.remainingToFailureX + 0.35 * rulProj.remainingToFailureX;
      } else {
        muDays = healthProj.remainingToFailureX;
      }
    } else if (rulProj.remainingToFailureX !== null && rulProj.remainingToFailureX > 0) {
      muDays = rulProj.remainingToFailureX;
    } else {
      const anchorDay = obsRows[obsRows.length - 1].timestampDay;
      const fallbackRemaining = Math.max(5, u.eolDay - anchorDay);
      muDays = fallbackRemaining;
    }

    // Estimate uncertainty sigma (days) from observed health residuals + anomaly spikes
    const anchorDay = obsRows[obsRows.length - 1].timestampDay;
    const anchorHealth = obsRows[obsRows.length - 1].engagementScore * 100;
    const slopeH = healthProj.slopePerX;
    let sqErr = 0;
    for (const r of obsRows) {
      const predH = anchorHealth + slopeH * (r.timestampDay - anchorDay);
      const err = r.engagementScore * 100 - predH;
      sqErr += err * err;
    }
    const rmseHealth = Math.sqrt(sqErr / obsRows.length);
    const spikeCountInSlice = obsRows.filter((r) => r.isAnomalySpike).length;
    const baseSigma = Math.max(9, Math.min(48, 8 + rmseHealth * 0.85 + spikeCountInSlice * 4.5 + muDays * 0.08));
    const normFactor = Math.max(1e-4, 1 - normalCdf((0 - muDays) / baseSigma));

    components.push({ mu: muDays, sigma: baseSigma, normFactor });
  }

  const step = 5;
  const gridDays: number[] = [];
  for (let d = 0; d <= maxHorizonDays; d += step) {
    gridDays.push(d);
  }

  if (components.length === 0) {
    return {
      activeUnitCount: 0,
      alreadyEolCount,
      excludedShortCount,
      windowStartDays: wStart,
      windowEndDays: wEnd,
      windowProbabilityPct: 0,
      expectedFailureUnits: 0,
      peakDay: 0,
      peakDensityPctPer10d: 0,
      medianTtfDay: null,
      meanTtfDay: null,
      p90TtfDay: null,
      meanUncertaintyDays: 0,
      points: gridDays.map((d) => ({
        dayOffset: d,
        dayLabel: `+${d}d`,
        density: 0,
        densityPctPer10d: 0,
        windowDensityPctPer10d: d >= wStart && d <= wEnd ? 0 : null,
        cumulativePct: 0,
      })),
    };
  }

  const rawDensities = gridDays.map((t) => {
    let sum = 0;
    for (const c of components) {
      const z = (t - c.mu) / c.sigma;
      const pdf = Math.exp(-0.5 * z * z) / (c.sigma * Math.sqrt(2 * Math.PI) * c.normFactor);
      sum += pdf;
    }
    return sum / components.length;
  });

  // Trapezoidal cumulative integration for CDF & window probability
  const cdfs: number[] = [0];
  for (let i = 1; i < gridDays.length; i++) {
    const dt = gridDays[i] - gridDays[i - 1];
    const area = 0.5 * (rawDensities[i - 1] + rawDensities[i]) * dt;
    cdfs.push(Math.min(1, cdfs[i - 1] + area));
  }

  const startIdx = Math.max(0, Math.min(gridDays.length - 1, Math.round(wStart / step)));
  const endIdx = Math.max(startIdx, Math.min(gridDays.length - 1, Math.round(wEnd / step)));
  const windowProb = Math.max(0, Math.min(1, cdfs[endIdx] - cdfs[startIdx]));
  const windowProbabilityPct = Math.round(windowProb * 1000) / 10;

  let peakIdx = 0;
  for (let i = 1; i < rawDensities.length; i++) {
    if (rawDensities[i] > rawDensities[peakIdx]) peakIdx = i;
  }

  const medianIdx = cdfs.findIndex((c) => c >= 0.5);
  const p90Idx = cdfs.findIndex((c) => c >= 0.9);
  const meanTtfDay =
    Math.round((components.reduce((a, c) => a + c.mu, 0) / components.length) * 10) / 10;
  const meanUncertaintyDays =
    Math.round((components.reduce((a, c) => a + c.sigma, 0) / components.length) * 10) / 10;

  const points: FailurePdfPoint[] = gridDays.map((d, idx) => {
    const density = rawDensities[idx];
    const densityPctPer10d = Math.round(density * 1000 * 100) / 100; // % likelihood per 10-day window
    return {
      dayOffset: d,
      dayLabel: `+${d}d`,
      density: Math.round(density * 100000) / 100000,
      densityPctPer10d,
      windowDensityPctPer10d: d >= wStart && d <= wEnd ? densityPctPer10d : null,
      cumulativePct: Math.round(cdfs[idx] * 1000) / 10,
    };
  });

  return {
    activeUnitCount: components.length,
    alreadyEolCount,
    excludedShortCount,
    windowStartDays: wStart,
    windowEndDays: wEnd,
    windowProbabilityPct,
    expectedFailureUnits: Math.round((windowProb * components.length) * 10) / 10,
    peakDay: gridDays[peakIdx],
    peakDensityPctPer10d: points[peakIdx].densityPctPer10d,
    medianTtfDay: medianIdx >= 0 ? gridDays[medianIdx] : null,
    meanTtfDay,
    p90TtfDay: p90Idx >= 0 ? gridDays[p90Idx] : null,
    meanUncertaintyDays,
    points,
  };
}

export type AnomalyTrendBasis = 'ema' | 'linear';

export interface TrendAnomalyPoint {
  x: number;
  y: number;
  trendY: number;
  residual: number;
  zScore: number;
  upperBand: number;
  lowerBand: number;
  isAnomaly: boolean;
}

export interface TrendAnomalyAnalysis {
  residualStd: number;
  thresholdSigma: number;
  trendBasis: AnomalyTrendBasis;
  anomalyCount: number;
  maxAbsZScore: number;
  slopePerX: number;
  points: TrendAnomalyPoint[];
}

export function detectTrendLineAnomalies(params: {
  points: Array<{ x: number; y: number }>;
  trendBasis: AnomalyTrendBasis;
  thresholdSigma: number;
  emaAlpha?: number;
}): TrendAnomalyAnalysis {
  const { points, trendBasis, thresholdSigma, emaAlpha = 0.38 } = params;
  const clampedSigma = Math.max(0.5, Math.min(5, thresholdSigma));

  if (points.length === 0) {
    return {
      residualStd: 0,
      thresholdSigma: clampedSigma,
      trendBasis,
      anomalyCount: 0,
      maxAbsZScore: 0,
      slopePerX: 0,
      points: [],
    };
  }

  const ordered = points
    .map((pt, idx) => ({ ...pt, idx }))
    .sort((a, b) => a.x - b.x || a.idx - b.idx);

  const n = ordered.length;
  const trendYs = new Array<number>(n);
  let slopePerX = 0;

  if (n < 3) {
    for (let i = 0; i < n; i++) {
      trendYs[i] = ordered[i].y;
    }
  } else if (trendBasis === 'linear') {
    const { slope, intercept } = fitLinearRegression(ordered);
    slopePerX = slope;
    for (let i = 0; i < n; i++) {
      trendYs[i] = intercept + slope * ordered[i].x;
    }
  } else {
    // Zero-phase bidirectional EMA trend line so smooth curved degradation is tracked without lag
    const alpha = Math.min(0.65, Math.max(0.2, emaAlpha));
    const fwd = new Array<number>(n);
    const bwd = new Array<number>(n);
    fwd[0] = ordered[0].y;
    for (let i = 1; i < n; i++) {
      fwd[i] = alpha * ordered[i].y + (1 - alpha) * fwd[i - 1];
    }
    bwd[n - 1] = ordered[n - 1].y;
    for (let i = n - 2; i >= 0; i--) {
      bwd[i] = alpha * ordered[i].y + (1 - alpha) * bwd[i + 1];
    }
    for (let i = 0; i < n; i++) {
      trendYs[i] = 0.5 * (fwd[i] + bwd[i]);
    }
    const spanX = Math.max(1e-4, ordered[n - 1].x - ordered[0].x);
    slopePerX = (trendYs[n - 1] - trendYs[0]) / spanX;
  }

  const residuals = ordered.map((pt, i) => pt.y - trendYs[i]);
  const df = trendBasis === 'linear' && n > 3 ? 2 : 1;
  const variance =
    n >= 3
      ? residuals.reduce((acc, r) => acc + r * r, 0) / Math.max(1, n - df)
      : 0;
  const residualStd = Math.sqrt(variance);
  const bandHalfWidth = clampedSigma * residualStd;

  let anomalyCount = 0;
  let maxAbsZScore = 0;

  const analyzedOrdered: TrendAnomalyPoint[] = ordered.map((pt, i) => {
    const residual = residuals[i];
    const zScore = residualStd > 1e-6 ? residual / residualStd : 0;
    const absZ = Math.abs(zScore);
    if (absZ > maxAbsZScore) maxAbsZScore = absZ;
    const isAnomaly = n >= 3 && residualStd > 1e-6 && absZ >= clampedSigma;
    if (isAnomaly) anomalyCount += 1;

    return {
      x: pt.x,
      y: pt.y,
      trendY: Math.round(trendYs[i] * 100) / 100,
      residual: Math.round(residual * 100) / 100,
      zScore: Math.round(zScore * 100) / 100,
      upperBand: Math.round((trendYs[i] + bandHalfWidth) * 100) / 100,
      lowerBand: Math.round((trendYs[i] - bandHalfWidth) * 100) / 100,
      isAnomaly,
    };
  });

  // Restore original caller order
  const restored = new Array<TrendAnomalyPoint>(n);
  for (let i = 0; i < n; i++) {
    restored[ordered[i].idx] = analyzedOrdered[i];
  }

  return {
    residualStd: Math.round(residualStd * 100) / 100,
    thresholdSigma: clampedSigma,
    trendBasis,
    anomalyCount,
    maxAbsZScore: Math.round(maxAbsZScore * 100) / 100,
    slopePerX: Math.round(slopePerX * 1000) / 1000,
    points: restored,
  };
}

export type SeasonalityMetricMode = 'rul_capped' | 'health_pct' | 'signal';

export interface SeasonalityHarmonic {
  rank: number;
  binIndex: number;
  periodDays: number;
  frequencyPerDay: number;
  amplitude: number;
  power: number;
  energySharePct: number;
  phaseRad: number;
  cycleLabel: string;
}

export interface SeasonalitySpectrumBin {
  binIndex: number;
  periodDays: number;
  periodLabel: string;
  frequencyPerDay: number;
  amplitude: number;
  power: number;
  energySharePct: number;
  isDominant: boolean;
}

export interface SeasonalitySeriesPoint {
  day: number;
  dayLabel: string;
  observedValue: number;
  trendValue: number;
  detrendedResidual: number;
  fourierPeriodic: number;
  fourierCombined: number;
}

export interface SeasonalityAnalysisResult {
  hasEnoughData: boolean;
  sampleCount: number;
  stepDays: number;
  spanDays: number;
  residualStd: number;
  periodicVarianceExplainedPct: number;
  dominantPeriodDays: number | null;
  dominantFrequencyPerDay: number | null;
  dominantAmplitude: number;
  dominantCycleLabel: string;
  harmonics: SeasonalityHarmonic[];
  spectrum: SeasonalitySpectrumBin[];
  reconstructedSeries: SeasonalitySeriesPoint[];
}

function classifyCyclePeriod(periodDays: number): string {
  if (periodDays <= 4.5) return 'High-Frequency Jitter';
  if (periodDays <= 9.5) return 'Weekly Operational Cycle';
  if (periodDays <= 17.5) return 'Bi-Weekly Maintenance Cycle';
  if (periodDays <= 35) return 'Monthly Duty Cycle';
  if (periodDays <= 75) return 'Multi-Month Regime Wave';
  return 'Macro Lifecycle Harmonic';
}

export function analyzeRulSeasonality(params: {
  cycleRows: RulCycleRow[];
  unitIds: string[];
  metric: SeasonalityMetricMode;
  topHarmonics?: number;
}): SeasonalityAnalysisResult {
  const { cycleRows, unitIds, metric, topHarmonics = 3 } = params;
  const kCount = Math.max(1, Math.min(5, Math.round(topHarmonics)));

  const emptyResult: SeasonalityAnalysisResult = {
    hasEnoughData: false,
    sampleCount: 0,
    stepDays: 1,
    spanDays: 0,
    residualStd: 0,
    periodicVarianceExplainedPct: 0,
    dominantPeriodDays: null,
    dominantFrequencyPerDay: null,
    dominantAmplitude: 0,
    dominantCycleLabel: 'Insufficient cycles',
    harmonics: [],
    spectrum: [],
    reconstructedSeries: [],
  };

  if (unitIds.length === 0 || cycleRows.length === 0) return emptyResult;

  const allowedSet = new Set(unitIds);
  const dailyBuckets = new Map<number, { sum: number; count: number }>();

  for (const row of cycleRows) {
    if (!allowedSet.has(row.entityId)) continue;
    const val =
      metric === 'health_pct'
        ? row.engagementScore * 100
        : metric === 'signal'
        ? row.spendAmount
        : row.rulCapped;
    const cur = dailyBuckets.get(row.timestampDay) ?? { sum: 0, count: 0 };
    cur.sum += val;
    cur.count += 1;
    dailyBuckets.set(row.timestampDay, cur);
  }

  const dailyPoints = Array.from(dailyBuckets.entries())
    .map(([day, agg]) => ({ day, value: agg.sum / agg.count }))
    .sort((a, b) => a.day - b.day);

  if (dailyPoints.length < 4) return emptyResult;

  const minDay = dailyPoints[0].day;
  const maxDay = dailyPoints[dailyPoints.length - 1].day;
  const spanDays = maxDay - minDay;
  if (spanDays < 3) return emptyResult;

  // Build uniform sampling grid (<= 160 samples) for exact real-input DFT
  const stepDays = Math.max(1, Math.ceil(spanDays / 150));
  const gridDays: number[] = [];
  for (let d = minDay; d <= maxDay; d += stepDays) {
    gridDays.push(d);
  }
  if (gridDays.length < 4) return emptyResult;

  const N = gridDays.length;
  const sampledY: number[] = [];
  let ptr = 0;

  for (const targetDay of gridDays) {
    while (ptr + 1 < dailyPoints.length && dailyPoints[ptr + 1].day < targetDay) {
      ptr += 1;
    }
    const p0 = dailyPoints[ptr];
    const p1 = dailyPoints[Math.min(dailyPoints.length - 1, ptr + 1)];
    if (p1.day === p0.day || targetDay <= p0.day) {
      sampledY.push(p0.value);
    } else if (targetDay >= p1.day) {
      sampledY.push(p1.value);
    } else {
      const t = (targetDay - p0.day) / (p1.day - p0.day);
      sampledY.push(p0.value + t * (p1.value - p0.value));
    }
  }

  // Linearly detrend sampled signal via OLS so monotonic RUL ramp does not mask periodic cycles
  const regressionPts = sampledY.map((y, idx) => ({ x: idx, y }));
  const { slope, intercept } = fitLinearRegression(regressionPts);
  const trendValues = sampledY.map((_, idx) => intercept + slope * idx);
  const residuals = sampledY.map((y, idx) => y - trendValues[idx]);

  const totalResidualVar =
    residuals.reduce((acc, r) => acc + r * r, 0) / Math.max(1, N);
  const residualStd = Math.sqrt(totalResidualVar);

  const maxBin = Math.floor(N / 2);
  if (maxBin < 1) return emptyResult;

  interface RawBin {
    binIndex: number;
    re: number;
    im: number;
    amplitude: number;
    power: number;
    phaseRad: number;
    periodDays: number;
    frequencyPerDay: number;
  }

  const rawBins: RawBin[] = [];
  let totalPower = 0;

  for (let k = 1; k <= maxBin; k++) {
    let re = 0;
    let im = 0;
    const baseAngle = (2 * Math.PI * k) / N;
    for (let n = 0; n < N; n++) {
      const angle = baseAngle * n;
      re += residuals[n] * Math.cos(angle);
      im -= residuals[n] * Math.sin(angle);
    }
    const mag = Math.sqrt(re * re + im * im);
    const isNyquist = N % 2 === 0 && k === maxBin;
    const amplitude = ((isNyquist ? 1 : 2) / N) * mag;
    const power = (re * re + im * im) / N;
    const phaseRad = Math.atan2(im, re);
    const periodDays = (N * stepDays) / k;
    const frequencyPerDay = k / (N * stepDays);

    totalPower += power;
    rawBins.push({
      binIndex: k,
      re,
      im,
      amplitude,
      power,
      phaseRad,
      periodDays,
      frequencyPerDay,
    });
  }

  const rankedByPower = [...rawBins].sort((a, b) => b.power - a.power);
  const dominantBins = rankedByPower.slice(0, Math.min(kCount, rankedByPower.length));
  const dominantSet = new Set(dominantBins.map((b) => b.binIndex));

  const harmonics: SeasonalityHarmonic[] = dominantBins.map((b, idx) => ({
    rank: idx + 1,
    binIndex: b.binIndex,
    periodDays: Math.round(b.periodDays * 10) / 10,
    frequencyPerDay: Math.round(b.frequencyPerDay * 10000) / 10000,
    amplitude: Math.round(b.amplitude * 100) / 100,
    power: Math.round(b.power * 100) / 100,
    energySharePct:
      totalPower > 1e-9 ? Math.round((b.power / totalPower) * 1000) / 10 : 0,
    phaseRad: Math.round(b.phaseRad * 100) / 100,
    cycleLabel: classifyCyclePeriod(b.periodDays),
  }));

  // Build periodogram sorted by period ascending (shortest to longest cycle) capped to 36 informative bins
  const spectrumSorted = [...rawBins]
    .sort((a, b) => a.periodDays - b.periodDays)
    .slice(0, 36)
    .map((b) => ({
      binIndex: b.binIndex,
      periodDays: Math.round(b.periodDays * 10) / 10,
      periodLabel: `${Math.round(b.periodDays * 10) / 10}d`,
      frequencyPerDay: Math.round(b.frequencyPerDay * 10000) / 10000,
      amplitude: Math.round(b.amplitude * 1000) / 1000,
      power: Math.round(b.power * 100) / 100,
      energySharePct:
        totalPower > 1e-9 ? Math.round((b.power / totalPower) * 1000) / 10 : 0,
      isDominant: dominantSet.has(b.binIndex),
    }));

  // Inverse DFT reconstruction using only the Top-K dominant periodic harmonics
  const periodicSignals = new Array<number>(N).fill(0);
  for (let n = 0; n < N; n++) {
    let sum = 0;
    for (const b of dominantBins) {
      const isNyquist = N % 2 === 0 && b.binIndex === maxBin;
      const weight = (isNyquist ? 1 : 2) / N;
      const angle = (2 * Math.PI * b.binIndex * n) / N;
      sum += weight * (b.re * Math.cos(angle) - b.im * Math.sin(angle));
    }
    periodicSignals[n] = sum;
  }

  const periodicVar =
    periodicSignals.reduce((acc, s) => acc + s * s, 0) / Math.max(1, N);
  const periodicVarianceExplainedPct =
    totalResidualVar > 1e-9
      ? Math.min(100, Math.max(0, Math.round((periodicVar / totalResidualVar) * 1000) / 10))
      : 0;

  const reconstructedSeries: SeasonalitySeriesPoint[] = gridDays.map((day, idx) => ({
    day,
    dayLabel: `d${day}`,
    observedValue: Math.round(sampledY[idx] * 100) / 100,
    trendValue: Math.round(trendValues[idx] * 100) / 100,
    detrendedResidual: Math.round(residuals[idx] * 100) / 100,
    fourierPeriodic: Math.round(periodicSignals[idx] * 100) / 100,
    fourierCombined: Math.round((trendValues[idx] + periodicSignals[idx]) * 100) / 100,
  }));

  const topHarmonic = harmonics[0] ?? null;

  return {
    hasEnoughData: true,
    sampleCount: N,
    stepDays,
    spanDays,
    residualStd: Math.round(residualStd * 100) / 100,
    periodicVarianceExplainedPct,
    dominantPeriodDays: topHarmonic ? topHarmonic.periodDays : null,
    dominantFrequencyPerDay: topHarmonic ? topHarmonic.frequencyPerDay : null,
    dominantAmplitude: topHarmonic ? topHarmonic.amplitude : 0,
    dominantCycleLabel: topHarmonic ? topHarmonic.cycleLabel : 'No periodic signal',
    harmonics,
    spectrum: spectrumSorted,
    reconstructedSeries,
  };
}

export type HeatmapAgeBasis = 'fleet_span' | 'unit_lifecycle';
export type HeatmapDensityMode = 'failure_hazard' | 'eol_endpoints' | 'occupancy';

export interface DegradationHeatmapCell {
  ageIdx: number;
  damageIdx: number;
  ageLabel: string;
  damageLabel: string;
  failureDensityPct: number;
  eolCount: number;
  cycleCount: number;
  activeEntityCount: number;
  meanRulRaw: number | null;
  intensity: number;
  entityIds: string[];
}

export interface DegradationHeatmapRow {
  damageIdx: number;
  damageLabel: string;
  rowSharePct: number;
  cells: DegradationHeatmapCell[];
}

export interface PopulationDegradationHeatmapResult {
  totalEntities: number;
  totalCycles: number;
  totalEolEvents: number;
  ageLabels: string[];
  rows: DegradationHeatmapRow[];
  hotspotAgeLabel: string;
  hotspotDamageLabel: string;
  hotspotDensityPct: number;
  hotspotEolCount: number;
  highDamageEolSharePct: number;
  meanDamageAtFailure: number;
  stdDamageAtFailure: number;
}

export function buildPopulationDegradationHeatmap(params: {
  unitSummaries: RulEntitySummary[];
  cycleRows: RulCycleRow[];
  ageBasis: HeatmapAgeBasis;
  densityMode: HeatmapDensityMode;
}): PopulationDegradationHeatmapResult {
  const { unitSummaries, cycleRows, ageBasis, densityMode } = params;

  const AGE_BINS = 10;
  const DAMAGE_BINS = 8;
  const ageLabels = Array.from({ length: AGE_BINS }, (_, i) => `${i * 10}–${(i + 1) * 10}%`);
  const damageLabels = Array.from({ length: DAMAGE_BINS }, (_, i) => {
    const lo = (i * 100) / DAMAGE_BINS;
    const hi = ((i + 1) * 100) / DAMAGE_BINS;
    return `${lo.toFixed(0)}–${hi.toFixed(0)}`;
  });

  const makeEmptyGrid = (): PopulationDegradationHeatmapResult => ({
    totalEntities: 0,
    totalCycles: 0,
    totalEolEvents: 0,
    ageLabels,
    rows: Array.from({ length: DAMAGE_BINS }, (_, rev) => {
      const damageIdx = DAMAGE_BINS - 1 - rev;
      return {
        damageIdx,
        damageLabel: damageLabels[damageIdx],
        rowSharePct: 0,
        cells: Array.from({ length: AGE_BINS }, (__, ageIdx) => ({
          ageIdx,
          damageIdx,
          ageLabel: ageLabels[ageIdx],
          damageLabel: damageLabels[damageIdx],
          failureDensityPct: 0,
          eolCount: 0,
          cycleCount: 0,
          activeEntityCount: 0,
          meanRulRaw: null,
          intensity: 0,
          entityIds: [],
        })),
      };
    }),
    hotspotAgeLabel: '—',
    hotspotDamageLabel: '—',
    hotspotDensityPct: 0,
    hotspotEolCount: 0,
    highDamageEolSharePct: 0,
    meanDamageAtFailure: 0,
    stdDamageAtFailure: 0,
  });

  if (unitSummaries.length === 0 || cycleRows.length === 0) {
    return makeEmptyGrid();
  }

  const allowedSet = new Set(unitSummaries.map((u) => u.entityId));
  const summaryMap = new Map(unitSummaries.map((u) => [u.entityId, u]));
  const rowsByUnit = new Map<string, RulCycleRow[]>();
  const allSpends: number[] = [];

  for (const r of cycleRows) {
    if (!allowedSet.has(r.entityId)) continue;
    const arr = rowsByUnit.get(r.entityId) ?? [];
    arr.push(r);
    rowsByUnit.set(r.entityId, arr);
    allSpends.push(r.spendAmount);
  }

  if (allSpends.length === 0) return makeEmptyGrid();

  const sortedSpends = [...allSpends].sort((a, b) => a - b);
  const signalRef = Math.max(1e-3, percentileSorted(sortedSpends, 0.9));

  const sortedSpans = unitSummaries
    .map((u) => Math.max(1, u.eolDay - u.firstDay))
    .sort((a, b) => a - b);
  const fleetSpanRef = Math.max(1, percentileSorted(sortedSpans, 0.95));

  // Pass 1: Compute raw cumulative wear trajectory per unit
  interface UnitStepPoint {
    entityId: string;
    normAgePct: number;
    rawCumWear: number;
    healthDeficit: number;
    rulRaw: number;
    isEol: boolean;
  }

  const unitTrajectories = new Map<string, UnitStepPoint[]>();
  const terminalRawWears: number[] = [];

  for (const u of unitSummaries) {
    const uRows = (rowsByUnit.get(u.entityId) ?? []).sort(
      (a, b) => a.timestampDay - b.timestampDay
    );
    if (uRows.length === 0) continue;

    const unitSpan = Math.max(1, u.eolDay - u.firstDay);
    const ageDenom = ageBasis === 'fleet_span' ? fleetSpanRef : unitSpan;
    let cumWear = 0;
    const steps: UnitStepPoint[] = [];

    for (let i = 0; i < uRows.length; i++) {
      const r = uRows[i];
      const dt = i === 0 ? 1 : Math.max(1, r.timestampDay - uRows[i - 1].timestampDay);
      const healthDeficit = Math.max(0, Math.min(1, 1 - r.engagementScore));
      const spikeShock = r.isAnomalySpike
        ? 1
        : Math.min(0.6, Math.max(0, Math.abs(r.zScoreAnomaly) - 1.0) * 0.3);
      const stressRatio = Math.min(1, Math.max(0, r.spendAmount / signalRef));
      const stepWear = dt * (0.55 * healthDeficit + 0.25 * stressRatio + 0.2 * spikeShock);
      cumWear += stepWear;

      const normAgePct = Math.min(
        100,
        Math.max(0, ((r.timestampDay - u.firstDay) / ageDenom) * 100)
      );

      steps.push({
        entityId: u.entityId,
        normAgePct,
        rawCumWear: cumWear,
        healthDeficit,
        rulRaw: r.rulRaw,
        isEol: i === uRows.length - 1,
      });
    }

    unitTrajectories.set(u.entityId, steps);
    terminalRawWears.push(cumWear);
  }

  if (unitTrajectories.size === 0) return makeEmptyGrid();

  const sortedTerminalWear = [...terminalRawWears].sort((a, b) => a - b);
  const wearRef = Math.max(1e-3, percentileSorted(sortedTerminalWear, 0.95));

  // Initialize 8x10 accumulator matrix (damageIdx 0..7, ageIdx 0..9)
  interface CellAcc {
    hazardMass: number;
    eolCount: number;
    cycleCount: number;
    rulSum: number;
    entities: Set<string>;
  }

  const accGrid: CellAcc[][] = Array.from({ length: DAMAGE_BINS }, () =>
    Array.from({ length: AGE_BINS }, () => ({
      hazardMass: 0,
      eolCount: 0,
      cycleCount: 0,
      rulSum: 0,
      entities: new Set<string>(),
    }))
  );

  const eolDamages: number[] = [];
  let totalCycles = 0;
  let totalEolEvents = 0;

  for (const steps of unitTrajectories.values()) {
    for (const st of steps) {
      const cumWearNorm = Math.min(1, st.rawCumWear / wearRef);
      const damageScore = Math.min(
        100,
        Math.max(0, (0.62 * cumWearNorm + 0.38 * st.healthDeficit) * 100)
      );

      const ageIdx = Math.min(AGE_BINS - 1, Math.max(0, Math.floor((st.normAgePct / 100) * AGE_BINS)));
      const damageIdx = Math.min(
        DAMAGE_BINS - 1,
        Math.max(0, Math.floor((damageScore / 100) * DAMAGE_BINS))
      );

      const cell = accGrid[damageIdx][ageIdx];
      cell.cycleCount += 1;
      cell.rulSum += st.rulRaw;
      cell.entities.add(st.entityId);
      totalCycles += 1;

      // Failure hazard mass: EOL endpoints get full weight + smooth proximity hazard near failure
      const hazardWeight = (st.isEol ? 1.0 : 0) + Math.exp(-st.rulRaw / 24) * 0.45;
      cell.hazardMass += hazardWeight;

      if (st.isEol) {
        cell.eolCount += 1;
        totalEolEvents += 1;
        eolDamages.push(damageScore);
      }
    }
  }

  const metricValue = (cell: CellAcc): number => {
    if (densityMode === 'eol_endpoints') return cell.eolCount;
    if (densityMode === 'occupancy') return cell.entities.size;
    return cell.hazardMass;
  };

  let totalMetricMass = 0;
  let maxCellMass = 0;
  for (let d = 0; d < DAMAGE_BINS; d++) {
    for (let a = 0; a < AGE_BINS; a++) {
      const m = metricValue(accGrid[d][a]);
      totalMetricMass += m;
      if (m > maxCellMass) maxCellMass = m;
    }
  }

  let hotspotAgeLabel = '—';
  let hotspotDamageLabel = '—';
  let hotspotDensityPct = 0;
  let hotspotEolCount = 0;

  const rows: DegradationHeatmapRow[] = [];
  for (let rev = 0; rev < DAMAGE_BINS; rev++) {
    const damageIdx = DAMAGE_BINS - 1 - rev;
    let rowMass = 0;
    const cells: DegradationHeatmapCell[] = [];

    for (let ageIdx = 0; ageIdx < AGE_BINS; ageIdx++) {
      const acc = accGrid[damageIdx][ageIdx];
      const mass = metricValue(acc);
      rowMass += mass;

      const failureDensityPct =
        totalMetricMass > 1e-9 ? Math.round((mass / totalMetricMass) * 1000) / 10 : 0;
      const intensity = maxCellMass > 1e-9 ? mass / maxCellMass : 0;

      if (failureDensityPct > hotspotDensityPct || (failureDensityPct === hotspotDensityPct && acc.eolCount > hotspotEolCount)) {
        hotspotDensityPct = failureDensityPct;
        hotspotAgeLabel = ageLabels[ageIdx];
        hotspotDamageLabel = damageLabels[damageIdx];
        hotspotEolCount = acc.eolCount;
      }

      const sortedEntities = Array.from(acc.entities).sort((eA, eB) => {
        const sA = summaryMap.get(eA);
        const sB = summaryMap.get(eB);
        return (sA?.finalHealthPct ?? 100) - (sB?.finalHealthPct ?? 100);
      });

      cells.push({
        ageIdx,
        damageIdx,
        ageLabel: ageLabels[ageIdx],
        damageLabel: damageLabels[damageIdx],
        failureDensityPct,
        eolCount: acc.eolCount,
        cycleCount: acc.cycleCount,
        activeEntityCount: acc.entities.size,
        meanRulRaw:
          acc.cycleCount > 0 ? Math.round((acc.rulSum / acc.cycleCount) * 10) / 10 : null,
        intensity,
        entityIds: sortedEntities,
      });
    }

    rows.push({
      damageIdx,
      damageLabel: damageLabels[damageIdx],
      rowSharePct:
        totalMetricMass > 1e-9 ? Math.round((rowMass / totalMetricMass) * 1000) / 10 : 0,
      cells,
    });
  }

  const highDamageEols = eolDamages.filter((d) => d >= 62.5).length;
  const highDamageEolSharePct =
    eolDamages.length > 0 ? Math.round((highDamageEols / eolDamages.length) * 1000) / 10 : 0;

  const meanDamageAtFailure =
    eolDamages.length > 0
      ? Math.round((eolDamages.reduce((a, b) => a + b, 0) / eolDamages.length) * 10) / 10
      : 0;

  const varDamage =
    eolDamages.length > 1
      ? eolDamages.reduce((acc, d) => acc + (d - meanDamageAtFailure) ** 2, 0) /
        eolDamages.length
      : 0;
  const stdDamageAtFailure = Math.round(Math.sqrt(varDamage) * 10) / 10;

  return {
    totalEntities: unitTrajectories.size,
    totalCycles,
    totalEolEvents,
    ageLabels,
    rows,
    hotspotAgeLabel,
    hotspotDamageLabel,
    hotspotDensityPct,
    hotspotEolCount,
    highDamageEolSharePct,
    meanDamageAtFailure,
    stdDamageAtFailure,
  };
}


