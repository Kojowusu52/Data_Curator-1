import {
  ActionBreakdown,
  AuditCheck,
  CutoffSensitivityPoint,
  EcdfCurvePoint,
  FeatureDriftMetric,
  GlobalCurationConfig,
  HistogramBin,
  KlDistributionBin,
  LtvAnomalyEntity,
  LtvAnomalyReport,
  LtvTrendPoint,
  LtvTrendProjectionPoint,
  LtvTrendProjectionReport,
  MatrixFeatureDef,
  TrendProjectionWindow,
  MdpConfig,
  MdpResult,
  MdpTransition,
  ModelDriftReport,
  RawEvent,
  RegressionConfig,
  RegressionFeatureKey,
  RegressionFeatureValues,
  RegressionResult,
  RegressionRow,
  RegressionScalerStat,
  SequenceConfig,
  SequenceResult,
  SequenceStep,
  SequenceTensorSample,
  SplitName,
  TargetDataQualityIssue,
  TargetDataQualityReport,
  PipelineSchemaCheck,
  PipelineValidationStatus,
  SchemaValidationReport,
  ModelEvaluationMatrixData,
  SplitEvaluationMetrics,
  TierConfusionCell,
  PiiMaskingConfig,
  TransformerArchitectureId,
  TransformerEntityPrediction,
  TransformerEvaluationSummary,
  TransformerLossCurveSummary,
  TransformerLossEpochPoint,
  TransformerModelBenchmarkRow,
  TransformerPoolingMode,
  TransformerPositionalEncoding,
  LossFitDiagnosis,
  DataHealthCheckItem,
  DataHealthScorecard,
  DataHealthStatus,
  DataHealthTier,
  TimestampBucketStat,
  OptimizationObjective,
  HyperparameterTrialResult,
  HyperparameterSearchReport,
  AttentionExecutionMode,
  BatchSimulationConfig,
  BatchSimulationReport,
  BatchSizeScalingPoint,
  BatchStepBreakdown,
  HardwareAcceleratorProfile,
  HardwareProfileId,
  TrainingPrecision,
  PerformanceAlertReport,
  PerformanceAlertSeverity,
  PerformanceBaselineMode,
  PerformanceDeviationAlert,
  PerformanceMetricComparison,
  WorkspaceBaselineSnapshot,
  SqlExecutionPlanNode,
  SqlQueryAnalysisReport,
  SqlSchemaExpectationIssue,
  SequenceHistogramBinMode,
  SequenceLengthAnalysis,
  SequenceLengthDistributionBin,
  SequenceLengthPercentiles,
  TruncationStrategy,
  KlDriftAlertItem,
  KlDriftAlertReport,
  KlDriftAlertSeverity,
  RewardScaleMode,
  MdpActionSensitivityRow,
  MdpDistributionShapeMode,
  MdpGammaSweepPoint,
  MdpReturnSummaryStats,
  MdpRewardScaleComparisonRow,
  MdpSensitivityBin,
  MdpSensitivityReport,
  ExportFeatureImportanceRow,
  ExportFeatureImportanceReport,
  SqlSyntaxTokenType,
  SqlSyntaxToken,
  SqlSyntaxDiagnostic,
  SqlSyntaxValidationReport,
  DatasetPreset,
  GlobalSearchCategory,
  GlobalSearchResultItem,
  GlobalSearchReport,
  RetentionCohortAnalysis,
  RetentionCohortCell,
  RetentionCohortRow,
  RetentionPeriodSummary,
  SnapshotComparisonEvaluated,
  SnapshotComparisonMetricDef,
  SnapshotComparisonMetricDelta,
  SnapshotComparisonMetricKey,
  SnapshotComparisonReport,
  SnapshotDeltaPolarity,
} from '../types/curation';
import {
  buildSampleMatBuffer,
  inferDefaultMatMapping,
  MatColumnMapping,
  MatValue,
  MatVariableSummary,
  matWorkspaceToEvents,
  ParsedMatWorkspace,
  parseMatFileBuffer,
} from './matParser';

export {
  buildSampleMatBuffer,
  inferDefaultMatMapping,
  matWorkspaceToEvents,
  parseMatFileBuffer,
};
export type {
  MatColumnMapping,
  MatValue,
  MatVariableSummary,
  ParsedMatWorkspace,
};

export function assignEntitySplit(
  entityId: string,
  config: GlobalCurationConfig
): SplitName {
  const input = `${config.seedSalt}:${entityId}`;
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const unit = (hash >>> 0) / 4294967296;
  if (unit < config.trainRatio) return 'train';
  if (unit < config.trainRatio + config.valRatio) return 'val';
  return 'test';
}

function normalizeBatchSize(batchSize: number | undefined, fallback = 32): number {
  const num = Number(batchSize);
  if (!Number.isFinite(num) || num < 1) return fallback;
  return Math.max(1, Math.min(2048, Math.round(num)));
}

function assignSplitBatchIds<T extends { split: SplitName; batchId: number }>(
  items: T[],
  rawBatchSize: number | undefined
): {
  batchSize: number;
  batchCount: number;
  splitBatchCounts: Record<SplitName, number>;
} {
  const batchSize = normalizeBatchSize(rawBatchSize, 32);
  const splitCounters: Record<SplitName, number> = { train: 0, val: 0, test: 0 };
  for (const item of items) {
    const pos = splitCounters[item.split];
    item.batchId = Math.floor(pos / batchSize);
    splitCounters[item.split] = pos + 1;
  }
  const splitBatchCounts: Record<SplitName, number> = {
    train: Math.ceil(splitCounters.train / batchSize),
    val: Math.ceil(splitCounters.val / batchSize),
    test: Math.ceil(splitCounters.test / batchSize),
  };
  const batchCount =
    splitBatchCounts.train + splitBatchCounts.val + splitBatchCounts.test;
  return { batchSize, batchCount, splitBatchCounts };
}

function quantile(sortedValues: number[], q: number): number {
  if (sortedValues.length === 0) return 0;
  const pos = (sortedValues.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sortedValues[base + 1] !== undefined) {
    return sortedValues[base] + rest * (sortedValues[base + 1] - sortedValues[base]);
  }
  return sortedValues[base];
}

const T_CRIT_95_TABLE: number[] = [
  12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228,
  2.201, 2.179, 2.160, 2.145, 2.131, 2.120, 2.110, 2.101, 2.093, 2.086,
  2.080, 2.074, 2.069, 2.064, 2.060, 2.056, 2.052, 2.048, 2.045, 2.042,
];

function tCritical95(df: number): number {
  const safeDf = Math.max(1, Math.round(df));
  if (safeDf <= 30) return T_CRIT_95_TABLE[safeDf - 1];
  return 1.96;
}

function pearsonCorrelation(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 2) return 0;
  let sumX = 0;
  let sumY = 0;
  for (let i = 0; i < n; i++) {
    sumX += xs[i];
    sumY += ys[i];
  }
  const meanX = sumX / n;
  const meanY = sumY / n;
  let num = 0;
  let denX = 0;
  let denY = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  const denom = Math.sqrt(denX * denY);
  return denom === 0 ? 0 : num / denom;
}

function solveLinearSystem(A: number[][], b: number[]): number[] {
  const m = A.length;
  const aug = A.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < m; col++) {
    let pivotRow = col;
    let maxAbs = Math.abs(aug[col][col]);
    for (let r = col + 1; r < m; r++) {
      const val = Math.abs(aug[r][col]);
      if (val > maxAbs) {
        maxAbs = val;
        pivotRow = r;
      }
    }
    if (pivotRow !== col) {
      const tmp = aug[col];
      aug[col] = aug[pivotRow];
      aug[pivotRow] = tmp;
    }

    const pivot = aug[col][col];
    if (Math.abs(pivot) < 1e-10) continue;

    for (let c = col; c <= m; c++) {
      aug[col][c] /= pivot;
    }
    for (let r = 0; r < m; r++) {
      if (r === col) continue;
      const factor = aug[r][col];
      if (factor === 0) continue;
      for (let c = col; c <= m; c++) {
        aug[r][c] -= factor * aug[col][c];
      }
    }
  }

  return aug.map((row) => (Number.isFinite(row[m]) ? row[m] : 0));
}

function buildHistogram(values: number[], binCount: number): HistogramBin[] {
  if (values.length === 0) return [];
  const minVal = Math.min(...values);
  const maxVal = Math.max(...values);
  const span = maxVal - minVal || 1;
  const step = span / binCount;
  const bins: HistogramBin[] = [];
  for (let i = 0; i < binCount; i++) {
    const bMin = minVal + i * step;
    const bMax = i === binCount - 1 ? maxVal : bMin + step;
    bins.push({
      label: `${Math.round(bMin)}–${Math.round(bMax)}`,
      min: bMin,
      max: bMax,
      count: 0,
    });
  }
  for (const v of values) {
    let idx = Math.floor((v - minVal) / step);
    if (idx >= binCount) idx = binCount - 1;
    if (idx < 0) idx = 0;
    bins[idx].count += 1;
  }
  return bins;
}

function computeMomentStats(values: number[]): {
  mean: number;
  std: number;
  skewness: number;
  excessKurtosis: number;
} {
  const n = values.length;
  if (n === 0) return { mean: 0, std: 0, skewness: 0, excessKurtosis: 0 };
  const mean = values.reduce((a, b) => a + b, 0) / n;
  let m2 = 0;
  let m3 = 0;
  let m4 = 0;
  for (const v of values) {
    const d = v - mean;
    const d2 = d * d;
    m2 += d2;
    m3 += d2 * d;
    m4 += d2 * d2;
  }
  const variance = m2 / n;
  const std = Math.sqrt(variance);
  if (n < 3 || std <= 1e-9) {
    return { mean, std, skewness: 0, excessKurtosis: 0 };
  }
  const m2Norm = variance;
  const skewness = m3 / n / Math.pow(std, 3);
  const excessKurtosis = m4 / n / (m2Norm * m2Norm) - 3;
  return { mean, std, skewness, excessKurtosis };
}

function computeTargetDataQuality(
  rawValues: number[],
  winsorizedValues: number[]
): TargetDataQualityReport {
  const n = rawValues.length;
  if (n === 0) {
    return {
      score: 0,
      tier: 'critical',
      sampleSize: 0,
      zeroCount: 0,
      zeroRate: 1,
      rawSkewness: 0,
      winsorizedSkewness: 0,
      excessKurtosis: 0,
      meanRaw: 0,
      medianRaw: 0,
      p95Raw: 0,
      p99Raw: 0,
      p99ToMedianRatio: null,
      issues: [
        {
          code: 'low_sample',
          severity: 'critical',
          title: 'Empty target cohort',
          detail: 'No entities remain after applying observation cutoff and split filters.',
        },
      ],
    };
  }

  const zeroCount = rawValues.filter((v) => v <= 0).length;
  const zeroRate = zeroCount / n;
  const sorted = [...rawValues].sort((a, b) => a - b);
  const medianRaw = quantile(sorted, 0.5);
  const p95Raw = quantile(sorted, 0.95);
  const p99Raw = quantile(sorted, 0.99);
  const p99ToMedianRatio =
    medianRaw > 1e-6 ? Math.round((p99Raw / medianRaw) * 100) / 100 : null;

  const rawMoments = computeMomentStats(rawValues);
  const winMoments = computeMomentStats(winsorizedValues);
  const absSkew = Math.abs(rawMoments.skewness);

  // Composite 0-100 score penalizing high zero-inflation (sparsity), skewness, and tiny/flat targets
  const sparsityPenalty = Math.min(45, Math.round(zeroRate * 65));
  const skewPenalty =
    absSkew <= 0.5 ? 0 : Math.min(40, Math.round((absSkew - 0.5) * 14));
  const samplePenalty = n < 20 ? Math.min(15, 20 - n) : 0;
  const flatPenalty = rawMoments.std <= 1e-6 ? 15 : 0;
  const score = Math.max(
    0,
    Math.min(100, 100 - sparsityPenalty - skewPenalty - samplePenalty - flatPenalty)
  );

  const tier: TargetDataQualityReport['tier'] =
    score >= 75 ? 'healthy' : score >= 50 ? 'caution' : 'critical';

  const issues: TargetDataQualityIssue[] = [];

  if (absSkew >= 2.2) {
    issues.push({
      code: 'high_skew',
      severity: 'critical',
      title: `Severe target right-skewness (γ₁ = ${rawMoments.skewness.toFixed(2)})`,
      detail:
        'Extreme upper-tail LTV values exert quadratic leverage on OLS squared-error gradients, inflating coefficient variance and degrading convergence.',
    });
  } else if (absSkew >= 1.25) {
    issues.push({
      code: 'moderate_skew',
      severity: 'warn',
      title: `Elevated target skewness (γ₁ = ${rawMoments.skewness.toFixed(2)})`,
      detail:
        'Long-tail high spenders skew residual errors. Consider P95/P99 winsorization or log1p(target_ltv) transformation.',
    });
  }

  if (zeroRate >= 0.45) {
    issues.push({
      code: 'high_sparsity',
      severity: 'critical',
      title: `High target sparsity (${(zeroRate * 100).toFixed(1)}% zero-spend)`,
      detail:
        'Nearly half or more of entities have zero horizon spend, biasing linear regression intercepts and compressing predictions toward zero.',
    });
  } else if (zeroRate >= 0.25) {
    issues.push({
      code: 'moderate_sparsity',
      severity: 'warn',
      title: `Moderate target sparsity (${(zeroRate * 100).toFixed(1)}% zero-spend)`,
      detail:
        'Point-mass at $0 violates homoscedastic Gaussian residual assumptions; check horizon length (H) or two-stage hurdle modeling.',
    });
  }

  if (n < 20) {
    issues.push({
      code: 'low_sample',
      severity: 'critical',
      title: `Small cohort sample size (n = ${n})`,
      detail:
        'Fewer than 20 entities reduces degrees of freedom and increases risk of ill-conditioned normal equations.',
    });
  } else if (rawMoments.std <= 1e-6) {
    issues.push({
      code: 'flat_variance',
      severity: 'critical',
      title: 'Zero variance in target_ltv_raw',
      detail:
        'All entities share identical target spend within this horizon; OLS cannot fit meaningful slopes.',
    });
  }

  return {
    score,
    tier,
    sampleSize: n,
    zeroCount,
    zeroRate: Math.round(zeroRate * 1000) / 1000,
    rawSkewness: Math.round(rawMoments.skewness * 100) / 100,
    winsorizedSkewness: Math.round(winMoments.skewness * 100) / 100,
    excessKurtosis: Math.round(rawMoments.excessKurtosis * 100) / 100,
    meanRaw: Math.round(rawMoments.mean * 100) / 100,
    medianRaw: Math.round(medianRaw * 100) / 100,
    p95Raw: Math.round(p95Raw * 100) / 100,
    p99Raw: Math.round(p99Raw * 100) / 100,
    p99ToMedianRatio,
    issues,
  };
}

function twoSampleKsTest(
  sampleA: number[],
  sampleB: number[]
): {
  ksStatistic: number;
  pValue: number;
  maxGapX: number;
  ecdfCurve: EcdfCurvePoint[];
} {
  const n1 = sampleA.length;
  const n2 = sampleB.length;
  if (n1 === 0 || n2 === 0) {
    return { ksStatistic: 0, pValue: 1, maxGapX: 0, ecdfCurve: [] };
  }

  const a = [...sampleA].sort((x, y) => x - y);
  const b = [...sampleB].sort((x, y) => x - y);

  let i = 0;
  let j = 0;
  let maxD = 0;
  let maxGapX = a[0];
  const allSteps: EcdfCurvePoint[] = [];

  while (i < n1 || j < n2) {
    const nextX =
      i < n1 && j < n2
        ? Math.min(a[i], b[j])
        : i < n1
        ? a[i]
        : b[j];

    while (i < n1 && a[i] <= nextX) i++;
    while (j < n2 && b[j] <= nextX) j++;

    const cdfA = i / n1;
    const cdfB = j / n2;
    const diff = Math.abs(cdfA - cdfB);
    if (diff > maxD) {
      maxD = diff;
      maxGapX = nextX;
    }

    allSteps.push({
      x: Math.round(nextX * 1000) / 1000,
      trainCdf: Math.round(cdfA * 1000) / 1000,
      valCdf: Math.round(cdfB * 1000) / 1000,
    });
  }

  // Downsample ECDF curve if large, always preserving endpoints and maxGapX
  let ecdfCurve = allSteps;
  if (allSteps.length > 64) {
    const sampled: EcdfCurvePoint[] = [];
    const stride = (allSteps.length - 1) / 60;
    const seen = new Set<number>();
    for (let k = 0; k <= 60; k++) {
      const idx = Math.round(k * stride);
      if (!seen.has(idx)) {
        seen.add(idx);
        sampled.push(allSteps[idx]);
      }
    }
    const maxGapIdx = allSteps.findIndex((pt) => pt.x === Math.round(maxGapX * 1000) / 1000);
    if (maxGapIdx >= 0 && !seen.has(maxGapIdx)) {
      sampled.push(allSteps[maxGapIdx]);
      sampled.sort((p1, p2) => p1.x - p2.x);
    }
    ecdfCurve = sampled;
  }

  // Asymptotic Kolmogorov-Smirnov p-value with Stephens finite-sample adjustment
  const nEff = (n1 * n2) / (n1 + n2);
  const sqrtN = Math.sqrt(nEff);
  const lambda = (sqrtN + 0.12 + 0.11 / sqrtN) * maxD;
  let pValue = 1;
  if (lambda > 0) {
    let sum = 0;
    for (let k = 1; k <= 100; k++) {
      const term = Math.exp(-2 * k * k * lambda * lambda);
      sum += (k % 2 === 1 ? 1 : -1) * term;
      if (term < 1e-12) break;
    }
    pValue = Math.max(0, Math.min(1, 2 * sum));
  }

  return {
    ksStatistic: Math.round(maxD * 1000) / 1000,
    pValue: Math.round(pValue * 10000) / 10000,
    maxGapX: Math.round(maxGapX * 1000) / 1000,
    ecdfCurve,
  };
}

export const DEFAULT_KL_DRIFT_THRESHOLD = 0.25;

export function computeKlDivergence(
  trainSample: number[],
  valSample: number[],
  explicitBins?: number
): {
  klDivergence: number;
  jsDivergence: number;
  bins: KlDistributionBin[];
} {
  const n1 = trainSample.length;
  const n2 = valSample.length;
  if (n1 < 2 || n2 < 2) {
    return { klDivergence: 0, jsDivergence: 0, bins: [] };
  }

  let minVal = Infinity;
  let maxVal = -Infinity;
  for (const v of trainSample) {
    if (Number.isFinite(v)) {
      if (v < minVal) minVal = v;
      if (v > maxVal) maxVal = v;
    }
  }
  for (const v of valSample) {
    if (Number.isFinite(v)) {
      if (v < minVal) minVal = v;
      if (v > maxVal) maxVal = v;
    }
  }

  const span = maxVal - minVal;
  if (!Number.isFinite(span) || span <= 1e-9) {
    return { klDivergence: 0, jsDivergence: 0, bins: [] };
  }

  const binCount =
    explicitBins && explicitBins >= 3
      ? explicitBins
      : Math.min(10, Math.max(5, Math.round(Math.sqrt(Math.min(n1, n2)))));
  const step = span / binCount;
  const trainCounts = new Array<number>(binCount).fill(0);
  const valCounts = new Array<number>(binCount).fill(0);

  const assignBin = (v: number) => {
    let idx = Math.floor((v - minVal) / step);
    if (idx < 0) idx = 0;
    if (idx >= binCount) idx = binCount - 1;
    return idx;
  };

  for (const v of trainSample) {
    if (Number.isFinite(v)) trainCounts[assignBin(v)] += 1;
  }
  for (const v of valSample) {
    if (Number.isFinite(v)) valCounts[assignBin(v)] += 1;
  }

  // Jeffreys smoothing (alpha = 0.5) avoids infinite log(P/0) singularities on sparse bins
  const smoothing = 0.5;
  const trainDenom = n1 + binCount * smoothing;
  const valDenom = n2 + binCount * smoothing;

  let kl = 0;
  let js = 0;
  const bins: KlDistributionBin[] = [];

  for (let b = 0; b < binCount; b++) {
    const p = (trainCounts[b] + smoothing) / trainDenom;
    const q = (valCounts[b] + smoothing) / valDenom;
    const m = 0.5 * (p + q);
    const klTerm = p * Math.log(p / q);
    kl += klTerm;
    js += 0.5 * (p * Math.log(p / m) + q * Math.log(q / m));

    const bMin = minVal + b * step;
    const bMax = b === binCount - 1 ? maxVal : bMin + step;
    const fmt = (num: number) =>
      Math.abs(num) >= 100
        ? String(Math.round(num))
        : Math.abs(num) >= 10
        ? num.toFixed(1)
        : num.toFixed(2);

    bins.push({
      binLabel: `${fmt(bMin)}–${fmt(bMax)}`,
      binMin: Math.round(bMin * 1000) / 1000,
      binMax: Math.round(bMax * 1000) / 1000,
      trainProb: Math.round(p * 10000) / 10000,
      valProb: Math.round(q * 10000) / 10000,
      klContribution: Math.round(klTerm * 10000) / 10000,
    });
  }

  return {
    klDivergence: Math.round(Math.max(0, kl) * 10000) / 10000,
    jsDivergence: Math.round(Math.max(0, js) * 10000) / 10000,
    bins,
  };
}

export function computeModelDriftReport(
  allRows: RegressionRow[],
  featureDefs: typeof REGRESSION_FEATURE_CATALOG,
  normMode: RegressionConfig['featureNormalization'],
  rawKlThreshold = DEFAULT_KL_DRIFT_THRESHOLD
): ModelDriftReport {
  const klThreshold =
    Number.isFinite(rawKlThreshold) && rawKlThreshold > 0
      ? rawKlThreshold
      : DEFAULT_KL_DRIFT_THRESHOLD;
  const trainRows = allRows.filter((r) => r.split === 'train');
  const valRows = allRows.filter((r) => r.split === 'val');
  const alpha = 0.05;
  const enoughSamples = trainRows.length >= 5 && valRows.length >= 5;

  const features: FeatureDriftMetric[] = featureDefs.map((f) => {
    const trainVals = trainRows.map((r) =>
      normMode === 'none' ? Number(r[f.key]) : Number(r.scaledFeatures[f.key])
    );
    const valVals = valRows.map((r) =>
      normMode === 'none' ? Number(r[f.key]) : Number(r.scaledFeatures[f.key])
    );

    const trainStats = computeMomentStats(trainVals);
    const valStats = computeMomentStats(valVals);
    const ks = twoSampleKsTest(trainVals, valVals);
    const kl = computeKlDivergence(trainVals, valVals);

    const klExceedsThreshold = enoughSamples && kl.klDivergence > klThreshold;
    const klModerate = enoughSamples && kl.klDivergence >= klThreshold * 0.7;

    const status: FeatureDriftMetric['status'] =
      enoughSamples && (ks.pValue < alpha || klExceedsThreshold)
        ? 'significant'
        : enoughSamples &&
          (ks.pValue < 0.15 || ks.ksStatistic >= 0.16 || klModerate)
        ? 'moderate'
        : 'stable';

    return {
      feature: f.key,
      csvColumn: f.csvColumn,
      label: f.label,
      shortLabel: f.shortLabel,
      ksStatistic: ks.ksStatistic,
      pValue: ks.pValue,
      maxGapX: ks.maxGapX,
      klDivergence: kl.klDivergence,
      jsDivergence: kl.jsDivergence,
      klExceedsThreshold,
      klBins: kl.bins,
      trainMean: Math.round(trainStats.mean * 100) / 100,
      valMean: Math.round(valStats.mean * 100) / 100,
      trainStd: Math.round(trainStats.std * 100) / 100,
      valStd: Math.round(valStats.std * 100) / 100,
      status,
      ecdfCurve: ks.ecdfCurve,
    };
  });

  const sortedByDrift = [...features].sort(
    (a, b) =>
      b.klDivergence - a.klDivergence || b.ksStatistic - a.ksStatistic
  );
  const significantCount = features.filter((f) => f.status === 'significant').length;
  const moderateCount = features.filter((f) => f.status === 'moderate').length;
  const klFlaggedCount = features.filter((f) => f.klExceedsThreshold).length;
  const maxKsStatistic =
    features.length > 0 ? Math.max(...features.map((f) => f.ksStatistic)) : 0;
  const minPValue =
    features.length > 0 ? Math.min(...features.map((f) => f.pValue)) : 1;
  const maxKlDivergence =
    features.length > 0 ? Math.max(...features.map((f) => f.klDivergence)) : 0;
  const meanKlDivergence =
    features.length > 0
      ? Math.round(
          (features.reduce((acc, f) => acc + f.klDivergence, 0) / features.length) *
            10000
        ) / 10000
      : 0;

  const klExceedsThreshold = klFlaggedCount > 0;

  const tier: ModelDriftReport['tier'] =
    significantCount > 0 || klExceedsThreshold
      ? 'drift_detected'
      : moderateCount > 0
      ? 'watch'
      : 'aligned';

  return {
    tier,
    trainCount: trainRows.length,
    valCount: valRows.length,
    alpha,
    klThreshold,
    maxKsStatistic,
    minPValue,
    maxKlDivergence,
    meanKlDivergence,
    klFlaggedCount,
    klExceedsThreshold,
    significantCount,
    moderateCount,
    features: sortedByDrift,
  };
}

function computeModelEvaluationMatrix(
  allRows: RegressionRow[],
  featureDefs: MatrixFeatureDef[],
  normMode: RegressionConfig['featureNormalization']
): ModelEvaluationMatrixData {
  const trainRows = allRows.filter((r) => r.split === 'train');
  const fitRows = trainRows.length >= 3 ? trainRows : allRows;
  const trainedOnSplit: 'train' | 'filtered' =
    trainRows.length >= 3 ? 'train' : 'filtered';

  const keys = featureDefs.map((f) => f.key as RegressionFeatureKey);
  const readFeature = (row: RegressionRow, key: RegressionFeatureKey): number =>
    normMode === 'none' ? Number(row[key]) : Number(row.scaledFeatures[key]);

  const nFit = fitRows.length;
  const p = keys.length;
  const fitY = fitRows.map((r) => r.targetLtvWinsorized);
  const yMean = fitY.reduce((a, b) => a + b, 0) / (nFit || 1);
  const yVar = fitY.reduce((a, b) => a + (b - yMean) ** 2, 0) / (nFit || 1);
  const yStd = Math.sqrt(yVar);

  let rawCoeffs = new Array(p).fill(0);
  let intercept = yMean;

  if (nFit >= 3 && p > 0 && yStd > 1e-9) {
    const fMeans = keys.map(
      (k) => fitRows.reduce((acc, r) => acc + readFeature(r, k), 0) / nFit
    );
    const fStds = keys.map((k, j) => {
      const m = fMeans[j];
      const v =
        fitRows.reduce((acc, r) => acc + (readFeature(r, k) - m) ** 2, 0) / nFit;
      return Math.sqrt(v);
    });

    const Z = fitRows.map((r) =>
      keys.map((k, j) =>
        fStds[j] > 1e-9 ? (readFeature(r, k) - fMeans[j]) / fStds[j] : 0
      )
    );
    const zy = fitY.map((y) => (y - yMean) / yStd);
    const ztz: number[][] = Array.from({ length: p }, () => new Array(p).fill(0));
    const zty: number[] = new Array(p).fill(0);

    for (let i = 0; i < nFit; i++) {
      for (let j = 0; j < p; j++) {
        const zij = Z[i][j];
        zty[j] += zij * zy[i];
        for (let k = j; k < p; k++) {
          ztz[j][k] += zij * Z[i][k];
        }
      }
    }
    for (let j = 0; j < p; j++) {
      for (let k = 0; k < j; k++) {
        ztz[j][k] = ztz[k][j];
      }
      ztz[j][j] += 1e-3 * nFit;
    }

    const betas = solveLinearSystem(ztz, zty);
    rawCoeffs = betas.map((beta, j) =>
      fStds[j] > 1e-9 ? (beta * yStd) / fStds[j] : 0
    );
    intercept =
      yMean - rawCoeffs.reduce((acc, b, j) => acc + b * fMeans[j], 0);
  }

  const scored = allRows.map((r) => {
    let pred = intercept;
    for (let j = 0; j < p; j++) {
      pred += rawCoeffs[j] * readFeature(r, keys[j]);
    }
    return {
      split: r.split,
      actual: r.targetLtvWinsorized,
      predicted: Math.max(0, Math.round(pred * 100) / 100),
      projectedFuture: r.projectedFutureLtv,
    };
  });

  const evalSlice = (
    split: SplitEvaluationMetrics['split'],
    label: string,
    items: typeof scored
  ): SplitEvaluationMetrics => {
    const m = items.length;
    if (m === 0) {
      return {
        split,
        label,
        sampleSize: 0,
        rSquared: null,
        rmse: 0,
        mae: 0,
        mape: null,
        mapeSampleCount: 0,
        residualStdError: 0,
        standardError: 0,
        ci95Lower: 0,
        ci95Upper: 0,
        pi95HalfWidth: 0,
        bias: 0,
        calibrationRatio: null,
        meanActual: 0,
        meanPredicted: 0,
      };
    }
    let sumAct = 0;
    let sumPred = 0;
    let sumAbs = 0;
    let sse = 0;
    let sumAbsPct = 0;
    let nonZeroCount = 0;
    for (const it of items) {
      sumAct += it.actual;
      sumPred += it.predicted;
      const err = it.predicted - it.actual;
      const absErr = Math.abs(err);
      sumAbs += absErr;
      sse += err * err;
      if (it.actual > 1e-6) {
        sumAbsPct += absErr / it.actual;
        nonZeroCount += 1;
      }
    }
    const meanAct = sumAct / m;
    const meanPred = sumPred / m;
    let sst = 0;
    for (const it of items) {
      sst += (it.actual - meanAct) ** 2;
    }
    const rSquared =
      m >= 2 && sst > 1e-9
        ? Math.round(Math.max(-1, Math.min(1, 1 - sse / sst)) * 1000) / 1000
        : null;
    const rmse = Math.round(Math.sqrt(sse / m) * 100) / 100;
    const mae = Math.round((sumAbs / m) * 100) / 100;
    const mape =
      nonZeroCount > 0
        ? Math.round((sumAbsPct / nonZeroCount) * 1000) / 10
        : null;
    const df = split === 'train' ? Math.max(1, m - p - 1) : Math.max(1, m - 1);
    const residualStdError = Math.sqrt(sse / df);
    const standardError = residualStdError / Math.sqrt(m);
    const tCrit = tCritical95(df);
    const ci95Lower = Math.max(0, meanPred - tCrit * standardError);
    const ci95Upper = meanPred + tCrit * standardError;
    const pi95HalfWidth = tCrit * residualStdError;

    const bias = Math.round((meanPred - meanAct) * 100) / 100;
    const calibrationRatio =
      sumAct > 1e-6 ? Math.round((sumPred / sumAct) * 1000) / 1000 : null;

    return {
      split,
      label,
      sampleSize: m,
      rSquared,
      rmse,
      mae,
      mape,
      mapeSampleCount: nonZeroCount,
      residualStdError: Math.round(residualStdError * 100) / 100,
      standardError: Math.round(standardError * 100) / 100,
      ci95Lower: Math.round(ci95Lower * 100) / 100,
      ci95Upper: Math.round(ci95Upper * 100) / 100,
      pi95HalfWidth: Math.round(pi95HalfWidth * 100) / 100,
      bias,
      calibrationRatio,
      meanActual: Math.round(meanAct * 100) / 100,
      meanPredicted: Math.round(meanPred * 100) / 100,
    };
  };

  const trainSlice = scored.filter((s) => s.split === 'train');
  const valSlice = scored.filter((s) => s.split === 'val');
  const testSlice = scored.filter((s) => s.split === 'test');
  const holdoutSlice = scored.filter(
    (s) => s.split === 'val' || s.split === 'test'
  );

  const splitMetrics: SplitEvaluationMetrics[] = [
    evalSlice('train', 'Train', trainSlice),
    evalSlice('val', 'Validation', valSlice),
    evalSlice('test', 'Test', testSlice),
    evalSlice('all', 'All Splits', scored),
  ];

  const allMetric = splitMetrics[3];
  const nTotal = scored.length;
  const fwdVals = scored.map((s) => s.projectedFuture);
  const forwardProjectionMean =
    nTotal > 0 ? fwdVals.reduce((a, b) => a + b, 0) / nTotal : 0;
  const forwardVar =
    nTotal > 1
      ? fwdVals.reduce((a, v) => a + (v - forwardProjectionMean) ** 2, 0) /
        (nTotal - 1)
      : 0;
  const forwardProjectionSe =
    nTotal > 0
      ? Math.sqrt(
          forwardVar / nTotal +
            allMetric.standardError * allMetric.standardError
        )
      : 0;
  const tAll = tCritical95(Math.max(1, nTotal - p - 1));
  const forwardProjectionCi95Lower = Math.max(
    0,
    forwardProjectionMean - tAll * forwardProjectionSe
  );
  const forwardProjectionCi95Upper =
    forwardProjectionMean + tAll * forwardProjectionSe;

  const trainR2 = splitMetrics[0].rSquared;
  const valR2 = splitMetrics[1].rSquared;
  const overfitDeltaR2 =
    trainR2 !== null && valR2 !== null
      ? Math.round((trainR2 - valR2) * 1000) / 1000
      : null;

  const sortedFitY = [...fitY].sort((a, b) => a - b);
  const q25 = Math.round(quantile(sortedFitY, 0.25) * 100) / 100;
  const q50 = Math.round(quantile(sortedFitY, 0.5) * 100) / 100;
  const q75 = Math.round(quantile(sortedFitY, 0.75) * 100) / 100;

  const tierOf = (v: number): number => {
    if (v <= q25) return 0;
    if (v <= q50) return 1;
    if (v <= q75) return 2;
    return 3;
  };

  const buildTierMatrix = (items: typeof scored) => {
    const counts = Array.from({ length: 4 }, () => [0, 0, 0, 0]);
    let exact = 0;
    let withinOne = 0;
    for (const it of items) {
      const a = tierOf(it.actual);
      const pr = tierOf(it.predicted);
      counts[a][pr] += 1;
      if (a === pr) exact += 1;
      if (Math.abs(a - pr) <= 1) withinOne += 1;
    }
    const matrix: TierConfusionCell[][] = counts.map((row, actualTier) => {
      const rowTotal = row.reduce((acc, c) => acc + c, 0);
      return row.map((count, predictedTier) => ({
        actualTier,
        predictedTier,
        count,
        rowShare:
          rowTotal > 0 ? Math.round((count / rowTotal) * 1000) / 1000 : 0,
      }));
    });
    const total = items.length;
    return {
      matrix,
      exactAcc: total > 0 ? Math.round((exact / total) * 1000) / 1000 : 0,
      withinOneAcc:
        total > 0 ? Math.round((withinOne / total) * 1000) / 1000 : 0,
    };
  };

  const allTier = buildTierMatrix(scored);
  const holdoutTier = buildTierMatrix(holdoutSlice);

  return {
    trainedOnSplit,
    trainSampleCount: fitRows.length,
    splitMetrics,
    overfitDeltaR2,
    forwardProjectionMean: Math.round(forwardProjectionMean * 100) / 100,
    forwardProjectionSe: Math.round(forwardProjectionSe * 100) / 100,
    forwardProjectionCi95Lower:
      Math.round(forwardProjectionCi95Lower * 100) / 100,
    forwardProjectionCi95Upper:
      Math.round(forwardProjectionCi95Upper * 100) / 100,
    residualStdError: allMetric.residualStdError,
    pi95HalfWidth: allMetric.pi95HalfWidth,
    tierLabels: ['Q1 Low', 'Q2 Core', 'Q3 Growth', 'Q4 VIP'],
    tierThresholds: [q25, q50, q75],
    tierMatrixAll: allTier.matrix,
    tierMatrixHoldout: holdoutTier.matrix,
    exactTierAccuracyAll: allTier.exactAcc,
    withinOneTierAccuracyAll: allTier.withinOneAcc,
    exactTierAccuracyHoldout:
      holdoutSlice.length > 0 ? holdoutTier.exactAcc : null,
    withinOneTierAccuracyHoldout:
      holdoutSlice.length > 0 ? holdoutTier.withinOneAcc : null,
    holdoutCount: holdoutSlice.length,
  };
}

export function groupEventsByEntity(events: RawEvent[]): Map<string, RawEvent[]> {
  const map = new Map<string, RawEvent[]>();
  for (const ev of events) {
    const list = map.get(ev.entityId);
    if (list) {
      list.push(ev);
    } else {
      map.set(ev.entityId, [ev]);
    }
  }
  for (const list of map.values()) {
    list.sort((a, b) => a.timestampDay - b.timestampDay);
  }
  return map;
}

export const REGRESSION_FEATURE_CATALOG: {
  key: RegressionFeatureKey;
  csvColumn: string;
  label: string;
  shortLabel: string;
}[] = [
  { key: 'monetarySumObs', csvColumn: 'monetary_sum_obs', label: 'Monetary Sum (Obs)', shortLabel: 'Monetary' },
  { key: 'txCountObs', csvColumn: 'tx_count_obs', label: 'Transaction Count', shortLabel: 'Tx Count' },
  { key: 'avgOrderValueObs', csvColumn: 'avg_order_value_obs', label: 'Avg Order Value', shortLabel: 'AOV' },
  { key: 'meanEngagementObs', csvColumn: 'mean_engagement_obs', label: 'Mean Engagement', shortLabel: 'Engagement' },
  { key: 'recencyAtCutoff', csvColumn: 'recency_at_cutoff', label: 'Recency at Cutoff', shortLabel: 'Recency' },
  { key: 'promoShareObs', csvColumn: 'promo_share_obs', label: 'Promo Exposure Share', shortLabel: 'Promo %' },
  { key: 'tenureDaysObs', csvColumn: 'tenure_days_obs', label: 'Entity Tenure (Days)', shortLabel: 'Tenure (d)' },
];

export function buildRegressionDataset(
  events: RawEvent[],
  config: RegressionConfig,
  globalConfig: GlobalCurationConfig
): RegressionResult {
  const byEntity = groupEventsByEntity(events);
  const maxObservedDay = events.reduce(
    (acc, e) => Math.max(acc, e.timestampDay),
    0
  );
  const trailingStartDay = Math.max(0, maxObservedDay - config.obsCutoffDay);
  const trailingFeaturesByEntity = new Map<string, RegressionFeatureValues>();
  const allRows: RegressionRow[] = [];

  for (const [entityId, evs] of byEntity.entries()) {
    const obsEvents = evs.filter((e) => e.timestampDay <= config.obsCutoffDay);
    if (config.excludeZeroObsEntities && obsEvents.length === 0) {
      continue;
    }

    const horizonEnd = config.obsCutoffDay + config.horizonDays;
    const horizonEvents = evs.filter(
      (e) => e.timestampDay > config.obsCutoffDay && e.timestampDay <= horizonEnd
    );

    const txCountObs = obsEvents.length;
    const monetarySumObs = obsEvents.reduce((acc, e) => acc + e.spendAmount, 0);
    const avgOrderValueObs = txCountObs > 0 ? monetarySumObs / txCountObs : 0;
    const meanEngagementObs =
      txCountObs > 0
        ? obsEvents.reduce((acc, e) => acc + e.engagementScore, 0) / txCountObs
        : 0;
    const promoCountObs = obsEvents.filter((e) => e.actionId !== 0).length;
    const promoShareObs = txCountObs > 0 ? promoCountObs / txCountObs : 0;
    const lastObsDay = txCountObs > 0 ? obsEvents[txCountObs - 1].timestampDay : 0;
    const firstObsDay = txCountObs > 0 ? obsEvents[0].timestampDay : config.obsCutoffDay;
    const recencyAtCutoff =
      txCountObs > 0 ? config.obsCutoffDay - lastObsDay : config.obsCutoffDay;
    const tenureDaysObs =
      txCountObs > 0 ? config.obsCutoffDay - firstObsDay : 0;
    const targetLtvRaw = horizonEvents.reduce((acc, e) => acc + e.spendAmount, 0);

    // Cumulative historical observed spend up to maxObservedDay and trailing T_obs-day state
    const currentObservedLtv = evs.reduce((acc, e) => acc + e.spendAmount, 0);
    const trailingEvents = evs.filter((e) =>
      trailingStartDay === 0
        ? e.timestampDay >= 0 && e.timestampDay <= maxObservedDay
        : e.timestampDay > trailingStartDay && e.timestampDay <= maxObservedDay
    );
    const trailingTxCount = trailingEvents.length;
    const trailingMonetary = trailingEvents.reduce((acc, e) => acc + e.spendAmount, 0);
    const trailingAov = trailingTxCount > 0 ? trailingMonetary / trailingTxCount : 0;
    const trailingEng =
      trailingTxCount > 0
        ? trailingEvents.reduce((acc, e) => acc + e.engagementScore, 0) / trailingTxCount
        : 0;
    const trailingPromoCount = trailingEvents.filter((e) => e.actionId !== 0).length;
    const trailingPromoShare =
      trailingTxCount > 0 ? trailingPromoCount / trailingTxCount : 0;
    const trailingLastDay =
      trailingTxCount > 0 ? trailingEvents[trailingTxCount - 1].timestampDay : 0;
    const trailingRecency =
      trailingTxCount > 0 ? maxObservedDay - trailingLastDay : config.obsCutoffDay;
    const trailingTenure =
      evs.length > 0
        ? Math.min(config.obsCutoffDay, Math.max(0, maxObservedDay - evs[0].timestampDay))
        : 0;

    trailingFeaturesByEntity.set(entityId, {
      recencyAtCutoff: trailingRecency,
      txCountObs: trailingTxCount,
      monetarySumObs: Math.round(trailingMonetary * 100) / 100,
      avgOrderValueObs: Math.round(trailingAov * 100) / 100,
      meanEngagementObs: Math.round(trailingEng * 1000) / 1000,
      promoShareObs: Math.round(trailingPromoShare * 1000) / 1000,
      tenureDaysObs: trailingTenure,
    });

    // Temporal leakage guarantee: no obsEvent may exceed obsCutoffDay
    const leakageVerified = obsEvents.every((e) => e.timestampDay <= config.obsCutoffDay);

    const rawFeatureValues: RegressionFeatureValues = {
      recencyAtCutoff,
      txCountObs,
      monetarySumObs: Math.round(monetarySumObs * 100) / 100,
      avgOrderValueObs: Math.round(avgOrderValueObs * 100) / 100,
      meanEngagementObs: Math.round(meanEngagementObs * 1000) / 1000,
      promoShareObs: Math.round(promoShareObs * 1000) / 1000,
      tenureDaysObs,
    };

    allRows.push({
      entityId,
      split: assignEntitySplit(entityId, globalConfig),
      batchId: 0,
      ...rawFeatureValues,
      scaledFeatures: { ...rawFeatureValues },
      targetLtvRaw: Math.round(targetLtvRaw * 100) / 100,
      targetLtvWinsorized: Math.round(targetLtvRaw * 100) / 100,
      predictedHorizonLtv: 0,
      currentObservedLtv: Math.round(currentObservedLtv * 100) / 100,
      projectedFutureLtv: 0,
      trailingTxCount,
      horizonEventsCount: horizonEvents.length,
      leakageVerified,
    });
  }

  // Automated Standard-Deviation LTV Anomaly Detection (before winsorization masks tail spikes)
  const rawStdThreshold =
    typeof config.outlierStdThreshold === 'number' && Number.isFinite(config.outlierStdThreshold)
      ? Math.max(1.0, Math.min(5.0, config.outlierStdThreshold))
      : 2.5;
  const excludeOutliersEnabled = Boolean(config.excludeDetectedOutliers);

  const baselineRows = allRows.filter((r) => r.split === 'train');
  const statsPool = baselineRows.length >= 3 ? baselineRows : allRows;
  const statsN = statsPool.length || 1;
  const rawLtvMean = statsPool.reduce((acc, r) => acc + r.targetLtvRaw, 0) / statsN;
  const rawLtvVar =
    statsPool.reduce((acc, r) => acc + (r.targetLtvRaw - rawLtvMean) ** 2, 0) / statsN;
  const rawLtvStd = Math.sqrt(rawLtvVar);
  const upperBound = rawLtvMean + rawStdThreshold * rawLtvStd;
  const lowerBound = Math.max(0, rawLtvMean - rawStdThreshold * rawLtvStd);

  const zScoreByEntity = new Map<string, number>();
  const outlierIdSet = new Set<string>();
  if (rawLtvStd > 1e-6) {
    for (const row of allRows) {
      const z = (row.targetLtvRaw - rawLtvMean) / rawLtvStd;
      zScoreByEntity.set(row.entityId, z);
      if (Math.abs(z) >= rawStdThreshold) {
        outlierIdSet.add(row.entityId);
      }
    }
  }

  const workingRows = excludeOutliersEnabled
    ? allRows.filter((r) => !(r.split === 'train' && outlierIdSet.has(r.entityId)))
    : allRows;

  // Fit winsorization cap strictly on active TRAIN split to avoid distribution leakage
  const trainTargets = workingRows
    .filter((r) => r.split === 'train')
    .map((r) => r.targetLtvRaw)
    .sort((a, b) => a - b);

  const fallbackTargets = workingRows.map((r) => r.targetLtvRaw).sort((a, b) => a - b);
  const capSource = trainTargets.length > 0 ? trainTargets : fallbackTargets;
  const winsorCapValue =
    config.winsorizePercentile === 0
      ? capSource[capSource.length - 1] ?? 0
      : quantile(capSource, config.winsorizePercentile / 100);

  for (const row of allRows) {
    row.targetLtvWinsorized =
      config.winsorizePercentile === 0
        ? row.targetLtvRaw
        : Math.round(Math.min(row.targetLtvRaw, winsorCapValue) * 100) / 100;
  }

  // Fit feature normalization scalers strictly on active TRAIN split to prevent leakage
  const selectedSet = new Set<RegressionFeatureKey>(
    config.selectedFeatures && config.selectedFeatures.length > 0
      ? config.selectedFeatures
      : REGRESSION_FEATURE_CATALOG.map((f) => f.key)
  );
  const regFeatureDefs = REGRESSION_FEATURE_CATALOG.filter((f) =>
    selectedSet.has(f.key)
  );

  const trainRowsForScaler = workingRows.filter((r) => r.split === 'train');
  const scalerRows = trainRowsForScaler.length > 0 ? trainRowsForScaler : workingRows;

  const featureScalerStats: RegressionScalerStat[] = REGRESSION_FEATURE_CATALOG.map((f) => {
    const vals = scalerRows.map((r) => r[f.key]);
    if (vals.length === 0) {
      return { feature: f.key, label: f.label, mean: 0, std: 1, min: 0, max: 1 };
    }
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const variance = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length;
    const std = Math.sqrt(variance) || 1;
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    return {
      feature: f.key,
      label: f.label,
      mean: Math.round(mean * 1000) / 1000,
      std: Math.round(std * 1000) / 1000,
      min: Math.round(min * 1000) / 1000,
      max: Math.round(max * 1000) / 1000,
    };
  });

  const normMode = config.featureNormalization ?? 'none';
  if (normMode !== 'none') {
    for (const row of allRows) {
      const scaled = { ...row.scaledFeatures };
      for (const st of featureScalerStats) {
        const rawVal = row[st.feature];
        if (normMode === 'zscore') {
          scaled[st.feature] = Math.round(((rawVal - st.mean) / (st.std || 1)) * 1000) / 1000;
        } else {
          const span = st.max - st.min || 1;
          scaled[st.feature] = Math.round(((rawVal - st.min) / span) * 1000) / 1000;
        }
      }
      row.scaledFeatures = scaled;
    }
  }

  // Build cumulative LTV trend series across horizon checkpoints with ±k·σ envelopes
  const trendCheckpoints = 12;
  const trendSeries: LtvTrendPoint[] = [];
  if (allRows.length > 0 && maxObservedDay > 0) {
    for (let step = 1; step <= trendCheckpoints; step++) {
      const day = Math.max(1, Math.round((step / trendCheckpoints) * maxObservedDay));
      const allVals: number[] = [];
      const outlierVals: { entityId: string; cumLtv: number }[] = [];

      for (const r of allRows) {
        const evs = byEntity.get(r.entityId) ?? [];
        let cum = 0;
        for (const ev of evs) {
          if (ev.timestampDay <= day) cum += ev.spendAmount;
          else break;
        }
        allVals.push(cum);
        if (outlierIdSet.has(r.entityId)) {
          outlierVals.push({ entityId: r.entityId, cumLtv: cum });
        }
      }

      const mCum = allVals.reduce((a, b) => a + b, 0) / allVals.length;
      const vCum =
        allVals.reduce((a, b) => a + (b - mCum) ** 2, 0) / allVals.length;
      const sCum = Math.sqrt(vCum);
      const upCum = mCum + rawStdThreshold * sCum;
      const lowCum = Math.max(0, mCum - rawStdThreshold * sCum);

      outlierVals.sort((a, b) => b.cumLtv - a.cumLtv);
      const outlierMean =
        outlierVals.length > 0
          ? Math.round(
              (outlierVals.reduce((acc, o) => acc + o.cumLtv, 0) /
                outlierVals.length) *
                100
            ) / 100
          : null;

      trendSeries.push({
        day,
        label: `Day ${day}`,
        activeCohortCount: allVals.length,
        meanCumulativeLtv: Math.round(mCum * 100) / 100,
        stdCumulativeLtv: Math.round(sCum * 100) / 100,
        upperThresholdLtv: Math.round(upCum * 100) / 100,
        lowerThresholdLtv: Math.round(lowCum * 100) / 100,
        outlierMeanLtv: outlierMean,
        outlierCount: outlierVals.length,
        topOutlierEntityId: outlierVals[0]?.entityId ?? null,
        topOutlierLtv:
          outlierVals[0] !== undefined
            ? Math.round(outlierVals[0].cumLtv * 100) / 100
            : null,
      });
    }
  }

  const outlierEntities: LtvAnomalyEntity[] = allRows
    .filter((r) => outlierIdSet.has(r.entityId))
    .map((r) => {
      const z = zScoreByEntity.get(r.entityId) ?? 0;
      return {
        entityId: r.entityId,
        split: r.split,
        targetLtvRaw: r.targetLtvRaw,
        targetLtvWinsorized: r.targetLtvWinsorized,
        currentObservedLtv: r.currentObservedLtv,
        monetarySumObs: r.monetarySumObs,
        txCountObs: r.txCountObs,
        zScore: Math.round(z * 100) / 100,
        direction: z >= 0 ? ('high_tail' as const) : ('low_tail' as const),
        excludedFromTraining: excludeOutliersEnabled && r.split === 'train',
      };
    })
    .sort((a, b) => Math.abs(b.zScore) - Math.abs(a.zScore));

  const trainOutlierCount = outlierEntities.filter((o) => o.split === 'train').length;
  const excludedFromTrainCount = excludeOutliersEnabled ? trainOutlierCount : 0;

  const anomalyReport: LtvAnomalyReport = {
    stdThreshold: rawStdThreshold,
    excludeEnabled: excludeOutliersEnabled,
    totalEvaluatedCount: allRows.length,
    trainBaselineCount: statsPool.length,
    meanTargetLtv: Math.round(rawLtvMean * 100) / 100,
    stdTargetLtv: Math.round(rawLtvStd * 100) / 100,
    upperBound: Math.round(upperBound * 100) / 100,
    lowerBound: Math.round(lowerBound * 100) / 100,
    outlierCount: outlierEntities.length,
    trainOutlierCount,
    excludedFromTrainCount,
    outlierRate:
      allRows.length > 0
        ? Math.round((outlierEntities.length / allRows.length) * 10000) / 10000
        : 0,
    outlierEntityIds: outlierEntities.map((o) => o.entityId),
    outlierEntities,
    trendSeries,
  };

  const splitCounts: Record<SplitName, number> = { train: 0, val: 0, test: 0 };
  for (const r of workingRows) splitCounts[r.split] += 1;

  const filtered =
    config.splitFilter === 'all'
      ? workingRows
      : workingRows.filter((r) => r.split === config.splitFilter);

  const batchSummary = assignSplitBatchIds(filtered, config.batchSize);

  const n = filtered.length || 1;
  const meanTargetRaw =
    filtered.reduce((acc, r) => acc + r.targetLtvRaw, 0) / n;
  const meanTargetWinsorized =
    filtered.reduce((acc, r) => acc + r.targetLtvWinsorized, 0) / n;
  const zeroTargetRate =
    filtered.filter((r) => r.targetLtvRaw === 0).length / n;

  const ys = filtered.map((r) => r.targetLtvWinsorized);
  const featureDefs = regFeatureDefs;

  const featureVectors = featureDefs.map((f) =>
    filtered.map((r) =>
      normMode === 'none' ? Number(r[f.key]) : Number(r.scaledFeatures[f.key])
    )
  );

  const correlations = featureDefs.map((f, idx) => {
    const xs = featureVectors[idx];
    const mean = xs.reduce((a, b) => a + b, 0) / n;
    const variance =
      xs.reduce((a, b) => a + (b - mean) * (b - mean), 0) / n;
    return {
      feature: String(f.key),
      label: f.label,
      pearsonR: Math.round(pearsonCorrelation(xs, ys) * 1000) / 1000,
      mean: Math.round(mean * 100) / 100,
      std: Math.round(Math.sqrt(variance) * 100) / 100,
    };
  });

  const matrix: number[][] = featureDefs.map((_, i) =>
    featureDefs.map((__, j) => {
      if (i === j) return 1;
      return Math.round(pearsonCorrelation(featureVectors[i], featureVectors[j]) * 1000) / 1000;
    })
  );

  const highCollinearityPairs: RegressionResult['featureMatrix']['highCollinearityPairs'] = [];
  for (let i = 0; i < featureDefs.length; i++) {
    for (let j = i + 1; j < featureDefs.length; j++) {
      const r = matrix[i][j];
      if (Math.abs(r) >= 0.7) {
        const vifEstimate = Math.round((1 / Math.max(0.01, 1 - r * r)) * 100) / 100;
        highCollinearityPairs.push({
          featureA: String(featureDefs[i].key),
          labelA: featureDefs[i].label,
          featureB: String(featureDefs[j].key),
          labelB: featureDefs[j].label,
          pearsonR: r,
          vifEstimate,
        });
      }
    }
  }
  highCollinearityPairs.sort((a, b) => Math.abs(b.pearsonR) - Math.abs(a.pearsonR));

  // Fit standardized OLS linear regression (with minimal Ridge epsilon for collinearity stability)
  const p = featureDefs.length;
  const rowCount = filtered.length;
  const yMean = ys.reduce((a, b) => a + b, 0) / (rowCount || 1);
  const yVar = ys.reduce((a, b) => a + (b - yMean) ** 2, 0) / (rowCount || 1);
  const yStd = Math.sqrt(yVar);

  const featureMeans = featureVectors.map((xs) => xs.reduce((a, b) => a + b, 0) / (rowCount || 1));
  const featureStds = featureVectors.map((xs, idx) => {
    const m = featureMeans[idx];
    const v = xs.reduce((a, b) => a + (b - m) ** 2, 0) / (rowCount || 1);
    return Math.sqrt(v);
  });

  let linearFit: RegressionResult['linearFit'];
  if (rowCount >= 3 && yStd > 1e-9) {
    const Z: number[][] = Array.from({ length: rowCount }, (_, i) =>
      featureVectors.map((xs, j) =>
        featureStds[j] > 1e-9 ? (xs[i] - featureMeans[j]) / featureStds[j] : 0
      )
    );
    const zy = ys.map((y) => (y - yMean) / yStd);

    const ztz: number[][] = Array.from({ length: p }, () => new Array(p).fill(0));
    const zty: number[] = new Array(p).fill(0);

    for (let i = 0; i < rowCount; i++) {
      for (let j = 0; j < p; j++) {
        const zij = Z[i][j];
        zty[j] += zij * zy[i];
        for (let k = j; k < p; k++) {
          ztz[j][k] += zij * Z[i][k];
        }
      }
    }
    for (let j = 0; j < p; j++) {
      for (let k = 0; k < j; k++) {
        ztz[j][k] = ztz[k][j];
      }
      ztz[j][j] += 1e-3 * rowCount;
    }

    const betas = solveLinearSystem(ztz, zty);
    const rawCoeffs = betas.map((beta, j) =>
      featureStds[j] > 1e-9 ? (beta * yStd) / featureStds[j] : 0
    );
    const intercept =
      yMean - rawCoeffs.reduce((acc, b, j) => acc + b * featureMeans[j], 0);

    const scalerByKey = new Map<RegressionFeatureKey, RegressionScalerStat>(
      featureScalerStats.map((st) => [st.feature, st])
    );

    let sse = 0;
    let sst = 0;
    let sumAbsErr = 0;
    let sumAbsPctErr = 0;
    let nonZeroMapeCount = 0;
    for (let i = 0; i < rowCount; i++) {
      let pred = intercept;
      for (let j = 0; j < p; j++) {
        pred += rawCoeffs[j] * featureVectors[j][i];
      }
      const clampedPred = Math.max(0, Math.round(pred * 100) / 100);
      const absErr = Math.abs(ys[i] - clampedPred);
      const err = ys[i] - pred;
      sse += err * err;
      sumAbsErr += absErr;
      if (ys[i] > 1e-6) {
        sumAbsPctErr += absErr / ys[i];
        nonZeroMapeCount += 1;
      }
      sst += (ys[i] - yMean) ** 2;

      const row = filtered[i];
      row.predictedHorizonLtv = clampedPred;

      // Project future +H day LTV from the entity's latest trailing behavioral window
      const trailingRaw = trailingFeaturesByEntity.get(row.entityId);
      if (trailingRaw) {
        let forwardPred = intercept;
        for (let j = 0; j < p; j++) {
          const fKey = featureDefs[j].key;
          let xVal = trailingRaw[fKey];
          if (normMode !== 'none') {
            const st = scalerByKey.get(fKey);
            if (st) {
              if (normMode === 'zscore') {
                xVal = (xVal - st.mean) / (st.std || 1);
              } else {
                const span = st.max - st.min || 1;
                xVal = (xVal - st.min) / span;
              }
            }
          }
          forwardPred += rawCoeffs[j] * xVal;
        }
        row.projectedFutureLtv = Math.max(0, Math.round(forwardPred * 100) / 100);
      } else {
        row.projectedFutureLtv = row.predictedHorizonLtv;
      }
    }

    const rSquared = sst > 1e-9 ? Math.max(0, Math.min(1, 1 - sse / sst)) : 0;
    const rmse = Math.sqrt(sse / rowCount);
    const mae = sumAbsErr / rowCount;
    const mape =
      nonZeroMapeCount > 0
        ? Math.round((sumAbsPctErr / nonZeroMapeCount) * 1000) / 10
        : null;
    const df = Math.max(1, rowCount - p - 1);
    const standardError = Math.sqrt(sse / df);
    const meanProjectedLtv =
      filtered.reduce((acc, r) => acc + r.projectedFutureLtv, 0) / rowCount;
    const meanLtvSe = standardError / Math.sqrt(rowCount);
    const tCrit = tCritical95(df);
    const ci95Lower = Math.max(0, meanProjectedLtv - tCrit * meanLtvSe);
    const ci95Upper = meanProjectedLtv + tCrit * meanLtvSe;
    const pi95HalfWidth = tCrit * standardError;
    const totalAbsBeta = betas.reduce((acc, b) => acc + Math.abs(b), 0) || 1;

    const featuresImportance = featureDefs
      .map((f, j) => {
        const stdBeta = Math.round(betas[j] * 1000) / 1000;
        const corrR = correlations[j]?.pearsonR ?? 0;
        return {
          feature: String(f.key),
          label: f.label,
          standardizedBeta: stdBeta,
          importanceShare: Math.round((Math.abs(betas[j]) / totalAbsBeta) * 1000) / 1000,
          rawCoefficient: Math.round(rawCoeffs[j] * 1000) / 1000,
          univariateR2: Math.round(corrR * corrR * 1000) / 1000,
          direction:
            stdBeta > 0.005
              ? ('positive' as const)
              : stdBeta < -0.005
              ? ('negative' as const)
              : ('neutral' as const),
        };
      })
      .sort((a, b) => Math.abs(b.standardizedBeta) - Math.abs(a.standardizedBeta));

    linearFit = {
      rSquared: Math.round(rSquared * 1000) / 1000,
      rmse: Math.round(rmse * 100) / 100,
      mae: Math.round(mae * 100) / 100,
      mape,
      mapeSampleCount: nonZeroMapeCount,
      standardError: Math.round(standardError * 100) / 100,
      meanProjectedLtv: Math.round(meanProjectedLtv * 100) / 100,
      meanLtvSe: Math.round(meanLtvSe * 100) / 100,
      ci95Lower: Math.round(ci95Lower * 100) / 100,
      ci95Upper: Math.round(ci95Upper * 100) / 100,
      pi95HalfWidth: Math.round(pi95HalfWidth * 100) / 100,
      intercept: Math.round(intercept * 100) / 100,
      sampleSize: rowCount,
      features: featuresImportance,
    };
  } else {
    const fallbackPred = Math.max(0, Math.round(yMean * 100) / 100);
    for (const row of filtered) {
      row.predictedHorizonLtv = fallbackPred;
      row.projectedFutureLtv = fallbackPred;
    }
    linearFit = {
      rSquared: 0,
      rmse: 0,
      mae: 0,
      mape: null,
      mapeSampleCount: 0,
      standardError: 0,
      meanProjectedLtv: fallbackPred,
      meanLtvSe: 0,
      ci95Lower: fallbackPred,
      ci95Upper: fallbackPred,
      pi95HalfWidth: 0,
      intercept: Math.round(yMean * 100) / 100,
      sampleSize: rowCount,
      features: featureDefs.map((f) => ({
        feature: String(f.key),
        label: f.label,
        standardizedBeta: 0,
        importanceShare: 0,
        rawCoefficient: 0,
        univariateR2: 0,
        direction: 'neutral' as const,
      })),
    };
  }

  // Approximate linear R^2 from fitted OLS model
  const baselineR2Estimate = linearFit.rSquared;
  const rawTargetsForQuality = filtered.map((r) => r.targetLtvRaw);
  const targetQuality = computeTargetDataQuality(rawTargetsForQuality, ys);
  const driftReport = computeModelDriftReport(
    workingRows,
    featureDefs,
    normMode,
    config.klDriftThreshold ?? DEFAULT_KL_DRIFT_THRESHOLD
  );
  const evaluationMatrix = computeModelEvaluationMatrix(
    workingRows,
    featureDefs,
    normMode
  );

  return {
    rows: filtered,
    totalEntitiesBeforeFilter: byEntity.size,
    maxObservedDay,
    meanTargetRaw: Math.round(meanTargetRaw * 100) / 100,
    meanTargetWinsorized: Math.round(meanTargetWinsorized * 100) / 100,
    winsorCapValue: Math.round(winsorCapValue * 100) / 100,
    zeroTargetRate: Math.round(zeroTargetRate * 1000) / 1000,
    baselineR2Estimate,
    correlations,
    featureMatrix: {
      features: featureDefs,
      matrix,
      highCollinearityPairs,
    },
    linearFit,
    featureScalerStats,
    targetHistogram: buildHistogram(ys, 8),
    targetQuality,
    driftReport,
    evaluationMatrix,
    anomalyReport,
    splitCounts,
    batchSize: batchSummary.batchSize,
    batchCount: batchSummary.batchCount,
    splitBatchCounts: batchSummary.splitBatchCounts,
  };
}

function evaluateTrainHoldoutR2(
  rows: RegressionRow[],
  selectedKeys: RegressionFeatureKey[],
  normMode: RegressionConfig['featureNormalization']
): number | null {
  const trainRows = rows.filter((r) => r.split === 'train');
  const evalRows = rows.filter((r) => r.split === 'val' || r.split === 'test');
  if (trainRows.length < 4 || evalRows.length < 3 || selectedKeys.length === 0) {
    return null;
  }

  const p = selectedKeys.length;
  const nTrain = trainRows.length;
  const ysTrain = trainRows.map((r) => r.targetLtvWinsorized);
  const yMean = ysTrain.reduce((a, b) => a + b, 0) / nTrain;
  const yVar = ysTrain.reduce((a, b) => a + (b - yMean) ** 2, 0) / nTrain;
  const yStd = Math.sqrt(yVar);
  if (yStd <= 1e-9) return null;

  const trainVectors = selectedKeys.map((k) =>
    trainRows.map((r) => (normMode === 'none' ? Number(r[k]) : Number(r.scaledFeatures[k])))
  );
  const fMeans = trainVectors.map((xs) => xs.reduce((a, b) => a + b, 0) / nTrain);
  const fStds = trainVectors.map((xs, idx) => {
    const m = fMeans[idx];
    const v = xs.reduce((a, b) => a + (b - m) ** 2, 0) / nTrain;
    return Math.sqrt(v);
  });

  const Z: number[][] = Array.from({ length: nTrain }, (_, i) =>
    trainVectors.map((xs, j) => (fStds[j] > 1e-9 ? (xs[i] - fMeans[j]) / fStds[j] : 0))
  );
  const zy = ysTrain.map((y) => (y - yMean) / yStd);

  const ztz: number[][] = Array.from({ length: p }, () => new Array(p).fill(0));
  const zty: number[] = new Array(p).fill(0);
  for (let i = 0; i < nTrain; i++) {
    for (let j = 0; j < p; j++) {
      const zij = Z[i][j];
      zty[j] += zij * zy[i];
      for (let k = j; k < p; k++) {
        ztz[j][k] += zij * Z[i][k];
      }
    }
  }
  for (let j = 0; j < p; j++) {
    for (let k = 0; k < j; k++) {
      ztz[j][k] = ztz[k][j];
    }
    ztz[j][j] += 1e-3 * nTrain;
  }

  const betas = solveLinearSystem(ztz, zty);
  const rawCoeffs = betas.map((beta, j) =>
    fStds[j] > 1e-9 ? (beta * yStd) / fStds[j] : 0
  );
  const intercept =
    yMean - rawCoeffs.reduce((acc, b, j) => acc + b * fMeans[j], 0);

  const ysEval = evalRows.map((r) => r.targetLtvWinsorized);
  const evalMean = ysEval.reduce((a, b) => a + b, 0) / ysEval.length;
  let sse = 0;
  let sst = 0;
  for (let i = 0; i < evalRows.length; i++) {
    const row = evalRows[i];
    let pred = intercept;
    for (let j = 0; j < p; j++) {
      const k = selectedKeys[j];
      const xVal = normMode === 'none' ? Number(row[k]) : Number(row.scaledFeatures[k]);
      pred += rawCoeffs[j] * xVal;
    }
    sse += (ysEval[i] - pred) ** 2;
    sst += (ysEval[i] - evalMean) ** 2;
  }

  if (sst <= 1e-9) return 0;
  return Math.max(0, Math.min(1, Math.round((1 - sse / sst) * 1000) / 1000));
}

export function computeCutoffSensitivityCurve(
  events: RawEvent[],
  config: RegressionConfig,
  globalConfig: GlobalCurationConfig,
  maxDay: number
): CutoffSensitivityPoint[] {
  const minCutoff = 60;
  const maxCutoff = Math.max(90, maxDay - 60);
  const step = 15;
  const activeKeys: RegressionFeatureKey[] =
    config.selectedFeatures && config.selectedFeatures.length > 0
      ? config.selectedFeatures
      : REGRESSION_FEATURE_CATALOG.map((f) => f.key);
  const normMode = config.featureNormalization ?? 'none';

  const points: CutoffSensitivityPoint[] = [];
  for (let d = minCutoff; d <= maxCutoff; d += step) {
    const res = buildRegressionDataset(
      events,
      { ...config, obsCutoffDay: d },
      globalConfig
    );
    const holdoutR2 =
      config.splitFilter === 'all'
        ? evaluateTrainHoldoutR2(res.rows, activeKeys, normMode)
        : null;

    points.push({
      obsCutoffDay: d,
      horizonEndDay: d + config.horizonDays,
      rSquared: res.linearFit.rSquared,
      holdoutR2,
      rmse: res.linearFit.rmse,
      sampleSize: res.rows.length,
      zeroTargetRate: res.zeroTargetRate,
      isHorizonCensored: d + config.horizonDays > res.maxObservedDay,
    });
  }

  return points;
}

export function buildSequenceDataset(
  events: RawEvent[],
  config: SequenceConfig,
  globalConfig: GlobalCurationConfig
): SequenceResult {
  const byEntity = groupEventsByEntity(events);
  const featureNames = ['spend_amount', 'engagement_score', 'frequency_count', 'recency_days'];

  // First collect train-split events before cutoff to fit scaler without leakage
  const trainRawVectors: [number, number, number, number][] = [];
  for (const [entityId, evs] of byEntity.entries()) {
    const split = assignEntitySplit(entityId, globalConfig);
    if (split !== 'train') continue;
    for (const e of evs) {
      if (e.timestampDay <= config.obsCutoffDay) {
        trainRawVectors.push([
          e.spendAmount,
          e.engagementScore,
          e.frequencyCount,
          e.recencyDays,
        ]);
      }
    }
  }

  const transformVal = (v: number, idx: number) => {
    if (config.normalization === 'log1p_zscore' && idx !== 1) {
      return Math.log1p(Math.max(0, v));
    }
    return v;
  };

  const scalerSource = trainRawVectors.length > 0 ? trainRawVectors : [[50, 0.5, 2, 15] as [number, number, number, number]];
  const featureStats = featureNames.map((name, dim) => {
    const vals = scalerSource.map((vec) => transformVal(vec[dim], dim));
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const variance = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length;
    const std = Math.sqrt(variance) || 1;
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    return {
      name,
      mean: Math.round(mean * 1000) / 1000,
      std: Math.round(std * 1000) / 1000,
      min: Math.round(min * 1000) / 1000,
      max: Math.round(max * 1000) / 1000,
    };
  });

  const normalizeVector = (raw: [number, number, number, number]): [number, number, number, number] => {
    const out = [0, 0, 0, 0] as [number, number, number, number];
    for (let d = 0; d < 4; d++) {
      const val = transformVal(raw[d], d);
      const st = featureStats[d];
      if (config.normalization === 'minmax') {
        const span = st.max - st.min || 1;
        out[d] = Math.round(((val - st.min) / span) * 1000) / 1000;
      } else {
        out[d] = Math.round(((val - st.mean) / st.std) * 1000) / 1000;
      }
    }
    return out;
  };

  const allSamples: SequenceTensorSample[] = [];
  const rawLengths: number[] = [];

  for (const [entityId, evs] of byEntity.entries()) {
    const obsEvents = evs.filter((e) => e.timestampDay <= config.obsCutoffDay);
    if (obsEvents.length < config.minSeqLen) continue;

    rawLengths.push(obsEvents.length);
    const horizonEvents = evs.filter((e) => e.timestampDay > config.obsCutoffDay);
    const horizonTargetLtv =
      Math.round(horizonEvents.reduce((acc, e) => acc + e.spendAmount, 0) * 100) / 100;
    const nextActionId = horizonEvents[0]?.actionId ?? 0;

    let selected = obsEvents;
    let truncatedCount = 0;
    if (obsEvents.length > config.maxSeqLen) {
      truncatedCount = obsEvents.length - config.maxSeqLen;
      selected =
        config.truncation === 'recent'
          ? obsEvents.slice(obsEvents.length - config.maxSeqLen)
          : obsEvents.slice(0, config.maxSeqLen);
    }

    const padCount = Math.max(0, config.maxSeqLen - selected.length);
    const realSteps: SequenceStep[] = selected.map((ev, i) => {
      const raw: [number, number, number, number] = [
        ev.spendAmount,
        ev.engagementScore,
        ev.frequencyCount,
        ev.recencyDays,
      ];
      return {
        stepIndex: i,
        mask: 1,
        timestampDay: ev.timestampDay,
        deltaDays: ev.recencyDays,
        actionId: ev.actionId,
        actionLabel: ev.actionLabel,
        rawFeatures: raw,
        normalizedFeatures: normalizeVector(raw),
        stepReward: ev.reward,
      };
    });

    const makePadStep = (idx: number): SequenceStep => ({
      stepIndex: idx,
      mask: 0,
      timestampDay: null,
      deltaDays: 0,
      actionId: -1,
      actionLabel: 'PAD',
      rawFeatures: [0, 0, 0, 0],
      normalizedFeatures: [0, 0, 0, 0],
      stepReward: 0,
    });

    const steps: SequenceStep[] = [];
    if (config.padding === 'pre') {
      for (let p = 0; p < padCount; p++) steps.push(makePadStep(p));
      for (let r = 0; r < realSteps.length; r++) {
        steps.push({ ...realSteps[r], stepIndex: padCount + r });
      }
    } else {
      for (let r = 0; r < realSteps.length; r++) {
        steps.push({ ...realSteps[r], stepIndex: r });
      }
      for (let p = 0; p < padCount; p++) steps.push(makePadStep(realSteps.length + p));
    }

    allSamples.push({
      entityId,
      split: assignEntitySplit(entityId, globalConfig),
      batchId: 0,
      actualLen: selected.length,
      truncatedCount,
      padCount,
      horizonTargetLtv,
      nextActionId,
      steps,
    });
  }

  const splitCounts: Record<SplitName, number> = { train: 0, val: 0, test: 0 };
  for (const s of allSamples) splitCounts[s.split] += 1;

  const filtered =
    config.splitFilter === 'all'
      ? allSamples
      : allSamples.filter((s) => s.split === config.splitFilter);

  const batchSummary = assignSplitBatchIds(filtered, config.batchSize);

  const totalSlots = filtered.length * config.maxSeqLen || 1;
  const totalPads = filtered.reduce((acc, s) => acc + s.padCount, 0);
  const totalReal = filtered.reduce((acc, s) => acc + s.actualLen, 0);

  const transformerEval = evaluateTransformerSequenceModels(
    allSamples,
    filtered,
    config,
    batchSummary.batchSize
  );

  return {
    samples: filtered,
    tensorShape: [filtered.length, config.maxSeqLen, 4],
    featureNames,
    paddingSparsity: Math.round((totalPads / totalSlots) * 1000) / 1000,
    meanActualLength: Math.round((totalReal / (filtered.length || 1)) * 100) / 100,
    truncatedEntitiesCount: filtered.filter((s) => s.truncatedCount > 0).length,
    lengthHistogram: buildHistogram(rawLengths, 6),
    featureStats,
    splitCounts,
    batchSize: batchSummary.batchSize,
    batchCount: batchSummary.batchCount,
    splitBatchCounts: batchSummary.splitBatchCounts,
    transformerEval,
  };
}

export const TRANSFORMER_ARCHITECTURE_CATALOG: {
  id: TransformerArchitectureId;
  label: string;
  shortLabel: string;
  attentionType: string;
  description: string;
}[] = [
  {
    id: 'transformer_encoder',
    label: 'Transformer Encoder (Bidirectional Self-Attention)',
    shortLabel: 'Encoder Transformer',
    attentionType: 'Full Bidirectional + Key Padding Mask',
    description:
      'Multi-head self-attention encoder (nn.TransformerEncoder) pooling across all observed behavior tokens.',
  },
  {
    id: 'causal_gpt',
    label: 'Causal GPT Transformer (Autoregressive Mask)',
    shortLabel: 'Causal GPT',
    attentionType: 'Lower-Triangular Causal Mask',
    description:
      'Decoder-only causal attention attending backward from the latest behavioral state to model spend momentum.',
  },
  {
    id: 'temporal_fusion',
    label: 'Temporal Fusion Transformer (TFT Δt-Gated)',
    shortLabel: 'Temporal Fusion',
    attentionType: 'Variable Selection + Δt Kernel Attention',
    description:
      'Combines gated variable selection networks with continuous time-delta attention for non-linear spend bursts.',
  },
];

export function resolveTransformerConfig(config: SequenceConfig): {
  architecture: TransformerArchitectureId;
  architectureLabel: string;
  dModel: 64 | 128 | 256;
  numHeads: 2 | 4 | 8;
  headDim: number;
  numLayers: 1 | 2 | 4;
  dropoutRate: number;
  learningRate: number;
  positionalEncoding: TransformerPositionalEncoding;
  poolingMode: TransformerPoolingMode;
} {
  const architecture: TransformerArchitectureId =
    config.transformerArch ?? 'transformer_encoder';
  const dModel: 64 | 128 | 256 = config.dModel ?? 128;
  const numHeads: 2 | 4 | 8 = config.numHeads ?? 4;
  const numLayers: 1 | 2 | 4 = config.numLayers ?? 2;
  const dropoutRate =
    typeof config.dropoutRate === 'number' && Number.isFinite(config.dropoutRate)
      ? Math.max(0, Math.min(0.5, config.dropoutRate))
      : 0.1;
  const learningRate =
    typeof config.learningRate === 'number' && Number.isFinite(config.learningRate)
      ? Math.max(0.0001, Math.min(0.01, config.learningRate))
      : 0.001;
  const positionalEncoding: TransformerPositionalEncoding =
    config.positionalEncoding ?? 'time_delta';
  const poolingMode: TransformerPoolingMode =
    config.poolingMode ?? 'attention_pool';
  const archMeta =
    TRANSFORMER_ARCHITECTURE_CATALOG.find((a) => a.id === architecture) ??
    TRANSFORMER_ARCHITECTURE_CATALOG[0];

  return {
    architecture,
    architectureLabel: archMeta.shortLabel,
    dModel,
    numHeads,
    headDim: Math.max(8, Math.round(dModel / numHeads)),
    numLayers,
    dropoutRate,
    learningRate,
    positionalEncoding,
    poolingMode,
  };
}

export function estimateTransformerParams(
  modelId: 'ols_linear' | 'gru_seq' | TransformerArchitectureId,
  dModel: number,
  numLayers: number,
  featureDim = 4,
  actionVocabSize = 16
): number {
  if (modelId === 'ols_linear') {
    return featureDim + 1;
  }
  if (modelId === 'gru_seq') {
    const hidden = Math.max(32, Math.round(dModel / 2));
    // Single/multi-layer GRU: 3 * (input*hidden + hidden^2 + 2*hidden)
    const layer0 = 3 * (featureDim * hidden + hidden * hidden + 2 * hidden);
    const upper = Math.max(0, numLayers - 1) * 3 * (hidden * hidden * 2 + 2 * hidden);
    return layer0 + upper + hidden + 1;
  }
  // Input projection + action embedding + positional norm
  const inputProj = featureDim * dModel + dModel + actionVocabSize * 16 + 16 * dModel;
  // Each Transformer block: QKV + O proj (4*d^2 + 4d) + FFN (2 * d * 4d + 5d) + 2 LayerNorms (4d)
  const blockParams = 4 * dModel * dModel + 4 * dModel + 8 * dModel * dModel + 5 * dModel + 4 * dModel;
  const extraTftGating =
    modelId === 'temporal_fusion'
      ? 2 * (featureDim * dModel + dModel) + 2 * dModel * dModel
      : 0;
  const readoutHead = dModel * 32 + 32 + 32 + 1;
  return inputProj + numLayers * blockParams + extraTftGating + readoutHead;
}

function computeSplitEvalFromPairs(
  split: SplitEvaluationMetrics['split'],
  label: string,
  items: { actual: number; predicted: number }[],
  featureCount: number
): SplitEvaluationMetrics {
  const m = items.length;
  if (m === 0) {
    return {
      split,
      label,
      sampleSize: 0,
      rSquared: null,
      rmse: 0,
      mae: 0,
      mape: null,
      mapeSampleCount: 0,
      residualStdError: 0,
      standardError: 0,
      ci95Lower: 0,
      ci95Upper: 0,
      pi95HalfWidth: 0,
      bias: 0,
      calibrationRatio: null,
      meanActual: 0,
      meanPredicted: 0,
    };
  }

  let sumAct = 0;
  let sumPred = 0;
  let sumAbs = 0;
  let sse = 0;
  let sumAbsPct = 0;
  let nonZeroCount = 0;

  for (const it of items) {
    sumAct += it.actual;
    sumPred += it.predicted;
    const err = it.predicted - it.actual;
    const absErr = Math.abs(err);
    sumAbs += absErr;
    sse += err * err;
    if (it.actual > 1e-6) {
      sumAbsPct += absErr / it.actual;
      nonZeroCount += 1;
    }
  }

  const meanAct = sumAct / m;
  const meanPred = sumPred / m;
  let sst = 0;
  for (const it of items) {
    sst += (it.actual - meanAct) ** 2;
  }

  const rSquared =
    m >= 2 && sst > 1e-9
      ? Math.round(Math.max(-1, Math.min(1, 1 - sse / sst)) * 1000) / 1000
      : null;
  const rmse = Math.round(Math.sqrt(sse / m) * 100) / 100;
  const mae = Math.round((sumAbs / m) * 100) / 100;
  const mape =
    nonZeroCount > 0 ? Math.round((sumAbsPct / nonZeroCount) * 1000) / 10 : null;
  const df =
    split === 'train' ? Math.max(1, m - featureCount - 1) : Math.max(1, m - 1);
  const residualStdError = Math.sqrt(sse / df);
  const standardError = residualStdError / Math.sqrt(m);
  const tCrit = tCritical95(df);
  const ci95Lower = Math.max(0, meanPred - tCrit * standardError);
  const ci95Upper = meanPred + tCrit * standardError;
  const pi95HalfWidth = tCrit * residualStdError;
  const bias = Math.round((meanPred - meanAct) * 100) / 100;
  const calibrationRatio =
    sumAct > 1e-6 ? Math.round((sumPred / sumAct) * 1000) / 1000 : null;

  return {
    split,
    label,
    sampleSize: m,
    rSquared,
    rmse,
    mae,
    mape,
    mapeSampleCount: nonZeroCount,
    residualStdError: Math.round(residualStdError * 100) / 100,
    standardError: Math.round(standardError * 100) / 100,
    ci95Lower: Math.round(ci95Lower * 100) / 100,
    ci95Upper: Math.round(ci95Upper * 100) / 100,
    pi95HalfWidth: Math.round(pi95HalfWidth * 100) / 100,
    bias,
    calibrationRatio,
    meanActual: Math.round(meanAct * 100) / 100,
    meanPredicted: Math.round(meanPred * 100) / 100,
  };
}

function fitRidgeOnSequenceBasis(
  trainSamples: { features: number[]; actual: number }[],
  evalSamples: { features: number[]; actual: number; sample: SequenceTensorSample }[],
  ridgeLambda: number
): { actual: number; predicted: number; sample: SequenceTensorSample }[] {
  const nTrain = trainSamples.length;
  const p = trainSamples[0]?.features.length ?? 0;
  if (nTrain < 3 || p === 0) {
    const meanY =
      nTrain > 0
        ? trainSamples.reduce((acc, s) => acc + s.actual, 0) / nTrain
        : evalSamples.reduce((acc, s) => acc + s.actual, 0) / (evalSamples.length || 1);
    return evalSamples.map((s) => ({
      actual: s.actual,
      predicted: Math.max(0, Math.round(meanY * 100) / 100),
      sample: s.sample,
    }));
  }

  const yMean = trainSamples.reduce((acc, s) => acc + s.actual, 0) / nTrain;
  const yVar =
    trainSamples.reduce((acc, s) => acc + (s.actual - yMean) ** 2, 0) / nTrain;
  const yStd = Math.sqrt(yVar);

  if (yStd <= 1e-9) {
    return evalSamples.map((s) => ({
      actual: s.actual,
      predicted: Math.max(0, Math.round(yMean * 100) / 100),
      sample: s.sample,
    }));
  }

  const fMeans = new Array(p).fill(0);
  for (const row of trainSamples) {
    for (let j = 0; j < p; j++) fMeans[j] += row.features[j];
  }
  for (let j = 0; j < p; j++) fMeans[j] /= nTrain;

  const fStds = new Array(p).fill(0);
  for (const row of trainSamples) {
    for (let j = 0; j < p; j++) {
      const d = row.features[j] - fMeans[j];
      fStds[j] += d * d;
    }
  }
  for (let j = 0; j < p; j++) fStds[j] = Math.sqrt(fStds[j] / nTrain);

  const ztz: number[][] = Array.from({ length: p }, () => new Array(p).fill(0));
  const zty: number[] = new Array(p).fill(0);

  for (const row of trainSamples) {
    const zy = (row.actual - yMean) / yStd;
    const zRow = row.features.map((v, j) =>
      fStds[j] > 1e-9 ? (v - fMeans[j]) / fStds[j] : 0
    );
    for (let j = 0; j < p; j++) {
      zty[j] += zRow[j] * zy;
      for (let k = j; k < p; k++) {
        ztz[j][k] += zRow[j] * zRow[k];
      }
    }
  }

  for (let j = 0; j < p; j++) {
    for (let k = 0; k < j; k++) ztz[j][k] = ztz[k][j];
    ztz[j][j] += ridgeLambda * nTrain;
  }

  const betas = solveLinearSystem(ztz, zty);
  const rawCoeffs = betas.map((b, j) =>
    fStds[j] > 1e-9 ? (b * yStd) / fStds[j] : 0
  );
  const intercept =
    yMean - rawCoeffs.reduce((acc, w, j) => acc + w * fMeans[j], 0);

  return evalSamples.map((s) => {
    let pred = intercept;
    for (let j = 0; j < p; j++) {
      pred += rawCoeffs[j] * s.features[j];
    }
    return {
      actual: s.actual,
      predicted: Math.max(0, Math.round(pred * 100) / 100),
      sample: s.sample,
    };
  });
}

function computeSampleTransformerRepresentation(
  sample: SequenceTensorSample,
  modelId: 'ols_linear' | 'gru_seq' | TransformerArchitectureId,
  resolved: ReturnType<typeof resolveTransformerConfig>,
  maxSeqLen: number
): {
  features: number[];
  stepWeights: number[];
  attentionEntropy: number;
  peakAttentionStep: number;
} {
  const steps = sample.steps;
  const activeIndices: number[] = [];
  for (let i = 0; i < steps.length; i++) {
    if (steps[i].mask === 1) activeIndices.push(i);
  }

  const mLen = activeIndices.length;
  const stepWeights = new Array<number>(steps.length).fill(0);
  if (mLen === 0) {
    return {
      features: new Array(modelId === 'ols_linear' ? 4 : 8).fill(0),
      stepWeights,
      attentionEntropy: 0,
      peakAttentionStep: 0,
    };
  }

  // Mean normalized vector for query context (used by Encoder self-attention)
  const meanVec = [0, 0, 0, 0];
  for (const idx of activeIndices) {
    const nf = steps[idx].normalizedFeatures;
    for (let d = 0; d < 4; d++) meanVec[d] += nf[d] / mLen;
  }
  const lastStep = steps[activeIndices[mLen - 1]];
  const invTemp = Math.sqrt(resolved.headDim) / 8;

  const logits: number[] = [];
  for (let k = 0; k < mLen; k++) {
    const idx = activeIndices[k];
    const st = steps[idx];
    const nf = st.normalizedFeatures;
    const relPos = mLen > 1 ? k / (mLen - 1) : 1; // 0 = earliest, 1 = latest

    // Positional bias
    let posTerm = 0;
    if (resolved.positionalEncoding === 'sinusoidal') {
      posTerm = 0.25 * Math.sin(relPos * Math.PI * 0.5) + 0.15 * relPos;
    } else if (resolved.positionalEncoding === 'rotary_rope') {
      posTerm = 0.35 * Math.cos((1 - relPos) * Math.PI * 0.5);
    } else {
      // time_delta continuous kernel
      posTerm = 0.4 * Math.exp(-Math.max(0, st.deltaDays) / 45) + 0.2 * relPos;
    }

    if (modelId === 'ols_linear') {
      logits.push(0);
    } else if (modelId === 'gru_seq') {
      // Recurrent exponential forgetting factor toward latest event
      logits.push(1.4 * relPos + 0.25 * nf[0]);
    } else if (modelId === 'transformer_encoder') {
      // Bidirectional Q*K dot-product affinity around sequence context + spend/engagement salience
      const qkDot =
        (meanVec[0] * nf[0] +
          meanVec[1] * nf[1] +
          0.6 * meanVec[2] * nf[2] -
          0.4 * meanVec[3] * nf[3]) *
        0.5;
      const headScale = 1 + 0.08 * Math.log2(resolved.numHeads);
      const poolBias =
        resolved.poolingMode === 'last_token'
          ? 2.2 * relPos
          : resolved.poolingMode === 'cls_mean'
          ? 0.2 * relPos
          : 0.65 * relPos;
      logits.push((qkDot * headScale + posTerm + poolBias + 0.35 * nf[0] + 0.25 * nf[1]) / Math.max(0.65, invTemp * 0.45));
    } else if (modelId === 'causal_gpt') {
      // Causal attention anchored at the final active token K_T * Q_t
      const lf = lastStep.normalizedFeatures;
      const causalDot =
        (lf[0] * nf[0] + lf[1] * nf[1] + 0.5 * lf[2] * nf[2] - 0.3 * lf[3] * nf[3]) * 0.55;
      const causalDecay = 1.65 * relPos;
      logits.push((causalDot + causalDecay + posTerm + 0.3 * nf[1]) / Math.max(0.65, invTemp * 0.45));
    } else {
      // temporal_fusion: variable selection gating (spend * engagement salience + delta_t burst)
      const vsnGate =
        0.55 * Math.tanh(nf[0]) +
        0.45 * Math.tanh(nf[1]) +
        0.3 * Math.tanh(nf[2]) -
        0.25 * Math.tanh(nf[3]);
      const deltaKernel = Math.exp(-Math.max(0, st.deltaDays) / 30);
      logits.push((1.35 * vsnGate + 0.85 * deltaKernel + 0.9 * relPos + posTerm) / Math.max(0.65, invTemp * 0.45));
    }
  }

  // Stable softmax over unmasked steps
  const maxLogit = Math.max(...logits);
  const exps = logits.map((l) => Math.exp(Math.max(-20, Math.min(20, l - maxLogit))));
  const sumExp = exps.reduce((a, b) => a + b, 0) || 1;
  const alphas = exps.map((e) => e / sumExp);

  let entropy = 0;
  let peakStep = activeIndices[0];
  let peakAlpha = -1;
  for (let k = 0; k < mLen; k++) {
    const idx = activeIndices[k];
    const a = alphas[k];
    stepWeights[idx] = Math.round(a * 10000) / 10000;
    if (a > 1e-12) entropy -= a * Math.log(a);
    if (a > peakAlpha) {
      peakAlpha = a;
      peakStep = idx;
    }
  }

  if (modelId === 'ols_linear') {
    return {
      features: meanVec,
      stepWeights,
      attentionEntropy: Math.round(entropy * 1000) / 1000,
      peakAttentionStep: peakStep,
    };
  }

  // Attention-pooled hidden representation z_i
  const pooled = [0, 0, 0, 0];
  let weightedRawSpend = 0;
  let weightedReward = 0;
  for (let k = 0; k < mLen; k++) {
    const idx = activeIndices[k];
    const a = alphas[k];
    const nf = steps[idx].normalizedFeatures;
    for (let d = 0; d < 4; d++) pooled[d] += a * nf[d];
    weightedRawSpend += a * steps[idx].rawFeatures[0];
    weightedReward += a * steps[idx].stepReward;
  }

  // Non-linear Transformer FFN + temporal velocity basis
  const spendVel =
    mLen >= 2
      ? steps[activeIndices[mLen - 1]].normalizedFeatures[0] -
        steps[activeIndices[0]].normalizedFeatures[0]
      : 0;
  const engSpendInteraction = Math.tanh(pooled[0]) * (1 + 0.5 * Math.tanh(pooled[1]));
  const burstStd = Math.sqrt(
    activeIndices.reduce((acc, idx) => {
      const diff = steps[idx].normalizedFeatures[0] - meanVec[0];
      return acc + diff * diff;
    }, 0) / mLen
  );
  const lengthLog = Math.log1p(mLen) / Math.log1p(Math.max(2, maxSeqLen));

  const features =
    modelId === 'temporal_fusion'
      ? [
          pooled[0],
          pooled[1],
          pooled[2],
          pooled[3],
          engSpendInteraction,
          spendVel,
          burstStd,
          Math.log1p(Math.max(0, weightedRawSpend)),
          Math.tanh(weightedReward / 50),
          lengthLog,
        ]
      : modelId === 'causal_gpt'
      ? [
          pooled[0],
          pooled[1],
          pooled[2],
          pooled[3],
          lastStep.normalizedFeatures[0],
          spendVel,
          engSpendInteraction,
          lengthLog,
        ]
      : [
          pooled[0],
          pooled[1],
          pooled[2],
          pooled[3],
          engSpendInteraction,
          burstStd,
          Math.log1p(Math.max(0, weightedRawSpend)),
          lengthLog,
        ];

  return {
    features,
    stepWeights,
    attentionEntropy: Math.round(entropy * 1000) / 1000,
    peakAttentionStep: peakStep,
  };
}

function buildExpandedLossFeatures(
  zBase: number[],
  extraCount: number,
  activeBaseLimit: number
): number[] {
  const clampVal = (v: number) => Math.max(-3.5, Math.min(3.5, v));
  const baseSlice = zBase.slice(0, activeBaseLimit);
  if (extraCount <= 0 || zBase.length < 2) return baseSlice;

  const z0 = zBase[0] ?? 0;
  const z1 = zBase[1] ?? 0;
  const z2 = zBase[2] ?? 0;
  const z3 = zBase[3] ?? 0;
  const z4 = zBase[4] ?? z0;
  const z5 = zBase[5] ?? z1;

  const candidates = [
    clampVal(z0 * z2),
    clampVal(z1 * z2),
    clampVal(z0 * z0 - 1),
    clampVal(z0 * z3),
    clampVal(z2 * z3),
    clampVal(z1 * z1 - 1),
    clampVal(z4 * z5),
    Math.sin(1.7 * z0 + 0.9 * z1),
    Math.cos(1.4 * z2 - 0.8 * z3),
    Math.sin(2.3 * z0 - 1.1 * z2),
    Math.cos(2.1 * z1 + 1.3 * z3),
    clampVal(z2 * z2 - 1),
    clampVal(z0 * z1 * z2),
    clampVal(z1 * z2 * z3),
    Math.sin(3.1 * z0 + 2.7 * z1),
    Math.cos(2.9 * z2 - 2.4 * z3),
  ];

  return baseSlice.concat(candidates.slice(0, Math.min(extraCount, candidates.length)));
}

export function computeTransformerLossCurve(
  trainSamples: SequenceTensorSample[],
  valSamples: SequenceTensorSample[],
  resolved: ReturnType<typeof resolveTransformerConfig>,
  maxSeqLen: number,
  batchSize: number,
  estimatedParams: number,
  evalSplitLabel: 'Validation' | 'Holdout (Val+Test)' = 'Validation'
): TransformerLossCurveSummary {
  const EPOCHS = 30;
  const nTrain = trainSamples.length;
  const nVal = valSamples.length;
  const paramToSampleRatio =
    nTrain > 0 ? Math.round((estimatedParams / nTrain) * 10) / 10 : 0;

  if (nTrain < 3) {
    return {
      epochs: 0,
      points: [],
      diagnosis: 'insufficient_data',
      diagnosisLabel: 'Insufficient Training Data',
      diagnosisDetail:
        'At least 3 training sequences are required to optimize and plot epoch-by-epoch loss.',
      bestEpoch: 0,
      bestValLoss: null,
      finalTrainLoss: 0,
      finalValLoss: null,
      finalTrainRmse: 0,
      finalValRmse: null,
      generalizationGap: null,
      valReboundDelta: null,
      paramToSampleRatio,
      trainSampleCount: nTrain,
      evalSampleCount: nVal,
      evalSplitLabel,
    };
  }

  const trainReps = trainSamples.map((s) => ({
    rep: computeSampleTransformerRepresentation(
      s,
      resolved.architecture,
      resolved,
      maxSeqLen
    ),
    actual: s.horizonTargetLtv,
  }));
  const valReps = valSamples.map((s) => ({
    rep: computeSampleTransformerRepresentation(
      s,
      resolved.architecture,
      resolved,
      maxSeqLen
    ),
    actual: s.horizonTargetLtv,
  }));

  const yMean = trainReps.reduce((acc, r) => acc + r.actual, 0) / nTrain;
  const yVar =
    trainReps.reduce((acc, r) => acc + (r.actual - yMean) ** 2, 0) / nTrain;
  const yStd = Math.sqrt(yVar);

  if (yStd <= 1e-9) {
    return {
      epochs: 0,
      points: [],
      diagnosis: 'insufficient_data',
      diagnosisLabel: 'Zero Target Variance',
      diagnosisDetail:
        'Target horizon LTV has zero variance in the training split; optimization loss cannot be evaluated.',
      bestEpoch: 0,
      bestValLoss: null,
      finalTrainLoss: 0,
      finalValLoss: null,
      finalTrainRmse: 0,
      finalValRmse: null,
      generalizationGap: null,
      valReboundDelta: null,
      paramToSampleRatio,
      trainSampleCount: nTrain,
      evalSampleCount: nVal,
      evalSplitLabel,
    };
  }

  // Per-split variance for 1 - R^2 normalized loss comparison
  const valActualMean =
    nVal > 0 ? valReps.reduce((acc, r) => acc + r.actual, 0) / nVal : yMean;
  const valActualVar =
    nVal > 1
      ? valReps.reduce((acc, r) => acc + (r.actual - valActualMean) ** 2, 0) / nVal
      : yVar;
  const valNormVar = valActualVar > 1e-6 ? valActualVar / yVar : 1;

  const pBase = trainReps[0].rep.features.length;
  const fMeans = new Array<number>(pBase).fill(0);
  for (const r of trainReps) {
    for (let j = 0; j < pBase; j++) fMeans[j] += r.rep.features[j] / nTrain;
  }
  const fStds = new Array<number>(pBase).fill(0);
  for (const r of trainReps) {
    for (let j = 0; j < pBase; j++) {
      const d = r.rep.features[j] - fMeans[j];
      fStds[j] += d * d;
    }
  }
  for (let j = 0; j < pBase; j++) {
    fStds[j] = Math.sqrt(fStds[j] / nTrain);
  }

  // Capacity & regularization parameters derived directly from Transformer hyperparameters
  const dModelTerms = resolved.dModel === 256 ? 7 : resolved.dModel === 128 ? 2 : 0;
  const layerTerms = resolved.numLayers === 4 ? 7 : resolved.numLayers === 2 ? 2 : 0;
  const headTerms = resolved.numHeads === 8 ? 2 : resolved.numHeads === 4 ? 1 : 0;
  const extraCount = dModelTerms + layerTerms + headTerms;

  // Ultra-small capacity (64d, 1L) limits active readout dimensionality; larger configs unlock full basis
  const activeBaseLimit =
    resolved.dModel === 64 && resolved.numLayers === 1
      ? Math.min(pBase, 3)
      : resolved.dModel === 64 || resolved.numLayers === 1
      ? Math.min(pBase, 5)
      : pBase;

  const toFeatureVec = (feats: number[]) => {
    const zBase = feats.map((v, j) => (fStds[j] > 1e-9 ? (v - fMeans[j]) / fStds[j] : 0));
    return buildExpandedLossFeatures(zBase, extraCount, activeBaseLimit);
  };

  const trainX = trainReps.map((r) => toFeatureVec(r.rep.features));
  const trainY = trainReps.map((r) => (r.actual - yMean) / yStd);
  const valX = valReps.map((r) => toFeatureVec(r.rep.features));
  const valY = valReps.map((r) => (r.actual - yMean) / yStd);

  const dim = trainX[0].length;
  const weights = new Array<number>(dim).fill(0);
  const velocity = new Array<number>(dim).fill(0);

  // Regularization from dropout + capacity bottleneck
  const capacityDamping =
    resolved.dModel === 64 && resolved.numLayers === 1
      ? 0.42
      : resolved.dModel === 64 || resolved.numLayers === 1
      ? 0.14
      : 0;
  const baseL2 = 0.004 + resolved.dropoutRate * 0.95 + capacityDamping;
  const extraL2 = 0.0005 + resolved.dropoutRate * 1.55 + capacityDamping;

  // Step size modulated by learningRate, batchSize & model depth, stabilized against high L2 eigenvalues
  const lrMultiplier = Math.max(0.35, Math.min(2.1, Math.pow(resolved.learningRate / 0.001, 0.45)));
  const batchFactor = Math.pow(32 / Math.max(16, batchSize), 0.22);
  const depthStepScale =
    resolved.numLayers === 4 ? 1.18 : resolved.numLayers === 2 ? 1.0 : 0.72;
  const baseLr = 0.14 * lrMultiplier * batchFactor * depthStepScale;
  const momentum = resolved.learningRate >= 0.0025 ? 0.56 : 0.45;

  const evalSplitMseZ = (xs: number[][], ys: number[]): number => {
    let sse = 0;
    for (let i = 0; i < xs.length; i++) {
      let pred = 0;
      const row = xs[i];
      for (let j = 0; j < dim; j++) pred += weights[j] * row[j];
      const err = pred - ys[i];
      sse += err * err;
    }
    return sse / xs.length;
  };

  const points: TransformerLossEpochPoint[] = [];
  let bestEpoch = 1;
  let bestValLoss = Infinity;

  for (let epoch = 1; epoch <= EPOCHS; epoch++) {
    const grad = new Array<number>(dim).fill(0);
    for (let i = 0; i < nTrain; i++) {
      let pred = 0;
      const row = trainX[i];
      for (let j = 0; j < dim; j++) pred += weights[j] * row[j];
      const err = pred - trainY[i];
      for (let j = 0; j < dim; j++) grad[j] += (err * row[j]) / nTrain;
    }

    const cosineDecay = 0.55 + 0.45 * Math.cos(((epoch - 1) / EPOCHS) * (Math.PI * 0.6));

    for (let j = 0; j < dim; j++) {
      const reg = j < activeBaseLimit ? baseL2 : extraL2;
      const lr = (baseLr * cosineDecay) / (1 + 2.4 * reg);
      const g = grad[j] + reg * weights[j];
      velocity[j] = momentum * velocity[j] - lr * g;
      weights[j] += velocity[j];
    }

    const trainMseZ = evalSplitMseZ(trainX, trainY);
    const valMseZ = nVal >= 2 ? evalSplitMseZ(valX, valY) : null;
    const trainNormLoss = trainMseZ;
    const valNormLoss = valMseZ !== null ? valMseZ / valNormVar : null;

    const trainRmse = Math.round(Math.sqrt(Math.max(0, trainMseZ)) * yStd * 100) / 100;
    const valRmse =
      valMseZ !== null ? Math.round(Math.sqrt(Math.max(0, valMseZ)) * yStd * 100) / 100 : null;
    const roundedTrain = Math.round(trainNormLoss * 10000) / 10000;
    const roundedVal = valNormLoss !== null ? Math.round(valNormLoss * 10000) / 10000 : null;
    const gap =
      roundedVal !== null ? Math.round((roundedVal - roundedTrain) * 10000) / 10000 : null;

    if (roundedVal !== null && roundedVal < bestValLoss) {
      bestValLoss = roundedVal;
      bestEpoch = epoch;
    }

    points.push({
      epoch,
      trainLoss: roundedTrain,
      valLoss: roundedVal,
      trainRmse,
      valRmse,
      generalizationGap: gap,
    });
  }

  const firstPt = points[0];
  const lastPt = points[points.length - 1];
  const finalTrainLoss = lastPt.trainLoss;
  const finalValLoss = lastPt.valLoss;
  const finalBestVal = Number.isFinite(bestValLoss) ? bestValLoss : null;
  const valReboundDelta =
    finalValLoss !== null && finalBestVal !== null
      ? Math.round((finalValLoss - finalBestVal) * 10000) / 10000
      : null;

  let diagnosis: LossFitDiagnosis = 'good_fit';
  let diagnosisLabel = 'Well-Calibrated Fit';
  let diagnosisDetail =
    'Training and validation loss descend together and stabilize with a narrow generalization gap.';

  if (nVal < 2 || finalValLoss === null) {
    diagnosis = 'insufficient_data';
    diagnosisLabel = 'No Validation Split';
    diagnosisDetail =
      'Validation/holdout split contains fewer than 2 sequences; adjust global split ratios to monitor generalization.';
  } else {
    const gap = finalValLoss - finalTrainLoss;
    const initGap = (firstPt.valLoss ?? finalValLoss) - firstPt.trainLoss;
    const gapExpansion = gap - initGap;
    const rebound = valReboundDelta ?? 0;
    const trainDrop = Math.max(0, 1 - finalTrainLoss);

    const isOverfit =
      gap >= 0.08 &&
      ((rebound >= 0.008 && bestEpoch <= 26) || gapExpansion >= 0.085);
    const isUnderfit =
      !isOverfit &&
      (trainDrop < 0.09 ||
        (capacityDamping >= 0.3 && trainDrop < 0.16) ||
        (resolved.dropoutRate >= 0.3 && trainDrop < 0.18));

    if (isOverfit) {
      diagnosis = 'overfitting';
      diagnosisLabel = 'Overfitting Risk';
      diagnosisDetail =
        rebound >= 0.008
          ? `${evalSplitLabel} loss hit its minimum at Epoch ${bestEpoch} (${finalBestVal?.toFixed(3)}) and rebounded +${rebound.toFixed(3)} while train loss fell to ${finalTrainLoss.toFixed(3)} (${resolved.dModel}d · ${resolved.numLayers}L, dropout ${(resolved.dropoutRate * 100).toFixed(0)}%). Increase dropout or reduce layers/d_model.`
          : `Generalization gap widened by +${gapExpansion.toFixed(3)} to ${gap.toFixed(3)} across 30 epochs (${resolved.dModel}d · ${resolved.numLayers}L, dropout ${(resolved.dropoutRate * 100).toFixed(0)}%). Increase dropout or reduce capacity.`;
    } else if (isUnderfit) {
      diagnosis = 'underfitting';
      diagnosisLabel = 'Underfitting Risk';
      diagnosisDetail = `Model reduced training loss by only ${(trainDrop * 100).toFixed(1)}% from baseline (${resolved.dModel}d · ${resolved.numLayers}L, dropout ${(resolved.dropoutRate * 100).toFixed(0)}%). Increase d_model, add Transformer layers, lengthen max_seq_len, or lower dropout.`;
    } else {
      diagnosis = 'good_fit';
      diagnosisLabel = 'Balanced Generalization';
      diagnosisDetail = `Train (${finalTrainLoss.toFixed(3)}) and ${evalSplitLabel} (${finalValLoss.toFixed(3)}) descend together by Epoch ${bestEpoch} with gap ${gap >= 0 ? '+' : ''}${gap.toFixed(3)}.`;
    }
  }

  return {
    epochs: EPOCHS,
    points,
    diagnosis,
    diagnosisLabel,
    diagnosisDetail,
    bestEpoch,
    bestValLoss: finalBestVal,
    finalTrainLoss,
    finalValLoss,
    finalTrainRmse: lastPt.trainRmse,
    finalValRmse: lastPt.valRmse,
    generalizationGap: lastPt.generalizationGap,
    valReboundDelta,
    paramToSampleRatio,
    trainSampleCount: nTrain,
    evalSampleCount: nVal,
    evalSplitLabel,
  };
}

export function evaluateTransformerSequenceModels(
  allSamples: SequenceTensorSample[],
  filteredSamples: SequenceTensorSample[],
  config: SequenceConfig,
  batchSize = 32
): TransformerEvaluationSummary {
  const resolved = resolveTransformerConfig(config);
  const trainPool = allSamples.filter((s) => s.split === 'train');
  const valPool = allSamples.filter((s) => s.split === 'val');
  const fitSource = trainPool.length >= 3 ? trainPool : allSamples;
  const evalTargetSamples = filteredSamples.length > 0 ? filteredSamples : allSamples;

  const modelSpecs: {
    id: 'ols_linear' | 'gru_seq' | TransformerArchitectureId;
    name: string;
    family: TransformerModelBenchmarkRow['family'];
    ridgeLambda: number;
  }[] = [
    {
      id: 'ols_linear',
      name: 'Linear OLS (Mean-Pool Baseline)',
      family: 'Linear Baseline',
      ridgeLambda: 0.02,
    },
    {
      id: 'gru_seq',
      name: 'GRU Sequence Baseline',
      family: 'Recurrent Baseline',
      ridgeLambda: 0.03,
    },
    {
      id: 'transformer_encoder',
      name: 'Transformer Encoder (Self-Attn)',
      family: 'Transformer',
      ridgeLambda: 0.015 + resolved.dropoutRate * 0.05,
    },
    {
      id: 'causal_gpt',
      name: 'Causal GPT Transformer',
      family: 'Transformer',
      ridgeLambda: 0.02 + resolved.dropoutRate * 0.05,
    },
    {
      id: 'temporal_fusion',
      name: 'Temporal Fusion Transformer (TFT)',
      family: 'Transformer',
      ridgeLambda: 0.01 + resolved.dropoutRate * 0.04,
    },
  ];

  const benchmarks: TransformerModelBenchmarkRow[] = [];
  let activePredictions: Record<string, TransformerEntityPrediction> = {};
  let activeTrainMetrics = computeSplitEvalFromPairs('train', 'Train', [], 8);
  let activeValMetrics = computeSplitEvalFromPairs('val', 'Validation', [], 8);
  let activeTestMetrics = computeSplitEvalFromPairs('test', 'Test', [], 8);
  let activeHoldoutMetrics = computeSplitEvalFromPairs('val', 'Holdout (Val+Test)', [], 8);
  let activeAllMetrics = computeSplitEvalFromPairs('all', 'All Splits', [], 8);
  let activeMeanEntropy = 0;

  for (const spec of modelSpecs) {
    const trainBasis = fitSource.map((sample) => {
      const rep = computeSampleTransformerRepresentation(
        sample,
        spec.id,
        resolved,
        config.maxSeqLen
      );
      return { features: rep.features, actual: sample.horizonTargetLtv };
    });

    const evalReps = evalTargetSamples.map((sample) => {
      const rep = computeSampleTransformerRepresentation(
        sample,
        spec.id,
        resolved,
        config.maxSeqLen
      );
      return {
        features: rep.features,
        actual: sample.horizonTargetLtv,
        sample,
        rep,
      };
    });

    const scored = fitRidgeOnSequenceBasis(trainBasis, evalReps, spec.ridgeLambda);
    const featureCount = trainBasis[0]?.features.length ?? 4;

    const trainPairs = scored
      .filter((x) => x.sample.split === 'train')
      .map((x) => ({ actual: x.actual, predicted: x.predicted }));
    const valPairs = scored
      .filter((x) => x.sample.split === 'val')
      .map((x) => ({ actual: x.actual, predicted: x.predicted }));
    const testPairs = scored
      .filter((x) => x.sample.split === 'test')
      .map((x) => ({ actual: x.actual, predicted: x.predicted }));
    const holdoutPairs = scored
      .filter((x) => x.sample.split === 'val' || x.sample.split === 'test')
      .map((x) => ({ actual: x.actual, predicted: x.predicted }));
    const allPairs = scored.map((x) => ({ actual: x.actual, predicted: x.predicted }));

    const mTrain = computeSplitEvalFromPairs('train', 'Train', trainPairs, featureCount);
    const mVal = computeSplitEvalFromPairs('val', 'Validation', valPairs, featureCount);
    const mTest = computeSplitEvalFromPairs('test', 'Test', testPairs, featureCount);
    const mHoldout = computeSplitEvalFromPairs(
      'val',
      'Holdout (Val+Test)',
      holdoutPairs,
      featureCount
    );
    const mAll = computeSplitEvalFromPairs('all', 'All Splits', allPairs, featureCount);

    const meanEnt =
      evalReps.length > 0
        ? Math.round(
            (evalReps.reduce((acc, r) => acc + r.rep.attentionEntropy, 0) /
              evalReps.length) *
              1000
          ) / 1000
        : 0;

    const isActive = spec.id === resolved.architecture;
    const summaryMetric = holdoutPairs.length >= 2 ? mHoldout : mAll;

    benchmarks.push({
      modelId: spec.id,
      modelName: spec.name,
      family: spec.family,
      isActive,
      paramCount: estimateTransformerParams(
        spec.id,
        resolved.dModel,
        resolved.numLayers
      ),
      rSquaredAll: mAll.rSquared,
      rSquaredHoldout: holdoutPairs.length >= 2 ? mHoldout.rSquared : null,
      rmseAll: mAll.rmse,
      rmseHoldout: holdoutPairs.length >= 2 ? mHoldout.rmse : null,
      maeAll: mAll.mae,
      maeHoldout: holdoutPairs.length >= 2 ? mHoldout.mae : null,
      mapeHoldout: holdoutPairs.length >= 2 ? mHoldout.mape : mAll.mape,
      standardError: summaryMetric.standardError,
      ci95Lower: summaryMetric.ci95Lower,
      ci95Upper: summaryMetric.ci95Upper,
      meanAttentionEntropy: spec.id === 'ols_linear' ? null : meanEnt,
    });

    if (isActive) {
      activeTrainMetrics = mTrain;
      activeValMetrics = mVal;
      activeTestMetrics = mTest;
      activeHoldoutMetrics = mHoldout;
      activeAllMetrics = mAll;
      activeMeanEntropy = meanEnt;
      const preds: Record<string, TransformerEntityPrediction> = {};
      for (let i = 0; i < scored.length; i++) {
        const sc = scored[i];
        const rep = evalReps[i].rep;
        preds[sc.sample.entityId] = {
          entityId: sc.sample.entityId,
          split: sc.sample.split,
          actualLtv: sc.actual,
          predictedLtv: sc.predicted,
          residual: Math.round((sc.predicted - sc.actual) * 100) / 100,
          attentionEntropy: rep.attentionEntropy,
          peakAttentionStep: rep.peakAttentionStep,
          stepWeights: rep.stepWeights,
        };
      }
      activePredictions = preds;
    }
  }

  const totalSlots = evalTargetSamples.length * config.maxSeqLen || 1;
  const totalReal = evalTargetSamples.reduce((acc, s) => acc + s.actualLen, 0);
  const overfitDeltaR2 =
    activeTrainMetrics.rSquared !== null && activeValMetrics.rSquared !== null
      ? Math.round((activeTrainMetrics.rSquared - activeValMetrics.rSquared) * 1000) /
        1000
      : null;

  const holdoutPool = allSamples.filter((s) => s.split === 'val' || s.split === 'test');
  const lossEvalPool = valPool.length >= 2 ? valPool : holdoutPool;
  const lossEvalLabel: 'Validation' | 'Holdout (Val+Test)' =
    valPool.length >= 2 ? 'Validation' : 'Holdout (Val+Test)';

  const activeEstimatedParams = estimateTransformerParams(
    resolved.architecture,
    resolved.dModel,
    resolved.numLayers
  );
  const lossCurve = computeTransformerLossCurve(
    trainPool.length >= 3 ? trainPool : allSamples,
    lossEvalPool,
    resolved,
    config.maxSeqLen,
    batchSize,
    activeEstimatedParams,
    lossEvalLabel
  );

  return {
    architecture: resolved.architecture,
    architectureLabel: resolved.architectureLabel,
    dModel: resolved.dModel,
    numHeads: resolved.numHeads,
    headDim: resolved.headDim,
    numLayers: resolved.numLayers,
    dropoutRate: resolved.dropoutRate,
    learningRate: resolved.learningRate,
    positionalEncoding: resolved.positionalEncoding,
    poolingMode: resolved.poolingMode,
    estimatedParams: activeEstimatedParams,
    tokensPerBatch: batchSize * config.maxSeqLen,
    attentionMaskCoverage: Math.round((totalReal / totalSlots) * 1000) / 1000,
    meanAttentionEntropy: activeMeanEntropy,
    trainMetrics: activeTrainMetrics,
    valMetrics: activeValMetrics,
    testMetrics: activeTestMetrics,
    holdoutMetrics: activeHoldoutMetrics,
    allMetrics: activeAllMetrics,
    overfitDeltaR2,
    lossCurve,
    benchmarks,
    predictionsByEntity: activePredictions,
  };
}

export function buildMdpDataset(
  events: RawEvent[],
  config: MdpConfig,
  globalConfig: GlobalCurationConfig
): MdpResult {
  const byEntity = groupEventsByEntity(events);
  const rawTransitions: Omit<
    MdpTransition,
    'rewardScaled' | 'returnToGo' | 'supportCount' | 'isLowSupportOod'
  >[] = [];

  // Build coarse state-action density map on train split for OOD detection
  const trainBinCounts = new Map<string, number>();

  const stateBucketKey = (
    engagement: number,
    recency: number,
    actionId: number
  ) => {
    const engBin = engagement < 0.35 ? 'L' : engagement < 0.7 ? 'M' : 'H';
    const recBin = recency <= 15 ? 'Fresh' : recency <= 35 ? 'Mid' : 'Stale';
    return `${engBin}:${recBin}:A${actionId}`;
  };

  let trajectoryCount = 0;

  for (const [entityId, evs] of byEntity.entries()) {
    if (evs.length < config.minTrajectorySteps) continue;
    const split = assignEntitySplit(entityId, globalConfig);
    trajectoryCount += 1;

    let cumSpend = 0;
    for (let i = 0; i < evs.length; i++) {
      const curr = evs[i];
      cumSpend += curr.spendAmount;
      const next = evs[i + 1];

      const isLast = i === evs.length - 1;
      const gapToNext = next ? next.timestampDay - curr.timestampDay : 0;
      const gapTerminal = !isLast && gapToNext > config.terminalInactivityGapDays;

      if (!config.includeAbsorbingStep && isLast) {
        // If not including absorbing step and it's the final event with no s_{t+1},
        // emit self-absorbing s_t -> s_t only if explicitly enabled; otherwise mark previous or emit with done=1
      }

      const done: 0 | 1 = isLast || gapTerminal ? 1 : 0;
      const terminalReason: MdpTransition['terminalReason'] = gapTerminal
        ? 'inactivity_gap'
        : isLast
        ? config.includeAbsorbingStep
          ? 'absorbing'
          : 'horizon_end'
        : 'none';

      const state = {
        recencyDays: curr.recencyDays,
        frequencyCount: curr.frequencyCount,
        cumSpend: Math.round(cumSpend * 100) / 100,
        engagementScore: curr.engagementScore,
      };

      const nextState =
        next && !gapTerminal
          ? {
              recencyDays: next.recencyDays,
              frequencyCount: next.frequencyCount,
              cumSpend: Math.round((cumSpend + next.spendAmount) * 100) / 100,
              engagementScore: next.engagementScore,
            }
          : {
              recencyDays: curr.recencyDays + config.terminalInactivityGapDays,
              frequencyCount: curr.frequencyCount,
              cumSpend: state.cumSpend,
              engagementScore: 0,
            };

      if (split === 'train') {
        const key = stateBucketKey(curr.engagementScore, curr.recencyDays, curr.actionId);
        trainBinCounts.set(key, (trainBinCounts.get(key) ?? 0) + 1);
      }

      rawTransitions.push({
        transitionId: `${entityId}#${i}`,
        entityId,
        split,
        stepIdx: i,
        timestampDay: curr.timestampDay,
        state,
        actionId: curr.actionId,
        actionLabel: curr.actionLabel,
        rewardRaw: curr.reward,
        nextState,
        done,
        terminalReason,
        behaviorPropensity: curr.propensity,
      });
    }
  }

  // Reward standardization stats from train transitions
  const trainRewards = rawTransitions
    .filter((t) => t.split === 'train')
    .map((t) => t.rewardRaw);
  const rSource = trainRewards.length > 0 ? trainRewards : rawTransitions.map((t) => t.rewardRaw);
  const rMean = rSource.reduce((a, b) => a + b, 0) / (rSource.length || 1);
  const rVar = rSource.reduce((a, b) => a + (b - rMean) ** 2, 0) / (rSource.length || 1);
  const rStd = Math.sqrt(rVar) || 1;

  const scaleReward = (r: number) => {
    if (config.rewardScale === 'clipped_10') {
      return Math.round(Math.max(-10, Math.min(10, r)) * 100) / 100;
    }
    if (config.rewardScale === 'standardized') {
      return Math.round(((r - rMean) / rStd) * 1000) / 1000;
    }
    return Math.round(r * 100) / 100;
  };

  // Compute discounted return-to-go G_t per entity trajectory backwards
  const byEntityTransitions = new Map<string, typeof rawTransitions>();
  for (const t of rawTransitions) {
    const arr = byEntityTransitions.get(t.entityId);
    if (arr) arr.push(t);
    else byEntityTransitions.set(t.entityId, [t]);
  }

  const completed: MdpTransition[] = [];
  const initialReturns: number[] = [];

  for (const trs of byEntityTransitions.values()) {
    let runningG = 0;
    const returnsForTraj = new Array<number>(trs.length);
    for (let i = trs.length - 1; i >= 0; i--) {
      const scaled = scaleReward(trs[i].rewardRaw);
      if (trs[i].done === 1) {
        runningG = scaled;
      } else {
        runningG = scaled + config.gamma * runningG;
      }
      returnsForTraj[i] = Math.round(runningG * 100) / 100;
    }
    if (returnsForTraj.length > 0) {
      initialReturns.push(returnsForTraj[0]);
    }

    for (let i = 0; i < trs.length; i++) {
      const t = trs[i];
      const key = stateBucketKey(t.state.engagementScore, t.state.recencyDays, t.actionId);
      const supportCount = trainBinCounts.get(key) ?? 0;
      completed.push({
        ...t,
        rewardScaled: scaleReward(t.rewardRaw),
        returnToGo: returnsForTraj[i],
        supportCount,
        isLowSupportOod: supportCount < 8 || t.behaviorPropensity < 0.2,
      });
    }
  }

  const splitCounts: Record<SplitName, number> = { train: 0, val: 0, test: 0 };
  for (const t of completed) splitCounts[t.split] += 1;

  const filtered =
    config.splitFilter === 'all'
      ? completed
      : completed.filter((t) => t.split === config.splitFilter);

  const actionMap = new Map<
    number,
    { label: string; count: number; sumR: number; sumG: number; lowSupp: number }
  >();
  for (const t of filtered) {
    const cur = actionMap.get(t.actionId) ?? {
      label: t.actionLabel,
      count: 0,
      sumR: 0,
      sumG: 0,
      lowSupp: 0,
    };
    cur.count += 1;
    cur.sumR += t.rewardScaled;
    cur.sumG += t.returnToGo;
    if (t.isLowSupportOod) cur.lowSupp += 1;
    actionMap.set(t.actionId, cur);
  }

  const totalF = filtered.length || 1;
  const actionBreakdown: ActionBreakdown[] = Array.from(actionMap.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([actionId, v]) => ({
      actionId,
      actionLabel: v.label,
      count: v.count,
      share: Math.round((v.count / totalF) * 1000) / 1000,
      meanReward: Math.round((v.sumR / v.count) * 100) / 100,
      meanReturnToGo: Math.round((v.sumG / v.count) * 100) / 100,
      lowSupportCount: v.lowSupp,
    }));

  const uniqueEntitiesFiltered = new Set(filtered.map((t) => t.entityId)).size || 1;
  const meanInitReturn =
    initialReturns.reduce((a, b) => a + b, 0) / (initialReturns.length || 1);

  return {
    transitions: filtered,
    trajectoryCount: config.splitFilter === 'all' ? trajectoryCount : uniqueEntitiesFiltered,
    terminalCount: filtered.filter((t) => t.done === 1).length,
    meanTrajectoryLength: Math.round((filtered.length / uniqueEntitiesFiltered) * 100) / 100,
    meanInitialReturn: Math.round(meanInitReturn * 100) / 100,
    lowSupportOodRate:
      Math.round((filtered.filter((t) => t.isLowSupportOod).length / totalF) * 1000) / 1000,
    rewardMean: Math.round(rMean * 100) / 100,
    rewardStd: Math.round(rStd * 100) / 100,
    actionBreakdown,
    splitCounts,
  };
}

export function runCrossParadigmAudit(
  events: RawEvent[],
  reg: RegressionResult,
  seq: SequenceResult,
  mdp: MdpResult,
  globalConfig: GlobalCurationConfig
): AuditCheck[] {
  // 1. Entity split disjointness
  const entitySplits = new Map<string, Set<SplitName>>();
  for (const r of reg.rows) {
    const s = entitySplits.get(r.entityId) ?? new Set();
    s.add(r.split);
    entitySplits.set(r.entityId, s);
  }
  for (const sSample of seq.samples) {
    const s = entitySplits.get(sSample.entityId) ?? new Set();
    s.add(sSample.split);
    entitySplits.set(sSample.entityId, s);
  }
  for (const t of mdp.transitions) {
    const s = entitySplits.get(t.entityId) ?? new Set();
    s.add(t.split);
    entitySplits.set(t.entityId, s);
  }
  const overlappingEntities = Array.from(entitySplits.values()).filter((s) => s.size > 1).length;

  // 2. Temporal leakage in regression
  const regLeakFailures = reg.rows.filter((r) => !r.leakageVerified).length;

  // 3. NaN / Inf check across events
  const invalidNumerics = events.filter(
    (e) =>
      !Number.isFinite(e.spendAmount) ||
      !Number.isFinite(e.reward) ||
      !Number.isFinite(e.engagementScore) ||
      !Number.isFinite(e.timestampDay)
  ).length;

  // 4. Sequence padding efficiency
  const padPct = Math.round(seq.paddingSparsity * 100);
  const padStatus: AuditCheck['status'] = padPct > 70 ? 'warn' : 'pass';

  // 5. Offline RL OOD support coverage
  const oodPct = Math.round(mdp.lowSupportOodRate * 100);
  const oodStatus: AuditCheck['status'] = oodPct > 35 ? 'warn' : 'pass';

  // 6. Zero-inflation in LTV target
  const zeroPct = Math.round(reg.zeroTargetRate * 100);
  const zeroStatus: AuditCheck['status'] = zeroPct > 50 ? 'warn' : 'pass';

  return [
    {
      id: 'split_disjointness',
      name: 'Cross-Paradigm Entity Split Parity',
      paradigm: 'Global',
      status: overlappingEntities === 0 ? 'pass' : 'fail',
      metricValue: `${overlappingEntities} cross-split leaks`,
      detail: `Deterministic FNV-1a entity hash (${Math.round(globalConfig.trainRatio * 100)}/${Math.round(globalConfig.valRatio * 100)}/${Math.round(globalConfig.testRatio * 100)}) guarantees identical train/val/test membership across Tabular, Tensor, and MDP sets.`,
    },
    {
      id: 'nan_sentinel',
      name: 'Numeric Integrity & Finite Sentinel',
      paradigm: 'Global',
      status: invalidNumerics === 0 ? 'pass' : 'fail',
      metricValue: `${invalidNumerics} invalid values`,
      detail: 'Verifies all spend, engagement, timestamp, and reward scalars are finite IEEE-754 floats before scaling.',
    },
    {
      id: 'temporal_leakage',
      name: 'Point-in-Time Observation Boundary',
      paradigm: 'Regression',
      status: regLeakFailures === 0 ? 'pass' : 'fail',
      metricValue: `${regLeakFailures} violations`,
      detail: 'Enforces strict timestamp_day <= T_obs for RFM features and (T_obs, T_obs + H] for LTV horizon labels; winsorization cap fit solely on train split.',
    },
    {
      id: 'zero_inflation',
      name: 'Target Horizon Zero-Inflation Check',
      paradigm: 'Regression',
      status: zeroStatus,
      metricValue: `${zeroPct}% zero targets`,
      detail:
        zeroStatus === 'warn'
          ? 'Over 50% of entities have zero spend in the target horizon. Consider a two-stage hurdle or Tweedie loss.'
          : 'Zero-spend rate is within nominal range for standard continuous LTV regression.',
    },
    {
      id: 'padding_sparsity',
      name: 'Tensor Padding Overhead Budget',
      paradigm: 'Sequence',
      status: padStatus,
      metricValue: `${padPct}% padding tokens`,
      detail:
        padStatus === 'warn'
          ? 'Padding sparsity exceeds 70%. Lower max sequence length L or raise min_seq_len to save GPU compute.'
          : 'Sequence length L is well aligned with entity event density; attention mask density is healthy.',
    },
    {
      id: 'cql_ood_support',
      name: 'Behavior Policy Support Coverage (CQL)',
      paradigm: 'Offline RL',
      status: oodStatus,
      metricValue: `${oodPct}% low-support (s,a)`,
      detail:
        oodStatus === 'warn'
          ? 'High proportion of low-support state-action cells (<8 train samples or propensity <0.20). Increase CQL conservative penalty alpha.'
          : 'Empirical behavior policy coverage is balanced enough for stable conservative Q-learning updates.',
    },
  ];
}

export interface CsvColumnMapping {
  entity: number;
  day: number;
  spend: number;
  actionId?: number;
  actionLabel?: number;
  channel?: number;
  engagement?: number;
  reward?: number;
  propensity?: number;
}

function parseCsvRows(csvText: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < csvText.length; i++) {
    const char = csvText[i];
    if (quoted) {
      if (char === '"' && csvText[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"' && field.length === 0) {
      quoted = true;
    } else if (char === ',') {
      row.push(field.trim());
      field = '';
    } else if (char === '\n' || char === '\r') {
      row.push(field.trim());
      field = '';
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
      if (char === '\r' && csvText[i + 1] === '\n') i++;
    } else {
      field += char;
    }
  }
  row.push(field.trim());
  if (row.some((value) => value.length > 0)) rows.push(row);
  return rows;
}

export function getCsvHeaders(csvText: string): string[] {
  const firstRow = parseCsvRows(csvText)[0] ?? [];
  return firstRow.map((header) => header.replace(/^\uFEFF/, '').trim());
}

export function inferDefaultCsvMapping(headers: string[]): CsvColumnMapping {
  const normalized = headers.map((header) =>
    header.trim().toLowerCase().replace(/[\s-]+/g, '_')
  );
  const find = (aliases: string[]) =>
    normalized.findIndex((header) => aliases.includes(header));
  const entity = find([
    'entity_id', 'user_id', 'customer_id', 'entity', 'unit_id', 'asset_id',
    'machine_id', 'engine_id', 'sensor_id', 'device_id',
  ]);
  const day = find([
    'timestamp_day', 'day', 't', 'timestamp', 'cycle', 'time_cycles', 'step',
    'cycle_idx',
  ]);
  const spend = find([
    'spend_amount', 'spend', 'amount', 'revenue', 'vibration', 'vibration_rms',
    'rms_vibration', 'sensor_value', 'sensor_reading', 'temperature',
    'pressure', 'signal_value',
  ]);
  const actionId = find(['action_id', 'action', 'op_setting']);
  const actionLabel = find([
    'action_label', 'treatment', 'action_name', 'maintenance_action', 'regime',
  ]);
  const channel = find(['channel', 'source', 'sensor_channel', 'sensor_name', 'subsystem']);
  const engagement = find([
    'engagement_score', 'engagement', 'utilization', 'health_index', 'health',
    'degradation_index',
  ]);
  const reward = find(['reward', 'margin', 'r', 'uptime_reward', 'rul_margin']);
  const propensity = find(['propensity', 'mu', 'prob']);

  return {
    entity: entity >= 0 ? entity : 0,
    day: day >= 0 ? day : Math.min(1, headers.length - 1),
    spend: spend >= 0 ? spend : Math.min(2, headers.length - 1),
    ...(actionId >= 0 ? { actionId } : {}),
    ...(actionLabel >= 0 ? { actionLabel } : {}),
    ...(channel >= 0 ? { channel } : {}),
    ...(engagement >= 0 ? { engagement } : {}),
    ...(reward >= 0 ? { reward } : {}),
    ...(propensity >= 0 ? { propensity } : {}),
  };
}

export function parseCsvToEvents(
  csvText: string,
  mappingOverride?: CsvColumnMapping
): {
  events: RawEvent[];
  errors: string[];
  presentFields: string[];
  headers: string[];
} {
  const rows = parseCsvRows(csvText);
  if (rows.length < 2) {
    return {
      events: [],
      errors: ['CSV must include a header row and at least one data row.'],
      presentFields: [],
      headers: rows[0] ?? [],
    };
  }

  const headers = rows[0].map((header) => header.replace(/^\uFEFF/, '').trim());
  const inferred = inferDefaultCsvMapping(headers);
  const idx: CsvColumnMapping = mappingOverride ?? inferred;
  const validIndex = (index: number | undefined): index is number =>
    index !== undefined && Number.isInteger(index) && index >= 0 && index < headers.length;

  const presentFields: string[] = [];
  if (validIndex(idx.entity)) presentFields.push('entity_id');
  if (validIndex(idx.day)) presentFields.push('timestamp_day');
  if (validIndex(idx.spend)) presentFields.push('spend_amount');
  if (validIndex(idx.actionId)) presentFields.push('action_id');
  if (validIndex(idx.actionLabel)) presentFields.push('action_label');
  if (validIndex(idx.channel)) presentFields.push('channel');
  if (validIndex(idx.engagement)) presentFields.push('engagement_score');
  if (validIndex(idx.reward)) presentFields.push('reward');
  if (validIndex(idx.propensity)) presentFields.push('propensity');

  if (!validIndex(idx.entity) || !validIndex(idx.day) || !validIndex(idx.spend)) {
    return {
      events: [],
      errors: [
        'Map a column to each required field: Entity ID, Timestamp, and Value.',
      ],
      presentFields,
      headers,
    };
  }
  if (new Set([idx.entity, idx.day, idx.spend]).size !== 3) {
    return {
      events: [],
      errors: ['Entity ID, Timestamp, and Target / Value must use different columns.'],
      presentFields,
      headers,
    };
  }

  const rawParsed: RawEvent[] = [];
  const errors: string[] = [];

  for (let i = 1; i < rows.length; i++) {
    const cols = rows[i];
    const entityId = cols[idx.entity];
    const timestampDay = Number(cols[idx.day]);
    const spendAmount = Number(cols[idx.spend]);

    if (!entityId || !Number.isFinite(timestampDay) || !Number.isFinite(spendAmount)) {
      errors.push(`Row ${i + 1}: invalid mapped entity, timestamp, or value.`);
      continue;
    }

    const actionId = validIndex(idx.actionId) ? Number(cols[idx.actionId]) || 0 : 0;
    const actionLabel =
      validIndex(idx.actionLabel) && cols[idx.actionLabel]
        ? cols[idx.actionLabel]
        : `Action ${actionId}`;
    const channel =
      validIndex(idx.channel) && cols[idx.channel] ? cols[idx.channel] : 'Default';
    const engagementScore =
      validIndex(idx.engagement) && Number.isFinite(Number(cols[idx.engagement]))
        ? Number(cols[idx.engagement])
        : 0.5;
    const reward =
      validIndex(idx.reward) && Number.isFinite(Number(cols[idx.reward]))
        ? Number(cols[idx.reward])
        : Math.round(spendAmount * 0.3 * 100) / 100;
    const propensity =
      validIndex(idx.propensity) && Number.isFinite(Number(cols[idx.propensity]))
        ? Math.min(1, Math.max(0.01, Number(cols[idx.propensity])))
        : 0.5;

    rawParsed.push({
      eventId: `CSV-${i}`,
      entityId,
      timestampDay,
      actionId,
      actionLabel,
      channel,
      recencyDays: 0,
      frequencyCount: 1,
      spendAmount,
      engagementScore,
      reward,
      propensity,
    });
  }

  // Recompute per-entity chronological recencyDays & frequencyCount
  const grouped = groupEventsByEntity(rawParsed);
  const finalEvents: RawEvent[] = [];
  for (const list of grouped.values()) {
    for (let i = 0; i < list.length; i++) {
      list[i].frequencyCount = i + 1;
      list[i].recencyDays = i === 0 ? 0 : list[i].timestampDay - list[i - 1].timestampDay;
      finalEvents.push(list[i]);
    }
  }

  return { events: finalEvents, errors, presentFields, headers };
}

const CANONICAL_IMPORT_FIELDS = [
  'entity_id',
  'timestamp_day',
  'spend_amount',
  'action_id',
  'action_label',
  'channel',
  'engagement_score',
  'reward',
  'propensity',
] as const;

export function getMatMappedFields(mapping: MatColumnMapping): string[] {
  const fields: string[] = [];
  if (mapping.sourceType === 'matrix') {
    if (mapping.entityCol !== undefined) fields.push('entity_id');
    if (mapping.dayCol !== undefined) fields.push('timestamp_day');
    if (mapping.spendCol !== undefined) fields.push('spend_amount');
    if (mapping.actionIdCol !== undefined) fields.push('action_id');
    if (mapping.engagementCol !== undefined) fields.push('engagement_score');
    if (mapping.rewardCol !== undefined) fields.push('reward');
    if (mapping.propensityCol !== undefined) fields.push('propensity');
  } else {
    if (mapping.entityVar) fields.push('entity_id');
    if (mapping.dayVar) fields.push('timestamp_day');
    if (mapping.spendVar) fields.push('spend_amount');
    if (mapping.actionIdVar) fields.push('action_id');
    if (mapping.actionLabelVar) fields.push('action_label');
    if (mapping.channelVar) fields.push('channel');
    if (mapping.engagementVar) fields.push('engagement_score');
    if (mapping.rewardVar) fields.push('reward');
    if (mapping.propensityVar) fields.push('propensity');
  }
  return fields;
}

export function validateImportedDatasetSchema(params: {
  presentFields: string[];
  events: RawEvent[];
  parseErrors?: string[];
}): SchemaValidationReport {
  const presentSet = new Set(params.presentFields);
  const detectedFields = CANONICAL_IMPORT_FIELDS.filter((f) => presentSet.has(f));
  const missingFields = CANONICAL_IMPORT_FIELDS.filter((f) => !presentSet.has(f));

  const events = params.events;
  const byEntity = groupEventsByEntity(events);
  const entityCount = byEntity.size;
  let multiStepEntities = 0;
  let minDay = Infinity;
  let maxDay = -Infinity;
  for (const list of byEntity.values()) {
    if (list.length >= 2) multiStepEntities += 1;
    for (const ev of list) {
      if (ev.timestampDay < minDay) minDay = ev.timestampDay;
      if (ev.timestampDay > maxDay) maxDay = ev.timestampDay;
    }
  }
  const daySpan = Number.isFinite(minDay) && Number.isFinite(maxDay) ? maxDay - minDay : 0;

  const coreRequired = ['entity_id', 'timestamp_day', 'spend_amount'];
  const missingCore = coreRequired.filter((f) => !presentSet.has(f));

  // 1. Regression Pipeline Check
  const regMissingCritical = [...missingCore];
  const regMissingRecommended = ['engagement_score', 'action_id', 'channel'].filter(
    (f) => !presentSet.has(f)
  );
  let regStatus: PipelineValidationStatus = 'ready';
  let regSummary = 'All required LTV feature & target fields detected.';
  if (regMissingCritical.length > 0 || events.length === 0) {
    regStatus = 'blocked';
    regSummary =
      regMissingCritical.length > 0
        ? `Missing core columns: ${regMissingCritical.join(', ')}.`
        : 'No valid event rows available for LTV matrix construction.';
  } else if (entityCount < 3) {
    regStatus = 'blocked';
    regSummary = `Only ${entityCount} unique entities found; need at least 3 entities for OLS regression.`;
  } else if (regMissingRecommended.length > 0 || daySpan <= 0) {
    regStatus = 'warn';
    const parts: string[] = [];
    if (regMissingRecommended.length > 0) {
      parts.push(
        `Defaulting missing fields (${regMissingRecommended.join(', ')}) reduces feature variance`
      );
    }
    if (daySpan <= 0) {
      parts.push('zero timestamp span prevents observation/horizon split');
    }
    regSummary = parts.join('; ') + '.';
  }

  // 2. Sequence Tensor Pipeline Check
  const seqMissingCritical = [...missingCore];
  const seqMissingRecommended = ['engagement_score', 'action_id'].filter(
    (f) => !presentSet.has(f)
  );
  let seqStatus: PipelineValidationStatus = 'ready';
  let seqSummary = 'All 4 tensor channels and action tokens are populated.';
  if (seqMissingCritical.length > 0 || events.length === 0) {
    seqStatus = 'blocked';
    seqSummary =
      seqMissingCritical.length > 0
        ? `Missing core columns: ${seqMissingCritical.join(', ')}.`
        : 'No valid events to build [B, L, D] sequential tensors.';
  } else if (seqMissingRecommended.length > 0 || multiStepEntities === 0) {
    seqStatus = 'warn';
    const parts: string[] = [];
    if (seqMissingRecommended.length > 0) {
      parts.push(
        `Missing ${seqMissingRecommended.join(', ')} will pad constant fallback values`
      );
    }
    if (multiStepEntities === 0) {
      parts.push('all entities have only 1 event (no temporal progression)');
    }
    seqSummary = parts.join('; ') + '.';
  }

  // 3. Offline RL (MDP) Pipeline Check
  const mdpMissingCritical = [
    ...missingCore,
    ...['action_id', 'reward', 'propensity'].filter((f) => !presentSet.has(f)),
  ];
  const mdpMissingRecommended = ['engagement_score'].filter(
    (f) => !presentSet.has(f)
  );
  let mdpStatus: PipelineValidationStatus = 'ready';
  let mdpSummary = 'State, action, reward, and propensity fields satisfy CQL/MDP schema.';
  if (missingCore.length > 0 || events.length === 0 || multiStepEntities === 0) {
    mdpStatus = 'blocked';
    if (missingCore.length > 0 || events.length === 0) {
      mdpSummary =
        missingCore.length > 0
          ? `Missing core columns: ${missingCore.join(', ')}.`
          : 'No valid events to form MDP transitions.';
    } else {
      mdpSummary =
        'No entity has >= 2 chronological events; cannot form (s, a, r, s\') transitions.';
    }
  } else if (mdpMissingCritical.length > 0 || mdpMissingRecommended.length > 0) {
    mdpStatus = 'warn';
    const missingAll = [...mdpMissingCritical, ...mdpMissingRecommended];
    mdpSummary = `Missing RL signals (${missingAll.join(
      ', '
    )}); synthetic fallback defaults will degrade CQL & propensity support accuracy.`;
  }

  const pipelines: PipelineSchemaCheck[] = [
    {
      paradigm: 'Regression',
      status: regStatus,
      missingCritical: regMissingCritical,
      missingRecommended: regMissingRecommended,
      summary: regSummary,
    },
    {
      paradigm: 'Sequence',
      status: seqStatus,
      missingCritical: seqMissingCritical,
      missingRecommended: seqMissingRecommended,
      summary: seqSummary,
    },
    {
      paradigm: 'Offline RL',
      status: mdpStatus,
      missingCritical: mdpMissingCritical,
      missingRecommended: mdpMissingRecommended,
      summary: mdpSummary,
    },
  ];

  const warnings: string[] = [];
  if (missingCore.length > 0) {
    warnings.push(
      `Missing mandatory canonical fields (${missingCore.join(', ')}). All pipelines require entity_id, timestamp_day, and spend_amount.`
    );
  }
  const missingMdpSpecific = ['action_id', 'reward', 'propensity'].filter(
    (f) => !presentSet.has(f)
  );
  if (missingMdpSpecific.length > 0 && missingCore.length === 0) {
    warnings.push(
      `Offline RL fields absent (${missingMdpSpecific.join(', ')}): falling back to action_id=0, reward=0.3×spend, propensity=0.5.`
    );
  }
  if (!presentSet.has('engagement_score') && missingCore.length === 0) {
    warnings.push(
      'Missing engagement_score: defaulting to constant 0.5 across Regression mean_engagement_obs, Sequence X[...,1], and MDP state.'
    );
  }
  if (!presentSet.has('channel') && missingCore.length === 0) {
    warnings.push(
      'Missing channel column: segment variance analysis will group events under a single default channel.'
    );
  }
  if (events.length > 0 && multiStepEntities === 0) {
    warnings.push(
      'No multi-step trajectories detected (>= 2 events per entity); Offline RL MDP transition buffer will be empty.'
    );
  }
  if (params.parseErrors && params.parseErrors.length > 0) {
    warnings.push(
      `${params.parseErrors.length} row(s) failed parsing and were excluded from materialized pipelines.`
    );
  }

  const overallStatus: PipelineValidationStatus = pipelines.some(
    (p) => p.status === 'blocked'
  )
    ? 'blocked'
    : pipelines.some((p) => p.status === 'warn') || warnings.length > 0
    ? 'warn'
    : 'ready';

  return {
    overallStatus,
    detectedFields,
    missingFields,
    totalRowsParsed: events.length,
    entityCount,
    pipelines,
    warnings,
  };
}

export async function parseMatToEvents(
  buffer: ArrayBuffer,
  mappingOverride?: Partial<MatColumnMapping>
): Promise<{
  events: RawEvent[];
  errors: string[];
  workspace: ParsedMatWorkspace;
  mapping: MatColumnMapping;
  presentFields: string[];
  schemaReport: SchemaValidationReport;
}> {
  const workspace = await parseMatFileBuffer(buffer);
  const inferred = inferDefaultMatMapping(workspace);
  const mapping: MatColumnMapping = mappingOverride
    ? { ...inferred, ...mappingOverride }
    : inferred;
  const { events, errors } = matWorkspaceToEvents(workspace, mapping);
  const presentFields = getMatMappedFields(mapping);
  const allErrors = [...workspace.warnings, ...errors];
  const schemaReport = validateImportedDatasetSchema({
    presentFields,
    events,
    parseErrors: allErrors,
  });
  return {
    events,
    errors: allErrors,
    workspace,
    mapping,
    presentFields,
    schemaReport,
  };
}

const SPLIT_ORDER: Record<SplitName, number> = { train: 0, val: 1, test: 2 };

function fnv1a32Hex(input: string, seedOffset = 0): string {
  let hash = (2166136261 + seedOffset) >>> 0;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function hashPiiValue(value: string, salt = 'stratum-pii-v1'): string {
  const normalizedSalt = salt.trim() || 'stratum-pii-v1';
  const payload = `${normalizedSalt}::${value}`;
  const hi = fnv1a32Hex(payload, 0);
  const lo = fnv1a32Hex(`${payload}::v2`, 0x9e3779b9);
  return `${hi}${lo}`;
}

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const SSN_RE = /\b\d{3}-\d{2}-\d{4}\b/g;
const IPV4_RE = /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g;
const PHONE_RE = /\b(?:\+?\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g;

export function sanitizeEmbeddedPiiText(
  text: string,
  config?: PiiMaskingConfig
): string {
  if (!config?.enabled || !text) return text;
  const replaceToken = (match: string) =>
    config.mode === 'hash'
      ? `pii_${hashPiiValue(match, config.salt).slice(0, 10)}`
      : '[REDACTED]';

  return text
    .replace(EMAIL_RE, replaceToken)
    .replace(SSN_RE, replaceToken)
    .replace(IPV4_RE, replaceToken)
    .replace(PHONE_RE, replaceToken);
}

export interface PiiMasker {
  enabled: boolean;
  mode: PiiMaskingConfig['mode'];
  maskEntityId: (entityId: string) => string;
  maskEventId: (eventId: string) => string;
  maskTransitionId: (entityId: string, stepIdx: number) => string;
  sanitizeText: (text: string) => string;
}

export function createPiiMasker(config?: PiiMaskingConfig): PiiMasker {
  if (!config?.enabled) {
    return {
      enabled: false,
      mode: config?.mode ?? 'hash',
      maskEntityId: (id) => id,
      maskEventId: (id) => id,
      maskTransitionId: (entityId, stepIdx) => `${entityId}#${stepIdx}`,
      sanitizeText: (text) => text,
    };
  }

  const entityMap = new Map<string, string>();
  const eventMap = new Map<string, string>();
  let entitySeq = 0;
  let eventSeq = 0;

  const maskEntityId = (entityId: string): string => {
    const existing = entityMap.get(entityId);
    if (existing) return existing;
    const masked =
      config.mode === 'hash'
        ? `ent_${hashPiiValue(entityId, config.salt)}`
        : `[REDACTED_${String(++entitySeq).padStart(4, '0')}]`;
    entityMap.set(entityId, masked);
    return masked;
  };

  const maskEventId = (eventId: string): string => {
    const existing = eventMap.get(eventId);
    if (existing) return existing;
    const masked =
      config.mode === 'hash'
        ? `evt_${hashPiiValue(eventId, config.salt).slice(0, 12)}`
        : `[REDACTED_EVT_${String(++eventSeq).padStart(5, '0')}]`;
    eventMap.set(eventId, masked);
    return masked;
  };

  const maskTransitionId = (entityId: string, stepIdx: number): string =>
    `${maskEntityId(entityId)}#${stepIdx}`;

  const sanitizeText = (text: string): string =>
    sanitizeEmbeddedPiiText(text, config);

  return {
    enabled: true,
    mode: config.mode,
    maskEntityId,
    maskEventId,
    maskTransitionId,
    sanitizeText,
  };
}

export function previewPiiMasking(
  sampleEntityIds: string[],
  config: PiiMaskingConfig
): { original: string; masked: string }[] {
  const uniqueIds = Array.from(new Set(sampleEntityIds)).slice(0, 3);
  const masker = createPiiMasker({ ...config, enabled: true });
  return uniqueIds.map((original) => ({
    original,
    masked: masker.maskEntityId(original),
  }));
}

export function exportRegressionDatasetCsv(
  result: RegressionResult,
  config: RegressionConfig,
  piiConfig?: PiiMaskingConfig
): string {
  const mode = config.featureNormalization;
  const batchSize = normalizeBatchSize(config.batchSize, result.batchSize || 32);
  const masker = createPiiMasker(piiConfig);
  const selectedSet = new Set(config.selectedFeatures);
  const activeFeatures = REGRESSION_FEATURE_CATALOG.filter((f) =>
    selectedSet.has(f.key)
  );
  const exportFeatures =
    activeFeatures.length > 0 ? activeFeatures : REGRESSION_FEATURE_CATALOG;

  // Order rows deterministically by split then batchId so chunked CSV readers get contiguous mini-batches
  const orderedRows = [...result.rows].sort((a, b) => {
    const sDiff = SPLIT_ORDER[a.split] - SPLIT_ORDER[b.split];
    if (sDiff !== 0) return sDiff;
    return a.batchId - b.batchId;
  });

  const header = [
    'entity_id',
    'split',
    'batch_id',
    'batch_size',
    'normalization_mode',
    ...exportFeatures.map((f) => f.csvColumn),
    'target_ltv_raw',
    'target_ltv_winsorized',
  ].join(',');

  const lines = orderedRows.map((r) => {
    const f = mode === 'none' ? r : r.scaledFeatures;
    return [
      masker.maskEntityId(r.entityId),
      r.split,
      r.batchId,
      batchSize,
      mode,
      ...exportFeatures.map((feat) => f[feat.key]),
      r.targetLtvRaw,
      r.targetLtvWinsorized,
    ].join(',');
  });

  return [header, ...lines].join('\n');
}

export interface ExportedSequenceBatch {
  split: SplitName;
  batchId: number;
  size: number;
  entityIds: string[];
  X: number[][][];
  mask: (0 | 1)[][];
  deltaDays: number[][];
  y_ltv: number[];
}

export function exportSequenceDatasetBundle(
  result: SequenceResult,
  config: SequenceConfig,
  piiConfig?: PiiMaskingConfig
) {
  const batchSize = normalizeBatchSize(config.batchSize, result.batchSize || 32);
  const masker = createPiiMasker(piiConfig);
  const orderedSamples = [...result.samples].sort((a, b) => {
    const sDiff = SPLIT_ORDER[a.split] - SPLIT_ORDER[b.split];
    if (sDiff !== 0) return sDiff;
    return a.batchId - b.batchId;
  });

  const batchMap = new Map<string, SequenceTensorSample[]>();
  for (const sample of orderedSamples) {
    const key = `${sample.split}:${sample.batchId}`;
    const existing = batchMap.get(key);
    if (existing) {
      existing.push(sample);
    } else {
      batchMap.set(key, [sample]);
    }
  }

  const batches: ExportedSequenceBatch[] = [];
  for (const group of batchMap.values()) {
    const first = group[0];
    batches.push({
      split: first.split,
      batchId: first.batchId,
      size: group.length,
      entityIds: group.map((s) => masker.maskEntityId(s.entityId)),
      X: group.map((s) => s.steps.map((st) => st.normalizedFeatures)),
      mask: group.map((s) => s.steps.map((st) => st.mask)),
      deltaDays: group.map((s) => s.steps.map((st) => st.deltaDays)),
      y_ltv: group.map((s) => s.horizonTargetLtv),
    });
  }

  return {
    schema: {
      shape: result.tensorShape,
      features: result.featureNames,
      padding: config.padding,
      truncation: config.truncation,
      normalization: config.normalization,
      batchSize,
      totalBatches: batches.length,
      splitBatchCounts: result.splitBatchCounts,
      transformer: {
        architecture: result.transformerEval.architecture,
        dModel: result.transformerEval.dModel,
        numHeads: result.transformerEval.numHeads,
        numLayers: result.transformerEval.numLayers,
        positionalEncoding: result.transformerEval.positionalEncoding,
        poolingMode: result.transformerEval.poolingMode,
        estimatedParams: result.transformerEval.estimatedParams,
        holdoutR2: result.transformerEval.holdoutMetrics.rSquared,
        holdoutRmse: result.transformerEval.holdoutMetrics.rmse,
      },
      piiMasking: {
        enabled: masker.enabled,
        mode: masker.enabled ? masker.mode : 'none',
      },
    },
    entityIds: orderedSamples.map((s) => masker.maskEntityId(s.entityId)),
    splits: orderedSamples.map((s) => s.split),
    batchIds: orderedSamples.map((s) => s.batchId),
    X: orderedSamples.map((s) => s.steps.map((st) => st.normalizedFeatures)),
    mask: orderedSamples.map((s) => s.steps.map((st) => st.mask)),
    deltaDays: orderedSamples.map((s) => s.steps.map((st) => st.deltaDays)),
    y_ltv: orderedSamples.map((s) => s.horizonTargetLtv),
    batches,
  };
}

export function exportMdpDatasetBundle(
  result: MdpResult,
  config: MdpConfig,
  piiConfig?: PiiMaskingConfig
) {
  const masker = createPiiMasker(piiConfig);
  const transitions = result.transitions.map((t) => ({
    ...t,
    transitionId: masker.maskTransitionId(t.entityId, t.stepIdx),
    entityId: masker.maskEntityId(t.entityId),
    actionLabel: masker.sanitizeText(t.actionLabel),
  }));

  return {
    schema: {
      gamma: config.gamma,
      terminalInactivityGapDays: config.terminalInactivityGapDays,
      rewardScale: config.rewardScale,
      stateFeatures: ['recencyDays', 'frequencyCount', 'cumSpend', 'engagementScore'],
      piiMasking: {
        enabled: masker.enabled,
        mode: masker.enabled ? masker.mode : 'none',
      },
    },
    transitions,
  };
}

function escapeSqlLiteral(val: string): string {
  return `'${val.replace(/'/g, "''")}'`;
}

function formatSqlNumber(val: number): string {
  if (!Number.isFinite(val)) return '0';
  return Number.isInteger(val) ? String(val) : String(val);
}

export function getRegressionSqlSchemaColumns(config: RegressionConfig): {
  name: string;
  pgType: string;
  description: string;
}[] {
  const selectedSet = new Set(config.selectedFeatures);
  const activeFeatures = REGRESSION_FEATURE_CATALOG.filter((f) =>
    selectedSet.has(f.key)
  );
  const exportFeatures =
    activeFeatures.length > 0 ? activeFeatures : REGRESSION_FEATURE_CATALOG;

  return [
    { name: 'entity_id', pgType: 'TEXT PRIMARY KEY', description: 'Unique entity key' },
    { name: 'split', pgType: 'VARCHAR(16) NOT NULL', description: 'Deterministic FNV-1a split (train/val/test)' },
    { name: 'batch_id', pgType: 'INTEGER NOT NULL', description: 'Training mini-batch chunk index' },
    { name: 'batch_size', pgType: 'INTEGER NOT NULL', description: 'Configured chunk size' },
    { name: 'normalization_mode', pgType: 'VARCHAR(16) NOT NULL', description: 'Train-fit scaling mode' },
    ...exportFeatures.map((f) => ({
      name: f.csvColumn,
      pgType: 'DOUBLE PRECISION NOT NULL',
      description: `${f.label} (${config.featureNormalization})`,
    })),
    { name: 'predicted_horizon_ltv', pgType: 'DOUBLE PRECISION NOT NULL', description: 'In-horizon OLS fitted LTV ($)' },
    { name: 'projected_future_ltv', pgType: 'DOUBLE PRECISION NOT NULL', description: 'Forward +H day projected LTV ($)' },
    { name: 'target_ltv_raw', pgType: 'DOUBLE PRECISION NOT NULL', description: 'Raw observed horizon spend ($)' },
    { name: 'target_ltv_winsorized', pgType: 'DOUBLE PRECISION NOT NULL', description: `Winsorized target LTV (P${config.winsorizePercentile})` },
    { name: 'leakage_verified', pgType: 'BOOLEAN NOT NULL', description: 'Point-in-time temporal boundary flag' },
  ];
}

export function buildSampleSqlSelectQuery(
  config: RegressionConfig,
  result: RegressionResult,
  datasetName = 'Stratum Dataset',
  piiConfig?: PiiMaskingConfig
): {
  tableName: string;
  ddlPreview: string;
  selectQuery: string;
  columns: { name: string; pgType: string; description: string }[];
} {
  const tableName = 'stratum_regression_ltv';
  const columns = getRegressionSqlSchemaColumns(config);
  const selectedSet = new Set(config.selectedFeatures);
  const activeFeatures = REGRESSION_FEATURE_CATALOG.filter((f) =>
    selectedSet.has(f.key)
  );
  const exportFeatures =
    activeFeatures.length > 0 ? activeFeatures : REGRESSION_FEATURE_CATALOG;

  const colDefs = columns
    .map((c) => `  ${c.name.padEnd(24, ' ')} ${c.pgType}`)
    .join(',\n');

  const ddlPreview = `CREATE TABLE IF NOT EXISTS ${tableName} (\n${colDefs}\n);`;

  const featureLines = exportFeatures
    .map((f) => `  ${f.csvColumn},`)
    .join('\n');

  const splitClause =
    config.splitFilter !== 'all'
      ? `\n  AND split = '${config.splitFilter}'`
      : '';

  const batchLimit = normalizeBatchSize(config.batchSize, result.batchSize || 32);
  const piiLabel = piiConfig?.enabled ? `ENABLED (${piiConfig.mode})` : 'OFF';

  const selectQuery = `-- Stratum PostgreSQL Schema Verification Query
-- Dataset: ${datasetName} | T_obs=${config.obsCutoffDay}d | H=${config.horizonDays}d | Norm=${config.featureNormalization} | BatchSize=${batchLimit} | PII Masking=${piiLabel}
SELECT
  entity_id,
  split,
  batch_id,
${featureLines}
  predicted_horizon_ltv,
  projected_future_ltv,
  target_ltv_raw,
  target_ltv_winsorized
FROM ${tableName}
WHERE leakage_verified = TRUE${splitClause}
ORDER BY split ASC, batch_id ASC, target_ltv_winsorized DESC
LIMIT ${batchLimit};

-- Split & Batch Aggregation Check
SELECT
  split,
  COUNT(*) AS entity_count,
  COUNT(DISTINCT batch_id) AS batch_chunks,
  ROUND(AVG(projected_future_ltv)::numeric, 2) AS mean_projected_ltv,
  ROUND(AVG(target_ltv_winsorized)::numeric, 2) AS mean_target_ltv
FROM ${tableName}
WHERE leakage_verified = TRUE${splitClause}
GROUP BY split
ORDER BY split;`;

  return { tableName, ddlPreview, selectQuery, columns };
}

export function exportRegressionDatasetSql(
  result: RegressionResult,
  config: RegressionConfig,
  datasetName = 'Stratum Dataset',
  piiConfig?: PiiMaskingConfig
): string {
  const tableName = 'stratum_regression_ltv';
  const mode = config.featureNormalization;
  const batchSize = normalizeBatchSize(config.batchSize, result.batchSize || 32);
  const masker = createPiiMasker(piiConfig);
  const selectedSet = new Set(config.selectedFeatures);
  const activeFeatures = REGRESSION_FEATURE_CATALOG.filter((f) =>
    selectedSet.has(f.key)
  );
  const exportFeatures =
    activeFeatures.length > 0 ? activeFeatures : REGRESSION_FEATURE_CATALOG;

  const columns = getRegressionSqlSchemaColumns(config);
  const colNames = columns.map((c) => c.name);
  const colDefs = columns
    .map((c) => `  ${c.name.padEnd(24, ' ')} ${c.pgType}`)
    .join(',\n');

  const orderedRows = [...result.rows].sort((a, b) => {
    const sDiff = SPLIT_ORDER[a.split] - SPLIT_ORDER[b.split];
    if (sDiff !== 0) return sDiff;
    return a.batchId - b.batchId;
  });

  const piiBanner = masker.enabled
    ? `ENABLED (mode=${masker.mode}, entity_id masked)`
    : 'DISABLED (raw entity_id)';

  const lines: string[] = [
    `-- ============================================================================`,
    `-- Stratum Materialized PostgreSQL Dataset Dump`,
    `-- Dataset: ${datasetName.replace(/[\r\n]+/g, ' ')}`,
    `-- Config: T_obs=${config.obsCutoffDay}d, Horizon=${config.horizonDays}d, Winsorization=P${config.winsorizePercentile}, Normalization=${mode}, BatchSize=${batchSize}, SplitFilter=${config.splitFilter}`,
    `-- PII Masking: ${piiBanner}`,
    `-- Rows: ${orderedRows.length} | Batches: ${result.batchCount}`,
    `-- ============================================================================`,
    '',
    'BEGIN;',
    '',
    `CREATE TABLE IF NOT EXISTS ${tableName} (`,
    colDefs,
    ');',
    '',
    `CREATE INDEX IF NOT EXISTS idx_${tableName}_split_batch ON ${tableName} (split, batch_id);`,
    '',
  ];

  const chunkSize = Math.min(100, Math.max(1, batchSize));
  const updateAssignments = colNames
    .filter((c) => c !== 'entity_id')
    .map((c) => `${c} = EXCLUDED.${c}`)
    .join(', ');

  for (let i = 0; i < orderedRows.length; i += chunkSize) {
    const slice = orderedRows.slice(i, i + chunkSize);
    lines.push(`INSERT INTO ${tableName} (${colNames.join(', ')}) VALUES`);
    const valueTuples = slice.map((r, idx) => {
      const f = mode === 'none' ? r : r.scaledFeatures;
      const vals = [
        escapeSqlLiteral(masker.maskEntityId(r.entityId)),
        escapeSqlLiteral(r.split),
        formatSqlNumber(r.batchId),
        formatSqlNumber(batchSize),
        escapeSqlLiteral(mode),
        ...exportFeatures.map((feat) => formatSqlNumber(f[feat.key])),
        formatSqlNumber(r.predictedHorizonLtv),
        formatSqlNumber(r.projectedFutureLtv),
        formatSqlNumber(r.targetLtvRaw),
        formatSqlNumber(r.targetLtvWinsorized),
        r.leakageVerified ? 'TRUE' : 'FALSE',
      ];
      const suffix = idx === slice.length - 1 ? '' : ',';
      return `  (${vals.join(', ')})${suffix}`;
    });
    lines.push(...valueTuples);
    lines.push(`ON CONFLICT (entity_id) DO UPDATE SET ${updateAssignments};`);
    lines.push('');
  }

  lines.push('COMMIT;');
  lines.push('');
  return lines.join('\n');
}

export function computeDataHealthScorecard(
  events: RawEvent[]
): DataHealthScorecard {
  const n = events.length;
  if (n === 0) {
    return {
      score: 0,
      tier: 'critical',
      tierLabel: 'No Events Loaded',
      totalEvents: 0,
      uniqueEntities: 0,
      passCount: 0,
      warnCount: 0,
      failCount: 1,
      timestampMin: 0,
      timestampMax: 0,
      timestampBinCv: 0,
      maxSingleDayShare: 0,
      timestampBuckets: [],
      checks: [
        {
          id: 'identifier_completeness',
          label: 'Dataset Presence & Identifiers',
          category: 'Schema',
          status: 'fail',
          affectedCount: 0,
          affectedRate: 1,
          scoreDeduction: 100,
          metricSummary: '0 events',
          thresholdRule: 'Requires >= 1 valid canonical event',
          detail: 'Loaded dataset contains zero canonical event records.',
          sampleEntities: [],
        },
      ],
    };
  }

  const uniqueEntitySet = new Set<string>();
  const seenEventIds = new Set<string>();
  const duplicateEventIdEntities: string[] = [];
  let duplicateEventIdCount = 0;

  const seenEntityDayAction = new Set<string>();
  const duplicateRecordEntities: string[] = [];
  let duplicateRecordCount = 0;

  let negativeRewardCount = 0;
  let minReward = Infinity;
  const negativeRewardEntities: string[] = [];

  let badTimestampCount = 0;
  const badTimestampEntities: string[] = [];
  const validDays: number[] = [];
  const dayCounts = new Map<number, number>();

  let badNumericBoundCount = 0;
  const badNumericEntities: string[] = [];

  let invalidPropensityCount = 0;
  let extremeLowPropensityCount = 0;
  const badPropensityEntities: string[] = [];

  let missingIdentifierCount = 0;
  const missingIdEntities: string[] = [];
  const entityEventCounts = new Map<string, number>();

  const pushSample = (arr: string[], id: string) => {
    const clean = id && id.trim() ? id.trim() : '(missing_id)';
    if (arr.length < 5 && !arr.includes(clean)) arr.push(clean);
  };

  for (const ev of events) {
    const eid = typeof ev.entityId === 'string' ? ev.entityId.trim() : '';
    const evId = typeof ev.eventId === 'string' ? ev.eventId.trim() : '';

    if (!eid || !evId || !ev.actionLabel?.trim() || !ev.channel?.trim()) {
      missingIdentifierCount += 1;
      pushSample(missingIdEntities, eid || evId);
    }
    if (eid) {
      uniqueEntitySet.add(eid);
      entityEventCounts.set(eid, (entityEventCounts.get(eid) ?? 0) + 1);
    }

    if (evId) {
      if (seenEventIds.has(evId)) {
        duplicateEventIdCount += 1;
        pushSample(duplicateEventIdEntities, eid || evId);
      } else {
        seenEventIds.add(evId);
      }
    }

    const compKey = `${eid}::${ev.timestampDay}::${ev.actionId}`;
    if (eid && seenEntityDayAction.has(compKey)) {
      duplicateRecordCount += 1;
      pushSample(duplicateRecordEntities, eid);
    } else if (eid) {
      seenEntityDayAction.add(compKey);
    }

    if (!Number.isFinite(ev.reward) || ev.reward < 0) {
      negativeRewardCount += 1;
      pushSample(negativeRewardEntities, eid);
    }
    if (Number.isFinite(ev.reward) && ev.reward < minReward) {
      minReward = ev.reward;
    }

    if (!Number.isFinite(ev.timestampDay) || ev.timestampDay < 0) {
      badTimestampCount += 1;
      pushSample(badTimestampEntities, eid);
    } else {
      validDays.push(ev.timestampDay);
      dayCounts.set(ev.timestampDay, (dayCounts.get(ev.timestampDay) ?? 0) + 1);
    }

    if (
      !Number.isFinite(ev.spendAmount) ||
      ev.spendAmount < 0 ||
      !Number.isFinite(ev.engagementScore) ||
      ev.engagementScore < 0 ||
      ev.engagementScore > 1 ||
      !Number.isFinite(ev.recencyDays) ||
      ev.recencyDays < 0 ||
      !Number.isFinite(ev.frequencyCount) ||
      ev.frequencyCount < 0
    ) {
      badNumericBoundCount += 1;
      pushSample(badNumericEntities, eid);
    }

    if (!Number.isFinite(ev.propensity) || ev.propensity <= 0 || ev.propensity > 1) {
      invalidPropensityCount += 1;
      pushSample(badPropensityEntities, eid);
    } else if (ev.propensity < 0.01) {
      extremeLowPropensityCount += 1;
      pushSample(badPropensityEntities, eid);
    }
  }

  // 1. Negative rewards check
  const negRewardRate = negativeRewardCount / n;
  const negRewardStatus: DataHealthStatus =
    negativeRewardCount === 0
      ? 'pass'
      : negRewardRate > 0.05
      ? 'fail'
      : 'warn';
  const negRewardDeduction =
    negRewardStatus === 'pass'
      ? 0
      : negRewardStatus === 'warn'
      ? Math.max(8, Math.round(negRewardRate * 240))
      : Math.min(30, 16 + Math.round(negRewardRate * 80));

  // 2. Duplicate entity records check (eventId duplicates + entity/day/action collisions)
  const totalDupCount = duplicateEventIdCount + duplicateRecordCount;
  const dupRate = totalDupCount / n;
  const dupStatus: DataHealthStatus =
    duplicateEventIdCount > 0 || dupRate > 0.05
      ? 'fail'
      : dupRate > 0.005 || duplicateRecordCount > 0
      ? 'warn'
      : 'pass';
  const dupDeduction =
    dupStatus === 'pass'
      ? 0
      : dupStatus === 'warn'
      ? Math.max(6, Math.round(dupRate * 200))
      : Math.min(28, 15 + Math.round(dupRate * 80));
  const combinedDupEntities = Array.from(
    new Set([...duplicateEventIdEntities, ...duplicateRecordEntities])
  ).slice(0, 5);

  // 3. Timestamp distribution check
  let tsMin = 0;
  let tsMax = 0;
  let maxSingleDayShare = 0;
  let timestampBinCv = 0;
  const timestampBuckets: TimestampBucketStat[] = [];

  if (validDays.length > 0) {
    tsMin = Math.min(...validDays);
    tsMax = Math.max(...validDays);
    const span = Math.max(1, tsMax - tsMin + 1);
    const bucketCount = 6;
    const counts = new Array<number>(bucketCount).fill(0);
    for (const d of validDays) {
      const idx = Math.min(bucketCount - 1, Math.floor(((d - tsMin) / span) * bucketCount));
      counts[idx] += 1;
    }
    const meanCount = validDays.length / bucketCount;
    const variance =
      counts.reduce((acc, c) => acc + (c - meanCount) ** 2, 0) / bucketCount;
    timestampBinCv =
      meanCount > 0 ? Math.round((Math.sqrt(variance) / meanCount) * 1000) / 1000 : 0;

    for (let b = 0; b < bucketCount; b++) {
      const startDay = Math.round(tsMin + (b * span) / bucketCount);
      const endDay = Math.round(tsMin + ((b + 1) * span) / bucketCount);
      timestampBuckets.push({
        label: `D${startDay}–${endDay}`,
        startDay,
        endDay,
        count: counts[b],
        share: Math.round((counts[b] / validDays.length) * 1000) / 1000,
      });
    }

    let maxDayCnt = 0;
    for (const c of dayCounts.values()) {
      if (c > maxDayCnt) maxDayCnt = c;
    }
    maxSingleDayShare = Math.round((maxDayCnt / validDays.length) * 1000) / 1000;
  }

  const tsSpanDays = tsMax - tsMin;
  const tsAbnormal =
    badTimestampCount > 0 ||
    tsSpanDays < 14 ||
    timestampBinCv > 0.95 ||
    maxSingleDayShare > 0.25;
  const tsWarning =
    !tsAbnormal &&
    (timestampBinCv > 0.55 || maxSingleDayShare > 0.1 || tsSpanDays < 45);
  const tsStatus: DataHealthStatus = tsAbnormal
    ? 'fail'
    : tsWarning
    ? 'warn'
    : 'pass';
  const tsDeduction =
    tsStatus === 'pass'
      ? 0
      : tsStatus === 'warn'
      ? 10
      : Math.min(28, 16 + Math.round((badTimestampCount / n) * 60));

  // 4. Spend, engagement & recency/frequency bounds
  const numRate = badNumericBoundCount / n;
  const numStatus: DataHealthStatus =
    badNumericBoundCount === 0 ? 'pass' : numRate > 0.02 ? 'fail' : 'warn';
  const numDeduction =
    numStatus === 'pass'
      ? 0
      : numStatus === 'warn'
      ? 8
      : Math.min(24, 14 + Math.round(numRate * 60));

  // 5. Propensity support check (0 < mu <= 1)
  const propAffected = invalidPropensityCount + extremeLowPropensityCount;
  const propStatus: DataHealthStatus =
    invalidPropensityCount > 0
      ? 'fail'
      : extremeLowPropensityCount > 0
      ? 'warn'
      : 'pass';
  const propDeduction =
    propStatus === 'pass'
      ? 0
      : propStatus === 'warn'
      ? 7
      : Math.min(22, 12 + Math.round((invalidPropensityCount / n) * 50));

  // 6. Identifier completeness & single-event fragmentation
  const uniqueEntities = uniqueEntitySet.size;
  const singleEventEntities = Array.from(entityEventCounts.values()).filter(
    (c) => c <= 1
  ).length;
  const singleEventShare =
    uniqueEntities > 0 ? singleEventEntities / uniqueEntities : 0;
  const idStatus: DataHealthStatus =
    missingIdentifierCount > 0
      ? 'fail'
      : singleEventShare > 0.35
      ? 'warn'
      : 'pass';
  const idDeduction =
    idStatus === 'pass'
      ? 0
      : idStatus === 'warn'
      ? 6
      : Math.min(25, 14 + Math.round((missingIdentifierCount / n) * 50));

  const checks: DataHealthCheckItem[] = [
    {
      id: 'negative_rewards',
      label: 'Negative Reward Guard',
      category: 'Reward Integrity',
      status: negRewardStatus,
      affectedCount: negativeRewardCount,
      affectedRate: Math.round(negRewardRate * 10000) / 10000,
      scoreDeduction: negRewardDeduction,
      metricSummary:
        negativeRewardCount === 0
          ? `0 neg · min ${Number.isFinite(minReward) ? minReward.toFixed(2) : '0.00'}`
          : `${negativeRewardCount} neg (${(negRewardRate * 100).toFixed(1)}%) · min ${minReward.toFixed(2)}`,
      thresholdRule: 'Pass: 0 negative rewards · Warn: <= 5% · Fail: > 5% or NaN',
      detail:
        negativeRewardCount === 0
          ? `All ${n.toLocaleString()} events have finite non-negative rewards (min = ${minReward.toFixed(2)}). Safe for LTV summation and discounted CQL returns.`
          : `${negativeRewardCount.toLocaleString()} event(s) carry negative or non-finite reward values (min = ${minReward.toFixed(2)}), which can distort MDP return-to-go G_t and regression LTV sums.`,
      sampleEntities: negativeRewardEntities,
    },
    {
      id: 'duplicate_records',
      label: 'Duplicate Entity Record Check',
      category: 'Uniqueness',
      status: dupStatus,
      affectedCount: totalDupCount,
      affectedRate: Math.round(dupRate * 10000) / 10000,
      scoreDeduction: dupDeduction,
      metricSummary:
        totalDupCount === 0
          ? '0 duplicates'
          : `${duplicateEventIdCount} ID dups · ${duplicateRecordCount} collisions`,
      thresholdRule: 'Pass: 0 dup eventIds & 0 (entity, day, action) collisions',
      detail:
        totalDupCount === 0
          ? `Zero duplicate event_id keys and zero (entity_id, timestamp_day, action_id) collisions across ${uniqueEntities.toLocaleString()} entities.`
          : `Detected ${duplicateEventIdCount} duplicate event_id keys and ${duplicateRecordCount} repeated (entity_id, timestamp_day, action_id) records that would double-count spend and sequence steps.`,
      sampleEntities: combinedDupEntities,
    },
    {
      id: 'timestamp_distribution',
      label: 'Timestamp Distribution & Burstiness',
      category: 'Temporal Distribution',
      status: tsStatus,
      affectedCount: badTimestampCount,
      affectedRate: Math.round((badTimestampCount / n) * 10000) / 10000,
      scoreDeduction: tsDeduction,
      metricSummary: `CV ${timestampBinCv.toFixed(2)} · peak ${(maxSingleDayShare * 100).toFixed(1)}%/d`,
      thresholdRule: 'Pass: valid t >= 0, bin CV <= 0.55, single-day peak <= 10%',
      detail:
        badTimestampCount > 0
          ? `Found ${badTimestampCount} invalid/negative timestamp_day values, breaking causal T_obs cutoffs and Δt sequence ordering.`
          : tsStatus === 'pass'
          ? `Events span Days ${tsMin}–${tsMax} evenly across 6 horizon buckets (CV = ${timestampBinCv.toFixed(2)}, single-day peak ${(maxSingleDayShare * 100).toFixed(1)}%).`
          : `Abnormal temporal clustering across Days ${tsMin}–${tsMax} (bucket CV = ${timestampBinCv.toFixed(2)}, single-day peak = ${(maxSingleDayShare * 100).toFixed(1)}%), risking censored cutoff splits.`,
      sampleEntities: badTimestampEntities,
    },
    {
      id: 'numeric_bounds',
      label: 'Spend, Engagement & RFM Bounds',
      category: 'Value Bounds',
      status: numStatus,
      affectedCount: badNumericBoundCount,
      affectedRate: Math.round(numRate * 10000) / 10000,
      scoreDeduction: numDeduction,
      metricSummary:
        badNumericBoundCount === 0
          ? 'All within domain'
          : `${badNumericBoundCount} out-of-range`,
      thresholdRule: 'Pass: spend >= 0, engagement in [0, 1], recency & freq >= 0',
      detail:
        badNumericBoundCount === 0
          ? 'All spendAmount, engagementScore [0, 1], recencyDays, and frequencyCount fields satisfy physical domain bounds.'
          : `${badNumericBoundCount} event(s) violate numeric domain bounds (negative spend/recency/frequency or engagement outside [0, 1]).`,
      sampleEntities: badNumericEntities,
    },
    {
      id: 'propensity_support',
      label: 'Logging Policy Propensity Support',
      category: 'Policy Support',
      status: propStatus,
      affectedCount: propAffected,
      affectedRate: Math.round((propAffected / n) * 10000) / 10000,
      scoreDeduction: propDeduction,
      metricSummary:
        propAffected === 0
          ? '100% in [0.01, 1.0]'
          : `${invalidPropensityCount} invalid · ${extremeLowPropensityCount} < 0.01`,
      thresholdRule: 'Pass: 0.01 <= mu(a|s) <= 1.0 · Warn: < 0.01 · Fail: <= 0 or > 1',
      detail:
        propAffected === 0
          ? 'Behavior policy propensities strictly satisfy positivity (0.01 <= μ <= 1.0), avoiding exploding inverse-propensity weights.'
          : `${invalidPropensityCount} invalid (<= 0 or > 1) and ${extremeLowPropensityCount} near-zero (< 0.01) propensity values may destabilize Offline RL IPS weighting.`,
      sampleEntities: badPropensityEntities,
    },
    {
      id: 'identifier_completeness',
      label: 'Identifier & Sequence Continuity',
      category: 'Schema',
      status: idStatus,
      affectedCount: missingIdentifierCount > 0 ? missingIdentifierCount : singleEventEntities,
      affectedRate:
        missingIdentifierCount > 0
          ? Math.round((missingIdentifierCount / n) * 10000) / 10000
          : Math.round(singleEventShare * 10000) / 10000,
      scoreDeduction: idDeduction,
      metricSummary:
        missingIdentifierCount > 0
          ? `${missingIdentifierCount} missing IDs`
          : `${(singleEventShare * 100).toFixed(1)}% single-step`,
      thresholdRule: 'Pass: 0 missing IDs & <= 35% single-event entities',
      detail:
        missingIdentifierCount > 0
          ? `${missingIdentifierCount} event(s) are missing entityId, eventId, actionLabel, or channel.`
          : `${uniqueEntities.toLocaleString()} unique entities identified (${(singleEventShare * 100).toFixed(1)}% have only 1 event; ${(100 - singleEventShare * 100).toFixed(1)}% form multi-step trajectories).`,
      sampleEntities: missingIdEntities,
    },
  ];

  const totalDeduction = checks.reduce((acc, c) => acc + c.scoreDeduction, 0);
  const score = Math.max(0, Math.min(100, Math.round(100 - totalDeduction)));
  const tier: DataHealthTier =
    score >= 80 ? 'healthy' : score >= 55 ? 'caution' : 'critical';
  const tierLabel =
    tier === 'healthy'
      ? 'Production Ready'
      : tier === 'caution'
      ? 'Sanity Warnings'
      : 'Critical Anomalies';

  return {
    score,
    tier,
    tierLabel,
    totalEvents: n,
    uniqueEntities,
    passCount: checks.filter((c) => c.status === 'pass').length,
    warnCount: checks.filter((c) => c.status === 'warn').length,
    failCount: checks.filter((c) => c.status === 'fail').length,
    timestampMin: tsMin,
    timestampMax: tsMax,
    timestampBinCv,
    maxSingleDayShare,
    timestampBuckets,
    checks,
  };
}

export function runHyperparameterSearch(
  events: RawEvent[],
  seqConfig: SequenceConfig,
  globalConfig: GlobalCurationConfig,
  options?: {
    architectureOverride?: TransformerArchitectureId;
    objective?: OptimizationObjective;
    dropoutOverride?: 'auto' | number;
  }
): HyperparameterSearchReport {
  const objective: OptimizationObjective =
    options?.objective ?? 'balanced_generalization';
  const targetArch: TransformerArchitectureId =
    options?.architectureOverride ??
    seqConfig.transformerArch ??
    'transformer_encoder';
  const archMeta =
    TRANSFORMER_ARCHITECTURE_CATALOG.find((a) => a.id === targetArch) ??
    TRANSFORMER_ARCHITECTURE_CATALOG[0];

  // Materialize all sequences once (all splits) to evaluate train vs val/holdout loss histories
  const fullSeqResult = buildSequenceDataset(
    events,
    { ...seqConfig, splitFilter: 'all', transformerArch: targetArch },
    globalConfig
  );
  const allSamples = fullSeqResult.samples;
  const trainPool = allSamples.filter((s) => s.split === 'train');
  const valPool = allSamples.filter((s) => s.split === 'val');
  const holdoutPool = allSamples.filter(
    (s) => s.split === 'val' || s.split === 'test'
  );

  const fitTrainPool = trainPool.length >= 3 ? trainPool : allSamples;
  const lossEvalPool = valPool.length >= 2 ? valPool : holdoutPool;
  const evalSplitLabel: 'Validation' | 'Holdout (Val+Test)' =
    valPool.length >= 2 ? 'Validation' : 'Holdout (Val+Test)';

  const batchSizes = [16, 32, 64, 128];
  const learningRates = [0.0003, 0.001, 0.003];
  const depthProfiles: {
    numLayers: 1 | 2 | 4;
    dModel: 64 | 128 | 256;
    numHeads: 2 | 4 | 8;
    depthLabel: string;
    autoDropout: number;
  }[] = [
    {
      numLayers: 1,
      dModel: 64,
      numHeads: 2,
      depthLabel: '1L · d64 · 2h (Shallow)',
      autoDropout: 0.05,
    },
    {
      numLayers: 2,
      dModel: 128,
      numHeads: 4,
      depthLabel: '2L · d128 · 4h (Balanced)',
      autoDropout: 0.1,
    },
    {
      numLayers: 4,
      dModel: 256,
      numHeads: 8,
      depthLabel: '4L · d256 · 8h (Deep)',
      autoDropout: 0.2,
    },
  ];

  const currentResolved = resolveTransformerConfig(seqConfig);
  const currentBatch = normalizeBatchSize(seqConfig.batchSize, 32);

  const scoreTrial = (lc: TransformerLossCurveSummary): number => {
    const valRef = lc.bestValLoss ?? lc.finalTrainLoss;
    const gapAbs = Math.abs(lc.generalizationGap ?? 0);
    const rebound = Math.max(0, lc.valReboundDelta ?? 0);
    const overfitPenalty =
      lc.diagnosis === 'overfitting'
        ? 0.08 + rebound * 2.5
        : lc.diagnosis === 'underfitting'
        ? 0.07
        : 0;

    if (objective === 'min_val_loss') {
      return Math.round((valRef + rebound * 1.4 + overfitPenalty * 0.4) * 10000) / 10000;
    }
    if (objective === 'fast_convergence') {
      return (
        Math.round(
          (valRef + lc.bestEpoch * 0.0035 + rebound * 1.6 + overfitPenalty * 0.6) *
            10000
        ) / 10000
      );
    }
    // balanced_generalization
    return (
      Math.round(
        (valRef + gapAbs * 0.28 + rebound * 2.2 + overfitPenalty) * 10000
      ) / 10000
    );
  };

  const evaluateCandidate = (params: {
    trialId: string;
    batchSize: number;
    learningRate: number;
    dModel: 64 | 128 | 256;
    numHeads: 2 | 4 | 8;
    numLayers: 1 | 2 | 4;
    depthLabel: string;
    dropoutRate: number;
    isCurrentConfig: boolean;
  }): HyperparameterTrialResult => {
    const cfg: SequenceConfig = {
      ...seqConfig,
      transformerArch: targetArch,
      batchSize: params.batchSize,
      learningRate: params.learningRate,
      dModel: params.dModel,
      numHeads: params.numHeads,
      numLayers: params.numLayers,
      dropoutRate: params.dropoutRate,
    };
    const resolved = resolveTransformerConfig(cfg);
    const estimatedParams = estimateTransformerParams(
      targetArch,
      params.dModel,
      params.numLayers
    );
    const lossCurve = computeTransformerLossCurve(
      fitTrainPool,
      lossEvalPool,
      resolved,
      seqConfig.maxSeqLen,
      params.batchSize,
      estimatedParams,
      evalSplitLabel
    );

    return {
      trialId: params.trialId,
      rank: 0,
      architecture: targetArch,
      architectureLabel: archMeta.shortLabel,
      batchSize: params.batchSize,
      learningRate: params.learningRate,
      dModel: params.dModel,
      numHeads: params.numHeads,
      numLayers: params.numLayers,
      depthLabel: params.depthLabel,
      dropoutRate: params.dropoutRate,
      estimatedParams,
      bestEpoch: lossCurve.bestEpoch,
      bestValLoss: lossCurve.bestValLoss,
      finalTrainLoss: lossCurve.finalTrainLoss,
      finalValLoss: lossCurve.finalValLoss,
      finalTrainRmse: lossCurve.finalTrainRmse,
      finalValRmse: lossCurve.finalValRmse,
      generalizationGap: lossCurve.generalizationGap,
      valReboundDelta: lossCurve.valReboundDelta,
      diagnosis: lossCurve.diagnosis,
      diagnosisLabel: lossCurve.diagnosisLabel,
      compositeScore: scoreTrial(lossCurve),
      isCurrentConfig: params.isCurrentConfig,
      lossCurve,
    };
  };

  const rawTrials: HyperparameterTrialResult[] = [];
  let matchedCurrentInGrid = false;

  for (const bs of batchSizes) {
    for (const lr of learningRates) {
      for (const dp of depthProfiles) {
        const dr =
          options?.dropoutOverride !== undefined &&
          options.dropoutOverride !== 'auto'
            ? options.dropoutOverride
            : dp.autoDropout;
        const isCurrent =
          bs === currentBatch &&
          Math.abs(lr - currentResolved.learningRate) < 1e-6 &&
          dp.dModel === currentResolved.dModel &&
          dp.numLayers === currentResolved.numLayers &&
          dp.numHeads === currentResolved.numHeads &&
          Math.abs(dr - currentResolved.dropoutRate) < 1e-4;
        if (isCurrent) matchedCurrentInGrid = true;

        rawTrials.push(
          evaluateCandidate({
            trialId: `bs${bs}_lr${lr}_L${dp.numLayers}_d${dp.dModel}`,
            batchSize: bs,
            learningRate: lr,
            dModel: dp.dModel,
            numHeads: dp.numHeads,
            numLayers: dp.numLayers,
            depthLabel: dp.depthLabel,
            dropoutRate: dr,
            isCurrentConfig: isCurrent,
          })
        );
      }
    }
  }

  const currentTrial =
    rawTrials.find((t) => t.isCurrentConfig) ??
    evaluateCandidate({
      trialId: 'current_active_config',
      batchSize: currentBatch,
      learningRate: currentResolved.learningRate,
      dModel: currentResolved.dModel,
      numHeads: currentResolved.numHeads,
      numLayers: currentResolved.numLayers,
      depthLabel: `${currentResolved.numLayers}L · d${currentResolved.dModel} · ${currentResolved.numHeads}h`,
      dropoutRate: currentResolved.dropoutRate,
      isCurrentConfig: true,
    });

  if (!matchedCurrentInGrid) {
    rawTrials.push(currentTrial);
  }

  rawTrials.sort((a, b) => {
    if (Math.abs(a.compositeScore - b.compositeScore) > 1e-6) {
      return a.compositeScore - b.compositeScore;
    }
    return (a.bestValLoss ?? 99) - (b.bestValLoss ?? 99);
  });

  const rankedTrials = rawTrials.map((t, idx) => ({
    ...t,
    rank: idx + 1,
  }));

  const recommendedTrial = rankedTrials[0];
  const rankedCurrent =
    rankedTrials.find((t) => t.isCurrentConfig) ?? currentTrial;

  const valDrop =
    rankedCurrent.bestValLoss !== null && recommendedTrial.bestValLoss !== null
      ? rankedCurrent.bestValLoss - recommendedTrial.bestValLoss
      : 0;

  const batchSizeReason = `Batch size ${recommendedTrial.batchSize} yields ${
    Math.ceil(fitTrainPool.length / recommendedTrial.batchSize) || 1
  } batch chunk(s) across ${fitTrainPool.length} train sequences, balancing gradient variance against epoch convergence speed.`;

  const learningRateReason = `Learning rate ${recommendedTrial.learningRate.toExponential(
    1
  )} reaches lowest ${evalSplitLabel.toLowerCase()} loss (${
    recommendedTrial.bestValLoss?.toFixed(3) ?? '—'
  }) at Epoch ${recommendedTrial.bestEpoch}${
    valDrop > 0.001
      ? `, improving best loss by ${valDrop.toFixed(3)} over your current configuration`
      : ' without late-epoch instability'
  }.`;

  const depthReason = `${recommendedTrial.depthLabel} with ${(
    recommendedTrial.dropoutRate * 100
  ).toFixed(0)}% dropout (${recommendedTrial.estimatedParams.toLocaleString()} params) avoids ${
    fitTrainPool.length < 100
      ? 'high-capacity memorization on a compact cohort'
      : 'under-capacity bias while controlling generalization gap'
  } (${recommendedTrial.diagnosisLabel}).`;

  return {
    objective,
    architecture: targetArch,
    architectureLabel: archMeta.shortLabel,
    trainSampleCount: fitTrainPool.length,
    evalSampleCount: lossEvalPool.length,
    evalSplitLabel,
    currentTrial: rankedCurrent,
    recommendedTrial,
    trials: rankedTrials,
    rationale: {
      batchSizeReason,
      learningRateReason,
      depthReason,
    },
  };
}

export const HARDWARE_ACCELERATOR_PROFILES: HardwareAcceleratorProfile[] = [
  {
    id: 'cpu_avx512',
    label: '16-Core Server CPU (AVX-512)',
    shortLabel: '16c CPU',
    memoryGb: 64,
    fp32Tflops: 1.8,
    tensorTflops: 1.8,
    memBandwidthGbps: 120,
    pcieBandwidthGbps: 64,
    launchOverheadMs: 0.72,
    baseMfu: 0.31,
  },
  {
    id: 'nvidia_t4',
    label: 'NVIDIA T4 16GB (Turing)',
    shortLabel: 'NVIDIA T4',
    memoryGb: 16,
    fp32Tflops: 8.1,
    tensorTflops: 65,
    memBandwidthGbps: 300,
    pcieBandwidthGbps: 15.8,
    launchOverheadMs: 0.28,
    baseMfu: 0.36,
  },
  {
    id: 'nvidia_a10g',
    label: 'NVIDIA A10G 24GB (Ampere)',
    shortLabel: 'NVIDIA A10G',
    memoryGb: 24,
    fp32Tflops: 31.2,
    tensorTflops: 125,
    memBandwidthGbps: 600,
    pcieBandwidthGbps: 31.5,
    launchOverheadMs: 0.16,
    baseMfu: 0.42,
  },
  {
    id: 'nvidia_a100',
    label: 'NVIDIA A100 80GB (SXM4)',
    shortLabel: 'NVIDIA A100',
    memoryGb: 80,
    fp32Tflops: 19.5,
    tensorTflops: 312,
    memBandwidthGbps: 2039,
    pcieBandwidthGbps: 63,
    launchOverheadMs: 0.11,
    baseMfu: 0.48,
  },
  {
    id: 'nvidia_h100',
    label: 'NVIDIA H100 80GB (SXM5)',
    shortLabel: 'NVIDIA H100',
    memoryGb: 80,
    fp32Tflops: 67,
    tensorTflops: 989,
    memBandwidthGbps: 3350,
    pcieBandwidthGbps: 63,
    launchOverheadMs: 0.08,
    baseMfu: 0.52,
  },
];

function computeBatchConfigurationTiming(params: {
  hardware: HardwareAcceleratorProfile;
  precision: TrainingPrecision;
  attentionMode: AttentionExecutionMode;
  architecture: TransformerArchitectureId;
  dModel: number;
  numHeads: number;
  numLayers: number;
  estimatedParams: number;
  sequenceCount: number;
  maxSeqLen: number;
  effectiveSeqLen: number;
  featureDim: number;
  batchSize: number;
  epochs: number;
  gradAccumSteps: number;
}): {
  batchesPerEpoch: number;
  forwardFlopsPerSample: number;
  totalFlopsPerBatch: number;
  achievedTflops: number;
  achievedMfuPct: number;
  arithmeticIntensity: number;
  bottleneck: 'compute_bound' | 'memory_bw_bound' | 'launch_io_bound';
  peakVramMb: number;
  epochDurationMs: number;
  totalTtcSec: number;
  samplesPerSec: number;
  meanBatchMs: number;
  dataLoadMs: number;
  forwardMs: number;
  backwardMs: number;
  optimizerMs: number;
  stepTrace: BatchStepBreakdown[];
} {
  const {
    hardware,
    precision,
    attentionMode,
    architecture,
    dModel,
    numHeads,
    numLayers,
    estimatedParams,
    sequenceCount,
    maxSeqLen,
    effectiveSeqLen,
    featureDim,
    batchSize,
    epochs,
    gradAccumSteps,
  } = params;

  const L = Math.max(1, effectiveSeqLen);
  const D = Math.max(1, featureDim);

  // Architecture attention & gating multipliers
  const attnMult =
    architecture === 'causal_gpt'
      ? attentionMode === 'flash_unpadded'
        ? 0.55
        : 0.85
      : architecture === 'temporal_fusion'
      ? 1.25
      : 1.0;

  const inputProjFlops = 2 * L * D * dModel + 2 * L * 16 * dModel;
  const qkvOutProjFlops = 8 * L * dModel * dModel;
  const attnMatmulFlops = 4 * L * L * dModel * attnMult;
  const ffnFlops = 16 * L * dModel * dModel;
  const normSoftmaxFlops = 5 * numHeads * L * L + 14 * L * dModel;
  const tftExtraPerLayer =
    architecture === 'temporal_fusion'
      ? 6 * L * D * dModel + 4 * L * dModel * dModel
      : 0;
  const readoutFlops = 2 * dModel * 32 + 64;

  const forwardFlopsPerSample =
    inputProjFlops +
    numLayers *
      (qkvOutProjFlops +
        attnMatmulFlops +
        ffnFlops +
        normSoftmaxFlops +
        tftExtraPerLayer) +
    readoutFlops;

  const bytesPerElem = precision === 'fp32' ? 4 : 2;
  const peakHardwareTflops =
    precision === 'fp32'
      ? hardware.fp32Tflops
      : hardware.id === 'cpu_avx512'
      ? hardware.fp32Tflops
      : hardware.tensorTflops * (precision === 'fp16_mixed' ? 1.0 : 0.92);

  // Peak VRAM footprint (MB): model weights + grads + fp32 AdamW states + batch activations
  const paramBytes = estimatedParams * bytesPerElem;
  const gradBytes = estimatedParams * bytesPerElem;
  const adamStatesBytes = estimatedParams * 12; // fp32 master copy + m + v
  const attentionMapBytes =
    attentionMode === 'flash_unpadded'
      ? batchSize * numHeads * L * 4 * numLayers
      : batchSize * numHeads * L * L * bytesPerElem * numLayers;
  const activationBytes =
    batchSize * L * dModel * 10 * numLayers * bytesPerElem + attentionMapBytes;
  const peakVramMb =
    Math.round(((paramBytes + gradBytes + adamStatesBytes + activationBytes) / (1024 * 1024)) * 100) /
    100;

  if (sequenceCount <= 0) {
    return {
      batchesPerEpoch: 0,
      forwardFlopsPerSample,
      totalFlopsPerBatch: 0,
      achievedTflops: 0,
      achievedMfuPct: 0,
      arithmeticIntensity: 0,
      bottleneck: 'launch_io_bound',
      peakVramMb,
      epochDurationMs: 0,
      totalTtcSec: 0,
      samplesPerSec: 0,
      meanBatchMs: 0,
      dataLoadMs: 0,
      forwardMs: 0,
      backwardMs: 0,
      optimizerMs: 0,
      stepTrace: [],
    };
  }

  const batchesPerEpoch = Math.max(1, Math.ceil(sequenceCount / batchSize));
  const simulateBatch = (bIdx: number, bSamples: number): BatchStepBreakdown => {
    const fwdFlops = bSamples * forwardFlopsPerSample;
    const bwdFlops = fwdFlops * 2;
    const totalStepFlops = fwdFlops + bwdFlops;

    // Memory traffic (bytes): read/write activations per layer + weight reads + gradient writes
    const stepActivationBytes =
      bSamples * L * dModel * 12 * numLayers * bytesPerElem +
      (attentionMode === 'flash_unpadded'
        ? bSamples * numHeads * L * 4 * numLayers
        : bSamples * numHeads * L * L * bytesPerElem * numLayers * 2);
    const totalMemBytes =
      estimatedParams * bytesPerElem * 4 + stepActivationBytes;

    const arithIntensity = totalStepFlops / Math.max(1, totalMemBytes);

    // Hardware ridge point: FLOP/s / Bytes/s
    const ridgePoint =
      (peakHardwareTflops * 1e12) / (hardware.memBandwidthGbps * 1e9);
    const occupancyRatio =
      (bSamples * L * dModel) / (bSamples * L * dModel + 24_576);
    const roofUtilization = Math.min(
      1,
      (arithIntensity / Math.max(1, ridgePoint)) * 1.15
    );
    const achievedMfu = Math.max(
      0.03,
      Math.min(
        0.72,
        hardware.baseMfu * (0.22 + 0.78 * occupancyRatio) * (0.35 + 0.65 * roofUtilization)
      )
    );

    const effectiveFlopsPerSec = peakHardwareTflops * 1e12 * achievedMfu;
    const computeFwdMs = (fwdFlops / effectiveFlopsPerSec) * 1000;
    const computeBwdMs = (bwdFlops / effectiveFlopsPerSec) * 1000;

    // Memory bandwidth bound floor
    const memBwFwdMs =
      ((totalMemBytes * 0.35) / (hardware.memBandwidthGbps * 1e9)) * 1000;
    const memBwBwdMs =
      ((totalMemBytes * 0.65) / (hardware.memBandwidthGbps * 1e9)) * 1000;

    // Per-layer kernel launch latency scales mildly with layers
    const layerLaunchMs = hardware.launchOverheadMs * (0.65 + 0.35 * numLayers);
    const forwardMs = Math.max(computeFwdMs, memBwFwdMs) + layerLaunchMs * 0.4;
    const backwardMs = Math.max(computeBwdMs, memBwBwdMs) + layerLaunchMs * 0.6;

    // Host-to-Device transfer for [B, L, D] float32 + mask [B, L]
    const h2dBytes = bSamples * maxSeqLen * (D + 1) * 4;
    const dataLoadMs =
      (h2dBytes / (hardware.pcieBandwidthGbps * 1e9)) * 1000 +
      hardware.launchOverheadMs * 0.45;

    const isOpt =
      (bIdx + 1) % gradAccumSteps === 0 || bIdx === batchesPerEpoch - 1;
    const optFlops = estimatedParams * 12;
    const optMemBytes = estimatedParams * 16;
    const optimizerMs = isOpt
      ? Math.max(
          (optFlops / (hardware.fp32Tflops * 1e12 * 0.35)) * 1000,
          (optMemBytes / (hardware.memBandwidthGbps * 1e9)) * 1000
        ) +
        hardware.launchOverheadMs * 0.35
      : 0;

    const totalStepMs = dataLoadMs + forwardMs + backwardMs + optimizerMs;
    return {
      batchIndex: bIdx,
      sampleCount: bSamples,
      tokenCount: Math.round(bSamples * L),
      dataLoadMs: Math.round(dataLoadMs * 1000) / 1000,
      forwardMs: Math.round(forwardMs * 1000) / 1000,
      backwardMs: Math.round(backwardMs * 1000) / 1000,
      optimizerMs: Math.round(optimizerMs * 1000) / 1000,
      totalStepMs: Math.round(totalStepMs * 1000) / 1000,
      isOptimizerStep: isOpt,
    };
  };

  // Compute representative full batch & tail batch analytically (O(1) even at 1000x scale)
  const fullBatches = Math.floor(sequenceCount / batchSize);
  const remainderSamples = sequenceCount % batchSize;
  const fullBatchStep =
    fullBatches > 0 ? simulateBatch(0, batchSize) : simulateBatch(0, remainderSamples);
  const tailBatchStep =
    remainderSamples > 0
      ? simulateBatch(batchesPerEpoch - 1, remainderSamples)
      : fullBatchStep;

  const optStepsPerEpoch = Math.max(1, Math.ceil(batchesPerEpoch / gradAccumSteps));
  // Compute exact epoch sum using fullBatches + tailBatch + exact optimizer step count
  const perBatchNoOptMs =
    fullBatchStep.dataLoadMs + fullBatchStep.forwardMs + fullBatchStep.backwardMs;
  const tailNoOptMs =
    tailBatchStep.dataLoadMs + tailBatchStep.forwardMs + tailBatchStep.backwardMs;
  const singleOptMs =
    Math.max(
      ((estimatedParams * 12) / (hardware.fp32Tflops * 1e12 * 0.35)) * 1000,
      ((estimatedParams * 16) / (hardware.memBandwidthGbps * 1e9)) * 1000
    ) +
    hardware.launchOverheadMs * 0.35;

  const totalDataLoadEpochMs =
    fullBatches * fullBatchStep.dataLoadMs +
    (remainderSamples > 0 ? tailBatchStep.dataLoadMs : 0);
  const totalFwdEpochMs =
    fullBatches * fullBatchStep.forwardMs +
    (remainderSamples > 0 ? tailBatchStep.forwardMs : 0);
  const totalBwdEpochMs =
    fullBatches * fullBatchStep.backwardMs +
    (remainderSamples > 0 ? tailBatchStep.backwardMs : 0);
  const totalOptEpochMs = optStepsPerEpoch * singleOptMs;

  const epochDurationMs =
    fullBatches * perBatchNoOptMs +
    (remainderSamples > 0 && fullBatches > 0 ? tailNoOptMs : remainderSamples > 0 ? tailNoOptMs : 0) +
    totalOptEpochMs;

  const totalTtcSec = (epochDurationMs * epochs) / 1000;
  const totalFlopsPerBatch = batchSize * forwardFlopsPerSample * 3;
  const totalEpochFlops = sequenceCount * forwardFlopsPerSample * 3;
  const achievedTflops =
    epochDurationMs > 0
      ? totalEpochFlops / (epochDurationMs / 1000) / 1e12
      : 0;
  const achievedMfuPct = Math.min(
    100,
    Math.round((achievedTflops / Math.max(1e-6, peakHardwareTflops)) * 1000) / 10
  );

  // Roofline arithmetic intensity & dominant bottleneck classification
  const fullActBytes =
    batchSize * L * dModel * 12 * numLayers * bytesPerElem +
    (attentionMode === 'flash_unpadded'
      ? batchSize * numHeads * L * 4 * numLayers
      : batchSize * numHeads * L * L * bytesPerElem * numLayers * 2);
  const fullMemBytes = estimatedParams * bytesPerElem * 4 + fullActBytes;
  const arithmeticIntensity =
    Math.round((totalFlopsPerBatch / Math.max(1, fullMemBytes)) * 100) / 100;

  const ioAndOptShare =
    epochDurationMs > 0
      ? (totalDataLoadEpochMs + totalOptEpochMs) / epochDurationMs
      : 0;
  const ridgePoint =
    (peakHardwareTflops * 1e12) / (hardware.memBandwidthGbps * 1e9);

  const bottleneck: 'compute_bound' | 'memory_bw_bound' | 'launch_io_bound' =
    ioAndOptShare > 0.35
      ? 'launch_io_bound'
      : arithmeticIntensity < ridgePoint * 0.45
      ? 'memory_bw_bound'
      : 'compute_bound';

  // Generate trace for up to first 24 batches of an epoch for timeline playback
  const traceCount = Math.min(24, batchesPerEpoch);
  const stepTrace: BatchStepBreakdown[] = [];
  for (let i = 0; i < traceCount; i++) {
    const isLast = i === batchesPerEpoch - 1 && remainderSamples > 0;
    stepTrace.push(simulateBatch(i, isLast ? remainderSamples : batchSize));
  }

  return {
    batchesPerEpoch,
    forwardFlopsPerSample,
    totalFlopsPerBatch,
    achievedTflops: Math.round(achievedTflops * 1000) / 1000,
    achievedMfuPct,
    arithmeticIntensity,
    bottleneck,
    peakVramMb,
    epochDurationMs: Math.round(epochDurationMs * 100) / 100,
    totalTtcSec: Math.round(totalTtcSec * 1000) / 1000,
    samplesPerSec:
      epochDurationMs > 0
        ? Math.round((sequenceCount / (epochDurationMs / 1000)) * 10) / 10
        : 0,
    meanBatchMs:
      batchesPerEpoch > 0
        ? Math.round((epochDurationMs / batchesPerEpoch) * 1000) / 1000
        : 0,
    dataLoadMs: totalDataLoadEpochMs,
    forwardMs: totalFwdEpochMs,
    backwardMs: totalBwdEpochMs,
    optimizerMs: totalOptEpochMs,
    stepTrace,
  };
}

export function simulateBatchTrainingJob(
  seqResult: SequenceResult,
  seqConfig: SequenceConfig,
  simConfig: BatchSimulationConfig
): BatchSimulationReport {
  const hardware =
    HARDWARE_ACCELERATOR_PROFILES.find((h) => h.id === simConfig.hardwareId) ??
    HARDWARE_ACCELERATOR_PROFILES[2];
  const resolved = resolveTransformerConfig(seqConfig);
  const scaleFactor = Math.max(1, Math.round(simConfig.datasetScaleFactor));
  const epochs = Math.max(1, Math.round(simConfig.epochs));
  const gradAccumSteps = Math.max(1, Math.round(simConfig.gradAccumSteps));

  const baseN = seqResult.samples.length;
  const sequenceCount = baseN * scaleFactor;
  const maxSeqLen = Math.max(1, seqResult.tensorShape[1] || seqConfig.maxSeqLen);
  const featureDim = Math.max(1, seqResult.tensorShape[2] || 4);
  const activeFraction = Math.max(0.15, 1 - seqResult.paddingSparsity);
  const effectiveSeqLen =
    simConfig.attentionMode === 'flash_unpadded'
      ? Math.max(1, Math.round(maxSeqLen * activeFraction * 100) / 100)
      : maxSeqLen;
  const batchSize = normalizeBatchSize(seqConfig.batchSize, 32);
  const estimatedParams = seqResult.transformerEval.estimatedParams;

  const core = computeBatchConfigurationTiming({
    hardware,
    precision: simConfig.precision,
    attentionMode: simConfig.attentionMode,
    architecture: resolved.architecture,
    dModel: resolved.dModel,
    numHeads: resolved.numHeads,
    numLayers: resolved.numLayers,
    estimatedParams,
    sequenceCount,
    maxSeqLen,
    effectiveSeqLen,
    featureDim,
    batchSize,
    epochs,
    gradAccumSteps,
  });

  const totalEpochMs = Math.max(1e-6, core.epochDurationMs);
  const dataLoadPct =
    core.epochDurationMs > 0
      ? Math.round((core.dataLoadMs / totalEpochMs) * 1000) / 10
      : 0;
  const forwardPct =
    core.epochDurationMs > 0
      ? Math.round((core.forwardMs / totalEpochMs) * 1000) / 10
      : 0;
  const backwardPct =
    core.epochDurationMs > 0
      ? Math.round((core.backwardMs / totalEpochMs) * 1000) / 10
      : 0;
  const optimizerPct =
    core.epochDurationMs > 0
      ? Math.max(0, Math.round((100 - dataLoadPct - forwardPct - backwardPct) * 10) / 10)
      : 0;

  const vramCapMb = hardware.memoryGb * 1024;
  const vramUtilizationPct =
    Math.round((core.peakVramMb / Math.max(1, vramCapMb)) * 1000) / 10;

  const bottleneckLabel =
    core.bottleneck === 'launch_io_bound'
      ? 'Kernel Launch & H2D I/O Bound'
      : core.bottleneck === 'memory_bw_bound'
      ? 'Memory Bandwidth Bound (HBM)'
      : 'Tensor Compute Bound (FLOPs)';

  // Sweep candidate batch sizes for scaling tradeoff curve
  const candidateBatches = Array.from(
    new Set([16, 32, 64, 128, 256, 512, batchSize])
  ).sort((a, b) => a - b);

  const batchSizeSweep: BatchSizeScalingPoint[] = candidateBatches.map((bs) => {
    const res = computeBatchConfigurationTiming({
      hardware,
      precision: simConfig.precision,
      attentionMode: simConfig.attentionMode,
      architecture: resolved.architecture,
      dModel: resolved.dModel,
      numHeads: resolved.numHeads,
      numLayers: resolved.numLayers,
      estimatedParams,
      sequenceCount,
      maxSeqLen,
      effectiveSeqLen,
      featureDim,
      batchSize: bs,
      epochs,
      gradAccumSteps,
    });
    return {
      batchSize: bs,
      isActive: bs === batchSize,
      batchesPerEpoch: res.batchesPerEpoch,
      epochDurationMs: res.epochDurationMs,
      totalTtcSec: res.totalTtcSec,
      samplesPerSec: res.samplesPerSec,
      achievedMfuPct: res.achievedMfuPct,
      peakVramMb: res.peakVramMb,
      bottleneck: res.bottleneck,
    };
  });

  const totalJobFlops = sequenceCount * core.forwardFlopsPerSample * 3 * epochs;
  const totalOptimizerSteps =
    Math.max(1, Math.ceil(core.batchesPerEpoch / gradAccumSteps)) * epochs;

  return {
    hardware,
    precision: simConfig.precision,
    attentionMode: simConfig.attentionMode,
    epochs,
    datasetScaleFactor: scaleFactor,
    gradAccumSteps,
    effectiveBatchSize: batchSize * gradAccumSteps,
    sequenceCount,
    maxSeqLen,
    effectiveSeqLen,
    featureDim,
    batchSize,
    batchesPerEpoch: core.batchesPerEpoch,
    totalOptimizerSteps,
    architecture: resolved.architecture,
    architectureLabel: resolved.architectureLabel,
    dModel: resolved.dModel,
    numHeads: resolved.numHeads,
    numLayers: resolved.numLayers,
    estimatedParams,
    forwardFlopsPerSample: Math.round(core.forwardFlopsPerSample),
    totalFlopsPerBatch: Math.round(core.totalFlopsPerBatch),
    totalJobFlops,
    achievedTflops: core.achievedTflops,
    achievedMfuPct: core.achievedMfuPct,
    arithmeticIntensity: core.arithmeticIntensity,
    bottleneck: core.bottleneck,
    bottleneckLabel,
    peakVramMb: core.peakVramMb,
    vramUtilizationPct,
    fitsInMemory: core.peakVramMb <= vramCapMb,
    meanBatchMs: core.meanBatchMs,
    dataLoadPct,
    forwardPct,
    backwardPct,
    optimizerPct,
    epochDurationMs: core.epochDurationMs,
    totalTtcSec: core.totalTtcSec,
    samplesPerSec: core.samplesPerSec,
    tokensPerSec: Math.round(core.samplesPerSec * effectiveSeqLen),
    sampleBatchTrace: core.stepTrace,
    batchSizeSweep,
  };
}

export function computeLtvTrendProjection(
  events: RawEvent[],
  rows: RegressionRow[],
  maxObservedDay: number,
  options?: {
    fitWindow?: TrendProjectionWindow;
    confidenceLevel?: 90 | 95 | 99;
    forecastDays?: number;
  }
): LtvTrendProjectionReport {
  const fitWindow: TrendProjectionWindow = options?.fitWindow ?? 'full';
  const confidenceLevel: 90 | 95 | 99 = options?.confidenceLevel ?? 95;
  const forecastDays = options?.forecastDays ?? 90;
  const cohortSize = rows.length;
  const historicalEndDay = Math.max(30, maxObservedDay);
  const forecastEndDay = historicalEndDay + forecastDays;

  if (cohortSize === 0 || events.length === 0) {
    return {
      fitWindow,
      confidenceLevel,
      cohortSize: 0,
      historicalEndDay,
      forecastEndDay,
      currentMeanLtv: 0,
      projected90dMeanLtv: 0,
      projected90dLiftUsd: 0,
      projected90dLiftPct: 0,
      ciLower90d: 0,
      ciUpper90d: 0,
      slopePerDay: 0,
      intercept: 0,
      fitR2: 0,
      residualStdError: 0,
      points: [],
    };
  }

  const activeSet = new Set(rows.map((r) => r.entityId));
  const byEntity = new Map<string, RawEvent[]>();
  for (const ev of events) {
    if (!activeSet.has(ev.entityId)) continue;
    let arr = byEntity.get(ev.entityId);
    if (!arr) {
      arr = [];
      byEntity.set(ev.entityId, arr);
    }
    arr.push(ev);
  }
  for (const arr of byEntity.values()) {
    arr.sort((a, b) => a.timestampDay - b.timestampDay);
  }

  // 12 evenly spaced historical observation checkpoints up to maxObservedDay
  const histSteps = 12;
  const histDaysSet = new Set<number>();
  for (let i = 1; i <= histSteps; i++) {
    histDaysSet.add(Math.max(1, Math.round((i / histSteps) * historicalEndDay)));
  }
  histDaysSet.add(historicalEndDay);
  const histDays = Array.from(histDaysSet).sort((a, b) => a - b);

  const histData = histDays.map((day) => {
    let totalSpend = 0;
    for (const r of rows) {
      const evs = byEntity.get(r.entityId);
      if (!evs) continue;
      for (const ev of evs) {
        if (ev.timestampDay <= day) totalSpend += ev.spendAmount;
        else break;
      }
    }
    const meanLtv = totalSpend / cohortSize;
    return {
      day,
      meanLtv: Math.round(meanLtv * 100) / 100,
      totalCohortLtv: Math.round(totalSpend * 100) / 100,
    };
  });

  // Fit window slice (either full 0..T_max or recent 50% of checkpoints)
  const fitStartIdx =
    fitWindow === 'recent_half'
      ? Math.max(0, Math.floor(histData.length / 2) - 1)
      : 0;
  const fitSample = histData.slice(fitStartIdx);
  const nFit = fitSample.length;
  const tMean = fitSample.reduce((acc, p) => acc + p.day, 0) / (nFit || 1);
  const yMean = fitSample.reduce((acc, p) => acc + p.meanLtv, 0) / (nFit || 1);

  let sTT = 0;
  let sTY = 0;
  for (const p of fitSample) {
    const dt = p.day - tMean;
    sTT += dt * dt;
    sTY += dt * (p.meanLtv - yMean);
  }

  const slope = sTT > 1e-9 ? sTY / sTT : 0;
  const intercept = yMean - slope * tMean;

  let sse = 0;
  let sst = 0;
  for (const p of fitSample) {
    const pred = intercept + slope * p.day;
    sse += (p.meanLtv - pred) ** 2;
    sst += (p.meanLtv - yMean) ** 2;
  }

  const df = Math.max(1, nFit - 2);
  const residualStdError = Math.sqrt(sse / df);
  const fitR2 =
    sst > 1e-9 ? Math.max(0, Math.min(1, 1 - sse / sst)) : 0;

  // Approximate Student-t critical value for 90%, 95%, or 99% confidence
  const zCrit =
    confidenceLevel === 99 ? 2.576 : confidenceLevel === 90 ? 1.645 : 1.96;
  const tCrit =
    confidenceLevel === 95
      ? tCritical95(df)
      : zCrit + (zCrit * zCrit * zCrit + zCrit) / (4 * Math.max(1, df));

  const computeInterval = (day: number) => {
    const pred = Math.max(0, intercept + slope * day);
    const se =
      residualStdError *
      Math.sqrt(1 / Math.max(1, nFit) + ((day - tMean) ** 2) / Math.max(1e-6, sTT));
    const margin = tCrit * se;
    const lower = Math.max(0, Math.round((pred - margin) * 100) / 100);
    const upper = Math.max(lower, Math.round((pred + margin) * 100) / 100);
    return {
      pred: Math.round(pred * 100) / 100,
      lower,
      upper,
    };
  };

  const points: LtvTrendProjectionPoint[] = [];
  const fitStartDay = fitSample[0]?.day ?? 0;

  for (const hd of histData) {
    const isAnchor = hd.day === historicalEndDay;
    const inFit = hd.day >= fitStartDay;
    const { pred, lower, upper } = computeInterval(hd.day);
    points.push({
      day: hd.day,
      label: `Day ${hd.day}`,
      isForecast: false,
      observedLtv: hd.meanLtv,
      trendFitLtv: inFit ? pred : null,
      projectedLtv: isAnchor ? pred : null,
      ciLower: isAnchor ? lower : null,
      ciUpper: isAnchor ? upper : null,
      ciBase: isAnchor ? lower : null,
      ciSpan: isAnchor ? Math.round((upper - lower) * 100) / 100 : null,
      observedCohortLtv: hd.totalCohortLtv,
      projectedCohortLtv: isAnchor ? Math.round(pred * cohortSize * 100) / 100 : null,
      cohortCiLower: isAnchor ? Math.round(lower * cohortSize * 100) / 100 : null,
      cohortCiUpper: isAnchor ? Math.round(upper * cohortSize * 100) / 100 : null,
    });
  }

  // Extrapolate next 90 days in 15-day increments
  const stepCount = 6;
  for (let s = 1; s <= stepCount; s++) {
    const day = historicalEndDay + Math.round((s / stepCount) * forecastDays);
    const { pred, lower, upper } = computeInterval(day);
    points.push({
      day,
      label: `Day ${day}`,
      isForecast: true,
      observedLtv: null,
      trendFitLtv: null,
      projectedLtv: pred,
      ciLower: lower,
      ciUpper: upper,
      ciBase: lower,
      ciSpan: Math.round((upper - lower) * 100) / 100,
      observedCohortLtv: null,
      projectedCohortLtv: Math.round(pred * cohortSize * 100) / 100,
      cohortCiLower: Math.round(lower * cohortSize * 100) / 100,
      cohortCiUpper: Math.round(upper * cohortSize * 100) / 100,
    });
  }

  const currentMeanLtv = histData[histData.length - 1]?.meanLtv ?? 0;
  const finalPt = points[points.length - 1];
  const projected90dMeanLtv = finalPt?.projectedLtv ?? currentMeanLtv;
  const projected90dLiftUsd =
    Math.round((projected90dMeanLtv - currentMeanLtv) * 100) / 100;
  const projected90dLiftPct =
    currentMeanLtv > 1e-6
      ? Math.round((projected90dLiftUsd / currentMeanLtv) * 1000) / 10
      : 0;

  return {
    fitWindow,
    confidenceLevel,
    cohortSize,
    historicalEndDay,
    forecastEndDay,
    currentMeanLtv,
    projected90dMeanLtv,
    projected90dLiftUsd,
    projected90dLiftPct,
    ciLower90d: finalPt?.ciLower ?? projected90dMeanLtv,
    ciUpper90d: finalPt?.ciUpper ?? projected90dMeanLtv,
    slopePerDay: Math.round(slope * 1000) / 1000,
    intercept: Math.round(intercept * 100) / 100,
    fitR2: Math.round(fitR2 * 1000) / 1000,
    residualStdError: Math.round(residualStdError * 100) / 100,
    points,
  };
}

export function reconstructWorkspaceBaseline(params: {
  workspaceId: string;
  name: string;
  presetId: string;
  datasetName: string;
  updatedAtLabel: string;
  events: RawEvent[];
  globalConfig: GlobalCurationConfig;
  regConfig: RegressionConfig;
  seqConfig: SequenceConfig;
  summaryStats?: {
    regRSquared?: number;
    seqRSquared?: number | null;
    valLoss?: number | null;
    trainLoss?: number;
    regRmse?: number;
  };
}): WorkspaceBaselineSnapshot {
  const cached = params.summaryStats;
  const hasCachedR2 =
    cached !== undefined &&
    typeof cached.regRSquared === 'number' &&
    Number.isFinite(cached.regRSquared);
  const hasCachedLoss =
    cached !== undefined &&
    typeof cached.trainLoss === 'number' &&
    Number.isFinite(cached.trainLoss);

  if (hasCachedR2 && hasCachedLoss) {
    return {
      workspaceId: params.workspaceId,
      name: params.name,
      presetId: params.presetId,
      datasetName: params.datasetName,
      updatedAtLabel: params.updatedAtLabel,
      regRSquared: cached.regRSquared as number,
      seqRSquared:
        typeof cached.seqRSquared === 'number' ? cached.seqRSquared : null,
      valLoss: typeof cached.valLoss === 'number' ? cached.valLoss : null,
      trainLoss: cached.trainLoss as number,
      regRmse: typeof cached.regRmse === 'number' ? cached.regRmse : 0,
      isReconstructed: false,
    };
  }

  const normalizedRegConfig: RegressionConfig = {
    ...params.regConfig,
    featureNormalization: params.regConfig.featureNormalization ?? 'none',
    batchSize: params.regConfig.batchSize ?? 32,
    selectedFeatures:
      params.regConfig.selectedFeatures &&
      params.regConfig.selectedFeatures.length > 0
        ? params.regConfig.selectedFeatures
        : REGRESSION_FEATURE_CATALOG.map((f) => f.key),
    klDriftThreshold: params.regConfig.klDriftThreshold ?? 0.25,
    outlierStdThreshold: params.regConfig.outlierStdThreshold ?? 2.5,
    excludeDetectedOutliers: params.regConfig.excludeDetectedOutliers ?? false,
  };

  const normalizedSeqConfig: SequenceConfig = {
    ...params.seqConfig,
    batchSize: params.seqConfig.batchSize ?? 32,
    learningRate: params.seqConfig.learningRate ?? 0.001,
    transformerArch: params.seqConfig.transformerArch ?? 'transformer_encoder',
    dModel: params.seqConfig.dModel ?? 128,
    numHeads: params.seqConfig.numHeads ?? 4,
    numLayers: params.seqConfig.numLayers ?? 2,
    dropoutRate: params.seqConfig.dropoutRate ?? 0.1,
    positionalEncoding: params.seqConfig.positionalEncoding ?? 'time_delta',
    poolingMode: params.seqConfig.poolingMode ?? 'attention_pool',
  };

  const reg = buildRegressionDataset(
    params.events,
    normalizedRegConfig,
    params.globalConfig
  );
  const seq = buildSequenceDataset(
    params.events,
    normalizedSeqConfig,
    params.globalConfig
  );

  const seqR2 =
    seq.transformerEval.holdoutMetrics.rSquared ??
    seq.transformerEval.allMetrics.rSquared ??
    null;
  const valLoss =
    seq.transformerEval.lossCurve.bestValLoss ??
    seq.transformerEval.lossCurve.finalValLoss ??
    null;

  return {
    workspaceId: params.workspaceId,
    name: params.name,
    presetId: params.presetId,
    datasetName: params.datasetName,
    updatedAtLabel: params.updatedAtLabel,
    regRSquared: Math.round(reg.linearFit.rSquared * 10000) / 10000,
    seqRSquared: seqR2 !== null ? Math.round(seqR2 * 10000) / 10000 : null,
    valLoss: valLoss !== null ? Math.round(valLoss * 10000) / 10000 : null,
    trainLoss:
      Math.round(seq.transformerEval.lossCurve.finalTrainLoss * 10000) / 10000,
    regRmse: Math.round(reg.linearFit.rmse * 100) / 100,
    isReconstructed: true,
  };
}

export function evaluatePerformanceAlerts(params: {
  currentMetrics: {
    regRSquared: number;
    seqRSquared: number | null;
    valLoss: number | null;
    trainLoss: number;
  };
  baselines: WorkspaceBaselineSnapshot[];
  baselineMode?: PerformanceBaselineMode;
  selectedWorkspaceId?: string | null;
  rSquaredThreshold?: number;
  lossIncreasePctThreshold?: number;
}): PerformanceAlertReport {
  const baselineMode: PerformanceBaselineMode =
    params.baselineMode ?? 'latest_matching';
  const rSquaredThreshold = params.rSquaredThreshold ?? 0.05;
  const lossIncreasePctThreshold = params.lossIncreasePctThreshold ?? 15;
  const runs = params.baselines;

  if (runs.length === 0) {
    return {
      status: 'no_baseline',
      baselineMode,
      baselineLabel: 'No saved workspace baselines found',
      matchingRunCount: 0,
      rSquaredThreshold,
      lossIncreasePctThreshold,
      alertCount: 0,
      alerts: [],
      comparisons: [
        {
          metricKey: 'reg_r2',
          metricLabel: 'Regression OLS R²',
          unit: 'r2',
          baselineValue: null,
          currentValue: params.currentMetrics.regRSquared,
          delta: null,
          pctChange: null,
          status: 'unavailable',
          targetTab: 'regression',
        },
        {
          metricKey: 'seq_r2',
          metricLabel: 'Transformer Holdout R²',
          unit: 'r2',
          baselineValue: null,
          currentValue: params.currentMetrics.seqRSquared,
          delta: null,
          pctChange: null,
          status: 'unavailable',
          targetTab: 'sequence',
        },
        {
          metricKey: 'val_loss',
          metricLabel: 'Transformer Val Loss',
          unit: 'loss',
          baselineValue: null,
          currentValue: params.currentMetrics.valLoss,
          delta: null,
          pctChange: null,
          status: 'unavailable',
          targetTab: 'sequence',
        },
        {
          metricKey: 'train_loss',
          metricLabel: 'Transformer Train Loss',
          unit: 'loss',
          baselineValue: null,
          currentValue: params.currentMetrics.trainLoss,
          delta: null,
          pctChange: null,
          status: 'unavailable',
          targetTab: 'sequence',
        },
      ],
    };
  }

  let baseRegR2: number;
  let baseSeqR2: number | null;
  let baseValLoss: number | null;
  let baseTrainLoss: number;
  let baselineLabel: string;

  if (baselineMode === 'mean_matching' && runs.length > 1) {
    baseRegR2 =
      runs.reduce((acc, r) => acc + r.regRSquared, 0) / runs.length;
    const seqR2Runs = runs.filter((r) => r.seqRSquared !== null);
    baseSeqR2 =
      seqR2Runs.length > 0
        ? seqR2Runs.reduce((acc, r) => acc + (r.seqRSquared as number), 0) /
          seqR2Runs.length
        : null;
    const valLossRuns = runs.filter((r) => r.valLoss !== null);
    baseValLoss =
      valLossRuns.length > 0
        ? valLossRuns.reduce((acc, r) => acc + (r.valLoss as number), 0) /
          valLossRuns.length
        : null;
    baseTrainLoss =
      runs.reduce((acc, r) => acc + r.trainLoss, 0) / runs.length;
    baselineLabel = `Mean of ${runs.length} saved runs`;
  } else {
    const pinned =
      baselineMode === 'selected_run' && params.selectedWorkspaceId
        ? runs.find((r) => r.workspaceId === params.selectedWorkspaceId) ?? runs[0]
        : runs[0];
    baseRegR2 = pinned.regRSquared;
    baseSeqR2 = pinned.seqRSquared;
    baseValLoss = pinned.valLoss;
    baseTrainLoss = pinned.trainLoss;
    baselineLabel = `${pinned.name} (${pinned.updatedAtLabel})`;
  }

  const alerts: PerformanceDeviationAlert[] = [];
  const comparisons: PerformanceMetricComparison[] = [];

  const checkR2 = (
    metricKey: 'reg_r2' | 'seq_r2',
    metricLabel: string,
    targetTab: 'regression' | 'sequence',
    baselineValue: number | null,
    currentValue: number | null
  ) => {
    if (baselineValue === null || currentValue === null) {
      comparisons.push({
        metricKey,
        metricLabel,
        unit: 'r2',
        baselineValue,
        currentValue,
        delta: null,
        pctChange: null,
        status: 'unavailable',
        targetTab,
      });
      return;
    }

    const delta = Math.round((currentValue - baselineValue) * 10000) / 10000;
    const absDrop = baselineValue - currentValue;
    let status: PerformanceMetricComparison['status'] = 'nominal';

    if (absDrop >= rSquaredThreshold) {
      const severity: PerformanceAlertSeverity =
        absDrop >= rSquaredThreshold * 1.75 ? 'critical' : 'warning';
      status = severity;
      alerts.push({
        id: `${metricKey}-${severity}`,
        metricKey,
        metricLabel,
        severity,
        baselineValue: Math.round(baselineValue * 1000) / 1000,
        currentValue: Math.round(currentValue * 1000) / 1000,
        delta,
        pctChange: null,
        thresholdLabel: `Drop >= ${rSquaredThreshold.toFixed(2)}`,
        message: `${metricLabel} dropped by ${absDrop.toFixed(3)} (${baselineValue.toFixed(3)} → ${currentValue.toFixed(3)}), exceeding the ${rSquaredThreshold.toFixed(2)} baseline threshold.`,
        targetTab,
      });
    } else if (delta >= rSquaredThreshold) {
      status = 'improved';
    }

    comparisons.push({
      metricKey,
      metricLabel,
      unit: 'r2',
      baselineValue: Math.round(baselineValue * 1000) / 1000,
      currentValue: Math.round(currentValue * 1000) / 1000,
      delta,
      pctChange: null,
      status,
      targetTab,
    });
  };

  const checkLoss = (
    metricKey: 'val_loss' | 'train_loss',
    metricLabel: string,
    baselineValue: number | null,
    currentValue: number | null
  ) => {
    if (baselineValue === null || currentValue === null) {
      comparisons.push({
        metricKey,
        metricLabel,
        unit: 'loss',
        baselineValue,
        currentValue,
        delta: null,
        pctChange: null,
        status: 'unavailable',
        targetTab: 'sequence',
      });
      return;
    }

    const delta = Math.round((currentValue - baselineValue) * 10000) / 10000;
    const denom = Math.max(1e-4, baselineValue);
    const pctChange = Math.round(((currentValue - baselineValue) / denom) * 1000) / 10;
    let status: PerformanceMetricComparison['status'] = 'nominal';

    if (pctChange >= lossIncreasePctThreshold) {
      const severity: PerformanceAlertSeverity =
        pctChange >= lossIncreasePctThreshold * 2 ? 'critical' : 'warning';
      status = severity;
      alerts.push({
        id: `${metricKey}-${severity}`,
        metricKey,
        metricLabel,
        severity,
        baselineValue: Math.round(baselineValue * 10000) / 10000,
        currentValue: Math.round(currentValue * 10000) / 10000,
        delta,
        pctChange,
        thresholdLabel: `Spike >= +${lossIncreasePctThreshold}%`,
        message: `${metricLabel} increased by +${pctChange.toFixed(1)}% (${baselineValue.toFixed(4)} → ${currentValue.toFixed(4)}) vs. saved baseline.`,
        targetTab: 'sequence',
      });
    } else if (pctChange <= -lossIncreasePctThreshold) {
      status = 'improved';
    }

    comparisons.push({
      metricKey,
      metricLabel,
      unit: 'loss',
      baselineValue: Math.round(baselineValue * 10000) / 10000,
      currentValue: Math.round(currentValue * 10000) / 10000,
      delta,
      pctChange,
      status,
      targetTab: 'sequence',
    });
  };

  checkR2(
    'reg_r2',
    'Regression OLS R²',
    'regression',
    baseRegR2,
    params.currentMetrics.regRSquared
  );
  checkR2(
    'seq_r2',
    'Transformer Holdout R²',
    'sequence',
    baseSeqR2,
    params.currentMetrics.seqRSquared
  );
  checkLoss(
    'val_loss',
    'Transformer Validation Loss',
    baseValLoss,
    params.currentMetrics.valLoss
  );
  checkLoss(
    'train_loss',
    'Transformer Train Loss',
    baseTrainLoss,
    params.currentMetrics.trainLoss
  );

  const hasCritical = alerts.some((a) => a.severity === 'critical');
  const status: PerformanceAlertReport['status'] = hasCritical
    ? 'critical'
    : alerts.length > 0
      ? 'warning'
      : 'nominal';

  return {
    status,
    baselineMode,
    baselineLabel,
    matchingRunCount: runs.length,
    rSquaredThreshold,
    lossIncreasePctThreshold,
    alertCount: alerts.length,
    alerts,
    comparisons,
  };
}

function splitTopLevelSqlList(clause: string): string[] {
  const parts: string[] = [];
  let current = '';
  let depth = 0;
  let inQuote = false;

  for (let i = 0; i < clause.length; i++) {
    const ch = clause[i];
    if (ch === "'" && clause[i - 1] !== '\\') {
      inQuote = !inQuote;
      current += ch;
      continue;
    }
    if (!inQuote) {
      if (ch === '(') depth++;
      else if (ch === ')') depth = Math.max(0, depth - 1);
      else if (ch === ',' && depth === 0) {
        if (current.trim()) parts.push(current.trim());
        current = '';
        continue;
      }
    }
    current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function stripSqlComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map((line) => {
      let inQuote = false;
      for (let i = 0; i < line.length - 1; i++) {
        if (line[i] === "'" && line[i - 1] !== '\\') inQuote = !inQuote;
        if (!inQuote && line[i] === '-' && line[i + 1] === '-') {
          return line.slice(0, i);
        }
      }
      return line;
    })
    .join('\n');
}

function splitSqlStatements(sql: string): string[] {
  const cleaned = stripSqlComments(sql);
  const stmts: string[] = [];
  let current = '';
  let inQuote = false;
  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (ch === "'" && cleaned[i - 1] !== '\\') {
      inQuote = !inQuote;
    }
    if (!inQuote && ch === ';') {
      if (current.trim()) stmts.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) stmts.push(current.trim());
  return stmts;
}

const SQL_KEYWORDS = new Set([
  'select',
  'from',
  'where',
  'and',
  'or',
  'not',
  'in',
  'is',
  'null',
  'true',
  'false',
  'as',
  'distinct',
  'count',
  'avg',
  'sum',
  'min',
  'max',
  'round',
  'numeric',
  'group',
  'by',
  'order',
  'asc',
  'desc',
  'limit',
  'case',
  'when',
  'then',
  'else',
  'end',
  'cast',
  'coalesce',
]);

function pgTypeByteWidth(pgType: string): number {
  if (pgType.includes('BOOLEAN')) return 1;
  if (pgType.includes('INTEGER')) return 4;
  if (pgType.includes('DOUBLE')) return 8;
  if (pgType.includes('VARCHAR')) return 10;
  return 20;
}

export function analyzeSqlVerificationQuery(
  sqlText: string,
  result: RegressionResult,
  config: RegressionConfig,
  piiConfig?: PiiMaskingConfig,
  statementIndex = 0
): SqlQueryAnalysisReport {
  const expectedTableName = 'stratum_regression_ltv';
  const schemaCols = getRegressionSqlSchemaColumns(config);
  const schemaColMap = new Map(schemaCols.map((c) => [c.name.toLowerCase(), c]));
  const totalTableRows = result.rows.length;

  const statements = splitSqlStatements(sqlText);
  const statementCount = statements.length;
  const activeStatementIndex =
    statementCount > 0
      ? Math.max(0, Math.min(statementCount - 1, statementIndex))
      : 0;
  const activeSql = (statements[activeStatementIndex] ?? '').trim();

  const buildEmptyError = (
    message: string,
    code: SqlSchemaExpectationIssue['code'] = 'syntax'
  ): SqlQueryAnalysisReport => {
    const planText = `Planner Error: ${message}`;
    return {
      isValid: false,
      statementCount,
      activeStatementIndex,
      tableName: expectedTableName,
      expectedTableName,
      tableMatched: false,
      scanStrategy: 'Seq Scan',
      indexName: null,
      totalTableRows,
      matchedRows: 0,
      outputRows: 0,
      selectivityPct: 0,
      limitApplied: null,
      groupByColumns: [],
      orderBySummary: null,
      wherePredicates: [],
      projectedColumns: [],
      unknownColumns: [],
      missingSchemaColumns: schemaCols.map((c) => c.name),
      estimatedTotalCost: 0,
      estimatedRowWidthBytes: 0,
      planNodes: [],
      planText,
      issues: [{ severity: 'error', code, message }],
      previewColumns: [],
      previewRows: [],
    };
  };

  if (!activeSql) {
    return buildEmptyError(
      'Enter a SELECT query targeting stratum_regression_ltv to run schema verification and cost estimation.'
    );
  }

  // Extract SELECT ... FROM <table> [WHERE ...] [GROUP BY ...] [ORDER BY ...] [LIMIT ...]
  const normalizedSpace = activeSql.replace(/\s+/g, ' ').trim();
  const selectMatch = normalizedSpace.match(
    /^SELECT\s+([\s\S]+?)\s+FROM\s+([a-zA-Z0-9_."]+)(.*)$/i
  );

  if (!selectMatch) {
    return buildEmptyError(
      'Expected a SELECT <columns> FROM <table> statement (DDL/DML previews should be verified with a SELECT probe).'
    );
  }

  const selectClause = selectMatch[1].trim();
  const rawTableName = selectMatch[2].replace(/"/g, '').trim();
  const tableMatched = rawTableName.toLowerCase() === expectedTableName;
  let remainder = selectMatch[3].trim();

  let limitApplied: number | null = null;
  const limitMatch = remainder.match(/\s+LIMIT\s+(\d+)\s*$/i);
  if (limitMatch) {
    limitApplied = Math.max(0, Number(limitMatch[1]));
    remainder = remainder.slice(0, limitMatch.index).trim();
  }

  let orderBySummary: string | null = null;
  let orderBySpecs: Array<{ col: string; dir: 'asc' | 'desc' }> = [];
  const orderMatch = remainder.match(/\s+ORDER\s+BY\s+([\s\S]+)$/i);
  if (orderMatch) {
    orderBySummary = orderMatch[1].trim();
    orderBySpecs = splitTopLevelSqlList(orderBySummary).map((part) => {
      const tokens = part.trim().split(/\s+/);
      const dir =
        tokens[1]?.toLowerCase() === 'desc' ? ('desc' as const) : ('asc' as const);
      return { col: tokens[0].replace(/"/g, '').toLowerCase(), dir };
    });
    remainder = remainder.slice(0, orderMatch.index).trim();
  }

  let groupByColumns: string[] = [];
  const groupMatch = remainder.match(/\s+GROUP\s+BY\s+([\s\S]+)$/i);
  if (groupMatch) {
    groupByColumns = splitTopLevelSqlList(groupMatch[1].trim()).map((c) =>
      c.replace(/"/g, '').trim().toLowerCase()
    );
    remainder = remainder.slice(0, groupMatch.index).trim();
  }

  let whereClause = '';
  const whereMatch = remainder.match(/^WHERE\s+([\s\S]+)$/i);
  if (whereMatch) {
    whereClause = whereMatch[1].trim();
    remainder = '';
  }

  const issues: SqlSchemaExpectationIssue[] = [];
  if (remainder.trim()) {
    issues.push({
      severity: 'warning',
      code: 'unsupported_clause',
      message: `Unrecognized trailing SQL clause "${remainder.trim()}" — skipped during local estimation.`,
    });
  }

  if (!tableMatched) {
    issues.push({
      severity: 'error',
      code: 'unknown_table',
      message: `Relation "${rawTableName}" does not exist in active export schema. Expected "${expectedTableName}".`,
    });
  }

  // Materialize live rows matching getRegressionSqlSchemaColumns(config)
  const mode = config.featureNormalization;
  const batchSize = normalizeBatchSize(config.batchSize, result.batchSize || 32);
  const masker = createPiiMasker(piiConfig);
  const selectedSet = new Set(config.selectedFeatures);
  const activeFeatures = REGRESSION_FEATURE_CATALOG.filter((f) =>
    selectedSet.has(f.key)
  );
  const exportFeatures =
    activeFeatures.length > 0 ? activeFeatures : REGRESSION_FEATURE_CATALOG;

  type FlatRow = Record<string, string | number | boolean>;
  const materializedRows: FlatRow[] = result.rows.map((r) => {
    const f = mode === 'none' ? r : r.scaledFeatures;
    const obj: FlatRow = {
      entity_id: masker.maskEntityId(r.entityId),
      split: r.split,
      batch_id: r.batchId,
      batch_size: batchSize,
      normalization_mode: mode,
      predicted_horizon_ltv: Math.round(r.predictedHorizonLtv * 100) / 100,
      projected_future_ltv: Math.round(r.projectedFutureLtv * 100) / 100,
      target_ltv_raw: Math.round(r.targetLtvRaw * 100) / 100,
      target_ltv_winsorized: Math.round(r.targetLtvWinsorized * 100) / 100,
      leakage_verified: r.leakageVerified,
    };
    for (const feat of exportFeatures) {
      obj[feat.csvColumn] = Math.round(f[feat.key] * 10000) / 10000;
    }
    return obj;
  });

  // Track unknown columns referenced anywhere
  const unknownSet = new Set<string>();
  const referencedColSet = new Set<string>();

  const registerIdentifier = (rawIdent: string) => {
    const clean = rawIdent.replace(/"/g, '').toLowerCase();
    if (!clean || SQL_KEYWORDS.has(clean) || /^\d+(\.\d+)?$/.test(clean)) return;
    referencedColSet.add(clean);
    if (!schemaColMap.has(clean)) {
      unknownSet.add(clean);
    }
  };

  // Parse WHERE predicates (supports AND-joined comparisons)
  const wherePredicates = whereClause
    ? whereClause
        .split(/\s+AND\s+/i)
        .map((p) => p.trim())
        .filter(Boolean)
    : [];

  let usesSplitIndex = false;
  let usesBatchIndex = false;

  const compiledFilters: Array<(row: FlatRow) => boolean> = [];
  for (const pred of wherePredicates) {
    // col IN ('a', 'b')
    const inMatch = pred.match(
      /^([a-zA-Z_][a-zA-Z0-9_]*)\s+IN\s*\(([^)]+)\)$/i
    );
    if (inMatch) {
      const col = inMatch[1].toLowerCase();
      registerIdentifier(col);
      if (col === 'split') usesSplitIndex = true;
      if (col === 'batch_id') usesBatchIndex = true;
      const vals = inMatch[2]
        .split(',')
        .map((v) => v.trim().replace(/^'|'$/g, ''));
      compiledFilters.push((row) => vals.includes(String(row[col])));
      continue;
    }

    // col op val
    const cmpMatch = pred.match(
      /^([a-zA-Z_][a-zA-Z0-9_]*)\s*(=|!=|<>|>=|<=|>|<)\s*(.+)$/i
    );
    if (cmpMatch) {
      const col = cmpMatch[1].toLowerCase();
      const op = cmpMatch[2];
      const rawVal = cmpMatch[3].trim();
      registerIdentifier(col);
      if (col === 'split' && op === '=') usesSplitIndex = true;
      if (col === 'batch_id') usesBatchIndex = true;

      if (/^'(.*)'$/.test(rawVal)) {
        const strVal = rawVal.slice(1, -1);
        compiledFilters.push((row) => {
          const v = String(row[col] ?? '');
          if (op === '=') return v === strVal;
          if (op === '!=' || op === '<>') return v !== strVal;
          return true;
        });
      } else if (/^(true|false)$/i.test(rawVal)) {
        const boolVal = rawVal.toLowerCase() === 'true';
        compiledFilters.push((row) => {
          const v = Boolean(row[col]);
          if (op === '=') return v === boolVal;
          if (op === '!=' || op === '<>') return v !== boolVal;
          return true;
        });
      } else if (!Number.isNaN(Number(rawVal))) {
        const numVal = Number(rawVal);
        compiledFilters.push((row) => {
          const v = Number(row[col]);
          if (Number.isNaN(v)) return false;
          if (op === '=') return v === numVal;
          if (op === '!=' || op === '<>') return v !== numVal;
          if (op === '>=') return v >= numVal;
          if (op === '<=') return v <= numVal;
          if (op === '>') return v > numVal;
          if (op === '<') return v < numVal;
          return true;
        });
      } else {
        issues.push({
          severity: 'warning',
          code: 'unsupported_clause',
          message: `Predicate "${pred}" uses a dynamic expression; row count assumes pass-through.`,
        });
      }
      continue;
    }

    // col IS [NOT] NULL
    const nullMatch = pred.match(
      /^([a-zA-Z_][a-zA-Z0-9_]*)\s+IS\s+(NOT\s+)?NULL$/i
    );
    if (nullMatch) {
      const col = nullMatch[1].toLowerCase();
      const isNot = Boolean(nullMatch[2]);
      registerIdentifier(col);
      compiledFilters.push((row) =>
        isNot ? row[col] !== undefined && row[col] !== null : row[col] == null
      );
      continue;
    }

    issues.push({
      severity: 'warning',
      code: 'unsupported_clause',
      message: `Filter "${pred}" could not be fully parsed locally; conservative estimate applied.`,
    });
  }

  for (const gbCol of groupByColumns) {
    registerIdentifier(gbCol);
  }
  for (const ord of orderBySpecs) {
    // Allow aliases defined in SELECT too; check after parsing projections
    const clean = ord.col;
    if (!schemaColMap.has(clean)) {
      // Check later against projected aliases
    } else {
      referencedColSet.add(clean);
    }
  }

  // Parse SELECT list
  const rawSelectItems =
    selectClause.trim() === '*'
      ? schemaCols.map((c) => c.name)
      : splitTopLevelSqlList(selectClause);

  interface ParsedProj {
    outputName: string;
    sourceExpression: string;
    pgType: string;
    isAggregate: boolean;
    isValid: boolean;
    evalFn: (rowsForGroup: FlatRow[], singleRow?: FlatRow) => string | number | boolean;
  }

  const parsedProjs: ParsedProj[] = [];
  for (const item of rawSelectItems) {
    const aliasMatch = item.match(/^([\s\S]+?)\s+AS\s+([a-zA-Z_][a-zA-Z0-9_]*)$/i);
    const expr = (aliasMatch ? aliasMatch[1] : item).trim();
    const explicitAlias = aliasMatch ? aliasMatch[2].trim() : null;

    // Strip optional ROUND(..., digits) wrapper
    const roundMatch = expr.match(
      /^ROUND\(\s*([\s\S]+?)(?:::numeric)?\s*,\s*(\d+)\s*\)$/i
    );
    const innerExpr = roundMatch ? roundMatch[1].replace(/::numeric$/i, '').trim() : expr;
    const roundDecimals = roundMatch ? Number(roundMatch[2]) : null;

    const wrapRound = (val: number): number => {
      if (roundDecimals === null) return Math.round(val * 10000) / 10000;
      const factor = 10 ** roundDecimals;
      return Math.round(val * factor) / factor;
    };

    const aggMatch = innerExpr.match(
      /^(COUNT|AVG|SUM|MIN|MAX)\(\s*(DISTINCT\s+)?(\*|[a-zA-Z_][a-zA-Z0-9_]*)\s*\)$/i
    );

    if (aggMatch) {
      const fn = aggMatch[1].toUpperCase();
      const isDistinct = Boolean(aggMatch[2]);
      const arg = aggMatch[3].toLowerCase();
      let colValid = true;
      if (arg !== '*') {
        registerIdentifier(arg);
        colValid = schemaColMap.has(arg);
      }
      const outputName =
        explicitAlias ??
        `${fn.toLowerCase()}_${arg === '*' ? 'all' : arg}`;
      const pgType =
        fn === 'COUNT' ? 'BIGINT' : 'DOUBLE PRECISION';

      parsedProjs.push({
        outputName,
        sourceExpression: item,
        pgType,
        isAggregate: true,
        isValid: colValid,
        evalFn: (groupRows) => {
          if (fn === 'COUNT') {
            if (arg === '*') return groupRows.length;
            if (isDistinct) {
              return new Set(groupRows.map((r) => String(r[arg]))).size;
            }
            return groupRows.filter((r) => r[arg] !== undefined).length;
          }
          const nums = groupRows
            .map((r) => Number(r[arg]))
            .filter((n) => Number.isFinite(n));
          if (nums.length === 0) return 0;
          if (fn === 'AVG') {
            return wrapRound(nums.reduce((a, b) => a + b, 0) / nums.length);
          }
          if (fn === 'SUM') {
            return wrapRound(nums.reduce((a, b) => a + b, 0));
          }
          if (fn === 'MIN') return wrapRound(Math.min(...nums));
          return wrapRound(Math.max(...nums));
        },
      });
      continue;
    }

    // Simple column reference
    const colName = expr.replace(/"/g, '').trim().toLowerCase();
    registerIdentifier(colName);
    const colDef = schemaColMap.get(colName);
    const outputName = explicitAlias ?? colName;
    parsedProjs.push({
      outputName,
      sourceExpression: item,
      pgType: colDef?.pgType ?? 'UNKNOWN',
      isAggregate: false,
      isValid: Boolean(colDef),
      evalFn: (_groupRows, singleRow) => {
        if (!singleRow) return '—';
        const val = singleRow[colName];
        return val !== undefined ? val : 'NULL';
      },
    });
  }

  const aliasSet = new Set(parsedProjs.map((p) => p.outputName.toLowerCase()));
  for (const ord of orderBySpecs) {
    if (!schemaColMap.has(ord.col) && !aliasSet.has(ord.col)) {
      unknownSet.add(ord.col);
    }
  }

  const unknownColumns = Array.from(unknownSet);
  if (unknownColumns.length > 0) {
    issues.push({
      severity: 'error',
      code: 'unknown_column',
      message: `Unknown or excluded schema column(s): ${unknownColumns.join(', ')}. Verify active features in RegressionView or check column spelling.`,
    });
  }

  // Filter rows
  const filteredRows = tableMatched
    ? materializedRows.filter((row) => compiledFilters.every((fn) => fn(row)))
    : [];
  const matchedRows = filteredRows.length;

  const hasAggregates =
    groupByColumns.length > 0 || parsedProjs.some((p) => p.isAggregate);

  let evaluatedRows: FlatRow[] = [];
  if (tableMatched) {
    if (hasAggregates) {
      const groups = new Map<string, FlatRow[]>();
      if (groupByColumns.length === 0) {
        groups.set('__all__', filteredRows);
      } else {
        for (const row of filteredRows) {
          const key = groupByColumns.map((c) => String(row[c] ?? 'NULL')).join('::');
          const arr = groups.get(key) ?? [];
          arr.push(row);
          groups.set(key, arr);
        }
      }

      for (const groupRows of groups.values()) {
        const rep = groupRows[0];
        const outRow: FlatRow = {};
        for (const p of parsedProjs) {
          outRow[p.outputName] = p.evalFn(groupRows, rep);
        }
        evaluatedRows.push(outRow);
      }
    } else {
      evaluatedRows = filteredRows.map((row) => {
        const outRow: FlatRow = {};
        for (const p of parsedProjs) {
          outRow[p.outputName] = p.evalFn([row], row);
        }
        return outRow;
      });
    }
  }

  // Sort if ORDER BY provided
  if (orderBySpecs.length > 0 && evaluatedRows.length > 1) {
    evaluatedRows.sort((a, b) => {
      for (const spec of orderBySpecs) {
        const va = a[spec.col] ?? '';
        const vb = b[spec.col] ?? '';
        let cmp = 0;
        if (typeof va === 'number' && typeof vb === 'number') {
          cmp = va - vb;
        } else {
          cmp = String(va).localeCompare(String(vb));
        }
        if (cmp !== 0) return spec.dir === 'desc' ? -cmp : cmp;
      }
      return 0;
    });
  }

  const totalPreLimit = evaluatedRows.length;
  const outputRows =
    limitApplied !== null
      ? Math.min(limitApplied, totalPreLimit)
      : totalPreLimit;
  const previewRows = evaluatedRows.slice(0, Math.min(6, outputRows));

  if (tableMatched && unknownColumns.length === 0 && matchedRows === 0) {
    issues.push({
      severity: 'warning',
      code: 'empty_result',
      message:
        'WHERE predicate filters out 100% of rows (0 matching entities). Verify split filter or numeric threshold.',
    });
  }

  // Compute row width & PostgreSQL-style EXPLAIN plan
  const estimatedRowWidthBytes = Math.max(
    8,
    parsedProjs.reduce((acc, p) => acc + pgTypeByteWidth(p.pgType), 0)
  );
  const selectivityPct =
    totalTableRows > 0
      ? Math.round((matchedRows / totalTableRows) * 1000) / 10
      : 0;

  const canUseSplitIndex =
    tableMatched &&
    (usesSplitIndex || usesBatchIndex) &&
    selectivityPct <= 80;
  const scanStrategy: SqlQueryAnalysisReport['scanStrategy'] = canUseSplitIndex
    ? 'Index Scan'
    : config.splitFilter === 'all' && !usesSplitIndex && totalTableRows > 0
      ? 'Multi-Split Scan'
      : 'Seq Scan';
  const indexName = canUseSplitIndex
    ? `idx_${expectedTableName}_split_batch`
    : null;

  // Deterministic PostgreSQL-calibrated cost units
  const pageReads = Math.max(1, Math.ceil((totalTableRows * 96) / 8192));
  const scanStartup = canUseSplitIndex ? 0.15 : 0.0;
  const scanTotal = canUseSplitIndex
    ? Math.round((0.15 + matchedRows * 0.028 + pageReads * 0.4) * 100) / 100
    : Math.round((pageReads * 1.0 + totalTableRows * 0.015) * 100) / 100;

  const nodesReverse: SqlExecutionPlanNode[] = [];
  nodesReverse.push({
    id: 'scan',
    depth: 0,
    operator: canUseSplitIndex
      ? `Index Scan using ${indexName} on ${rawTableName}`
      : `Seq Scan on ${rawTableName}`,
    relation: rawTableName,
    startupCost: scanStartup,
    totalCost: scanTotal,
    estimatedRows: matchedRows,
    rowWidthBytes: estimatedRowWidthBytes,
    detail:
      wherePredicates.length > 0
        ? `${canUseSplitIndex ? 'Index Cond / ' : ''}Filter: (${wherePredicates.join(' AND ')})`
        : undefined,
  });

  let runningCost = scanTotal;
  let runningStartup = scanStartup;
  let runningRows = matchedRows;

  if (hasAggregates) {
    runningStartup = runningCost;
    runningCost =
      Math.round((runningCost + matchedRows * 0.012 + 0.5) * 100) / 100;
    runningRows = totalPreLimit;
    nodesReverse.push({
      id: 'agg',
      depth: 0,
      operator:
        groupByColumns.length > 0 ? 'HashAggregate' : 'Aggregate',
      startupCost: runningStartup,
      totalCost: runningCost,
      estimatedRows: runningRows,
      rowWidthBytes: estimatedRowWidthBytes,
      detail:
        groupByColumns.length > 0
          ? `Group Key: ${groupByColumns.join(', ')}`
          : 'Scalar Cohort Aggregation',
    });
  }

  if (orderBySpecs.length > 0) {
    const sortStartup =
      Math.round(
        (runningCost + runningRows * Math.log2(Math.max(2, runningRows)) * 0.008) *
          100
      ) / 100;
    runningCost = Math.round((sortStartup + runningRows * 0.003) * 100) / 100;
    runningStartup = sortStartup;
    nodesReverse.push({
      id: 'sort',
      depth: 0,
      operator: 'Sort',
      startupCost: runningStartup,
      totalCost: runningCost,
      estimatedRows: runningRows,
      rowWidthBytes: estimatedRowWidthBytes,
      detail: `Sort Key: ${orderBySummary}`,
    });
  }

  if (limitApplied !== null) {
    const limitCost = Math.round((runningCost + 0.05) * 100) / 100;
    nodesReverse.push({
      id: 'limit',
      depth: 0,
      operator: 'Limit',
      startupCost: runningStartup,
      totalCost: limitCost,
      estimatedRows: outputRows,
      rowWidthBytes: estimatedRowWidthBytes,
      detail: `Count: ${limitApplied} (returning ${outputRows})`,
    });
    runningCost = limitCost;
  }

  // Assign tree depths from outer operator inward
  const planNodes: SqlExecutionPlanNode[] = nodesReverse
    .reverse()
    .map((node, idx) => ({ ...node, depth: idx }));

  const planLines = planNodes.map((n) => {
    const prefix = n.depth === 0 ? '' : `${'  '.repeat(n.depth)}->  `;
    const head = `${prefix}${n.operator}  (cost=${n.startupCost.toFixed(2)}..${n.totalCost.toFixed(2)} rows=${n.estimatedRows} width=${n.rowWidthBytes})`;
    if (!n.detail) return head;
    const detailIndent = '  '.repeat(n.depth + 1) + '  ';
    return `${head}\n${detailIndent}${n.detail}`;
  });

  const missingSchemaColumns = schemaCols
    .map((c) => c.name)
    .filter((name) => !referencedColSet.has(name.toLowerCase()));

  const isValid =
    tableMatched &&
    unknownColumns.length === 0 &&
    issues.every((iss) => iss.severity !== 'error');

  return {
    isValid,
    statementCount,
    activeStatementIndex,
    tableName: rawTableName,
    expectedTableName,
    tableMatched,
    scanStrategy,
    indexName,
    totalTableRows,
    matchedRows,
    outputRows,
    selectivityPct,
    limitApplied,
    groupByColumns,
    orderBySummary,
    wherePredicates,
    projectedColumns: parsedProjs.map((p) => ({
      outputName: p.outputName,
      sourceExpression: p.sourceExpression,
      pgType: p.pgType,
      isAggregate: p.isAggregate,
      isValid: p.isValid,
    })),
    unknownColumns,
    missingSchemaColumns,
    estimatedTotalCost: runningCost,
    estimatedRowWidthBytes,
    planNodes,
    planText: planLines.join('\n'),
    issues,
    previewColumns: parsedProjs.map((p) => p.outputName),
    previewRows,
  };
}

function linearQuantile(sortedAsc: number[], q: number): number {
  if (sortedAsc.length === 0) return 0;
  if (sortedAsc.length === 1) return sortedAsc[0];
  const clampedQ = Math.max(0, Math.min(1, q));
  const pos = clampedQ * (sortedAsc.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sortedAsc[lo];
  const frac = pos - lo;
  return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * frac;
}

export function computeSequenceLengthAnalysis(
  samples: SequenceTensorSample[],
  maxSeqLen: number,
  truncation: TruncationStrategy,
  binMode: SequenceHistogramBinMode = 'auto'
): SequenceLengthAnalysis {
  const safeMaxSeqLen = Math.max(1, Math.round(maxSeqLen));
  if (samples.length === 0) {
    return {
      bins: [],
      binWidth: 1,
      resolvedBinMode: 'exact',
      percentiles: {
        count: 0,
        min: 0,
        p50: 0,
        p75: 0,
        p90: 0,
        p95: 0,
        max: 0,
        mean: 0,
      },
      maxSeqLen: safeMaxSeqLen,
      truncation,
      truncatedEntities: 0,
      truncatedEntitiesPct: 0,
      exactFitEntities: 0,
      paddedEntities: 0,
      totalEventsBeforeCutoff: 0,
      retainedEvents: 0,
      droppedEvents: 0,
      droppedEventsPct: 0,
      retainedEventsPct: 100,
      paddedSlots: 0,
      totalTensorSlots: 0,
      paddingSparsityPct: 0,
      recommendedP90: safeMaxSeqLen,
      recommendedP95: safeMaxSeqLen,
      tradeoffNote: 'No sequences match the active split and minimum length filters.',
    };
  }

  const entries = samples.map((s) => ({
    rawLen: s.actualLen + s.truncatedCount,
    split: s.split,
  }));
  const sortedAsc = entries.map((e) => e.rawLen).sort((a, b) => a - b);
  const n = sortedAsc.length;
  const minVal = sortedAsc[0];
  const maxVal = sortedAsc[n - 1];
  const totalEventsBeforeCutoff = sortedAsc.reduce((acc, v) => acc + v, 0);
  const meanVal = totalEventsBeforeCutoff / n;

  const p50Raw = linearQuantile(sortedAsc, 0.5);
  const p75Raw = linearQuantile(sortedAsc, 0.75);
  const p90Raw = linearQuantile(sortedAsc, 0.9);
  const p95Raw = linearQuantile(sortedAsc, 0.95);

  const percentiles: SequenceLengthPercentiles = {
    count: n,
    min: minVal,
    p50: Math.round(p50Raw * 10) / 10,
    p75: Math.round(p75Raw * 10) / 10,
    p90: Math.round(p90Raw * 10) / 10,
    p95: Math.round(p95Raw * 10) / 10,
    max: maxVal,
    mean: Math.round(meanVal * 100) / 100,
  };

  let truncatedEntities = 0;
  let exactFitEntities = 0;
  let paddedEntities = 0;
  let retainedEvents = 0;
  let droppedEvents = 0;
  let paddedSlots = 0;

  for (const e of entries) {
    if (e.rawLen > safeMaxSeqLen) {
      truncatedEntities += 1;
      retainedEvents += safeMaxSeqLen;
      droppedEvents += e.rawLen - safeMaxSeqLen;
    } else {
      if (e.rawLen === safeMaxSeqLen) exactFitEntities += 1;
      else paddedEntities += 1;
      retainedEvents += e.rawLen;
      paddedSlots += safeMaxSeqLen - e.rawLen;
    }
  }

  const totalTensorSlots = n * safeMaxSeqLen;
  const truncatedEntitiesPct = Math.round((truncatedEntities / n) * 1000) / 10;
  const droppedEventsPct =
    totalEventsBeforeCutoff > 0
      ? Math.round((droppedEvents / totalEventsBeforeCutoff) * 1000) / 10
      : 0;
  const retainedEventsPct =
    totalEventsBeforeCutoff > 0
      ? Math.round((retainedEvents / totalEventsBeforeCutoff) * 1000) / 10
      : 100;
  const paddingSparsityPct =
    totalTensorSlots > 0
      ? Math.round((paddedSlots / totalTensorSlots) * 1000) / 10
      : 0;

  const span = maxVal - minVal + 1;
  const resolvedBinMode: 'exact' | 'grouped' =
    binMode === 'exact'
      ? 'exact'
      : binMode === 'grouped'
      ? 'grouped'
      : span <= 24
      ? 'exact'
      : 'grouped';

  const binWidth =
    resolvedBinMode === 'exact'
      ? 1
      : Math.max(2, Math.ceil(span / 14));

  const bins: SequenceLengthDistributionBin[] = [];
  let runningCumulative = 0;

  for (let start = minVal; start <= maxVal; start += binWidth) {
    const end = Math.min(maxVal, start + binWidth - 1);
    const inBin = entries.filter((e) => e.rawLen >= start && e.rawLen <= end);
    const withinBudgetCount = inBin.filter((e) => e.rawLen <= safeMaxSeqLen).length;
    const truncatedCount = inBin.length - withinBudgetCount;
    const trainCount = inBin.filter((e) => e.split === 'train').length;
    const valCount = inBin.filter((e) => e.split === 'val').length;
    const testCount = inBin.filter((e) => e.split === 'test').length;

    runningCumulative += inBin.length;
    const sharePct = Math.round((inBin.length / n) * 1000) / 10;
    const cumulativePct = Math.round((runningCumulative / n) * 1000) / 10;

    const status: SequenceLengthDistributionBin['status'] =
      end <= safeMaxSeqLen
        ? 'within_budget'
        : start > safeMaxSeqLen
        ? 'truncated'
        : 'boundary';

    bins.push({
      binKey: start === end ? `${start}` : `${start}-${end}`,
      label: start === end ? `${start}` : `${start}–${end}`,
      minLen: start,
      maxLen: end,
      entityCount: inBin.length,
      withinBudgetCount,
      truncatedCount,
      trainCount,
      valCount,
      testCount,
      sharePct,
      cumulativePct,
      status,
    });
  }

  const recommendedP90 = Math.max(2, Math.ceil(p90Raw));
  const recommendedP95 = Math.max(2, Math.ceil(p95Raw));

  let tradeoffNote: string;
  if (truncatedEntities === 0 && paddingSparsityPct >= 45) {
    tradeoffNote = `Zero truncation at L=${safeMaxSeqLen}, but ${paddingSparsityPct.toFixed(1)}% of tensor slots are zero-padded. Tightening L toward P90 (${recommendedP90}) reduces attention memory without dropping long-tail coverage.`;
  } else if (truncatedEntitiesPct > 25) {
    tradeoffNote =
      truncation === 'recent'
        ? `Heavy truncation: ${truncatedEntitiesPct.toFixed(1)}% of entities exceed L=${safeMaxSeqLen}, dropping ${droppedEvents} earliest onboarding events (${droppedEventsPct.toFixed(1)}% of all events). Raising L to ${recommendedP90} covers 90% of entities.`
        : `Heavy early-window truncation: ${truncatedEntitiesPct.toFixed(1)}% of entities exceed L=${safeMaxSeqLen}, dropping ${droppedEvents} most-recent events (${droppedEventsPct.toFixed(1)}% of all events) right before the horizon cutoff.`;
  } else if (truncatedEntities > 0) {
    tradeoffNote =
      truncation === 'recent'
        ? `Keep Recent preserves the latest ${safeMaxSeqLen} events prior to T_obs, trimming ${droppedEvents} earliest events across ${truncatedEntities} high-activity entities while keeping padding sparsity at ${paddingSparsityPct.toFixed(1)}%.`
        : `Keep Early retains the initial ${safeMaxSeqLen} onboarding events, trimming ${droppedEvents} most-recent events across ${truncatedEntities} high-activity entities. Verify whether recent spend momentum is required for horizon LTV.`;
  } else {
    tradeoffNote = `All ${n} entities fit completely inside L=${safeMaxSeqLen} (0 dropped events, ${paddingSparsityPct.toFixed(1)}% zero-mask padding).`;
  }

  return {
    bins,
    binWidth,
    resolvedBinMode,
    percentiles,
    maxSeqLen: safeMaxSeqLen,
    truncation,
    truncatedEntities,
    truncatedEntitiesPct,
    exactFitEntities,
    paddedEntities,
    totalEventsBeforeCutoff,
    retainedEvents,
    droppedEvents,
    droppedEventsPct,
    retainedEventsPct,
    paddedSlots,
    totalTensorSlots,
    paddingSparsityPct,
    recommendedP90,
    recommendedP95,
    tradeoffNote,
  };
}

export function evaluateKlDriftAlerts(
  driftReport: ModelDriftReport
): KlDriftAlertReport {
  const {
    klThreshold,
    maxKlDivergence,
    meanKlDivergence,
    trainCount,
    valCount,
    features,
  } = driftReport;

  if (trainCount < 5 || valCount < 5 || features.length === 0) {
    return {
      status: 'insufficient_data',
      klThreshold,
      maxKlDivergence,
      meanKlDivergence,
      trainCount,
      valCount,
      evaluatedFeatureCount: features.length,
      breachedCount: 0,
      approachingCount: 0,
      alerts: [],
      summaryMessage: `KL drift monitoring paused: need at least 5 entities in both Train (n=${trainCount}) and Validation (n=${valCount}) splits.`,
    };
  }

  const breached = features.filter((f) => f.klExceedsThreshold);
  const approaching = features.filter(
    (f) => !f.klExceedsThreshold && f.klDivergence >= klThreshold * 0.75
  );

  const alerts: KlDriftAlertItem[] = breached.map((f) => {
    const excessNats = Math.round((f.klDivergence - klThreshold) * 10000) / 10000;
    const ratioToThreshold =
      klThreshold > 0
        ? Math.round((f.klDivergence / klThreshold) * 100) / 100
        : 0;
    const severity: 'warning' | 'critical' =
      ratioToThreshold >= 1.5 || breached.length >= 2 ? 'critical' : 'warning';

    return {
      feature: f.feature,
      csvColumn: f.csvColumn,
      label: f.label,
      klDivergence: f.klDivergence,
      jsDivergence: f.jsDivergence,
      klThreshold,
      excessNats,
      ratioToThreshold,
      trainMean: f.trainMean,
      valMean: f.valMean,
      severity,
      message: `${f.csvColumn} train/val D_KL=${f.klDivergence.toFixed(3)} nats exceeds ${klThreshold.toFixed(2)} threshold (+${excessNats.toFixed(3)} nats, ${ratioToThreshold.toFixed(2)}× limit; train μ=${f.trainMean.toFixed(2)} vs val μ=${f.valMean.toFixed(2)}).`,
    };
  });

  let status: KlDriftAlertSeverity = 'nominal';
  let summaryMessage = `All ${features.length} selected features are within the D_KL ≤ ${klThreshold.toFixed(2)} nats threshold (max D_KL = ${maxKlDivergence.toFixed(3)} nats).`;

  if (alerts.length > 0) {
    const hasCritical =
      alerts.length >= 2 || alerts.some((a) => a.ratioToThreshold >= 1.5);
    status = hasCritical ? 'critical' : 'warning';
    summaryMessage = `${alerts.length} of ${features.length} active feature${features.length === 1 ? '' : 's'} breached the D_KL > ${klThreshold.toFixed(2)} nats threshold (peak ${alerts[0].csvColumn} = ${alerts[0].klDivergence.toFixed(3)} nats).`;
  } else if (approaching.length > 0) {
    summaryMessage = `Within threshold (max D_KL = ${maxKlDivergence.toFixed(3)} ≤ ${klThreshold.toFixed(2)} nats), with ${approaching.length} feature${approaching.length === 1 ? '' : 's'} above 75% of limit (${approaching.map((f) => f.csvColumn).join(', ')}).`;
  }

  return {
    status,
    klThreshold,
    maxKlDivergence,
    meanKlDivergence,
    trainCount,
    valCount,
    evaluatedFeatureCount: features.length,
    breachedCount: alerts.length,
    approachingCount: approaching.length,
    alerts,
    summaryMessage,
  };
}

const MDP_SWEEP_GAMMAS = [0.5, 0.6, 0.7, 0.8, 0.85, 0.9, 0.95, 0.99];

const REWARD_SCALE_LABELS: Record<RewardScaleMode, string> = {
  raw: 'Raw Margin Reward',
  clipped_10: 'Clipped [-10, +10]',
  standardized: 'Standardized (Train Z-Score)',
};

function computeTrajectoryReturnStats(
  trajectories: MdpTransition[][],
  gamma: number,
  rewardScale: RewardScaleMode,
  rMean: number,
  rStd: number
): {
  stats: MdpReturnSummaryStats;
  g0Values: number[];
  actionMeans: Map<number, { label: string; count: number; meanReturn: number }>;
} {
  const safeGamma = Math.max(0.1, Math.min(0.995, gamma));
  const safeStd = rStd > 1e-9 ? rStd : 1;

  const scaleStepReward = (raw: number): number => {
    if (rewardScale === 'clipped_10') {
      return Math.max(-10, Math.min(10, raw));
    }
    if (rewardScale === 'standardized') {
      return (raw - rMean) / safeStd;
    }
    return raw;
  };

  const g0Values: number[] = [];
  let totalSteps = 0;
  let saturatedSteps = 0;
  let firstStepAbsRewardSum = 0;

  const actionAcc = new Map<
    number,
    { label: string; count: number; sumG: number }
  >();

  for (const traj of trajectories) {
    if (traj.length === 0) continue;
    let runningG = 0;
    const stepReturns = new Array<number>(traj.length);
    for (let i = traj.length - 1; i >= 0; i--) {
      const tr = traj[i];
      const scaled = scaleStepReward(tr.rewardRaw);
      totalSteps += 1;
      if (rewardScale === 'clipped_10' && Math.abs(tr.rewardRaw) > 10) {
        saturatedSteps += 1;
      } else if (rewardScale === 'standardized' && Math.abs(scaled) > 3) {
        saturatedSteps += 1;
      }

      if (tr.done === 1) {
        runningG = scaled;
      } else {
        runningG = scaled + safeGamma * runningG;
      }
      stepReturns[i] = runningG;
    }
    g0Values.push(stepReturns[0]);
    firstStepAbsRewardSum += Math.abs(scaleStepReward(traj[0].rewardRaw));

    for (let i = 0; i < traj.length; i++) {
      const tr = traj[i];
      const cur = actionAcc.get(tr.actionId) ?? {
        label: tr.actionLabel,
        count: 0,
        sumG: 0,
      };
      cur.count += 1;
      cur.sumG += stepReturns[i];
      actionAcc.set(tr.actionId, cur);
    }
  }

  const n = g0Values.length;
  const effectiveHorizon =
    Math.round((1 / Math.max(0.005, 1 - safeGamma)) * 10) / 10;

  if (n === 0) {
    return {
      stats: {
        gamma: safeGamma,
        rewardScale,
        trajectoryCount: 0,
        mean: 0,
        std: 0,
        min: 0,
        p10: 0,
        p25: 0,
        median: 0,
        p75: 0,
        p90: 0,
        max: 0,
        iqr: 0,
        skewness: 0,
        saturationRatePct: 0,
        effectiveHorizon,
        bellmanAmplification: 1,
      },
      g0Values: [],
      actionMeans: new Map(),
    };
  }

  const sorted = [...g0Values].sort((a, b) => a - b);
  const mean = g0Values.reduce((a, b) => a + b, 0) / n;
  let m2 = 0;
  let m3 = 0;
  for (const v of g0Values) {
    const d = v - mean;
    m2 += d * d;
    m3 += d * d * d;
  }
  const std = Math.sqrt(m2 / n);
  const skewness = n >= 3 && std > 1e-9 ? m3 / n / Math.pow(std, 3) : 0;

  const p10 = linearQuantile(sorted, 0.1);
  const p25 = linearQuantile(sorted, 0.25);
  const median = linearQuantile(sorted, 0.5);
  const p75 = linearQuantile(sorted, 0.75);
  const p90 = linearQuantile(sorted, 0.9);
  const iqr = p75 - p25;

  const meanAbsG0 = g0Values.reduce((a, v) => a + Math.abs(v), 0) / n;
  const meanAbsR0 = firstStepAbsRewardSum / n;
  const bellmanAmplification =
    meanAbsR0 > 1e-6 ? Math.round((meanAbsG0 / meanAbsR0) * 100) / 100 : 1;

  const actionMeans = new Map<
    number,
    { label: string; count: number; meanReturn: number }
  >();
  for (const [actionId, acc] of actionAcc.entries()) {
    actionMeans.set(actionId, {
      label: acc.label,
      count: acc.count,
      meanReturn: Math.round((acc.sumG / acc.count) * 1000) / 1000,
    });
  }

  const r2 = (v: number) => Math.round(v * 100) / 100;

  return {
    stats: {
      gamma: Math.round(safeGamma * 1000) / 1000,
      rewardScale,
      trajectoryCount: n,
      mean: r2(mean),
      std: r2(std),
      min: r2(sorted[0]),
      p10: r2(p10),
      p25: r2(p25),
      median: r2(median),
      p75: r2(p75),
      p90: r2(p90),
      max: r2(sorted[n - 1]),
      iqr: r2(iqr),
      skewness: Math.round(skewness * 100) / 100,
      saturationRatePct:
        totalSteps > 0 ? Math.round((saturatedSteps / totalSteps) * 1000) / 10 : 0,
      effectiveHorizon,
      bellmanAmplification,
    },
    g0Values,
    actionMeans,
  };
}

export function computeMdpSensitivityAnalysis(params: {
  result: MdpResult;
  activeConfig: MdpConfig;
  simGamma: number;
  simRewardScale: RewardScaleMode;
  shapeMode?: MdpDistributionShapeMode;
}): MdpSensitivityReport {
  const { result, activeConfig, simGamma, simRewardScale } = params;
  const shapeMode: MdpDistributionShapeMode = params.shapeMode ?? 'native';

  const byEntity = new Map<string, MdpTransition[]>();
  for (const tr of result.transitions) {
    const arr = byEntity.get(tr.entityId);
    if (arr) arr.push(tr);
    else byEntity.set(tr.entityId, [tr]);
  }

  const trajectories = Array.from(byEntity.values()).map((trs) =>
    [...trs].sort((a, b) => a.stepIdx - b.stepIdx)
  );

  // Use train-split moments if present inside transitions for exact precision, else fall back to result moments
  const trainRawRewards = result.transitions
    .filter((t) => t.split === 'train')
    .map((t) => t.rewardRaw);
  let rMean = result.rewardMean;
  let rStd = result.rewardStd;
  if (trainRawRewards.length >= 5) {
    rMean =
      trainRawRewards.reduce((a, b) => a + b, 0) / trainRawRewards.length;
    const rVar =
      trainRawRewards.reduce((a, b) => a + (b - rMean) ** 2, 0) /
      trainRawRewards.length;
    rStd = Math.sqrt(rVar) || 1;
  }

  const activeEval = computeTrajectoryReturnStats(
    trajectories,
    activeConfig.gamma,
    activeConfig.rewardScale,
    rMean,
    rStd
  );
  const simEval = computeTrajectoryReturnStats(
    trajectories,
    simGamma,
    simRewardScale,
    rMean,
    rStd
  );

  const sweepGammas = Array.from(
    new Set([
      ...MDP_SWEEP_GAMMAS,
      Math.round(Math.max(0.5, Math.min(0.99, simGamma)) * 100) / 100,
    ])
  ).sort((a, b) => a - b);

  const gammaSweep: MdpGammaSweepPoint[] = sweepGammas.map((g) => {
    const res = computeTrajectoryReturnStats(
      trajectories,
      g,
      simRewardScale,
      rMean,
      rStd
    );
    return {
      gamma: g,
      gammaLabel: g.toFixed(2),
      effectiveHorizon: res.stats.effectiveHorizon,
      meanG0: res.stats.mean,
      medianG0: res.stats.median,
      p10G0: res.stats.p10,
      p90G0: res.stats.p90,
      stdG0: res.stats.std,
    };
  });

  const scaleModes: RewardScaleMode[] = ['raw', 'clipped_10', 'standardized'];
  const scaleComparison: MdpRewardScaleComparisonRow[] = scaleModes.map(
    (mode) => {
      const ev = computeTrajectoryReturnStats(
        trajectories,
        simGamma,
        mode,
        rMean,
        rStd
      );
      const s = ev.stats;
      let cqlStability: MdpRewardScaleComparisonRow['cqlStability'] = 'optimal';
      let stabilityLabel = 'Well-Conditioned';

      if (mode === 'clipped_10' && s.saturationRatePct >= 30) {
        cqlStability = 'clipped_saturation';
        stabilityLabel = `Saturated (${s.saturationRatePct.toFixed(0)}% clipped)`;
      } else if (s.std > 150 || Math.abs(s.skewness) >= 2.2) {
        cqlStability = 'high_dispersion';
        stabilityLabel = 'High Bellman Dispersion';
      } else if (s.std > 40 || Math.abs(s.skewness) >= 1.3) {
        cqlStability = 'moderate_dispersion';
        stabilityLabel = 'Moderate Spread';
      }

      return {
        mode,
        label: REWARD_SCALE_LABELS[mode],
        meanG0: s.mean,
        medianG0: s.median,
        stdG0: s.std,
        iqrG0: s.iqr,
        skewness: s.skewness,
        saturationRatePct: s.saturationRatePct,
        cqlStability,
        stabilityLabel,
      };
    }
  );

  // Build comparative distribution bins
  const sameScale = activeConfig.rewardScale === simRewardScale;
  const distributionBins: MdpSensitivityBin[] = [];

  if (trajectories.length > 0 && simEval.g0Values.length > 0) {
    const toShape = (vals: number[], mean: number, std: number) =>
      shapeMode === 'normalized_z'
        ? vals.map((v) => (std > 1e-9 ? (v - mean) / std : 0))
        : vals;

    const simPlotVals = toShape(
      simEval.g0Values,
      simEval.stats.mean,
      simEval.stats.std
    );
    const activePlotVals = toShape(
      activeEval.g0Values,
      activeEval.stats.mean,
      activeEval.stats.std
    );
    const includeActiveOverlay = sameScale || shapeMode === 'normalized_z';

    let minV = Math.min(...simPlotVals);
    let maxV = Math.max(...simPlotVals);
    if (includeActiveOverlay && activePlotVals.length > 0) {
      minV = Math.min(minV, ...activePlotVals);
      maxV = Math.max(maxV, ...activePlotVals);
    }

    const binCount = 12;
    const span = maxV - minV;
    const safeSpan = span > 1e-6 ? span : 1;
    const step = safeSpan / binCount;
    const simCounts = new Array<number>(binCount).fill(0);
    const actCounts = new Array<number>(binCount).fill(0);

    const assignBin = (v: number) => {
      let idx = Math.floor((v - minV) / step);
      if (idx < 0) idx = 0;
      if (idx >= binCount) idx = binCount - 1;
      return idx;
    };

    for (const v of simPlotVals) simCounts[assignBin(v)] += 1;
    if (includeActiveOverlay) {
      for (const v of activePlotVals) actCounts[assignBin(v)] += 1;
    }

    const fmtTick = (val: number) =>
      Math.abs(val) >= 100
        ? String(Math.round(val))
        : Math.abs(val) >= 10
        ? val.toFixed(1)
        : val.toFixed(2);

    const nSim = simPlotVals.length || 1;
    const nAct = activePlotVals.length || 1;

    for (let b = 0; b < binCount; b++) {
      const bMin = minV + b * step;
      const bMax = b === binCount - 1 ? maxV : bMin + step;
      distributionBins.push({
        binLabel: `${fmtTick(bMin)}–${fmtTick(bMax)}`,
        binMin: Math.round(bMin * 100) / 100,
        binMax: Math.round(bMax * 100) / 100,
        simulatedCount: simCounts[b],
        activeCount: includeActiveOverlay ? actCounts[b] : 0,
        simulatedPct: Math.round((simCounts[b] / nSim) * 1000) / 10,
        activePct: includeActiveOverlay
          ? Math.round((actCounts[b] / nAct) * 1000) / 10
          : 0,
      });
    }
  }

  // Action-level ranking sensitivity
  const activeRanked = Array.from(activeEval.actionMeans.entries()).sort(
    (a, b) => b[1].meanReturn - a[1].meanReturn
  );
  const simRanked = Array.from(simEval.actionMeans.entries()).sort(
    (a, b) => b[1].meanReturn - a[1].meanReturn
  );
  const activeRankMap = new Map<number, number>();
  activeRanked.forEach(([actionId], idx) => activeRankMap.set(actionId, idx + 1));
  const simRankMap = new Map<number, number>();
  simRanked.forEach(([actionId], idx) => simRankMap.set(actionId, idx + 1));

  const actionSensitivity: MdpActionSensitivityRow[] = simRanked.map(
    ([actionId, simMeta]) => {
      const actMeta = activeEval.actionMeans.get(actionId);
      const activeMeanReturn = actMeta?.meanReturn ?? simMeta.meanReturn;
      const activeRank = activeRankMap.get(actionId) ?? 1;
      const simulatedRank = simRankMap.get(actionId) ?? 1;
      return {
        actionId,
        actionLabel: simMeta.label,
        count: simMeta.count,
        activeMeanReturn: Math.round(activeMeanReturn * 100) / 100,
        simulatedMeanReturn: Math.round(simMeta.meanReturn * 100) / 100,
        deltaReturn:
          Math.round((simMeta.meanReturn - activeMeanReturn) * 100) / 100,
        activeRank,
        simulatedRank,
        rankShift: activeRank - simulatedRank,
      };
    }
  );

  const sSim = simEval.stats;
  const sAct = activeEval.stats;
  const rankChanged = actionSensitivity.some((a) => a.rankShift !== 0);

  let insightSummary = `At γ=${simGamma.toFixed(2)} (effective horizon ${sSim.effectiveHorizon} steps) with ${REWARD_SCALE_LABELS[simRewardScale]}, initial return G₀ has mean ${sSim.mean.toFixed(2)} (IQR ${sSim.iqr.toFixed(2)}, skew ${sSim.skewness.toFixed(2)}).`;
  if (trajectories.length === 0) {
    insightSummary =
      'No trajectories meet the active split and minimum trajectory length filters.';
  } else if (simRewardScale === 'clipped_10' && sSim.saturationRatePct >= 25) {
    insightSummary += ` Warning: ${sSim.saturationRatePct.toFixed(1)}% of transitions clip at ±10, compressing high-value margin separation. Consider Standardized (Z-Score) to preserve relative ordering without exploding Q-targets.`;
  } else if (simRewardScale === 'raw' && sSim.std > 150) {
    insightSummary += ` High G₀ dispersion (σ=${sSim.std.toFixed(1)}) can destabilize CQL Bellman backups; Standardized scaling or lower γ (${Math.max(0.85, simGamma - 0.05).toFixed(2)}) tightens TD variance.`;
  } else if (rankChanged) {
    insightSummary +=
      ' Action value ranking shifts relative to the active configuration, indicating γ/scale changes alter long-term vs. myopic action preference.';
  } else if (sameScale && Math.abs(simGamma - activeConfig.gamma) >= 0.01) {
    const pctDelta =
      Math.abs(sAct.mean) > 1e-6
        ? ((sSim.mean - sAct.mean) / Math.abs(sAct.mean)) * 100
        : 0;
    insightSummary += ` Mean return G₀ shifts by ${pctDelta >= 0 ? '+' : ''}${pctDelta.toFixed(1)}% vs. active γ=${activeConfig.gamma.toFixed(2)}.`;
  }

  return {
    trajectoryCount: trajectories.length,
    sameScale,
    shapeMode,
    activeStats: sAct,
    simulatedStats: sSim,
    gammaSweep,
    scaleComparison,
    distributionBins,
    actionSensitivity,
    insightSummary,
  };
}

export function buildExportFeatureImportanceReport(
  regConfig: RegressionConfig,
  regResult: RegressionResult,
  datasetName: string
): ExportFeatureImportanceReport {
  const { linearFit, correlations, driftReport, featureMatrix } = regResult;
  const corrByKey = new Map(correlations.map((c) => [c.feature, c]));
  const driftByKey = new Map(
    driftReport.features.map((d) => [String(d.feature), d])
  );
  const catalogByKey = new Map(
    REGRESSION_FEATURE_CATALOG.map((f) => [String(f.key), f])
  );

  const collinearMap = new Map<string, string[]>();
  for (const pair of featureMatrix.highCollinearityPairs) {
    const aCols = collinearMap.get(pair.featureA) ?? [];
    aCols.push(pair.labelB);
    collinearMap.set(pair.featureA, aCols);
    const bCols = collinearMap.get(pair.featureB) ?? [];
    bCols.push(pair.labelA);
    collinearMap.set(pair.featureB, bCols);
  }

  const sortedByAbsBeta = [...linearFit.features].sort(
    (a, b) => Math.abs(b.standardizedBeta) - Math.abs(a.standardizedBeta)
  );

  let runningSharePct = 0;
  const rows: ExportFeatureImportanceRow[] = sortedByAbsBeta.map((feat, idx) => {
    const meta = catalogByKey.get(feat.feature);
    const corr = corrByKey.get(feat.feature);
    const drift = driftByKey.get(feat.feature);
    const sharePct = Math.round(feat.importanceShare * 1000) / 10;
    runningSharePct = Math.min(
      100,
      Math.round((runningSharePct + sharePct) * 10) / 10
    );

    return {
      rank: idx + 1,
      featureKey: feat.feature,
      csvColumn: meta?.csvColumn ?? feat.feature,
      label: feat.label,
      description: meta?.shortLabel ?? feat.label,
      standardizedBeta: feat.standardizedBeta,
      absBeta: Math.round(Math.abs(feat.standardizedBeta) * 1000) / 1000,
      importanceSharePct: sharePct,
      cumulativeSharePct: runningSharePct,
      rawCoefficient: feat.rawCoefficient,
      univariateR2: feat.univariateR2,
      pearsonR: corr ? Math.round(corr.pearsonR * 1000) / 1000 : 0,
      featureMean: corr ? corr.mean : 0,
      featureStd: corr ? corr.std : 0,
      direction: feat.direction,
      klDivergence: drift ? drift.klDivergence : null,
      klExceedsThreshold: drift ? drift.klExceedsThreshold : false,
      collinearPartners: collinearMap.get(feat.feature) ?? [],
    };
  });

  const top = rows[0] ?? null;
  const second = rows[1] ?? null;
  const topTwoCumulativeSharePct =
    Math.round(
      ((top?.importanceSharePct ?? 0) + (second?.importanceSharePct ?? 0)) * 10
    ) / 10;

  let summaryNarrative: string;
  if (linearFit.sampleSize < 3 || rows.length === 0) {
    summaryNarrative =
      'At least 3 materialized entities are needed to estimate OLS feature importance weights for the exported dataset.';
  } else {
    summaryNarrative = `${top.csvColumn} is the primary LTV driver (${top.importanceSharePct.toFixed(1)}% weight share, β=${top.standardizedBeta >= 0 ? '+' : ''}${top.standardizedBeta.toFixed(3)}, raw slope=${top.rawCoefficient >= 0 ? '+' : ''}${top.rawCoefficient.toFixed(3)})${
      second
        ? `, followed by ${second.csvColumn} (${second.importanceSharePct.toFixed(1)}%, β=${second.standardizedBeta >= 0 ? '+' : ''}${second.standardizedBeta.toFixed(3)})`
        : ''
    }. Together, the top ${second ? 'two predictors' : 'predictor'} account for ${topTwoCumulativeSharePct.toFixed(1)}% of standardized linear attribution (model R²=${linearFit.rSquared.toFixed(3)}, RMSE=$${linearFit.rmse.toFixed(2)}).`;
  }

  return {
    datasetName,
    sampleSize: linearFit.sampleSize,
    featureCount: rows.length,
    rSquared: linearFit.rSquared,
    rmse: linearFit.rmse,
    mae: linearFit.mae,
    intercept: linearFit.intercept,
    obsCutoffDay: regConfig.obsCutoffDay,
    horizonDays: regConfig.horizonDays,
    winsorizePercentile: regConfig.winsorizePercentile,
    normalizationMode: regConfig.featureNormalization,
    topDriverColumn: top?.csvColumn ?? null,
    topDriverSharePct: top?.importanceSharePct ?? 0,
    topTwoCumulativeSharePct,
    rows,
    summaryNarrative,
  };
}

export function formatFeatureImportanceCsv(
  report: ExportFeatureImportanceReport
): string {
  const header = [
    'rank',
    'csv_column',
    'label',
    'direction',
    'importance_share_pct',
    'cumulative_share_pct',
    'standardized_beta',
    'raw_coefficient_usd_per_unit',
    'univariate_r2',
    'pearson_r',
    'kl_divergence_nats',
    'kl_breached',
  ].join(',');

  const lines = report.rows.map((r) =>
    [
      r.rank,
      r.csvColumn,
      `"${r.label.replace(/"/g, '""')}"`,
      r.direction,
      r.importanceSharePct.toFixed(1),
      r.cumulativeSharePct.toFixed(1),
      r.standardizedBeta.toFixed(4),
      r.rawCoefficient.toFixed(4),
      r.univariateR2.toFixed(4),
      r.pearsonR.toFixed(4),
      r.klDivergence !== null ? r.klDivergence.toFixed(4) : '',
      r.klExceedsThreshold ? 'true' : 'false',
    ].join(',')
  );

  return [header, ...lines].join('\n');
}

export function formatFeatureImportanceMarkdown(
  report: ExportFeatureImportanceReport
): string {
  const meta = [
    `# Feature Importance Summary — ${report.datasetName}`,
    `Rows: ${report.sampleSize} | Predictors: ${report.featureCount} | R²: ${report.rSquared.toFixed(3)} | RMSE: $${report.rmse.toFixed(2)} | T_obs: Day ${report.obsCutoffDay} | H: ${report.horizonDays}d`,
    '',
    '| Rank | Column | Share % | Std β | Raw Slope ($/unit) | Univariate R² | Pearson r | Direction |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |',
  ];

  const body = report.rows.map(
    (r) =>
      `| ${r.rank} | \`${r.csvColumn}\` | ${r.importanceSharePct.toFixed(1)}% | ${r.standardizedBeta >= 0 ? '+' : ''}${r.standardizedBeta.toFixed(3)} | ${r.rawCoefficient >= 0 ? '+' : ''}${r.rawCoefficient.toFixed(3)} | ${r.univariateR2.toFixed(3)} | ${r.pearsonR >= 0 ? '+' : ''}${r.pearsonR.toFixed(3)} | ${r.direction} |`
  );

  return [...meta, ...body, '', report.summaryNarrative].join('\n');
}

const VALID_SQL_CLAUSE_KEYWORDS = new Set([
  'select',
  'from',
  'where',
  'and',
  'or',
  'not',
  'in',
  'is',
  'null',
  'true',
  'false',
  'as',
  'distinct',
  'group',
  'by',
  'order',
  'asc',
  'desc',
  'limit',
  'offset',
  'having',
  'join',
  'inner',
  'left',
  'right',
  'outer',
  'on',
  'case',
  'when',
  'then',
  'else',
  'end',
  'cast',
  'coalesce',
  'like',
  'ilike',
  'between',
  'exists',
  'nulls',
  'first',
  'last',
]);

const VALID_SQL_FUNCTIONS_AND_TYPES = new Set([
  'count',
  'avg',
  'sum',
  'min',
  'max',
  'round',
  'abs',
  'floor',
  'ceil',
  'ceiling',
  'numeric',
  'text',
  'integer',
  'int',
  'bigint',
  'double',
  'precision',
  'boolean',
  'bool',
  'varchar',
  'float',
  'real',
]);

function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }
  return dp[m][n];
}

function findClosestCandidate(
  targetLower: string,
  candidates: Iterable<string>,
  maxDistance: number
): { candidate: string; distance: number } | null {
  let best: string | null = null;
  let bestDist = maxDistance + 1;
  for (const cand of candidates) {
    if (Math.abs(cand.length - targetLower.length) > maxDistance) continue;
    const dist = levenshteinDistance(targetLower, cand.toLowerCase());
    if (dist < bestDist) {
      bestDist = dist;
      best = cand;
    }
  }
  return best !== null && bestDist <= maxDistance
    ? { candidate: best, distance: bestDist }
    : null;
}

export function validateSqlEditorSyntax(
  sqlText: string,
  config: RegressionConfig,
  expectedTableName = 'stratum_regression_ltv'
): SqlSyntaxValidationReport {
  const schemaCols = getRegressionSqlSchemaColumns(config);
  const schemaColNames = schemaCols.map((c) => c.name);
  const schemaColSet = new Set(schemaColNames.map((n) => n.toLowerCase()));
  const allKeywordsList = Array.from(VALID_SQL_CLAUSE_KEYWORDS);
  const allFunctionsList = Array.from(VALID_SQL_FUNCTIONS_AND_TYPES);

  interface RawScanToken {
    kind: 'whitespace' | 'comment' | 'string' | 'number' | 'operator' | 'ident' | 'error';
    text: string;
    start: number;
    end: number;
    line: number;
    column: number;
    errorMessage?: string;
  }

  const rawTokens: RawScanToken[] = [];
  let i = 0;
  let line = 1;
  let col = 1;
  const len = sqlText.length;

  const advance = (str: string) => {
    for (let k = 0; k < str.length; k++) {
      if (str[k] === '\n') {
        line += 1;
        col = 1;
      } else {
        col += 1;
      }
    }
  };

  while (i < len) {
    const startLine = line;
    const startCol = col;
    const ch = sqlText[i];

    // Whitespace
    if (/\s/.test(ch)) {
      let j = i + 1;
      while (j < len && /\s/.test(sqlText[j])) j++;
      const text = sqlText.slice(i, j);
      rawTokens.push({ kind: 'whitespace', text, start: i, end: j, line: startLine, column: startCol });
      advance(text);
      i = j;
      continue;
    }

    // Line comment --
    if (ch === '-' && sqlText[i + 1] === '-') {
      let j = i + 2;
      while (j < len && sqlText[j] !== '\n') j++;
      const text = sqlText.slice(i, j);
      rawTokens.push({ kind: 'comment', text, start: i, end: j, line: startLine, column: startCol });
      advance(text);
      i = j;
      continue;
    }

    // Block comment /* ... */
    if (ch === '/' && sqlText[i + 1] === '*') {
      const closeIdx = sqlText.indexOf('*/', i + 2);
      if (closeIdx === -1) {
        const text = sqlText.slice(i);
        rawTokens.push({
          kind: 'error',
          text,
          start: i,
          end: len,
          line: startLine,
          column: startCol,
          errorMessage: 'Unclosed block comment (missing "*/").',
        });
        advance(text);
        i = len;
      } else {
        const text = sqlText.slice(i, closeIdx + 2);
        rawTokens.push({ kind: 'comment', text, start: i, end: closeIdx + 2, line: startLine, column: startCol });
        advance(text);
        i = closeIdx + 2;
      }
      continue;
    }

    // String literal '...'
    if (ch === "'") {
      let j = i + 1;
      let closed = false;
      while (j < len) {
        if (sqlText[j] === "'") {
          if (sqlText[j + 1] === "'") {
            j += 2;
            continue;
          }
          j += 1;
          closed = true;
          break;
        }
        j += 1;
      }
      const text = sqlText.slice(i, j);
      rawTokens.push({
        kind: closed ? 'string' : 'error',
        text,
        start: i,
        end: j,
        line: startLine,
        column: startCol,
        errorMessage: closed ? undefined : 'Unclosed single-quoted string literal.',
      });
      advance(text);
      i = j;
      continue;
    }

    // Double-quoted identifier "..."
    if (ch === '"') {
      let j = i + 1;
      let closed = false;
      while (j < len) {
        if (sqlText[j] === '"') {
          j += 1;
          closed = true;
          break;
        }
        j += 1;
      }
      const text = sqlText.slice(i, j);
      rawTokens.push({
        kind: closed ? 'ident' : 'error',
        text,
        start: i,
        end: j,
        line: startLine,
        column: startCol,
        errorMessage: closed ? undefined : 'Unclosed double-quoted identifier.',
      });
      advance(text);
      i = j;
      continue;
    }

    // Number literal
    if (/\d/.test(ch)) {
      let j = i + 1;
      while (j < len && /[\d.]/.test(sqlText[j])) j++;
      const text = sqlText.slice(i, j);
      const validNum = /^\d+(\.\d+)?$/.test(text);
      rawTokens.push({
        kind: validNum ? 'number' : 'error',
        text,
        start: i,
        end: j,
        line: startLine,
        column: startCol,
        errorMessage: validNum ? undefined : `Malformed numeric literal "${text}".`,
      });
      advance(text);
      i = j;
      continue;
    }

    // Identifier or Keyword
    if (/[a-zA-Z_]/.test(ch)) {
      let j = i + 1;
      while (j < len && /[a-zA-Z0-9_]/.test(sqlText[j])) j++;
      const text = sqlText.slice(i, j);
      rawTokens.push({ kind: 'ident', text, start: i, end: j, line: startLine, column: startCol });
      advance(text);
      i = j;
      continue;
    }

    // Multi-char operators
    const twoChar = sqlText.slice(i, i + 2);
    if (['::', '!=', '<>', '>=', '<='].includes(twoChar)) {
      rawTokens.push({ kind: 'operator', text: twoChar, start: i, end: i + 2, line: startLine, column: startCol });
      advance(twoChar);
      i += 2;
      continue;
    }

    // Single-char operators & punctuation
    if ('=<>+-*/,.;()'.includes(ch)) {
      rawTokens.push({ kind: 'operator', text: ch, start: i, end: i + 1, line: startLine, column: startCol });
      advance(ch);
      i += 1;
      continue;
    }

    // Unexpected character
    rawTokens.push({
      kind: 'error',
      text: ch,
      start: i,
      end: i + 1,
      line: startLine,
      column: startCol,
      errorMessage: `Unexpected character "${ch}" in SQL query.`,
    });
    advance(ch);
    i += 1;
  }

  // First pass per statement to collect declared AS aliases
  const statementAliases = new Map<number, Set<string>>();
  let stmtId = 0;
  const sigTokenStmt = new Array<number>(rawTokens.length).fill(0);
  const sigIndices: number[] = [];

  for (let idx = 0; idx < rawTokens.length; idx++) {
    const rt = rawTokens[idx];
    sigTokenStmt[idx] = stmtId;
    if (rt.kind === 'whitespace' || rt.kind === 'comment') continue;
    if (rt.kind === 'operator' && rt.text === ';') {
      stmtId += 1;
      continue;
    }
    sigIndices.push(idx);
  }

  for (let sIdx = 0; sIdx < sigIndices.length; sIdx++) {
    const curIdx = sigIndices[sIdx];
    const tok = rawTokens[curIdx];
    if (tok.kind === 'ident' && tok.text.toLowerCase() === 'as') {
      const nextRawIdx = sigIndices[sIdx + 1];
      if (nextRawIdx !== undefined && sigTokenStmt[nextRawIdx] === sigTokenStmt[curIdx]) {
        const nextTok = rawTokens[nextRawIdx];
        if (nextTok.kind === 'ident') {
          const cleanAlias = nextTok.text.replace(/"/g, '').toLowerCase();
          const curSet = statementAliases.get(sigTokenStmt[curIdx]) ?? new Set<string>();
          curSet.add(cleanAlias);
          statementAliases.set(sigTokenStmt[curIdx], curSet);
        }
      }
    }
  }

  // Second pass: classify every token with context-aware SQL & schema validation
  const tokens: SqlSyntaxToken[] = rawTokens.map((rt, idx) => ({
    id: `tok-${idx}`,
    type:
      rt.kind === 'whitespace'
        ? 'whitespace'
        : rt.kind === 'comment'
        ? 'comment'
        : rt.kind === 'string'
        ? 'string'
        : rt.kind === 'number'
        ? 'number'
        : rt.kind === 'operator'
        ? 'operator'
        : 'syntax_error',
    text: rt.text,
    start: rt.start,
    end: rt.end,
    line: rt.line,
    column: rt.column,
    diagnosticMessage: rt.errorMessage,
  }));

  const diagnostics: SqlSyntaxDiagnostic[] = [];
  const parenStack: number[] = [];

  const pushDiagnostic = (
    tokIdx: number,
    code: SqlSyntaxDiagnostic['code'],
    severity: SqlSyntaxDiagnostic['severity'],
    message: string,
    suggestion?: string
  ) => {
    const t = tokens[tokIdx];
    t.diagnosticMessage = message;
    if (suggestion) t.suggestion = suggestion;
    diagnostics.push({
      id: `diag-${diagnostics.length}-${tokIdx}`,
      severity,
      code,
      line: t.line,
      column: t.column,
      start: t.start,
      end: t.end,
      tokenText: t.text,
      message,
      suggestion,
    });
  };

  for (let idx = 0; idx < rawTokens.length; idx++) {
    const rt = rawTokens[idx];
    if (rt.kind === 'error') {
      pushDiagnostic(
        idx,
        'syntax_error',
        'error',
        rt.errorMessage ?? `Invalid syntax token "${rt.text}".`
      );
    }
  }

  // Context walk over significant tokens
  let atStatementStart = true;
  let expectingTable = false;
  let expectingAlias = false;
  let expectingTypeCast = false;
  let expectingByAfter: 'group' | 'order' | null = null;
  let expectingLimitNumber = false;
  let justSawTableName = false;
  let currentClause: 'none' | 'select' | 'from' | 'where' | 'group_by' | 'order_by' | 'limit' =
    'none';

  for (let sPos = 0; sPos < sigIndices.length; sPos++) {
    const tokIdx = sigIndices[sPos];
    const rt = rawTokens[tokIdx];
    const nextRawIdx = sigIndices[sPos + 1];
    const nextTok =
      nextRawIdx !== undefined && sigTokenStmt[nextRawIdx] === sigTokenStmt[tokIdx]
        ? rawTokens[nextRawIdx]
        : null;
    const prevRawIdx = sigIndices[sPos - 1];
    const prevTok =
      prevRawIdx !== undefined && sigTokenStmt[prevRawIdx] === sigTokenStmt[tokIdx]
        ? rawTokens[prevRawIdx]
        : null;

    if (rt.kind === 'operator') {
      if (rt.text === ';') {
        atStatementStart = true;
        expectingTable = false;
        expectingAlias = false;
        expectingTypeCast = false;
        expectingByAfter = null;
        expectingLimitNumber = false;
        justSawTableName = false;
        currentClause = 'none';
        continue;
      }
      if (rt.text === '(') {
        parenStack.push(tokIdx);
      } else if (rt.text === ')') {
        if (parenStack.length === 0) {
          tokens[tokIdx].type = 'syntax_error';
          pushDiagnostic(
            tokIdx,
            'syntax_error',
            'error',
            'Unmatched closing parenthesis ")".'
          );
        } else {
          parenStack.pop();
        }
      }
      expectingTypeCast = rt.text === '::';
      if (rt.text === ',' || rt.text === '(') {
        justSawTableName = false;
      }
      continue;
    }

    if (rt.kind === 'number') {
      if (expectingLimitNumber) {
        expectingLimitNumber = false;
      }
      expectingTypeCast = false;
      justSawTableName = false;
      continue;
    }

    if (rt.kind === 'string') {
      expectingTypeCast = false;
      justSawTableName = false;
      continue;
    }

    if (rt.kind !== 'ident') continue;

    const cleanIdent = rt.text.replace(/"/g, '');
    const lower = cleanIdent.toLowerCase();
    const aliases = statementAliases.get(sigTokenStmt[tokIdx]) ?? new Set<string>();

    // Handle GROUP / ORDER missing BY
    if (expectingByAfter !== null) {
      if (lower === 'by') {
        tokens[tokIdx].type = 'keyword';
        currentClause = expectingByAfter === 'group' ? 'group_by' : 'order_by';
        expectingByAfter = null;
        continue;
      } else {
        const kwMatch = findClosestCandidate(lower, ['by'], 1);
        tokens[tokIdx].type = 'invalid_keyword';
        pushDiagnostic(
          tokIdx,
          'invalid_keyword',
          'error',
          `Expected keyword "BY" after "${expectingByAfter.toUpperCase()}", found "${rt.text}".`,
          kwMatch ? 'BY' : undefined
        );
        expectingByAfter = null;
        continue;
      }
    }

    if (expectingLimitNumber) {
      tokens[tokIdx].type = 'invalid_keyword';
      pushDiagnostic(
        tokIdx,
        'syntax_error',
        'error',
        `Expected integer row limit after LIMIT, found "${rt.text}".`
      );
      expectingLimitNumber = false;
      continue;
    }

    // Type cast after ::
    if (expectingTypeCast) {
      expectingTypeCast = false;
      if (VALID_SQL_FUNCTIONS_AND_TYPES.has(lower)) {
        tokens[tokIdx].type = 'function';
      } else {
        tokens[tokIdx].type = 'invalid_keyword';
        const closest = findClosestCandidate(lower, allFunctionsList, 2);
        pushDiagnostic(
          tokIdx,
          'invalid_keyword',
          'error',
          `Unknown PostgreSQL cast type "::${rt.text}".`,
          closest?.candidate
        );
      }
      continue;
    }

    // Alias right after AS
    if (expectingAlias) {
      expectingAlias = false;
      if (VALID_SQL_CLAUSE_KEYWORDS.has(lower)) {
        tokens[tokIdx].type = 'invalid_keyword';
        pushDiagnostic(
          tokIdx,
          'invalid_keyword',
          'error',
          `SQL keyword "${rt.text}" cannot be used as an unquoted column alias.`
        );
      } else {
        tokens[tokIdx].type = 'alias';
      }
      continue;
    }

    // Table identifier right after FROM / JOIN
    if (expectingTable) {
      // Allow optional public.table_name
      if (lower === 'public' && nextTok?.kind === 'operator' && nextTok.text === '.') {
        tokens[tokIdx].type = 'keyword';
        continue;
      }
      expectingTable = false;
      justSawTableName = true;
      if (lower === expectedTableName) {
        tokens[tokIdx].type = 'table_valid';
      } else {
        tokens[tokIdx].type = 'invalid_schema';
        pushDiagnostic(
          tokIdx,
          'invalid_table',
          'error',
          `Unknown relation "${rt.text}". Expected materialized table "${expectedTableName}".`,
          expectedTableName
        );
      }
      continue;
    }

    // Statement starter validation
    if (atStatementStart) {
      atStatementStart = false;
      if (lower === 'select') {
        tokens[tokIdx].type = 'keyword';
        currentClause = 'select';
      } else if (VALID_SQL_CLAUSE_KEYWORDS.has(lower)) {
        tokens[tokIdx].type = 'invalid_keyword';
        pushDiagnostic(
          tokIdx,
          'invalid_keyword',
          'error',
          `Queries in the SQL Verifier must begin with "SELECT", not "${rt.text}".`,
          'SELECT'
        );
      } else {
        const kwHint = findClosestCandidate(lower, ['select'], 2);
        tokens[tokIdx].type = 'invalid_keyword';
        pushDiagnostic(
          tokIdx,
          'invalid_keyword',
          'error',
          `Invalid SQL keyword "${rt.text}" at start of statement. Expected "SELECT".`,
          kwHint ? 'SELECT' : 'SELECT'
        );
      }
      continue;
    }

    // Valid keywords
    if (VALID_SQL_CLAUSE_KEYWORDS.has(lower)) {
      tokens[tokIdx].type = 'keyword';
      justSawTableName = false;
      if (lower === 'from' || lower === 'join') {
        expectingTable = true;
        currentClause = 'from';
      } else if (lower === 'where') {
        currentClause = 'where';
      } else if (lower === 'group') {
        expectingByAfter = 'group';
      } else if (lower === 'order') {
        expectingByAfter = 'order';
      } else if (lower === 'limit') {
        currentClause = 'limit';
        expectingLimitNumber = true;
      } else if (lower === 'as') {
        expectingAlias = true;
      }
      continue;
    }

    // Valid SQL functions & types (e.g. COUNT(...), AVG(...), ROUND(...))
    if (VALID_SQL_FUNCTIONS_AND_TYPES.has(lower)) {
      tokens[tokIdx].type = 'function';
      justSawTableName = false;
      continue;
    }

    // Qualified column prefix: stratum_regression_ltv.<col>
    if (lower === expectedTableName && nextTok?.kind === 'operator' && nextTok.text === '.') {
      tokens[tokIdx].type = 'table_valid';
      continue;
    }

    // Valid schema column or declared alias
    if (schemaColSet.has(lower) || aliases.has(lower)) {
      tokens[tokIdx].type = 'column_valid';
      justSawTableName = false;
      continue;
    }

    // Distinguish invalid SQL keyword vs invalid schema column reference
    const kwMatch = findClosestCandidate(lower, allKeywordsList, 2);
    const fnMatch =
      nextTok?.kind === 'operator' && nextTok.text === '('
        ? findClosestCandidate(lower, allFunctionsList, 2)
        : null;
    const colMatch = findClosestCandidate(lower, schemaColNames, 4);

    const prevWasValueOrCloseParen =
      prevTok?.kind === 'string' ||
      prevTok?.kind === 'number' ||
      (prevTok?.kind === 'operator' && prevTok.text === ')') ||
      (prevTok?.kind === 'ident' &&
        (schemaColSet.has(prevTok.text.replace(/"/g, '').toLowerCase()) ||
          aliases.has(prevTok.text.replace(/"/g, '').toLowerCase()) ||
          ['true', 'false', 'null', 'asc', 'desc'].includes(prevTok.text.toLowerCase())));

    const isKeywordPosition =
      justSawTableName ||
      (prevWasValueOrCloseParen && currentClause !== 'select') ||
      (kwMatch !== null &&
        (!colMatch || kwMatch.distance <= colMatch.distance));

    if (fnMatch) {
      tokens[tokIdx].type = 'invalid_keyword';
      pushDiagnostic(
        tokIdx,
        'invalid_keyword',
        'error',
        `Unknown SQL function "${rt.text}()". Did you mean "${fnMatch.candidate.toUpperCase()}()"?`,
        fnMatch.candidate.toUpperCase()
      );
    } else if (isKeywordPosition && (kwMatch || justSawTableName)) {
      const suggestion = kwMatch?.candidate.toUpperCase();
      tokens[tokIdx].type = 'invalid_keyword';
      pushDiagnostic(
        tokIdx,
        'invalid_keyword',
        'error',
        suggestion
          ? `Invalid SQL keyword "${rt.text}". Did you mean "${suggestion}"?`
          : `Unexpected keyword or clause "${rt.text}" after relation.`,
        suggestion
      );
      if (kwMatch?.candidate === 'from' || kwMatch?.candidate === 'join') {
        expectingTable = true;
        currentClause = 'from';
      }
    } else {
      tokens[tokIdx].type = 'invalid_schema';
      pushDiagnostic(
        tokIdx,
        'invalid_column',
        'error',
        colMatch
          ? `Column "${rt.text}" is not in active export schema. Did you mean "${colMatch.candidate}"?`
          : `Column "${rt.text}" does not exist in active "${expectedTableName}" schema.`,
        colMatch?.candidate
      );
    }
    justSawTableName = false;
  }

  for (const unclosedIdx of parenStack) {
    tokens[unclosedIdx].type = 'syntax_error';
    pushDiagnostic(
      unclosedIdx,
      'syntax_error',
      'error',
      'Unclosed opening parenthesis "(".'
    );
  }

  diagnostics.sort((a, b) => a.start - b.start);
  const errorCount = diagnostics.filter((d) => d.severity === 'error').length;
  const warningCount = diagnostics.filter((d) => d.severity === 'warning').length;
  const errorLines = Array.from(new Set(diagnostics.map((d) => d.line))).sort(
    (a, b) => a - b
  );
  const lineCount = Math.max(1, sqlText.split('\n').length);

  return {
    isSyntaxClean: errorCount === 0 && warningCount === 0,
    tokens,
    diagnostics,
    errorCount,
    warningCount,
    lineCount,
    errorLines,
  };
}

export interface WorkspaceSearchInput {
  activePresetId: string;
  customDatasetName: string | null;
  datasetName: string;
  datasetDomain: string;
  events: RawEvent[];
  presets: DatasetPreset[];
  globalConfig: GlobalCurationConfig;
  regConfig: RegressionConfig;
  seqConfig: SequenceConfig;
  mdpConfig: MdpConfig;
  piiMaskingConfig: PiiMaskingConfig;
  regResult: RegressionResult;
  seqResult: SequenceResult;
  mdpResult: MdpResult;
  audits: AuditCheck[];
}

function scoreCatalogMatch(
  terms: string[],
  title: string,
  subtitle: string,
  valueText: string | undefined,
  keywords: string[]
): number {
  if (terms.length === 0) return 1;
  const tLower = title.toLowerCase();
  const sLower = subtitle.toLowerCase();
  const vLower = (valueText ?? '').toLowerCase();
  const kLower = keywords.join(' ').toLowerCase();
  const combined = `${tLower} ${sLower} ${vLower} ${kLower}`;

  for (const term of terms) {
    if (!combined.includes(term)) return 0;
  }

  let score = 10;
  const joined = terms.join(' ');
  if (tLower === joined) score += 80;
  else if (tLower.startsWith(joined)) score += 50;
  else if (tLower.includes(joined)) score += 35;

  for (const term of terms) {
    if (tLower.includes(term)) score += 20;
    else if (kLower.includes(term)) score += 12;
    else if (vLower.includes(term)) score += 8;
    else score += 4;
  }
  return score;
}

export function searchWorkspaceCatalog(
  rawQuery: string,
  input: WorkspaceSearchInput,
  categoryFilter: 'all' | GlobalSearchCategory = 'all',
  limit = 40
): GlobalSearchReport {
  const query = rawQuery.trim();
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 0);

  const {
    activePresetId,
    customDatasetName,
    datasetName,
    datasetDomain,
    events,
    presets,
    globalConfig,
    regConfig,
    seqConfig,
    mdpConfig,
    piiMaskingConfig,
    regResult,
    seqResult,
    mdpResult,
    audits,
  } = input;

  const catalog: Omit<GlobalSearchResultItem, 'score'>[] = [];

  // 1. Views & Analytical Tools
  const viewEntries: Omit<GlobalSearchResultItem, 'score'>[] = [
    {
      id: 'view-overview',
      category: 'view',
      title: 'Overview & Data Lineage Visualizer',
      subtitle: 'Cross-paradigm pipeline health, D3 data lineage flow, and baseline performance alerts',
      valueText: `${audits.length} checks`,
      targetTab: 'overview',
      targetLabel: 'Overview',
      keywords: ['overview', 'lineage', 'd3', 'flow', 'alert', 'baseline', 'health', 'scorecard'],
    },
    {
      id: 'view-regression',
      category: 'view',
      title: 'Regression (LTV) · Trend Projection & Drift',
      subtitle: '90-day linear LTV projection, confidence intervals, Explainable AI, and KL drift alerts',
      valueText: `R² ${regResult.linearFit.rSquared.toFixed(3)}`,
      targetTab: 'regression',
      targetLabel: 'Regression',
      keywords: ['regression', 'ltv', 'trend', 'projection', '90 days', 'confidence interval', 'explainable ai', 'kl', 'drift', 'anomaly', 'outlier', 'vif'],
    },
    {
      id: 'view-model-comparison',
      category: 'view',
      title: 'Model Comparison (A/B)',
      subtitle: 'Side-by-side cohort accuracy, feature scaling, and architecture promotion workbench',
      valueText: `${regResult.evaluationMatrix.splitMetrics.length} splits`,
      targetTab: 'model_comparison',
      targetLabel: 'Model A/B',
      keywords: ['comparison', 'ab', 'a/b', 'benchmark', 'evaluation', 'confusion', 'promote'],
    },
    {
      id: 'view-sequence',
      category: 'view',
      title: 'Deep Learning · Sequence Tensors & Length Histogram',
      subtitle: 'Sequence length distribution histogram, truncation/padding tuning, and Transformer training',
      valueText: `[${seqResult.tensorShape.join(', ')}]`,
      targetTab: 'sequence',
      targetLabel: 'Sequence',
      keywords: ['sequence', 'tensor', 'histogram', 'length', 'maxseqlen', 'truncation', 'padding', 'transformer', 'attention', 'loss'],
    },
    {
      id: 'view-workflow-templates',
      category: 'view',
      title: 'Workflow Templates Library',
      subtitle: 'Save & load industry vertical bundles (Regression + Sequence + Offline RL) for E-Commerce, SaaS, Fintech & IoT',
      valueText: '4+ Verticals',
      targetTab: 'overview',
      targetLabel: 'Overview',
      keywords: ['workflow', 'template', 'templates', 'vertical', 'industry', 'preset', 'bundle', 'ecommerce', 'saas', 'fintech', 'iot'],
    },
    {
      id: 'view-hpo',
      category: 'view',
      title: 'Hyperparameter Optimizer',
      subtitle: 'Grid search over learning rate, d_model, heads, layers, and dropout',
      valueText: `LR ${seqConfig.learningRate ?? 0.001}`,
      targetTab: 'hyperparameter_optimizer',
      targetLabel: 'HPO',
      keywords: ['hyperparameter', 'optimizer', 'hpo', 'sweep', 'learning rate', 'dmodel', 'dropout'],
    },
    {
      id: 'view-offline-rl',
      category: 'view',
      title: 'Offline RL (CQL / MDP) · Sensitivity Simulator',
      subtitle: 'Simulate gamma discount factor and rewardScale impact on policy cumulative reward',
      valueText: `γ=${mdpConfig.gamma.toFixed(2)}`,
      targetTab: 'offline_rl',
      targetLabel: 'Offline RL',
      keywords: ['offline rl', 'mdp', 'cql', 'sensitivity', 'gamma', 'discount', 'reward', 'rewardscale', 'policy', 'trajectory', 'ood'],
    },
    {
      id: 'view-retention-cohorts',
      category: 'view',
      title: 'Retention Cohort Analysis (D3)',
      subtitle: 'D3 retention heatmap and lifecycle survival curves across acquisition cohorts',
      valueText: `${new Set(events.map((e) => e.entityId)).size} entities`,
      targetTab: 'retention_cohorts',
      targetLabel: 'Retention Cohorts',
      keywords: ['retention', 'cohort', 'lifecycle', 'churn', 'd3', 'heatmap', 'survival', 'engagement', 'arpu'],
    },
    {
      id: 'view-snapshot-comparison',
      category: 'view',
      title: 'Snapshot Comparison Matrix',
      subtitle: 'Compare metrics, drift, and configuration diffs across multiple saved workspace snapshots',
      valueText: 'Multi-run diff',
      targetTab: 'snapshot_comparison',
      targetLabel: 'Snapshot Compare',
      keywords: ['snapshot', 'compare', 'comparison', 'workspace', 'drift', 'improvement', 'diff', 'baseline', 'experiment'],
    },
    {
      id: 'view-data-explorer',
      category: 'view',
      title: 'Data Explorer · Canonical Event Logs',
      subtitle: `Browse, filter, sort, and export ${events.length.toLocaleString()} raw events across train/val/test`,
      valueText: `${events.length.toLocaleString()} events`,
      targetTab: 'data_explorer',
      targetLabel: 'Data Explorer',
      keywords: ['explorer', 'events', 'logs', 'raw', 'entity', 'channel', 'action', 'filter', 'spend'],
    },
    {
      id: 'view-feature-engineering',
      category: 'view',
      title: 'Feature Engineering Assistant',
      subtitle: 'Synthesize leak-free velocity, momentum, and volatility signals with Pearson r & collinearity audits',
      valueText: 'AI Advisor',
      targetTab: 'feature_engineering',
      targetLabel: 'Feature Engineering',
      keywords: ['feature engineering', 'derived', 'slope', 'momentum', 'volatility', 'collinearity', 'pearson', 'augmented'],
    },
    {
      id: 'view-rul-timeseries',
      category: 'view',
      title: 'Time-Series & Remaining Useful Life (RUL) Preparation',
      subtitle: 'Inspect RUL trends, per-unit sensor degradation curves, rolling Z-score spikes, and sliding-window RUL tensors',
      valueText: 'RUL Tensors',
      targetTab: 'rul_timeseries',
      targetLabel: 'Time-Series & RUL',
      keywords: ['rul', 'rul trends', 'degradation trend', 'risk tier', 'remaining useful life', 'sensor', 'telemetry', 'time series', 'time-series', 'sliding window', 'turbofan', 'degradation', 'anomaly'],
    },
    {
      id: 'view-dataset-search',
      category: 'view',
      title: 'Dataset Search Engine & Metadata Catalog',
      subtitle: 'Multi-dataset search, schema lineage dictionary, and PII governance catalog',
      valueText: `${presets.length + (customDatasetName ? 1 : 0)} datasets`,
      targetTab: 'dataset_search',
      targetLabel: 'Search & Catalog',
      keywords: ['search', 'dataset', 'index', 'schema', 'query', 'catalog', 'metadata', 'governance', 'pii', 'discover', 'entity', 'operator'],
    },
    {
      id: 'view-governance-repository',
      category: 'view',
      title: 'Governance, Version Control & Archival Vault',
      subtitle: 'Standardize DCAT-3 / ML-Croissant / ISO-11179 metadata, commit & diff configs, and deposit SHA-256 WORM archives',
      valueText: 'VCS · WORM · ISO',
      targetTab: 'governance_repository',
      targetLabel: 'Governance & VCS',
      keywords: ['metadata', 'standardization', 'dcat', 'croissant', 'iso-11179', 'governance', 'catalog', 'version control', 'vcs', 'commit', 'branch', 'diff', 'repository', 'archive', 'vault', 'worm', 'sha256'],
    },
    {
      id: 'view-nl-query',
      category: 'view',
      title: 'Natural Language Query Engine',
      subtitle: 'Ask plain-English analytics questions compiled into verifiable SQL plans against events, LTV, and MDP tables',
      valueText: 'NL -> SQL',
      targetTab: 'nl_query',
      targetLabel: 'NL Query',
      keywords: ['natural language', 'nlq', 'ask', 'sql', 'query', 'english', 'analytics', 'group by', 'aggregate', 'gemini'],
    },
    {
      id: 'view-auto-docs',
      category: 'view',
      title: 'Auto Documentation Generator',
      subtitle: 'Generate ML Model Cards, automated Data Dictionaries, and Markdown/HTML/JSON specs',
      valueText: 'MD · HTML · JSON',
      targetTab: 'auto_docs',
      targetLabel: 'Auto Docs',
      keywords: ['documentation', 'docs', 'auto', 'model card', 'data dictionary', 'schema', 'markdown', 'html', 'datasheet'],
    },
    {
      id: 'view-ai-curator',
      category: 'view',
      title: 'AI Data Quality & Curator Engine',
      subtitle: 'Detect anomalies, run Gemini-powered curation audits, and apply reversible event cleaning rules',
      valueText: 'AI Curator',
      targetTab: 'ai_curator',
      targetLabel: 'AI Curator',
      keywords: ['ai', 'curator', 'quality', 'clean', 'anomaly', 'deduplicate', 'curation', 'remediate', 'outlier', 'propensity'],
    },
    {
      id: 'view-audit-export',
      category: 'view',
      title: 'Validation & Export · SQL Verifier & Feature Importance',
      subtitle: 'Interactive SQL editor with syntax validation, EXPLAIN plan, PII masking, and LTV feature importance',
      valueText: `${audits.filter((a) => a.status === 'pass').length}/${audits.length} pass`,
      targetTab: 'audit_export',
      targetLabel: 'Export & Audit',
      keywords: ['export', 'audit', 'sql', 'syntax', 'validator', 'explain', 'schema', 'feature importance', 'pii', 'csv', 'json'],
    },
  ];
  catalog.push(...viewEntries);

  // 2. Datasets & Presets
  if (customDatasetName) {
    catalog.push({
      id: 'dataset-custom',
      category: 'dataset',
      title: `${customDatasetName} (Active Custom Import)`,
      subtitle: `${datasetDomain} · ${events.length.toLocaleString()} events loaded`,
      valueText: 'ACTIVE',
      targetTab: 'data_explorer',
      targetLabel: 'Data Explorer',
      keywords: ['dataset', 'custom', 'import', 'csv', 'mat', customDatasetName.toLowerCase()],
    });
  }

  for (const preset of presets) {
    const isActive = !customDatasetName && preset.id === activePresetId;
    catalog.push({
      id: `dataset-preset-${preset.id}`,
      category: 'dataset',
      title: preset.name,
      subtitle: `${preset.domain} · ${preset.events.length.toLocaleString()} events · ${preset.horizonTotalDays}d horizon`,
      valueText: isActive ? 'ACTIVE' : 'Switch Preset',
      targetTab: 'overview',
      targetLabel: 'Overview',
      presetIdToSelect: preset.id,
      keywords: [
        'dataset',
        'preset',
        preset.id,
        preset.name,
        preset.domain,
        preset.description,
        ...preset.actionSpace.map((a) => a.label),
      ],
    });
  }

  // 3. Key Computed Metrics
  const holdoutSeqR2 =
    seqResult.transformerEval.holdoutMetrics.rSquared ??
    seqResult.transformerEval.allMetrics.rSquared;
  const bestValLoss =
    seqResult.transformerEval.lossCurve.bestValLoss ??
    seqResult.transformerEval.lossCurve.finalValLoss;

  catalog.push(
    {
      id: 'metric-reg-r2',
      category: 'metric',
      title: 'Regression R² (Linear LTV Fit)',
      subtitle: `OLS model goodness-of-fit on ${regResult.rows.length} entities (${datasetName})`,
      valueText: regResult.linearFit.rSquared.toFixed(4),
      targetTab: 'regression',
      targetLabel: 'Regression',
      keywords: ['r2', 'r-squared', 'rsquared', 'metric', 'regression', 'ltv', 'accuracy', 'fit'],
    },
    {
      id: 'metric-reg-rmse',
      category: 'metric',
      title: 'Regression RMSE & MAE',
      subtitle: `Root mean squared error ($${regResult.linearFit.rmse.toFixed(2)}) · MAE ($${regResult.linearFit.mae.toFixed(2)})`,
      valueText: `$${regResult.linearFit.rmse.toFixed(2)}`,
      targetTab: 'regression',
      targetLabel: 'Regression',
      keywords: ['rmse', 'mae', 'error', 'loss', 'metric', 'regression', 'ltv'],
    },
    {
      id: 'metric-reg-projected-ltv',
      category: 'metric',
      title: 'Mean Projected Horizon LTV',
      subtitle: `95% CI [$${regResult.linearFit.ci95Lower.toFixed(2)}, $${regResult.linearFit.ci95Upper.toFixed(2)}] · Winsorized mean $${regResult.meanTargetWinsorized.toFixed(2)}`,
      valueText: `$${regResult.linearFit.meanProjectedLtv.toFixed(2)}`,
      targetTab: 'regression',
      targetLabel: 'Regression',
      keywords: ['ltv', 'projected', 'mean', 'ci', 'confidence interval', 'metric', 'forecast'],
    },
    {
      id: 'metric-reg-kl-drift',
      category: 'metric',
      title: 'Max Feature KL Divergence (Train vs Val)',
      subtitle: `${regResult.driftReport.klFlaggedCount} feature(s) above threshold ${regResult.driftReport.klThreshold.toFixed(2)} · Tier: ${regResult.driftReport.tier}`,
      valueText: `${regResult.driftReport.maxKlDivergence.toFixed(3)} nats`,
      targetTab: 'regression',
      targetLabel: 'Regression',
      keywords: ['kl', 'divergence', 'drift', 'ks', 'validation', 'distribution', 'alert', 'metric'],
    },
    {
      id: 'metric-reg-outliers',
      category: 'metric',
      title: 'Detected LTV Anomalies / Outliers',
      subtitle: `${regResult.anomalyReport.outlierCount} entities (${(regResult.anomalyReport.outlierRate * 100).toFixed(1)}%) beyond ±${regResult.anomalyReport.stdThreshold}σ`,
      valueText: `${regResult.anomalyReport.outlierCount} entities`,
      targetTab: 'regression',
      targetLabel: 'Regression',
      keywords: ['outlier', 'anomaly', 'z-score', 'std', 'tail', 'metric', 'regression'],
    },
    {
      id: 'metric-seq-shape',
      category: 'metric',
      title: 'Sequence Tensor Shape & Sparsity',
      subtitle: `Mean seq len ${seqResult.meanActualLength.toFixed(1)} steps · Padding sparsity ${(seqResult.paddingSparsity * 100).toFixed(1)}% · ${seqResult.truncatedEntitiesCount} truncated`,
      valueText: `[${seqResult.tensorShape.join(', ')}]`,
      targetTab: 'sequence',
      targetLabel: 'Sequence',
      keywords: ['tensor', 'shape', 'sparsity', 'padding', 'truncated', 'length', 'sequence', 'metric'],
    },
    {
      id: 'metric-seq-loss',
      category: 'metric',
      title: 'Transformer Validation Loss & Holdout R²',
      subtitle: `${seqResult.transformerEval.architectureLabel} · Train loss ${seqResult.transformerEval.lossCurve.finalTrainLoss.toFixed(4)} · ${seqResult.transformerEval.estimatedParams.toLocaleString()} params`,
      valueText:
        bestValLoss !== null
          ? `Loss ${bestValLoss.toFixed(3)}`
          : `R² ${holdoutSeqR2 !== null ? holdoutSeqR2.toFixed(3) : 'N/A'}`,
      targetTab: 'sequence',
      targetLabel: 'Sequence',
      keywords: ['transformer', 'loss', 'val loss', 'train loss', 'holdout', 'r2', 'attention', 'metric'],
    },
    {
      id: 'metric-mdp-transitions',
      category: 'metric',
      title: 'Offline RL MDP Transitions & Initial Return',
      subtitle: `${mdpResult.trajectoryCount} trajectories · Mean return ${mdpResult.meanInitialReturn.toFixed(2)} · OOD rate ${(mdpResult.lowSupportOodRate * 100).toFixed(1)}%`,
      valueText: `${mdpResult.transitions.length.toLocaleString()} steps`,
      targetTab: 'offline_rl',
      targetLabel: 'Offline RL',
      keywords: ['mdp', 'transitions', 'trajectory', 'return', 'reward', 'ood', 'propensity', 'offline rl', 'metric'],
    }
  );

  for (const audit of audits) {
    catalog.push({
      id: `metric-audit-${audit.id}`,
      category: 'metric',
      title: `Audit: ${audit.name}`,
      subtitle: `${audit.paradigm} · ${audit.detail}`,
      valueText: `${audit.status.toUpperCase()} (${audit.metricValue})`,
      targetTab: 'audit_export',
      targetLabel: 'Export & Audit',
      keywords: ['audit', audit.paradigm, audit.status, audit.name, audit.metricValue],
    });
  }

  // 4. Dataset Configurations
  catalog.push(
    {
      id: 'config-global-splits',
      category: 'config',
      title: 'Global Split Ratio & Seed Salt',
      subtitle: `Train ${Math.round(globalConfig.trainRatio * 100)}% / Val ${Math.round(globalConfig.valRatio * 100)}% / Test ${Math.round(globalConfig.testRatio * 100)}% · Salt "${globalConfig.seedSalt}"`,
      valueText: `${Math.round(globalConfig.trainRatio * 100)}/${Math.round(globalConfig.valRatio * 100)}/${Math.round(globalConfig.testRatio * 100)}`,
      targetTab: 'overview',
      targetLabel: 'Overview',
      keywords: ['config', 'split', 'train', 'val', 'test', 'salt', 'seed', globalConfig.seedSalt],
    },
    {
      id: 'config-reg-window',
      category: 'config',
      title: 'Regression Observation Cutoff & Horizon',
      subtitle: `T_obs = Day ${regConfig.obsCutoffDay} · Prediction horizon H = ${regConfig.horizonDays}d · Split filter: ${regConfig.splitFilter}`,
      valueText: `T=${regConfig.obsCutoffDay}d / H=${regConfig.horizonDays}d`,
      targetTab: 'regression',
      targetLabel: 'Regression',
      keywords: ['config', 'cutoff', 'obsCutoffDay', 'horizon', 'horizonDays', 'window', 'regression'],
    },
    {
      id: 'config-reg-features',
      category: 'config',
      title: 'Regression Features, Winsorization & Scaling',
      subtitle: `${regConfig.selectedFeatures.length} active features · Winsorize P${regConfig.winsorizePercentile} · Scaling: ${regConfig.featureNormalization} · Batch ${regConfig.batchSize}`,
      valueText: `${regConfig.selectedFeatures.length} cols`,
      targetTab: 'regression',
      targetLabel: 'Regression',
      keywords: ['config', 'features', 'winsorize', 'normalization', 'scaling', 'zscore', 'minmax', 'batchsize', ...regConfig.selectedFeatures],
    },
    {
      id: 'config-reg-kl',
      category: 'config',
      title: 'KL Drift Alert & Outlier Thresholds',
      subtitle: `KL limit ${(regConfig.klDriftThreshold ?? 0.25).toFixed(2)} nats · Outlier bound ±${(regConfig.outlierStdThreshold ?? 2.5).toFixed(1)}σ (${regConfig.excludeDetectedOutliers ? 'excluded' : 'retained'})`,
      valueText: `KL ≤ ${(regConfig.klDriftThreshold ?? 0.25).toFixed(2)}`,
      targetTab: 'regression',
      targetLabel: 'Regression',
      keywords: ['config', 'kl', 'klDriftThreshold', 'threshold', 'drift', 'alert', 'outlier', 'std'],
    },
    {
      id: 'config-seq-params',
      category: 'config',
      title: 'Sequence maxSeqLen, Padding & Truncation',
      subtitle: `maxSeqLen=${seqConfig.maxSeqLen}, minSeqLen=${seqConfig.minSeqLen} · Padding=${seqConfig.padding} · Truncation=${seqConfig.truncation} · Norm=${seqConfig.normalization}`,
      valueText: `L=${seqConfig.maxSeqLen} (${seqConfig.truncation})`,
      targetTab: 'sequence',
      targetLabel: 'Sequence',
      keywords: ['config', 'maxseqlen', 'minseqlen', 'padding', 'pre', 'post', 'truncation', 'recent', 'early', 'normalization', 'sequence'],
    },
    {
      id: 'config-seq-transformer',
      category: 'config',
      title: 'Transformer Architecture & Hyperparameters',
      subtitle: `${seqConfig.transformerArch ?? 'transformer_encoder'} · d_model=${seqConfig.dModel ?? 128} · heads=${seqConfig.numHeads ?? 4} · layers=${seqConfig.numLayers ?? 2} · lr=${seqConfig.learningRate ?? 0.001}`,
      valueText: `d=${seqConfig.dModel ?? 128} · ${seqConfig.numLayers ?? 2}L`,
      targetTab: 'sequence',
      targetLabel: 'Sequence',
      keywords: ['config', 'transformer', 'architecture', 'dmodel', 'heads', 'layers', 'learning rate', 'dropout', 'positional', 'pooling'],
    },
    {
      id: 'config-mdp-rl',
      category: 'config',
      title: 'Offline RL Discount Factor (gamma) & Reward Scale',
      subtitle: `gamma=${mdpConfig.gamma} · rewardScale=${mdpConfig.rewardScale} · Inactivity gap=${mdpConfig.terminalInactivityGapDays}d · Min steps=${mdpConfig.minTrajectorySteps}`,
      valueText: `γ=${mdpConfig.gamma} · ${mdpConfig.rewardScale}`,
      targetTab: 'offline_rl',
      targetLabel: 'Offline RL',
      keywords: ['config', 'gamma', 'discount', 'rewardscale', 'reward', 'inactivity', 'trajectory', 'absorbing', 'mdp', 'rl'],
    },
    {
      id: 'config-pii-masking',
      category: 'config',
      title: 'PII Entity Masking & Export Governance',
      subtitle: piiMaskingConfig.enabled
        ? `Active (${piiMaskingConfig.mode} mode · salt "${piiMaskingConfig.salt}")`
        : 'Masking disabled — raw entity_id exported',
      valueText: piiMaskingConfig.enabled ? piiMaskingConfig.mode.toUpperCase() : 'OFF',
      targetTab: 'audit_export',
      targetLabel: 'Export & Audit',
      keywords: ['config', 'pii', 'masking', 'privacy', 'hash', 'redact', 'salt', 'export'],
    }
  );

  // 5. Event Aggregates (Channels & Actions)
  const channelStats = new Map<string, { count: number; spend: number }>();
  const actionStats = new Map<string, { actionId: number; count: number; spend: number }>();

  for (const ev of events) {
    const c = channelStats.get(ev.channel) ?? { count: 0, spend: 0 };
    c.count += 1;
    c.spend += ev.spendAmount;
    channelStats.set(ev.channel, c);

    const a = actionStats.get(ev.actionLabel) ?? {
      actionId: ev.actionId,
      count: 0,
      spend: 0,
    };
    a.count += 1;
    a.spend += ev.spendAmount;
    actionStats.set(ev.actionLabel, a);
  }

  for (const [channel, stat] of channelStats.entries()) {
    catalog.push({
      id: `event-channel-${channel}`,
      category: 'event',
      title: `Channel: ${channel}`,
      subtitle: `${stat.count.toLocaleString()} events · $${stat.spend.toFixed(0)} cumulative spend in ${datasetName}`,
      valueText: `${stat.count} events`,
      targetTab: 'data_explorer',
      targetLabel: 'Data Explorer',
      explorerQuery: channel,
      keywords: ['event', 'channel', channel.toLowerCase()],
    });
  }

  for (const [actionLabel, stat] of actionStats.entries()) {
    catalog.push({
      id: `event-action-${stat.actionId}-${actionLabel}`,
      category: 'event',
      title: `Action #${stat.actionId}: ${actionLabel}`,
      subtitle: `${stat.count.toLocaleString()} events · $${stat.spend.toFixed(0)} spend`,
      valueText: `${stat.count} events`,
      targetTab: 'data_explorer',
      targetLabel: 'Data Explorer',
      explorerQuery: actionLabel,
      keywords: ['event', 'action', `action_${stat.actionId}`, actionLabel.toLowerCase()],
    });
  }

  // Score catalog items
  const scoredStatic: GlobalSearchResultItem[] = [];
  for (const item of catalog) {
    const score = scoreCatalogMatch(
      terms,
      item.title,
      item.subtitle,
      item.valueText,
      item.keywords
    );
    if (score > 0) {
      scoredStatic.push({ ...item, score });
    }
  }

  // 6. Individual Event Rows (dynamic match across all events)
  const matchedEvents: GlobalSearchResultItem[] = [];
  if (terms.length > 0 || categoryFilter === 'event') {
    for (const ev of events) {
      const evTitle = `${ev.eventId} · ${ev.entityId}`;
      const evSubtitle = `Day ${ev.timestampDay} · ${ev.actionLabel} (${ev.channel}) · Spend $${ev.spendAmount.toFixed(2)} · Reward ${ev.reward.toFixed(2)}`;
      const evValue = `$${ev.spendAmount.toFixed(2)}`;
      const evKeywords = [
        'event',
        ev.eventId,
        ev.entityId,
        ev.actionLabel,
        ev.channel,
        `day ${ev.timestampDay}`,
      ];
      const score = scoreCatalogMatch(terms, evTitle, evSubtitle, evValue, evKeywords);
      if (score > 0) {
        matchedEvents.push({
          id: `event-row-${ev.eventId}`,
          category: 'event',
          title: evTitle,
          subtitle: evSubtitle,
          valueText: evValue,
          targetTab: 'data_explorer',
          targetLabel: 'Data Explorer',
          explorerQuery: ev.eventId,
          keywords: evKeywords,
          score: terms.length > 0 ? score : 1,
        });
      }
      if (terms.length === 0 && matchedEvents.length >= 12) break;
    }
    matchedEvents.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
  }

  const allScored = [...scoredStatic, ...matchedEvents.slice(0, 18)];

  const countsByCategory: Record<GlobalSearchCategory, number> = {
    metric: 0,
    config: 0,
    event: 0,
    dataset: 0,
    view: 0,
  };
  for (const item of allScored) {
    countsByCategory[item.category] += 1;
  }

  const filtered =
    categoryFilter === 'all'
      ? allScored
      : allScored.filter((item) => item.category === categoryFilter);

  const categoryPriority: Record<GlobalSearchCategory, number> = {
    metric: 5,
    config: 4,
    dataset: 3,
    view: 2,
    event: 1,
  };

  filtered.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return categoryPriority[b.category] - categoryPriority[a.category];
  });

  return {
    query,
    totalMatches: allScored.length,
    countsByCategory,
    items: filtered.slice(0, limit),
  };
}

export interface ExperimentConfigBundle {
  globalConfig: GlobalCurationConfig;
  regConfig: RegressionConfig;
  seqConfig: SequenceConfig;
  mdpConfig: MdpConfig;
}

function stripUndefinedEntries<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) {
      out[k] = Array.isArray(v) ? [...v] : v;
    }
  }
  return out as T;
}

export function cloneExperimentConfigs(
  bundle: ExperimentConfigBundle
): ExperimentConfigBundle {
  const allRegKeys = REGRESSION_FEATURE_CATALOG.map((f) => f.key);
  const selectedFeatures =
    bundle.regConfig.selectedFeatures && bundle.regConfig.selectedFeatures.length > 0
      ? [...bundle.regConfig.selectedFeatures]
      : allRegKeys;

  return {
    globalConfig: stripUndefinedEntries({ ...bundle.globalConfig }),
    regConfig: stripUndefinedEntries({
      ...bundle.regConfig,
      selectedFeatures,
      featureNormalization: bundle.regConfig.featureNormalization ?? 'none',
      batchSize: bundle.regConfig.batchSize ?? 32,
      klDriftThreshold: bundle.regConfig.klDriftThreshold ?? 0.25,
      outlierStdThreshold: bundle.regConfig.outlierStdThreshold ?? 2.5,
      excludeDetectedOutliers: bundle.regConfig.excludeDetectedOutliers ?? false,
    }),
    seqConfig: stripUndefinedEntries({
      ...bundle.seqConfig,
      batchSize: bundle.seqConfig.batchSize ?? 32,
      learningRate: bundle.seqConfig.learningRate ?? 0.001,
      transformerArch: bundle.seqConfig.transformerArch ?? 'transformer_encoder',
      dModel: bundle.seqConfig.dModel ?? 128,
      numHeads: bundle.seqConfig.numHeads ?? 4,
      numLayers: bundle.seqConfig.numLayers ?? 2,
      dropoutRate: bundle.seqConfig.dropoutRate ?? 0.1,
      positionalEncoding: bundle.seqConfig.positionalEncoding ?? 'time_delta',
      poolingMode: bundle.seqConfig.poolingMode ?? 'attention_pool',
    }),
    mdpConfig: stripUndefinedEntries({ ...bundle.mdpConfig }),
  };
}

export function formatTimestampedSnapshotName(
  datasetName: string,
  date: Date = new Date()
): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate()
  )} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  const cleanDs = datasetName.trim().slice(0, 82) || 'Workspace';
  return `Snapshot · ${cleanDs} · ${stamp}`.slice(0, 120);
}

export function summarizeSnapshotConfigDiff(
  snapshot: ExperimentConfigBundle,
  current: ExperimentConfigBundle
): { isIdentical: boolean; changedFields: string[] } {
  const changes: string[] = [];

  if (
    Math.abs(snapshot.globalConfig.trainRatio - current.globalConfig.trainRatio) > 1e-6 ||
    Math.abs(snapshot.globalConfig.valRatio - current.globalConfig.valRatio) > 1e-6 ||
    Math.abs(snapshot.globalConfig.testRatio - current.globalConfig.testRatio) > 1e-6
  ) {
    changes.push(
      `Splits ${Math.round(snapshot.globalConfig.trainRatio * 100)}/${Math.round(
        snapshot.globalConfig.valRatio * 100
      )}/${Math.round(snapshot.globalConfig.testRatio * 100)}`
    );
  }
  if (snapshot.globalConfig.seedSalt !== current.globalConfig.seedSalt) {
    changes.push(`Salt "${snapshot.globalConfig.seedSalt}"`);
  }

  if (snapshot.regConfig.obsCutoffDay !== current.regConfig.obsCutoffDay) {
    changes.push(`T_obs ${snapshot.regConfig.obsCutoffDay}d`);
  }
  if (snapshot.regConfig.horizonDays !== current.regConfig.horizonDays) {
    changes.push(`H ${snapshot.regConfig.horizonDays}d`);
  }
  if (snapshot.regConfig.winsorizePercentile !== current.regConfig.winsorizePercentile) {
    changes.push(`Winsor P${snapshot.regConfig.winsorizePercentile}`);
  }
  if (snapshot.regConfig.featureNormalization !== current.regConfig.featureNormalization) {
    changes.push(`Reg Norm ${snapshot.regConfig.featureNormalization}`);
  }
  if ((snapshot.regConfig.batchSize ?? 32) !== (current.regConfig.batchSize ?? 32)) {
    changes.push(`Reg Batch ${snapshot.regConfig.batchSize ?? 32}`);
  }
  const snapFeatures = [...(snapshot.regConfig.selectedFeatures ?? [])].sort().join(',');
  const curFeatures = [...(current.regConfig.selectedFeatures ?? [])].sort().join(',');
  if (snapFeatures !== curFeatures) {
    changes.push(`Features (${(snapshot.regConfig.selectedFeatures ?? []).length})`);
  }
  if (
    Math.abs((snapshot.regConfig.klDriftThreshold ?? 0.25) - (current.regConfig.klDriftThreshold ?? 0.25)) > 1e-6
  ) {
    changes.push(`KL ${(snapshot.regConfig.klDriftThreshold ?? 0.25).toFixed(2)}`);
  }

  if (snapshot.seqConfig.maxSeqLen !== current.seqConfig.maxSeqLen) {
    changes.push(`maxSeqLen ${snapshot.seqConfig.maxSeqLen}`);
  }
  if (snapshot.seqConfig.padding !== current.seqConfig.padding) {
    changes.push(`Pad ${snapshot.seqConfig.padding}`);
  }
  if (snapshot.seqConfig.truncation !== current.seqConfig.truncation) {
    changes.push(`Trunc ${snapshot.seqConfig.truncation}`);
  }
  if (snapshot.seqConfig.normalization !== current.seqConfig.normalization) {
    changes.push(`Seq Norm ${snapshot.seqConfig.normalization}`);
  }
  if (
    (snapshot.seqConfig.transformerArch ?? 'transformer_encoder') !==
    (current.seqConfig.transformerArch ?? 'transformer_encoder')
  ) {
    changes.push(`Arch ${snapshot.seqConfig.transformerArch ?? 'transformer_encoder'}`);
  }
  if (
    (snapshot.seqConfig.dModel ?? 128) !== (current.seqConfig.dModel ?? 128) ||
    (snapshot.seqConfig.numHeads ?? 4) !== (current.seqConfig.numHeads ?? 4) ||
    (snapshot.seqConfig.numLayers ?? 2) !== (current.seqConfig.numLayers ?? 2)
  ) {
    changes.push(
      `Transformer d=${snapshot.seqConfig.dModel ?? 128}/${snapshot.seqConfig.numLayers ?? 2}L`
    );
  }
  if (
    Math.abs((snapshot.seqConfig.learningRate ?? 0.001) - (current.seqConfig.learningRate ?? 0.001)) > 1e-8
  ) {
    changes.push(`LR ${snapshot.seqConfig.learningRate ?? 0.001}`);
  }

  if (Math.abs(snapshot.mdpConfig.gamma - current.mdpConfig.gamma) > 1e-6) {
    changes.push(`γ=${snapshot.mdpConfig.gamma}`);
  }
  if (snapshot.mdpConfig.rewardScale !== current.mdpConfig.rewardScale) {
    changes.push(`Reward ${snapshot.mdpConfig.rewardScale}`);
  }
  if (
    snapshot.mdpConfig.terminalInactivityGapDays !==
    current.mdpConfig.terminalInactivityGapDays
  ) {
    changes.push(`Gap ${snapshot.mdpConfig.terminalInactivityGapDays}d`);
  }
  if (snapshot.mdpConfig.minTrajectorySteps !== current.mdpConfig.minTrajectorySteps) {
    changes.push(`MinSteps ${snapshot.mdpConfig.minTrajectorySteps}`);
  }

  return {
    isIdentical: changes.length === 0,
    changedFields: changes,
  };
}

export function computeRetentionCohortAnalysis(
  events: RawEvent[],
  globalConfig: GlobalCurationConfig,
  options: {
    periodDays?: 14 | 30 | 60;
    splitFilter?: 'all' | SplitName;
    channelFilter?: string;
  } = {}
): RetentionCohortAnalysis {
  const periodDays = options.periodDays ?? 30;
  const splitFilter = options.splitFilter ?? 'all';
  const channelFilter = options.channelFilter ?? 'all';

  const availableChannels = Array.from(new Set(events.map((e) => e.channel))).sort((a, b) =>
    a.localeCompare(b)
  );

  // Filter events by split and channel
  const filteredEvents: RawEvent[] = [];
  for (const ev of events) {
    if (splitFilter !== 'all' && assignEntitySplit(ev.entityId, globalConfig) !== splitFilter) {
      continue;
    }
    if (channelFilter !== 'all' && ev.channel !== channelFilter) {
      continue;
    }
    filteredEvents.push(ev);
  }

  let maxObservedDay = 0;
  const entityEvents = new Map<string, RawEvent[]>();
  const entityFirstDay = new Map<string, number>();

  for (const ev of filteredEvents) {
    if (ev.timestampDay > maxObservedDay) maxObservedDay = ev.timestampDay;
    const list = entityEvents.get(ev.entityId);
    if (list) list.push(ev);
    else entityEvents.set(ev.entityId, [ev]);

    const prevFirst = entityFirstDay.get(ev.entityId);
    if (prevFirst === undefined || ev.timestampDay < prevFirst) {
      entityFirstDay.set(ev.entityId, ev.timestampDay);
    }
  }

  const maxPeriodIdx = Math.max(0, Math.floor(maxObservedDay / periodDays));
  const cohortEntities = new Map<number, string[]>();

  for (const [entityId, firstDay] of entityFirstDay.entries()) {
    const cIdx = Math.floor(Math.max(0, firstDay) / periodDays);
    const arr = cohortEntities.get(cIdx);
    if (arr) arr.push(entityId);
    else cohortEntities.set(cIdx, [entityId]);
  }

  const sortedCohortIndices = Array.from(cohortEntities.keys()).sort((a, b) => a - b);
  const cohorts: RetentionCohortRow[] = [];
  let maxOffsetPeriods = 0;

  for (const cIdx of sortedCohortIndices) {
    const members = cohortEntities.get(cIdx) ?? [];
    const cohortSize = members.length;
    if (cohortSize === 0) continue;

    const startDay = cIdx * periodDays;
    const endDay = startDay + periodDays - 1;
    const cohortLabel = `C${cIdx} (D${startDay}–${endDay})`;
    const windowRangeLabel = `Days ${startDay}–${endDay}`;
    const availableOffsets = Math.max(0, maxPeriodIdx - cIdx);
    if (availableOffsets + 1 > maxOffsetPeriods) {
      maxOffsetPeriods = availableOffsets + 1;
    }

    const activeByOffset = new Map<number, Set<string>>();
    const spendByOffset = new Map<number, number>();
    const countByOffset = new Map<number, number>();
    let cumulativeSpend = 0;

    for (const entityId of members) {
      const evs = entityEvents.get(entityId) ?? [];
      for (const ev of evs) {
        const evPeriodIdx = Math.floor(Math.max(0, ev.timestampDay) / periodDays);
        const offset = evPeriodIdx - cIdx;
        if (offset < 0 || offset > availableOffsets) continue;
        const activeSet = activeByOffset.get(offset) ?? new Set<string>();
        activeSet.add(entityId);
        activeByOffset.set(offset, activeSet);

        spendByOffset.set(offset, (spendByOffset.get(offset) ?? 0) + ev.spendAmount);
        countByOffset.set(offset, (countByOffset.get(offset) ?? 0) + 1);
        cumulativeSpend += ev.spendAmount;
      }
    }

    const cells: RetentionCohortCell[] = [];
    for (let offset = 0; offset <= availableOffsets; offset++) {
      const activeEntities = activeByOffset.get(offset)?.size ?? 0;
      const totalSpend = spendByOffset.get(offset) ?? 0;
      const totalEventsInPeriod = countByOffset.get(offset) ?? 0;
      cells.push({
        cohortIndex: cIdx,
        cohortLabel,
        offsetPeriod: offset,
        offsetLabel: offset === 0 ? 'P0 (Start)' : `+${offset}P (+${offset * periodDays}d)`,
        activeEntities,
        cohortSize,
        retentionPct: (activeEntities / cohortSize) * 100,
        totalSpend,
        totalEvents: totalEventsInPeriod,
        revenuePerUser: totalSpend / cohortSize,
        eventsPerUser: totalEventsInPeriod / cohortSize,
      });
    }

    cohorts.push({
      cohortIndex: cIdx,
      cohortLabel,
      windowRangeLabel,
      startDay,
      endDay,
      cohortSize,
      cumulativeSpend,
      arpu: cumulativeSpend / cohortSize,
      cells,
    });
  }

  // Compute weighted retention curve per offset period
  const periodCurve: RetentionPeriodSummary[] = [];
  for (let offset = 0; offset < maxOffsetPeriods; offset++) {
    let eligibleCohorts = 0;
    let eligibleEntities = 0;
    let retainedEntities = 0;
    let totalSpend = 0;
    let totalEv = 0;
    let minPct = 100;
    let maxPct = 0;

    for (const c of cohorts) {
      const cell = c.cells[offset];
      if (!cell) continue;
      eligibleCohorts += 1;
      eligibleEntities += cell.cohortSize;
      retainedEntities += cell.activeEntities;
      totalSpend += cell.totalSpend;
      totalEv += cell.totalEvents;
      if (cell.retentionPct < minPct) minPct = cell.retentionPct;
      if (cell.retentionPct > maxPct) maxPct = cell.retentionPct;
    }

    if (eligibleEntities === 0) continue;
    periodCurve.push({
      offsetPeriod: offset,
      offsetLabel: offset === 0 ? 'P0' : `+${offset}P`,
      eligibleCohorts,
      eligibleEntities,
      retainedEntities,
      weightedRetentionPct: (retainedEntities / eligibleEntities) * 100,
      minCohortRetentionPct: minPct,
      maxCohortRetentionPct: maxPct,
      weightedRevenuePerUser: totalSpend / eligibleEntities,
      weightedEventsPerUser: totalEv / eligibleEntities,
    });
  }

  const p1 = periodCurve.find((p) => p.offsetPeriod === 1)?.weightedRetentionPct ?? null;
  const p3 = periodCurve.find((p) => p.offsetPeriod === 3)?.weightedRetentionPct ?? null;

  // Linearly interpolate 50% retention half-life in periods
  let halfLifePeriod: number | null = null;
  for (let i = 1; i < periodCurve.length; i++) {
    const prev = periodCurve[i - 1];
    const curr = periodCurve[i];
    if (prev.weightedRetentionPct >= 50 && curr.weightedRetentionPct < 50) {
      const span = prev.weightedRetentionPct - curr.weightedRetentionPct;
      const frac = span > 1e-6 ? (prev.weightedRetentionPct - 50) / span : 0;
      halfLifePeriod = Math.round((prev.offsetPeriod + frac) * 100) / 100;
      break;
    }
  }

  const p1Cohorts = cohorts
    .filter((c) => c.cells.length > 1)
    .map((c) => ({
      label: c.cohortLabel,
      retentionPct: c.cells[1].retentionPct,
      cohortSize: c.cohortSize,
    }))
    .sort((a, b) => b.retentionPct - a.retentionPct);

  return {
    periodDays,
    splitFilter,
    channelFilter,
    availableChannels,
    totalEntities: entityEvents.size,
    totalEvents: filteredEvents.length,
    maxObservedDay,
    maxOffsetPeriods,
    period1RetentionPct: p1,
    period3RetentionPct: p3,
    halfLifePeriod,
    bestPeriod1Cohort: p1Cohorts[0] ?? null,
    worstPeriod1Cohort: p1Cohorts.length > 0 ? p1Cohorts[p1Cohorts.length - 1] : null,
    cohorts,
    periodCurve,
  };
}

export const SNAPSHOT_COMPARISON_METRIC_DEFS: SnapshotComparisonMetricDef[] = [
  {
    key: 'regRSquared',
    group: 'Regression',
    label: 'Regression R²',
    higherIsBetter: true,
    unit: 'ratio',
    tolerance: 0.0005,
  },
  {
    key: 'regRmse',
    group: 'Regression',
    label: 'Regression RMSE',
    higherIsBetter: false,
    unit: 'currency',
    tolerance: 0.05,
  },
  {
    key: 'meanProjectedLtv',
    group: 'Regression',
    label: 'Mean Projected LTV',
    higherIsBetter: true,
    unit: 'currency',
    tolerance: 0.25,
  },
  {
    key: 'maxKlDivergence',
    group: 'Regression',
    label: 'Max Feature KL Drift',
    higherIsBetter: false,
    unit: 'nats',
    tolerance: 0.002,
  },
  {
    key: 'outlierCount',
    group: 'Regression',
    label: 'Detected LTV Outliers',
    higherIsBetter: false,
    unit: 'count',
    tolerance: 0,
  },
  {
    key: 'seqHoldoutR2',
    group: 'Sequence',
    label: 'Transformer Holdout R²',
    higherIsBetter: true,
    unit: 'ratio',
    tolerance: 0.0005,
  },
  {
    key: 'valLoss',
    group: 'Sequence',
    label: 'Validation Loss',
    higherIsBetter: false,
    unit: 'loss',
    tolerance: 0.0005,
  },
  {
    key: 'trainLoss',
    group: 'Sequence',
    label: 'Train Loss',
    higherIsBetter: false,
    unit: 'loss',
    tolerance: 0.0005,
  },
  {
    key: 'paddingSparsityPct',
    group: 'Sequence',
    label: 'Padding Sparsity',
    higherIsBetter: false,
    unit: 'percent',
    tolerance: 0.1,
  },
  {
    key: 'mdpTransitions',
    group: 'Offline RL',
    label: 'MDP Transitions',
    higherIsBetter: true,
    unit: 'count',
    tolerance: 0,
  },
  {
    key: 'mdpInitialReturn',
    group: 'Offline RL',
    label: 'Mean Initial Return',
    higherIsBetter: true,
    unit: 'reward',
    tolerance: 0.05,
  },
  {
    key: 'mdpOodRatePct',
    group: 'Offline RL',
    label: 'Low-Support OOD Rate',
    higherIsBetter: false,
    unit: 'percent',
    tolerance: 0.1,
  },
];

export interface SnapshotComparisonInputRecord {
  workspaceId: string;
  name: string;
  presetId: string;
  datasetName: string;
  timestampLabel: string;
  notes?: string;
  isLiveActive?: boolean;
  globalConfig: GlobalCurationConfig;
  regConfig: RegressionConfig;
  seqConfig: SequenceConfig;
  mdpConfig: MdpConfig;
}

function formatMetricDeltaText(
  delta: number,
  def: SnapshotComparisonMetricDef
): string {
  const sign = delta > 0 ? '+' : '';
  if (def.unit === 'currency') return `${sign}$${delta.toFixed(2)}`;
  if (def.unit === 'percent') return `${sign}${delta.toFixed(1)}%`;
  if (def.unit === 'count') return `${sign}${Math.round(delta)}`;
  if (def.unit === 'nats') return `${sign}${delta.toFixed(3)} nats`;
  if (def.unit === 'reward') return `${sign}${delta.toFixed(2)}`;
  return `${sign}${delta.toFixed(4)}`;
}

export function evaluateSnapshotComparison(
  records: SnapshotComparisonInputRecord[],
  baselineId: string,
  presets: DatasetPreset[],
  fallbackEvents: RawEvent[]
): SnapshotComparisonReport {
  if (records.length === 0) {
    return {
      baselineId: '',
      baselineName: 'None',
      snapshots: [],
      metricDefs: SNAPSHOT_COMPARISON_METRIC_DEFS,
      topImprovement: null,
      topDrift: null,
    };
  }

  const presetMap = new Map<string, DatasetPreset>();
  for (const p of presets) presetMap.set(p.id, p);

  const rawEvaluated = records.map((rec) => {
    const normalized = cloneExperimentConfigs({
      globalConfig: rec.globalConfig,
      regConfig: rec.regConfig,
      seqConfig: rec.seqConfig,
      mdpConfig: rec.mdpConfig,
    });
    const sourceEvents =
      rec.presetId !== 'custom_csv' && presetMap.has(rec.presetId)
        ? presetMap.get(rec.presetId)!.events
        : fallbackEvents;

    const reg = buildRegressionDataset(
      sourceEvents,
      normalized.regConfig,
      normalized.globalConfig
    );
    const seq = buildSequenceDataset(
      sourceEvents,
      normalized.seqConfig,
      normalized.globalConfig
    );
    const mdp = buildMdpDataset(
      sourceEvents,
      normalized.mdpConfig,
      normalized.globalConfig
    );

    const seqHoldoutR2 =
      seq.transformerEval.holdoutMetrics.rSquared ??
      seq.transformerEval.allMetrics.rSquared ??
      null;
    const valLoss =
      seq.transformerEval.lossCurve.bestValLoss ??
      seq.transformerEval.lossCurve.finalValLoss ??
      null;

    return {
      rec,
      normalized,
      metrics: {
        regRows: reg.rows.length,
        regRSquared: Math.round(reg.linearFit.rSquared * 10000) / 10000,
        regRmse: Math.round(reg.linearFit.rmse * 100) / 100,
        meanProjectedLtv: Math.round(reg.linearFit.meanProjectedLtv * 100) / 100,
        maxKlDivergence: Math.round(reg.driftReport.maxKlDivergence * 1000) / 1000,
        outlierCount: reg.anomalyReport.outlierCount,
        tensorShapeLabel: `[${seq.tensorShape.join(', ')}]`,
        seqHoldoutR2:
          seqHoldoutR2 !== null ? Math.round(seqHoldoutR2 * 10000) / 10000 : null,
        valLoss: valLoss !== null ? Math.round(valLoss * 10000) / 10000 : null,
        trainLoss:
          Math.round(seq.transformerEval.lossCurve.finalTrainLoss * 10000) / 10000,
        paddingSparsityPct: Math.round(seq.paddingSparsity * 1000) / 10,
        mdpTransitions: mdp.transitions.length,
        mdpInitialReturn: Math.round(mdp.meanInitialReturn * 100) / 100,
        mdpOodRatePct: Math.round(mdp.lowSupportOodRate * 1000) / 10,
      },
    };
  });

  const baselineEntry =
    rawEvaluated.find((e) => e.rec.workspaceId === baselineId) ?? rawEvaluated[0];

  let bestImprovementScore = 0;
  let topImprovement: SnapshotComparisonReport['topImprovement'] = null;
  let worstDriftScore = 0;
  let topDrift: SnapshotComparisonReport['topDrift'] = null;

  const snapshots: SnapshotComparisonEvaluated[] = rawEvaluated.map((entry) => {
    const deltasFromBaseline = {} as Record<
      SnapshotComparisonMetricKey,
      SnapshotComparisonMetricDelta
    >;
    const isBaseline = entry.rec.workspaceId === baselineEntry.rec.workspaceId;

    for (const def of SNAPSHOT_COMPARISON_METRIC_DEFS) {
      const curVal = entry.metrics[def.key];
      const baseVal = baselineEntry.metrics[def.key];
      if (isBaseline || curVal === null || baseVal === null) {
        deltasFromBaseline[def.key] = {
          delta: isBaseline ? 0 : null,
          polarity: 'neutral',
        };
        continue;
      }

      const delta = curVal - baseVal;
      if (Math.abs(delta) <= def.tolerance) {
        deltasFromBaseline[def.key] = { delta: 0, polarity: 'neutral' };
        continue;
      }

      const improved = def.higherIsBetter ? delta > 0 : delta < 0;
      const polarity: SnapshotDeltaPolarity = improved ? 'improvement' : 'drift';
      deltasFromBaseline[def.key] = { delta, polarity };

      const normMag =
        Math.abs(baseVal) > 1e-6
          ? Math.abs(delta) / Math.abs(baseVal)
          : Math.abs(delta);
      if (improved && normMag > bestImprovementScore) {
        bestImprovementScore = normMag;
        topImprovement = {
          snapshotName: entry.rec.name,
          metricLabel: def.label,
          deltaText: formatMetricDeltaText(delta, def),
        };
      } else if (!improved && normMag > worstDriftScore) {
        worstDriftScore = normMag;
        topDrift = {
          snapshotName: entry.rec.name,
          metricLabel: def.label,
          deltaText: formatMetricDeltaText(delta, def),
        };
      }
    }

    const diff = summarizeSnapshotConfigDiff(entry.normalized, baselineEntry.normalized);

    return {
      workspaceId: entry.rec.workspaceId,
      name: entry.rec.name,
      presetId: entry.rec.presetId,
      datasetName: entry.rec.datasetName,
      timestampLabel: entry.rec.timestampLabel,
      notes: entry.rec.notes,
      isLiveActive: Boolean(entry.rec.isLiveActive),
      globalConfig: entry.normalized.globalConfig,
      regConfig: entry.normalized.regConfig,
      seqConfig: entry.normalized.seqConfig,
      mdpConfig: entry.normalized.mdpConfig,
      metrics: entry.metrics,
      deltasFromBaseline,
      configDiffsFromBaseline: diff.changedFields,
    };
  });

  return {
    baselineId: baselineEntry.rec.workspaceId,
    baselineName: baselineEntry.rec.name,
    snapshots,
    metricDefs: SNAPSHOT_COMPARISON_METRIC_DEFS,
    topImprovement,
    topDrift,
  };
}






