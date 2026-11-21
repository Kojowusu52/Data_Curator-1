import {
  EngineeredFeatureDefinition,
  EngineeredFeatureEvaluation,
  EngineeredFeatureId,
  GlobalCurationConfig,
  PiiMaskingConfig,
  RawEvent,
  RegressionConfig,
  RegressionResult,
} from '../types/curation';
import {
  createPiiMasker,
  groupEventsByEntity,
  REGRESSION_FEATURE_CATALOG,
} from './curationEngine';

export const ENGINEERED_FEATURE_CATALOG: EngineeredFeatureDefinition[] = [
  {
    id: 'spend_velocity_slope',
    columnName: 'fe_spend_velocity_slope',
    label: 'Signal / Spend Velocity Slope',
    formula: 'OLS slope(spendAmount ~ timestampDay | t <= T_obs)',
    category: 'Temporal',
    targetUseCase: 'Captures accelerating spend growth or rising sensor vibration degradation rate.',
  },
  {
    id: 'spend_volatility_std',
    columnName: 'fe_spend_volatility_std',
    label: 'Signal / Spend Volatility (Std)',
    formula: 'std(spendAmount | t <= T_obs)',
    category: 'Volatility',
    targetUseCase: 'Distinguishes erratic bursts or noisy machinery oscillations from steady baselines.',
  },
  {
    id: 'ema_to_mean_momentum',
    columnName: 'fe_ema_to_mean_momentum',
    label: 'EMA-to-Mean Momentum Ratio',
    formula: 'EMA(alpha=0.5, spend) / max(1, mean(spend))',
    category: 'Momentum',
    targetUseCase: 'Highlights recent upward or downward regime shifts relative to lifetime average.',
  },
  {
    id: 'peak_to_mean_ratio',
    columnName: 'fe_peak_to_mean_ratio',
    label: 'Peak-to-Mean Spike Ratio',
    formula: 'max(spendAmount) / max(1, mean(spendAmount))',
    category: 'Volatility',
    targetUseCase: 'Detects heavy-tail purchase outliers or transient mechanical shock events.',
  },
  {
    id: 'engagement_decay_slope',
    columnName: 'fe_engagement_decay_slope',
    label: 'Health / Engagement Trend Slope',
    formula: 'OLS slope(engagementScore ~ timestampDay | t <= T_obs)',
    category: 'Temporal',
    targetUseCase: 'Quantifies retention decay or asset health degradation prior to T_obs.',
  },
  {
    id: 'log_tenure_freq_interaction',
    columnName: 'fe_log_tenure_freq_x',
    label: 'Log Tenure × Frequency Interaction',
    formula: 'ln(1 + tenureDaysObs) * ln(1 + txCountObs)',
    category: 'Interaction',
    targetUseCase: 'Non-linear saturation feature pairing entity longevity with interaction density.',
  },
  {
    id: 'action_weighted_reward_yield',
    columnName: 'fe_reward_yield_ratio',
    label: 'Intervention Reward Yield Ratio',
    formula: 'sum(reward) / max(1, sum(spendAmount))',
    category: 'Interaction',
    targetUseCase: 'Measures unit margin efficiency or uptime return per unit load.',
  },
];

function computePearsonR(xs: number[], ys: number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return 0;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let dx2 = 0;
  let dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    num += dx * dy;
    dx2 += dx * dx;
    dy2 += dy * dy;
  }
  const denom = Math.sqrt(dx2 * dy2);
  if (denom < 1e-9) return 0;
  return num / denom;
}

function computeSimpleKl(trainVals: number[], valVals: number[]): number {
  if (trainVals.length < 4 || valVals.length < 4) return 0;
  const all = [...trainVals, ...valVals];
  const minV = Math.min(...all);
  const maxV = Math.max(...all);
  const span = Math.max(1e-6, maxV - minV);
  const bins = 6;
  const tCounts = new Array<number>(bins).fill(0.5);
  const vCounts = new Array<number>(bins).fill(0.5);
  for (const x of trainVals) {
    const idx = Math.min(bins - 1, Math.max(0, Math.floor(((x - minV) / span) * bins)));
    tCounts[idx] += 1;
  }
  for (const x of valVals) {
    const idx = Math.min(bins - 1, Math.max(0, Math.floor(((x - minV) / span) * bins)));
    vCounts[idx] += 1;
  }
  const tTotal = tCounts.reduce((a, b) => a + b, 0);
  const vTotal = vCounts.reduce((a, b) => a + b, 0);
  let kl = 0;
  for (let i = 0; i < bins; i++) {
    const p = tCounts[i] / tTotal;
    const q = vCounts[i] / vTotal;
    kl += p * Math.log(p / q);
  }
  return Math.max(0, Math.round(kl * 1000) / 1000);
}

function olsSlope(pairs: Array<{ x: number; y: number }>): number {
  if (pairs.length < 2) return 0;
  const mx = pairs.reduce((a, p) => a + p.x, 0) / pairs.length;
  const my = pairs.reduce((a, p) => a + p.y, 0) / pairs.length;
  let num = 0;
  let den = 0;
  for (const p of pairs) {
    const dx = p.x - mx;
    num += dx * (p.y - my);
    den += dx * dx;
  }
  return den > 1e-6 ? num / den : 0;
}

export function computeEngineeredFeaturesByEntity(
  events: RawEvent[],
  obsCutoffDay: number
): Map<string, Record<EngineeredFeatureId, number>> {
  const grouped = groupEventsByEntity(events);
  const map = new Map<string, Record<EngineeredFeatureId, number>>();

  for (const [entityId, rawList] of grouped.entries()) {
    const obsEvents = rawList
      .filter((e) => e.timestampDay <= obsCutoffDay)
      .sort((a, b) => a.timestampDay - b.timestampDay);

    if (obsEvents.length === 0) {
      map.set(entityId, {
        spend_velocity_slope: 0,
        spend_volatility_std: 0,
        ema_to_mean_momentum: 1,
        peak_to_mean_ratio: 1,
        engagement_decay_slope: 0,
        log_tenure_freq_interaction: 0,
        action_weighted_reward_yield: 0,
      });
      continue;
    }

    const spends = obsEvents.map((e) => e.spendAmount);
    const meanSpend = spends.reduce((a, b) => a + b, 0) / spends.length;
    const maxSpend = Math.max(...spends);
    const varSpend =
      spends.reduce((a, s) => a + (s - meanSpend) ** 2, 0) / spends.length;
    const stdSpend = Math.sqrt(varSpend);

    let ema = spends[0];
    for (let i = 1; i < spends.length; i++) {
      ema = 0.5 * spends[i] + 0.5 * ema;
    }

    const spendSlope = olsSlope(
      obsEvents.map((e) => ({ x: e.timestampDay, y: e.spendAmount }))
    );
    const engSlope = olsSlope(
      obsEvents.map((e) => ({ x: e.timestampDay, y: e.engagementScore }))
    );

    const tenure = obsCutoffDay - obsEvents[0].timestampDay;
    const logInteraction = Math.log1p(Math.max(0, tenure)) * Math.log1p(obsEvents.length);

    const sumSpend = spends.reduce((a, b) => a + b, 0);
    const sumReward = obsEvents.reduce((a, e) => a + e.reward, 0);

    map.set(entityId, {
      spend_velocity_slope: Math.round(spendSlope * 10000) / 10000,
      spend_volatility_std: Math.round(stdSpend * 100) / 100,
      ema_to_mean_momentum: Math.round((ema / Math.max(1, meanSpend)) * 1000) / 1000,
      peak_to_mean_ratio: Math.round((maxSpend / Math.max(1, meanSpend)) * 1000) / 1000,
      engagement_decay_slope: Math.round(engSlope * 100000) / 100000,
      log_tenure_freq_interaction: Math.round(logInteraction * 1000) / 1000,
      action_weighted_reward_yield:
        Math.round((sumReward / Math.max(1, sumSpend)) * 1000) / 1000,
    });
  }

  return map;
}

export function evaluateEngineeredFeatures(params: {
  events: RawEvent[];
  regResult: RegressionResult;
  regConfig: RegressionConfig;
  enabledFeatureIds: EngineeredFeatureId[];
}): EngineeredFeatureEvaluation[] {
  const { events, regResult, regConfig, enabledFeatureIds } = params;
  const enabledSet = new Set(enabledFeatureIds);
  const byEntity = computeEngineeredFeaturesByEntity(events, regConfig.obsCutoffDay);

  const rows = regResult.rows;
  const targets = rows.map((r) => r.targetLtvWinsorized);

  return ENGINEERED_FEATURE_CATALOG.map((def) => {
    const vals = rows.map((r) => byEntity.get(r.entityId)?.[def.id] ?? 0);
    const n = vals.length || 1;
    const mean = vals.reduce((a, b) => a + b, 0) / n;
    const std = Math.sqrt(vals.reduce((a, v) => a + (v - mean) ** 2, 0) / n);
    const min = vals.length > 0 ? Math.min(...vals) : 0;
    const max = vals.length > 0 ? Math.max(...vals) : 0;

    const pearsonR = computePearsonR(vals, targets);
    const univariateR2 = Math.round(pearsonR * pearsonR * 10000) / 10000;

    let maxColR = 0;
    let mostCorrelatedWith = 'None';
    for (const baseFeat of REGRESSION_FEATURE_CATALOG) {
      const baseVals = rows.map((r) => Number(r[baseFeat.key] ?? 0));
      const rVal = Math.abs(computePearsonR(vals, baseVals));
      if (rVal > maxColR) {
        maxColR = rVal;
        mostCorrelatedWith = baseFeat.shortLabel;
      }
    }

    const trainVals: number[] = [];
    const valVals: number[] = [];
    rows.forEach((r, idx) => {
      if (r.split === 'train') trainVals.push(vals[idx]);
      else if (r.split === 'val') valVals.push(vals[idx]);
    });
    const trainValKlDrift = computeSimpleKl(trainVals, valVals);

    const recommendationTier: EngineeredFeatureEvaluation['recommendationTier'] =
      maxColR >= 0.78
        ? 'redundant'
        : Math.abs(pearsonR) >= 0.18 && maxColR < 0.7
        ? 'strong'
        : 'moderate';

    return {
      ...def,
      enabled: enabledSet.has(def.id),
      mean: Math.round(mean * 1000) / 1000,
      std: Math.round(std * 1000) / 1000,
      min: Math.round(min * 1000) / 1000,
      max: Math.round(max * 1000) / 1000,
      pearsonR: Math.round(pearsonR * 1000) / 1000,
      univariateR2,
      maxExistingCollinearityR: Math.round(maxColR * 1000) / 1000,
      mostCorrelatedWith,
      trainValKlDrift,
      recommendationTier,
    };
  });
}

export function exportAugmentedRegressionCsv(params: {
  events: RawEvent[];
  regResult: RegressionResult;
  regConfig: RegressionConfig;
  enabledFeatureIds: EngineeredFeatureId[];
  piiMaskingConfig: PiiMaskingConfig;
}): string {
  const { events, regResult, regConfig, enabledFeatureIds, piiMaskingConfig } = params;
  const masker = createPiiMasker(piiMaskingConfig);
  const byEntity = computeEngineeredFeaturesByEntity(events, regConfig.obsCutoffDay);
  const activeEngineered = ENGINEERED_FEATURE_CATALOG.filter((d) =>
    enabledFeatureIds.includes(d.id)
  );

  const selectedSet = new Set(regConfig.selectedFeatures);
  const baseFeatures = REGRESSION_FEATURE_CATALOG.filter((f) => selectedSet.has(f.key));

  const header = [
    'entity_id',
    'split',
    'batch_id',
    ...baseFeatures.map((f) => f.csvColumn),
    ...activeEngineered.map((e) => e.columnName),
    'target_ltv_raw',
    'target_ltv_winsorized',
    'predicted_horizon_ltv',
  ].join(',');

  const lines = regResult.rows.map((r) => {
    const fe = byEntity.get(r.entityId);
    return [
      masker.maskEntityId(r.entityId),
      r.split,
      r.batchId,
      ...baseFeatures.map((f) => r[f.key]),
      ...activeEngineered.map((e) => fe?.[e.id] ?? 0),
      r.targetLtvRaw,
      r.targetLtvWinsorized,
      r.predictedHorizonLtv,
    ].join(',');
  });

  return [header, ...lines].join('\n');
}
