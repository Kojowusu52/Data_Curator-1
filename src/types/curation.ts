export type SplitName = 'train' | 'val' | 'test';

export type WorkspaceTab =
  | 'overview'
  | 'regression'
  | 'model_comparison'
  | 'sequence'
  | 'hyperparameter_optimizer'
  | 'offline_rl'
  | 'retention_cohorts'
  | 'snapshot_comparison'
  | 'data_explorer'
  | 'dataset_search'
  | 'auto_docs'
  | 'ai_curator'
  | 'nl_query'
  | 'rul_timeseries'
  | 'feature_engineering'
  | 'governance_repository'
  | 'audit_export';

export interface RawEvent {
  eventId: string;
  entityId: string;
  timestampDay: number;
  actionId: number;
  actionLabel: string;
  channel: string;
  recencyDays: number;
  frequencyCount: number;
  spendAmount: number;
  engagementScore: number;
  reward: number;
  propensity: number;
}

export interface DatasetPreset {
  id: string;
  name: string;
  domain: string;
  description: string;
  actionSpace: { id: number; label: string }[];
  horizonTotalDays: number;
  defaultObsCutoffDay: number;
  defaultHorizonDays: number;
  events: RawEvent[];
}

export interface GlobalCurationConfig {
  trainRatio: number;
  valRatio: number;
  testRatio: number;
  seedSalt: string;
}

export type RegressionNormalizationMode = 'none' | 'zscore' | 'minmax';
export type RegressionFeatureKey = keyof RegressionFeatureValues;

export interface RegressionConfig {
  obsCutoffDay: number;
  horizonDays: number;
  winsorizePercentile: 0 | 95 | 99;
  excludeZeroObsEntities: boolean;
  featureNormalization: RegressionNormalizationMode;
  selectedFeatures: RegressionFeatureKey[];
  batchSize: number;
  splitFilter: 'all' | SplitName;
  klDriftThreshold?: number;
  outlierStdThreshold?: number;
  excludeDetectedOutliers?: boolean;
}

export interface RegressionFeatureValues {
  recencyAtCutoff: number;
  txCountObs: number;
  monetarySumObs: number;
  avgOrderValueObs: number;
  meanEngagementObs: number;
  promoShareObs: number;
  tenureDaysObs: number;
}

export interface RegressionRow extends RegressionFeatureValues {
  entityId: string;
  split: SplitName;
  batchId: number;
  scaledFeatures: RegressionFeatureValues;
  targetLtvRaw: number;
  targetLtvWinsorized: number;
  predictedHorizonLtv: number;
  currentObservedLtv: number;
  projectedFutureLtv: number;
  trailingTxCount: number;
  horizonEventsCount: number;
  leakageVerified: boolean;
}

export interface FeatureCorrelation {
  feature: string;
  label: string;
  pearsonR: number;
  mean: number;
  std: number;
}

export interface MatrixFeatureDef {
  key: keyof RegressionRow;
  label: string;
  shortLabel: string;
}

export interface HighCollinearityPair {
  featureA: string;
  labelA: string;
  featureB: string;
  labelB: string;
  pearsonR: number;
  vifEstimate: number;
}

export interface FeatureCorrelationMatrix {
  features: MatrixFeatureDef[];
  matrix: number[][];
  highCollinearityPairs: HighCollinearityPair[];
}

export interface LinearFeatureImportance {
  feature: string;
  label: string;
  standardizedBeta: number;
  importanceShare: number;
  rawCoefficient: number;
  univariateR2: number;
  direction: 'positive' | 'negative' | 'neutral';
}

export interface LinearFitSummary {
  rSquared: number;
  rmse: number;
  mae: number;
  mape: number | null;
  mapeSampleCount: number;
  standardError: number;
  meanProjectedLtv: number;
  meanLtvSe: number;
  ci95Lower: number;
  ci95Upper: number;
  pi95HalfWidth: number;
  intercept: number;
  sampleSize: number;
  features: LinearFeatureImportance[];
}

export interface HistogramBin {
  label: string;
  min: number;
  max: number;
  count: number;
}

export interface RegressionScalerStat {
  feature: keyof RegressionFeatureValues;
  label: string;
  mean: number;
  std: number;
  min: number;
  max: number;
}

export interface TargetDataQualityIssue {
  code: 'high_skew' | 'moderate_skew' | 'high_sparsity' | 'moderate_sparsity' | 'low_sample' | 'flat_variance';
  severity: 'warn' | 'critical';
  title: string;
  detail: string;
}

export interface TargetDataQualityReport {
  score: number; // 0 to 100
  tier: 'healthy' | 'caution' | 'critical';
  sampleSize: number;
  zeroCount: number;
  zeroRate: number;
  rawSkewness: number;
  winsorizedSkewness: number;
  excessKurtosis: number;
  meanRaw: number;
  medianRaw: number;
  p95Raw: number;
  p99Raw: number;
  p99ToMedianRatio: number | null;
  issues: TargetDataQualityIssue[];
}

export interface EcdfCurvePoint {
  x: number;
  trainCdf: number;
  valCdf: number;
}

export interface KlDistributionBin {
  binLabel: string;
  binMin: number;
  binMax: number;
  trainProb: number;
  valProb: number;
  klContribution: number;
}

export interface FeatureDriftMetric {
  feature: RegressionFeatureKey;
  csvColumn: string;
  label: string;
  shortLabel: string;
  ksStatistic: number;
  pValue: number;
  maxGapX: number;
  klDivergence: number;
  jsDivergence: number;
  klExceedsThreshold: boolean;
  klBins: KlDistributionBin[];
  trainMean: number;
  valMean: number;
  trainStd: number;
  valStd: number;
  status: 'stable' | 'moderate' | 'significant';
  ecdfCurve: EcdfCurvePoint[];
}

export interface ModelDriftReport {
  tier: 'aligned' | 'watch' | 'drift_detected';
  trainCount: number;
  valCount: number;
  alpha: number;
  klThreshold: number;
  maxKsStatistic: number;
  minPValue: number;
  maxKlDivergence: number;
  meanKlDivergence: number;
  klFlaggedCount: number;
  klExceedsThreshold: boolean;
  significantCount: number;
  moderateCount: number;
  features: FeatureDriftMetric[];
}

export interface SplitEvaluationMetrics {
  split: 'train' | 'val' | 'test' | 'all';
  label: string;
  sampleSize: number;
  rSquared: number | null;
  rmse: number;
  mae: number;
  mape: number | null;
  mapeSampleCount: number;
  residualStdError: number;
  standardError: number;
  ci95Lower: number;
  ci95Upper: number;
  pi95HalfWidth: number;
  bias: number;
  calibrationRatio: number | null;
  meanActual: number;
  meanPredicted: number;
}

export interface TierConfusionCell {
  actualTier: number;
  predictedTier: number;
  count: number;
  rowShare: number;
}

export interface ModelEvaluationMatrixData {
  trainedOnSplit: 'train' | 'filtered';
  trainSampleCount: number;
  splitMetrics: SplitEvaluationMetrics[];
  overfitDeltaR2: number | null;
  forwardProjectionMean: number;
  forwardProjectionSe: number;
  forwardProjectionCi95Lower: number;
  forwardProjectionCi95Upper: number;
  residualStdError: number;
  pi95HalfWidth: number;
  tierLabels: string[];
  tierThresholds: [number, number, number];
  tierMatrixAll: TierConfusionCell[][];
  tierMatrixHoldout: TierConfusionCell[][];
  exactTierAccuracyAll: number;
  withinOneTierAccuracyAll: number;
  exactTierAccuracyHoldout: number | null;
  withinOneTierAccuracyHoldout: number | null;
  holdoutCount: number;
}

export interface LtvAnomalyEntity {
  entityId: string;
  split: SplitName;
  targetLtvRaw: number;
  targetLtvWinsorized: number;
  currentObservedLtv: number;
  monetarySumObs: number;
  txCountObs: number;
  zScore: number;
  direction: 'high_tail' | 'low_tail';
  excludedFromTraining: boolean;
}

export interface LtvTrendPoint {
  day: number;
  label: string;
  activeCohortCount: number;
  meanCumulativeLtv: number;
  stdCumulativeLtv: number;
  upperThresholdLtv: number;
  lowerThresholdLtv: number;
  outlierMeanLtv: number | null;
  outlierCount: number;
  topOutlierEntityId: string | null;
  topOutlierLtv: number | null;
}

export interface LtvAnomalyReport {
  stdThreshold: number;
  excludeEnabled: boolean;
  totalEvaluatedCount: number;
  trainBaselineCount: number;
  meanTargetLtv: number;
  stdTargetLtv: number;
  upperBound: number;
  lowerBound: number;
  outlierCount: number;
  trainOutlierCount: number;
  excludedFromTrainCount: number;
  outlierRate: number;
  outlierEntityIds: string[];
  outlierEntities: LtvAnomalyEntity[];
  trendSeries: LtvTrendPoint[];
}

export type TrendProjectionWindow = 'full' | 'recent_half';

export interface LtvTrendProjectionPoint {
  day: number;
  label: string;
  isForecast: boolean;
  observedLtv: number | null;
  trendFitLtv: number | null;
  projectedLtv: number | null;
  ciLower: number | null;
  ciUpper: number | null;
  ciBase: number | null;
  ciSpan: number | null;
  observedCohortLtv: number | null;
  projectedCohortLtv: number | null;
  cohortCiLower: number | null;
  cohortCiUpper: number | null;
}

export interface LtvTrendProjectionReport {
  fitWindow: TrendProjectionWindow;
  confidenceLevel: 90 | 95 | 99;
  cohortSize: number;
  historicalEndDay: number;
  forecastEndDay: number;
  currentMeanLtv: number;
  projected90dMeanLtv: number;
  projected90dLiftUsd: number;
  projected90dLiftPct: number;
  ciLower90d: number;
  ciUpper90d: number;
  slopePerDay: number;
  intercept: number;
  fitR2: number;
  residualStdError: number;
  points: LtvTrendProjectionPoint[];
}

export interface RegressionResult {
  rows: RegressionRow[];
  totalEntitiesBeforeFilter: number;
  maxObservedDay: number;
  meanTargetRaw: number;
  meanTargetWinsorized: number;
  winsorCapValue: number;
  zeroTargetRate: number;
  baselineR2Estimate: number;
  correlations: FeatureCorrelation[];
  featureMatrix: FeatureCorrelationMatrix;
  linearFit: LinearFitSummary;
  featureScalerStats: RegressionScalerStat[];
  targetHistogram: HistogramBin[];
  targetQuality: TargetDataQualityReport;
  driftReport: ModelDriftReport;
  evaluationMatrix: ModelEvaluationMatrixData;
  anomalyReport: LtvAnomalyReport;
  splitCounts: Record<SplitName, number>;
  batchSize: number;
  batchCount: number;
  splitBatchCounts: Record<SplitName, number>;
}

export interface CutoffSensitivityPoint {
  obsCutoffDay: number;
  horizonEndDay: number;
  rSquared: number;
  holdoutR2: number | null;
  rmse: number;
  sampleSize: number;
  zeroTargetRate: number;
  isHorizonCensored: boolean;
}

export type PaddingStrategy = 'pre' | 'post';
export type TruncationStrategy = 'recent' | 'early';
export type NormalizationMode = 'zscore' | 'minmax' | 'log1p_zscore';

export type TransformerArchitectureId =
  | 'transformer_encoder'
  | 'causal_gpt'
  | 'temporal_fusion';

export type TransformerPositionalEncoding =
  | 'sinusoidal'
  | 'rotary_rope'
  | 'time_delta';

export type TransformerPoolingMode =
  | 'attention_pool'
  | 'cls_mean'
  | 'last_token';

export interface SequenceConfig {
  maxSeqLen: number;
  padding: PaddingStrategy;
  truncation: TruncationStrategy;
  normalization: NormalizationMode;
  minSeqLen: number;
  obsCutoffDay: number;
  batchSize: number;
  splitFilter: 'all' | SplitName;
  transformerArch?: TransformerArchitectureId;
  dModel?: 64 | 128 | 256;
  numHeads?: 2 | 4 | 8;
  numLayers?: 1 | 2 | 4;
  dropoutRate?: number;
  learningRate?: number;
  positionalEncoding?: TransformerPositionalEncoding;
  poolingMode?: TransformerPoolingMode;
}

export interface SequenceStep {
  stepIndex: number;
  mask: 0 | 1;
  timestampDay: number | null;
  deltaDays: number;
  actionId: number;
  actionLabel: string;
  rawFeatures: [number, number, number, number]; // [spend, engagement, frequency, recency]
  normalizedFeatures: [number, number, number, number];
  stepReward: number;
}

export interface SequenceTensorSample {
  entityId: string;
  split: SplitName;
  batchId: number;
  actualLen: number;
  truncatedCount: number;
  padCount: number;
  horizonTargetLtv: number;
  nextActionId: number;
  steps: SequenceStep[];
}

export interface TransformerEntityPrediction {
  entityId: string;
  split: SplitName;
  actualLtv: number;
  predictedLtv: number;
  residual: number;
  attentionEntropy: number;
  peakAttentionStep: number;
  stepWeights: number[];
}

export interface TransformerModelBenchmarkRow {
  modelId: 'ols_linear' | 'gru_seq' | TransformerArchitectureId;
  modelName: string;
  family: 'Linear Baseline' | 'Recurrent Baseline' | 'Transformer';
  isActive: boolean;
  paramCount: number;
  rSquaredAll: number | null;
  rSquaredHoldout: number | null;
  rmseAll: number;
  rmseHoldout: number | null;
  maeAll: number;
  maeHoldout: number | null;
  mapeHoldout: number | null;
  standardError: number;
  ci95Lower: number;
  ci95Upper: number;
  meanAttentionEntropy: number | null;
}

export type LossFitDiagnosis =
  | 'good_fit'
  | 'overfitting'
  | 'underfitting'
  | 'insufficient_data';

export interface TransformerLossEpochPoint {
  epoch: number;
  trainLoss: number;
  valLoss: number | null;
  trainRmse: number;
  valRmse: number | null;
  generalizationGap: number | null;
}

export interface TransformerLossCurveSummary {
  epochs: number;
  points: TransformerLossEpochPoint[];
  diagnosis: LossFitDiagnosis;
  diagnosisLabel: string;
  diagnosisDetail: string;
  bestEpoch: number;
  bestValLoss: number | null;
  finalTrainLoss: number;
  finalValLoss: number | null;
  finalTrainRmse: number;
  finalValRmse: number | null;
  generalizationGap: number | null;
  valReboundDelta: number | null;
  paramToSampleRatio: number;
  trainSampleCount: number;
  evalSampleCount: number;
  evalSplitLabel: 'Validation' | 'Holdout (Val+Test)';
}

export interface TransformerEvaluationSummary {
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
  estimatedParams: number;
  tokensPerBatch: number;
  attentionMaskCoverage: number;
  meanAttentionEntropy: number;
  trainMetrics: SplitEvaluationMetrics;
  valMetrics: SplitEvaluationMetrics;
  testMetrics: SplitEvaluationMetrics;
  holdoutMetrics: SplitEvaluationMetrics;
  allMetrics: SplitEvaluationMetrics;
  overfitDeltaR2: number | null;
  lossCurve: TransformerLossCurveSummary;
  benchmarks: TransformerModelBenchmarkRow[];
  predictionsByEntity: Record<string, TransformerEntityPrediction>;
}

export interface SequenceResult {
  samples: SequenceTensorSample[];
  tensorShape: [number, number, number];
  featureNames: string[];
  paddingSparsity: number;
  meanActualLength: number;
  truncatedEntitiesCount: number;
  lengthHistogram: HistogramBin[];
  featureStats: { name: string; mean: number; std: number; min: number; max: number }[];
  splitCounts: Record<SplitName, number>;
  batchSize: number;
  batchCount: number;
  splitBatchCounts: Record<SplitName, number>;
  transformerEval: TransformerEvaluationSummary;
}

export type RewardScaleMode = 'raw' | 'clipped_10' | 'standardized';

export interface MdpConfig {
  gamma: number;
  terminalInactivityGapDays: number;
  rewardScale: RewardScaleMode;
  minTrajectorySteps: number;
  includeAbsorbingStep: boolean;
  splitFilter: 'all' | SplitName;
}

export interface StateVector {
  recencyDays: number;
  frequencyCount: number;
  cumSpend: number;
  engagementScore: number;
}

export interface MdpTransition {
  transitionId: string;
  entityId: string;
  split: SplitName;
  stepIdx: number;
  timestampDay: number;
  state: StateVector;
  actionId: number;
  actionLabel: string;
  rewardRaw: number;
  rewardScaled: number;
  nextState: StateVector;
  done: 0 | 1;
  terminalReason: 'none' | 'inactivity_gap' | 'horizon_end' | 'absorbing';
  returnToGo: number;
  behaviorPropensity: number;
  supportCount: number;
  isLowSupportOod: boolean;
}

export interface ActionBreakdown {
  actionId: number;
  actionLabel: string;
  count: number;
  share: number;
  meanReward: number;
  meanReturnToGo: number;
  lowSupportCount: number;
}

export interface MdpResult {
  transitions: MdpTransition[];
  trajectoryCount: number;
  terminalCount: number;
  meanTrajectoryLength: number;
  meanInitialReturn: number;
  lowSupportOodRate: number;
  rewardMean: number;
  rewardStd: number;
  actionBreakdown: ActionBreakdown[];
  splitCounts: Record<SplitName, number>;
}

export interface AuditCheck {
  id: string;
  name: string;
  paradigm: 'Global' | 'Regression' | 'Sequence' | 'Offline RL';
  status: 'pass' | 'warn' | 'fail';
  metricValue: string;
  detail: string;
}

export type PipelineValidationStatus = 'ready' | 'warn' | 'blocked';

export interface PipelineSchemaCheck {
  paradigm: 'Regression' | 'Sequence' | 'Offline RL';
  status: PipelineValidationStatus;
  missingCritical: string[];
  missingRecommended: string[];
  summary: string;
}

export interface SchemaValidationReport {
  overallStatus: PipelineValidationStatus;
  detectedFields: string[];
  missingFields: string[];
  totalRowsParsed: number;
  entityCount: number;
  pipelines: PipelineSchemaCheck[];
  warnings: string[];
}

export type PiiMaskingMode = 'hash' | 'redact';

export interface PiiMaskingConfig {
  enabled: boolean;
  mode: PiiMaskingMode;
  salt: string;
}

export type DataHealthStatus = 'pass' | 'warn' | 'fail';
export type DataHealthTier = 'healthy' | 'caution' | 'critical';

export interface DataHealthCheckItem {
  id:
    | 'negative_rewards'
    | 'duplicate_records'
    | 'timestamp_distribution'
    | 'numeric_bounds'
    | 'propensity_support'
    | 'identifier_completeness';
  label: string;
  category:
    | 'Reward Integrity'
    | 'Uniqueness'
    | 'Temporal Distribution'
    | 'Value Bounds'
    | 'Policy Support'
    | 'Schema';
  status: DataHealthStatus;
  affectedCount: number;
  affectedRate: number;
  scoreDeduction: number;
  metricSummary: string;
  thresholdRule: string;
  detail: string;
  sampleEntities: string[];
}

export interface TimestampBucketStat {
  label: string;
  startDay: number;
  endDay: number;
  count: number;
  share: number;
}

export interface DataHealthScorecard {
  score: number;
  tier: DataHealthTier;
  tierLabel: string;
  totalEvents: number;
  uniqueEntities: number;
  passCount: number;
  warnCount: number;
  failCount: number;
  timestampMin: number;
  timestampMax: number;
  timestampBinCv: number;
  maxSingleDayShare: number;
  timestampBuckets: TimestampBucketStat[];
  checks: DataHealthCheckItem[];
}

export type OptimizationObjective =
  | 'min_val_loss'
  | 'balanced_generalization'
  | 'fast_convergence';

export interface HyperparameterTrialResult {
  trialId: string;
  rank: number;
  architecture: TransformerArchitectureId;
  architectureLabel: string;
  batchSize: number;
  learningRate: number;
  dModel: 64 | 128 | 256;
  numHeads: 2 | 4 | 8;
  numLayers: 1 | 2 | 4;
  depthLabel: string;
  dropoutRate: number;
  estimatedParams: number;
  bestEpoch: number;
  bestValLoss: number | null;
  finalTrainLoss: number;
  finalValLoss: number | null;
  finalTrainRmse: number;
  finalValRmse: number | null;
  generalizationGap: number | null;
  valReboundDelta: number | null;
  diagnosis: LossFitDiagnosis;
  diagnosisLabel: string;
  compositeScore: number;
  isCurrentConfig: boolean;
  lossCurve: TransformerLossCurveSummary;
}

export interface HyperparameterSearchReport {
  objective: OptimizationObjective;
  architecture: TransformerArchitectureId;
  architectureLabel: string;
  trainSampleCount: number;
  evalSampleCount: number;
  evalSplitLabel: 'Validation' | 'Holdout (Val+Test)';
  currentTrial: HyperparameterTrialResult;
  recommendedTrial: HyperparameterTrialResult;
  trials: HyperparameterTrialResult[];
  rationale: {
    batchSizeReason: string;
    learningRateReason: string;
    depthReason: string;
  };
}

export type HardwareProfileId =
  | 'cpu_avx512'
  | 'nvidia_t4'
  | 'nvidia_a10g'
  | 'nvidia_a100'
  | 'nvidia_h100';

export type TrainingPrecision = 'fp32' | 'bf16_amp' | 'fp16_mixed';

export type AttentionExecutionMode = 'dense_padded' | 'flash_unpadded';

export interface HardwareAcceleratorProfile {
  id: HardwareProfileId;
  label: string;
  shortLabel: string;
  memoryGb: number;
  fp32Tflops: number;
  tensorTflops: number;
  memBandwidthGbps: number;
  pcieBandwidthGbps: number;
  launchOverheadMs: number;
  baseMfu: number;
}

export interface BatchSimulationConfig {
  hardwareId: HardwareProfileId;
  precision: TrainingPrecision;
  attentionMode: AttentionExecutionMode;
  epochs: number;
  datasetScaleFactor: number;
  gradAccumSteps: number;
}

export interface BatchStepBreakdown {
  batchIndex: number;
  sampleCount: number;
  tokenCount: number;
  dataLoadMs: number;
  forwardMs: number;
  backwardMs: number;
  optimizerMs: number;
  totalStepMs: number;
  isOptimizerStep: boolean;
}

export interface BatchSizeScalingPoint {
  batchSize: number;
  isActive: boolean;
  batchesPerEpoch: number;
  epochDurationMs: number;
  totalTtcSec: number;
  samplesPerSec: number;
  achievedMfuPct: number;
  peakVramMb: number;
  bottleneck: 'compute_bound' | 'memory_bw_bound' | 'launch_io_bound';
}

export interface BatchSimulationReport {
  hardware: HardwareAcceleratorProfile;
  precision: TrainingPrecision;
  attentionMode: AttentionExecutionMode;
  epochs: number;
  datasetScaleFactor: number;
  gradAccumSteps: number;
  effectiveBatchSize: number;
  // Tensor & architecture dims
  sequenceCount: number;
  maxSeqLen: number;
  effectiveSeqLen: number;
  featureDim: number;
  batchSize: number;
  batchesPerEpoch: number;
  totalOptimizerSteps: number;
  architecture: TransformerArchitectureId;
  architectureLabel: string;
  dModel: number;
  numHeads: number;
  numLayers: number;
  estimatedParams: number;
  // FLOPs & memory
  forwardFlopsPerSample: number;
  totalFlopsPerBatch: number;
  totalJobFlops: number;
  achievedTflops: number;
  achievedMfuPct: number;
  arithmeticIntensity: number;
  bottleneck: 'compute_bound' | 'memory_bw_bound' | 'launch_io_bound';
  bottleneckLabel: string;
  peakVramMb: number;
  vramUtilizationPct: number;
  fitsInMemory: boolean;
  // Time breakdown
  meanBatchMs: number;
  dataLoadPct: number;
  forwardPct: number;
  backwardPct: number;
  optimizerPct: number;
  epochDurationMs: number;
  totalTtcSec: number;
  samplesPerSec: number;
  tokensPerSec: number;
  sampleBatchTrace: BatchStepBreakdown[];
  batchSizeSweep: BatchSizeScalingPoint[];
}

export type PerformanceAlertSeverity = 'warning' | 'critical';
export type PerformanceBaselineMode =
  | 'latest_matching'
  | 'mean_matching'
  | 'selected_run';

export interface WorkspaceBaselineSnapshot {
  workspaceId: string;
  name: string;
  presetId: string;
  datasetName: string;
  updatedAtLabel: string;
  regRSquared: number;
  seqRSquared: number | null;
  valLoss: number | null;
  trainLoss: number;
  regRmse: number;
  isReconstructed: boolean;
}

export interface PerformanceDeviationAlert {
  id: string;
  metricKey: 'reg_r2' | 'seq_r2' | 'val_loss' | 'train_loss';
  metricLabel: string;
  severity: PerformanceAlertSeverity;
  baselineValue: number;
  currentValue: number;
  delta: number;
  pctChange: number | null;
  thresholdLabel: string;
  message: string;
  targetTab: 'regression' | 'sequence';
}

export interface PerformanceMetricComparison {
  metricKey: 'reg_r2' | 'seq_r2' | 'val_loss' | 'train_loss';
  metricLabel: string;
  unit: 'r2' | 'loss';
  baselineValue: number | null;
  currentValue: number | null;
  delta: number | null;
  pctChange: number | null;
  status: 'nominal' | 'improved' | 'warning' | 'critical' | 'unavailable';
  targetTab: 'regression' | 'sequence';
}

export interface PerformanceAlertReport {
  status: 'nominal' | 'warning' | 'critical' | 'no_baseline';
  baselineMode: PerformanceBaselineMode;
  baselineLabel: string;
  matchingRunCount: number;
  rSquaredThreshold: number;
  lossIncreasePctThreshold: number;
  alertCount: number;
  alerts: PerformanceDeviationAlert[];
  comparisons: PerformanceMetricComparison[];
}

export interface SqlExecutionPlanNode {
  id: string;
  depth: number;
  operator: string;
  relation?: string;
  startupCost: number;
  totalCost: number;
  estimatedRows: number;
  rowWidthBytes: number;
  detail?: string;
}

export interface SqlSchemaExpectationIssue {
  severity: 'error' | 'warning';
  code:
    | 'syntax'
    | 'unknown_table'
    | 'unknown_column'
    | 'empty_result'
    | 'unsupported_clause';
  message: string;
}

export interface SqlQueryAnalysisReport {
  isValid: boolean;
  statementCount: number;
  activeStatementIndex: number;
  tableName: string;
  expectedTableName: string;
  tableMatched: boolean;
  scanStrategy: 'Index Scan' | 'Seq Scan' | 'Multi-Split Scan';
  indexName: string | null;
  totalTableRows: number;
  matchedRows: number;
  outputRows: number;
  selectivityPct: number;
  limitApplied: number | null;
  groupByColumns: string[];
  orderBySummary: string | null;
  wherePredicates: string[];
  projectedColumns: Array<{
    outputName: string;
    sourceExpression: string;
    pgType: string;
    isAggregate: boolean;
    isValid: boolean;
  }>;
  unknownColumns: string[];
  missingSchemaColumns: string[];
  estimatedTotalCost: number;
  estimatedRowWidthBytes: number;
  planNodes: SqlExecutionPlanNode[];
  planText: string;
  issues: SqlSchemaExpectationIssue[];
  previewColumns: string[];
  previewRows: Array<Record<string, string | number | boolean>>;
}

export type SequenceHistogramBinMode = 'auto' | 'exact' | 'grouped';

export interface SequenceLengthDistributionBin {
  binKey: string;
  label: string;
  minLen: number;
  maxLen: number;
  entityCount: number;
  withinBudgetCount: number;
  truncatedCount: number;
  trainCount: number;
  valCount: number;
  testCount: number;
  sharePct: number;
  cumulativePct: number;
  status: 'within_budget' | 'boundary' | 'truncated';
}

export interface SequenceLengthPercentiles {
  count: number;
  min: number;
  p50: number;
  p75: number;
  p90: number;
  p95: number;
  max: number;
  mean: number;
}

export interface SequenceLengthAnalysis {
  bins: SequenceLengthDistributionBin[];
  binWidth: number;
  resolvedBinMode: 'exact' | 'grouped';
  percentiles: SequenceLengthPercentiles;
  maxSeqLen: number;
  truncation: TruncationStrategy;
  truncatedEntities: number;
  truncatedEntitiesPct: number;
  exactFitEntities: number;
  paddedEntities: number;
  totalEventsBeforeCutoff: number;
  retainedEvents: number;
  droppedEvents: number;
  droppedEventsPct: number;
  retainedEventsPct: number;
  paddedSlots: number;
  totalTensorSlots: number;
  paddingSparsityPct: number;
  recommendedP90: number;
  recommendedP95: number;
  tradeoffNote: string;
}

export type KlDriftAlertSeverity = 'nominal' | 'warning' | 'critical' | 'insufficient_data';

export interface KlDriftAlertItem {
  feature: RegressionFeatureKey;
  csvColumn: string;
  label: string;
  klDivergence: number;
  jsDivergence: number;
  klThreshold: number;
  excessNats: number;
  ratioToThreshold: number;
  trainMean: number;
  valMean: number;
  severity: 'warning' | 'critical';
  message: string;
}

export interface KlDriftAlertReport {
  status: KlDriftAlertSeverity;
  klThreshold: number;
  maxKlDivergence: number;
  meanKlDivergence: number;
  trainCount: number;
  valCount: number;
  evaluatedFeatureCount: number;
  breachedCount: number;
  approachingCount: number;
  alerts: KlDriftAlertItem[];
  summaryMessage: string;
}

export type MdpDistributionShapeMode = 'native' | 'normalized_z';

export interface MdpReturnSummaryStats {
  gamma: number;
  rewardScale: RewardScaleMode;
  trajectoryCount: number;
  mean: number;
  std: number;
  min: number;
  p10: number;
  p25: number;
  median: number;
  p75: number;
  p90: number;
  max: number;
  iqr: number;
  skewness: number;
  saturationRatePct: number;
  effectiveHorizon: number;
  bellmanAmplification: number;
}

export interface MdpGammaSweepPoint {
  gamma: number;
  gammaLabel: string;
  effectiveHorizon: number;
  meanG0: number;
  medianG0: number;
  p10G0: number;
  p90G0: number;
  stdG0: number;
}

export interface MdpRewardScaleComparisonRow {
  mode: RewardScaleMode;
  label: string;
  meanG0: number;
  medianG0: number;
  stdG0: number;
  iqrG0: number;
  skewness: number;
  saturationRatePct: number;
  cqlStability: 'optimal' | 'moderate_dispersion' | 'high_dispersion' | 'clipped_saturation';
  stabilityLabel: string;
}

export interface MdpSensitivityBin {
  binLabel: string;
  binMin: number;
  binMax: number;
  simulatedCount: number;
  activeCount: number;
  simulatedPct: number;
  activePct: number;
}

export interface MdpActionSensitivityRow {
  actionId: number;
  actionLabel: string;
  count: number;
  activeMeanReturn: number;
  simulatedMeanReturn: number;
  deltaReturn: number;
  activeRank: number;
  simulatedRank: number;
  rankShift: number;
}

export interface MdpSensitivityReport {
  trajectoryCount: number;
  sameScale: boolean;
  shapeMode: MdpDistributionShapeMode;
  activeStats: MdpReturnSummaryStats;
  simulatedStats: MdpReturnSummaryStats;
  gammaSweep: MdpGammaSweepPoint[];
  scaleComparison: MdpRewardScaleComparisonRow[];
  distributionBins: MdpSensitivityBin[];
  actionSensitivity: MdpActionSensitivityRow[];
  insightSummary: string;
}

export interface ExportFeatureImportanceRow {
  rank: number;
  featureKey: string;
  csvColumn: string;
  label: string;
  description: string;
  standardizedBeta: number;
  absBeta: number;
  importanceSharePct: number;
  cumulativeSharePct: number;
  rawCoefficient: number;
  univariateR2: number;
  pearsonR: number;
  featureMean: number;
  featureStd: number;
  direction: 'positive' | 'negative' | 'neutral';
  klDivergence: number | null;
  klExceedsThreshold: boolean;
  collinearPartners: string[];
}

export interface ExportFeatureImportanceReport {
  datasetName: string;
  sampleSize: number;
  featureCount: number;
  rSquared: number;
  rmse: number;
  mae: number;
  intercept: number;
  obsCutoffDay: number;
  horizonDays: number;
  winsorizePercentile: 0 | 95 | 99;
  normalizationMode: RegressionNormalizationMode;
  topDriverColumn: string | null;
  topDriverSharePct: number;
  topTwoCumulativeSharePct: number;
  rows: ExportFeatureImportanceRow[];
  summaryNarrative: string;
}

export type SqlSyntaxTokenType =
  | 'whitespace'
  | 'comment'
  | 'string'
  | 'number'
  | 'operator'
  | 'keyword'
  | 'function'
  | 'table_valid'
  | 'column_valid'
  | 'alias'
  | 'invalid_keyword'
  | 'invalid_schema'
  | 'syntax_error';

export interface SqlSyntaxToken {
  id: string;
  type: SqlSyntaxTokenType;
  text: string;
  start: number;
  end: number;
  line: number;
  column: number;
  diagnosticMessage?: string;
  suggestion?: string;
}

export interface SqlSyntaxDiagnostic {
  id: string;
  severity: 'error' | 'warning';
  code: 'invalid_keyword' | 'invalid_table' | 'invalid_column' | 'syntax_error';
  line: number;
  column: number;
  start: number;
  end: number;
  tokenText: string;
  message: string;
  suggestion?: string;
}

export interface SqlSyntaxValidationReport {
  isSyntaxClean: boolean;
  tokens: SqlSyntaxToken[];
  diagnostics: SqlSyntaxDiagnostic[];
  errorCount: number;
  warningCount: number;
  lineCount: number;
  errorLines: number[];
}

export type GlobalSearchCategory = 'metric' | 'config' | 'event' | 'dataset' | 'view';

export interface GlobalSearchResultItem {
  id: string;
  category: GlobalSearchCategory;
  title: string;
  subtitle: string;
  valueText?: string;
  targetTab: WorkspaceTab;
  targetLabel: string;
  presetIdToSelect?: string;
  explorerQuery?: string;
  keywords: string[];
  score: number;
}

export interface GlobalSearchReport {
  query: string;
  totalMatches: number;
  countsByCategory: Record<GlobalSearchCategory, number>;
  items: GlobalSearchResultItem[];
}

export type RetentionCohortMetricMode =
  | 'retention_pct'
  | 'revenue_per_user'
  | 'events_per_user';

export interface RetentionCohortCell {
  cohortIndex: number;
  cohortLabel: string;
  offsetPeriod: number;
  offsetLabel: string;
  activeEntities: number;
  cohortSize: number;
  retentionPct: number;
  totalSpend: number;
  totalEvents: number;
  revenuePerUser: number;
  eventsPerUser: number;
}

export interface RetentionCohortRow {
  cohortIndex: number;
  cohortLabel: string;
  windowRangeLabel: string;
  startDay: number;
  endDay: number;
  cohortSize: number;
  cumulativeSpend: number;
  arpu: number;
  cells: RetentionCohortCell[];
}

export interface RetentionPeriodSummary {
  offsetPeriod: number;
  offsetLabel: string;
  eligibleCohorts: number;
  eligibleEntities: number;
  retainedEntities: number;
  weightedRetentionPct: number;
  minCohortRetentionPct: number;
  maxCohortRetentionPct: number;
  weightedRevenuePerUser: number;
  weightedEventsPerUser: number;
}

export interface RetentionCohortAnalysis {
  periodDays: 14 | 30 | 60;
  splitFilter: 'all' | SplitName;
  channelFilter: string;
  availableChannels: string[];
  totalEntities: number;
  totalEvents: number;
  maxObservedDay: number;
  maxOffsetPeriods: number;
  period1RetentionPct: number | null;
  period3RetentionPct: number | null;
  halfLifePeriod: number | null;
  bestPeriod1Cohort: { label: string; retentionPct: number; cohortSize: number } | null;
  worstPeriod1Cohort: { label: string; retentionPct: number; cohortSize: number } | null;
  cohorts: RetentionCohortRow[];
  periodCurve: RetentionPeriodSummary[];
}

export type SnapshotDeltaPolarity = 'improvement' | 'drift' | 'neutral';

export type SnapshotComparisonMetricKey =
  | 'regRSquared'
  | 'regRmse'
  | 'meanProjectedLtv'
  | 'maxKlDivergence'
  | 'outlierCount'
  | 'seqHoldoutR2'
  | 'valLoss'
  | 'trainLoss'
  | 'paddingSparsityPct'
  | 'mdpTransitions'
  | 'mdpInitialReturn'
  | 'mdpOodRatePct';

export interface SnapshotComparisonMetricDelta {
  delta: number | null;
  polarity: SnapshotDeltaPolarity;
}

export interface SnapshotComparisonEvaluated {
  workspaceId: string;
  name: string;
  presetId: string;
  datasetName: string;
  timestampLabel: string;
  notes?: string;
  isLiveActive: boolean;
  globalConfig: GlobalCurationConfig;
  regConfig: RegressionConfig;
  seqConfig: SequenceConfig;
  mdpConfig: MdpConfig;
  metrics: {
    regRows: number;
    regRSquared: number;
    regRmse: number;
    meanProjectedLtv: number;
    maxKlDivergence: number;
    outlierCount: number;
    tensorShapeLabel: string;
    seqHoldoutR2: number | null;
    valLoss: number | null;
    trainLoss: number;
    paddingSparsityPct: number;
    mdpTransitions: number;
    mdpInitialReturn: number;
    mdpOodRatePct: number;
  };
  deltasFromBaseline: Record<SnapshotComparisonMetricKey, SnapshotComparisonMetricDelta>;
  configDiffsFromBaseline: string[];
}

export interface SnapshotComparisonMetricDef {
  key: SnapshotComparisonMetricKey;
  group: 'Regression' | 'Sequence' | 'Offline RL';
  label: string;
  higherIsBetter: boolean;
  unit: 'ratio' | 'currency' | 'nats' | 'count' | 'loss' | 'percent' | 'reward';
  tolerance: number;
}

export interface SnapshotComparisonReport {
  baselineId: string;
  baselineName: string;
  snapshots: SnapshotComparisonEvaluated[];
  metricDefs: SnapshotComparisonMetricDef[];
  topImprovement: {
    snapshotName: string;
    metricLabel: string;
    deltaText: string;
  } | null;
  topDrift: {
    snapshotName: string;
    metricLabel: string;
    deltaText: string;
  } | null;
}

export type DatasetSearchHitKind = 'dataset' | 'schema' | 'entity' | 'event';

export interface DatasetCatalogEntry {
  id: string;
  presetId: string;
  name: string;
  domain: string;
  description: string;
  isActive: boolean;
  isCustom: boolean;
  entityCount: number;
  eventCount: number;
  minDay: number;
  maxDay: number;
  channels: string[];
  actionSpace: { id: number; label: string }[];
  meanSpend: number;
  totalSpend: number;
  meanReward: number;
  meanEngagement: number;
  meanPropensity: number;
  healthScore: number;
  healthTier: DataHealthTier;
  events: RawEvent[];
}

export interface DatasetFieldCatalogItem {
  fieldKey: string;
  columnName: string;
  tableName: 'canonical_events' | 'regression_ltv' | 'sequence_tensors' | 'offline_rl_mdp';
  paradigm: 'Canonical' | 'Regression' | 'Sequence' | 'Offline RL';
  dataType: 'string' | 'integer' | 'float' | 'boolean';
  description: string;
  piiSensitive: boolean;
  nullable: boolean;
}

export interface DatasetSearchFilters {
  kind: 'all' | DatasetSearchHitKind;
  datasetId: 'all' | string;
  channel: 'all' | string;
  split: 'all' | SplitName;
  minSpend: number | null;
}

export interface ParsedDatasetSearchTokens {
  freeTerms: string[];
  domainFilter?: string;
  datasetFilter?: string;
  channelFilter?: string;
  actionFilter?: string;
  splitFilter?: SplitName;
  entityFilter?: string;
  spendMin?: number;
  spendMax?: number;
  rewardMin?: number;
  rewardMax?: number;
  dayMin?: number;
  dayMax?: number;
  rawChips: string[];
}

export interface DatasetSearchHit {
  id: string;
  kind: DatasetSearchHitKind;
  datasetId: string;
  datasetName: string;
  datasetDomain: string;
  isActiveDataset: boolean;
  title: string;
  subtitle: string;
  primaryMetricLabel?: string;
  primaryMetricValue?: string;
  score: number;
  matchReasons: string[];
  // Kind-specific payload for rich inspector
  catalogEntry?: DatasetCatalogEntry;
  fieldSchema?: DatasetFieldCatalogItem & {
    statsSummary?: string;
    minVal?: string;
    maxVal?: string;
    meanVal?: string;
    distinctCount?: number;
  };
  entitySummary?: {
    entityId: string;
    split: SplitName;
    eventCount: number;
    firstDay: number;
    lastDay: number;
    totalSpend: number;
    meanReward: number;
    meanEngagement: number;
    channels: string[];
    actions: string[];
    recentEvents: RawEvent[];
  };
  eventRecord?: RawEvent & {
    split: SplitName;
    windowPhase: 'obs' | 'horizon';
  };
}

export interface DatasetSearchReport {
  query: string;
  parsed: ParsedDatasetSearchTokens;
  totalHits: number;
  countsByKind: Record<DatasetSearchHitKind, number>;
  hits: DatasetSearchHit[];
  availableChannels: string[];
}

export type AutoDocTemplateMode = 'model_card' | 'data_dictionary' | 'executive_brief';

export type AutoDocSectionId =
  | 'overview'
  | 'data_health'
  | 'schema_dictionary'
  | 'paradigm_specs'
  | 'audit_lineage'
  | 'ai_narrative'
  | 'usage_code';

export interface AutoDocColumnStat {
  columnName: string;
  sourceTable: 'canonical_events' | 'regression_ltv' | 'sequence_tensors' | 'offline_rl_mdp';
  dataType: 'string' | 'integer' | 'float' | 'boolean';
  description: string;
  nonNullRatePct: number;
  distinctCount: number;
  zeroRatePct: number | null;
  minVal: string;
  p50Val: string;
  maxVal: string;
  meanVal: string;
  stdVal: string;
  sampleValues: string[];
  piiHandling: string;
}

export interface AutoDocAiNarrative {
  headline: string;
  executiveAbstract: string;
  intendedUseCases: string[];
  outOfScopeUses: string[];
  dataQualityFindings: string[];
  biasAndRiskCaveats: string[];
  curationRecommendations: string[];
  downstreamModelingGuidance: string;
  generatedAt: string;
  model: string;
}

export interface AutoDocBundle {
  generatedAtIso: string;
  datasetId: string;
  datasetName: string;
  datasetDomain: string;
  datasetDescription: string;
  isCustomDataset: boolean;
  entityCount: number;
  eventCount: number;
  dayRange: [number, number];
  channels: { name: string; count: number; sharePct: number }[];
  actionSpace: { id: number; label: string; count: number; sharePct: number; meanReward: number }[];
  splitSummary: {
    trainRatio: number;
    valRatio: number;
    testRatio: number;
    seedSalt: string;
    trainEntities: number;
    valEntities: number;
    testEntities: number;
  };
  healthScorecard: DataHealthScorecard;
  audits: AuditCheck[];
  canonicalDictionary: AutoDocColumnStat[];
  derivedDictionary: AutoDocColumnStat[];
  regressionSpec: {
    obsCutoffDay: number;
    horizonDays: number;
    winsorizePercentile: 0 | 95 | 99;
    normalization: RegressionNormalizationMode;
    rowCount: number;
    rSquared: number;
    rmse: number;
    mae: number;
    meanProjectedLtv: number;
    zeroTargetRatePct: number;
    maxKlDivergence: number;
    driftTier: string;
    outlierCount: number;
    highCollinearityCount: number;
    topDrivers: { label: string; csvColumn: string; importanceSharePct: number; direction: string }[];
  };
  sequenceSpec: {
    tensorShape: [number, number, number];
    maxSeqLen: number;
    padding: PaddingStrategy;
    truncation: TruncationStrategy;
    normalization: NormalizationMode;
    paddingSparsityPct: number;
    meanActualLength: number;
    architectureLabel: string;
    dModel: number;
    numHeads: number;
    numLayers: number;
    holdoutR2: number | null;
    valLoss: number | null;
    diagnosisLabel: string;
  };
  mdpSpec: {
    gamma: number;
    terminalInactivityGapDays: number;
    rewardScale: RewardScaleMode;
    trajectoryCount: number;
    transitionCount: number;
    terminalCount: number;
    meanTrajectoryLength: number;
    meanInitialReturn: number;
    lowSupportOodRatePct: number;
  };
  piiMasking: PiiMaskingConfig;
}

export type CurationRuleId =
  | 'deduplicate_events'
  | 'clip_negative_rewards'
  | 'winsorize_spend_tail'
  | 'clamp_propensity_bounds'
  | 'filter_single_touch_entities'
  | 'clamp_engagement_unit';

export type CurationObjectivePreset =
  | 'balanced_multi_paradigm'
  | 'regression_ltv_stability'
  | 'sequence_transformer_cleanliness'
  | 'offline_rl_cql_safety';

export interface CuratorFinding {
  id: string;
  ruleId: CurationRuleId | null;
  category:
    | 'Duplicates'
    | 'Reward Integrity'
    | 'Tail Outliers'
    | 'Policy Propensity'
    | 'Entity Coverage'
    | 'Bounds & Schema'
    | 'Cross-Paradigm Drift';
  severity: 'info' | 'warn' | 'critical';
  title: string;
  detail: string;
  affectedEvents: number;
  affectedEntities: number;
  affectedRatePct: number;
  sampleRows: Array<{
    eventId: string;
    entityId: string;
    timestampDay: number;
    metricLabel: string;
    metricValue: string;
  }>;
}

export interface CurationRuleSpec {
  id: CurationRuleId;
  label: string;
  category: string;
  description: string;
  affectedEventsCount: number;
  affectedEntitiesCount: number;
  estimatedScoreDelta: number;
}

export interface CurationTransformResult {
  events: RawEvent[];
  appliedRules: CurationRuleId[];
  rawEventCount: number;
  curatedEventCount: number;
  rawEntityCount: number;
  curatedEntityCount: number;
  removedEventCount: number;
  modifiedEventCount: number;
  ruleBreakdown: Record<CurationRuleId, { affected: number; action: 'removed' | 'modified' }>;
}

export interface CuratorProfileReport {
  rawEventCount: number;
  rawEntityCount: number;
  curatedEventCount: number;
  curatedEntityCount: number;
  rawHealthScorecard: DataHealthScorecard;
  curatedHealthScorecard: DataHealthScorecard;
  scoreDelta: number;
  findings: CuratorFinding[];
  availableRules: CurationRuleSpec[];
  p99SpendCap: number;
  negativeRewardCount: number;
  duplicateEventCount: number;
  lowPropensityCount: number;
  singleTouchEntityCount: number;
  outOfBoundsCount: number;
}

export interface AiCuratorConfigPatch {
  regWinsorizePercentile?: 0 | 95 | 99;
  regNormalization?: RegressionNormalizationMode;
  regExcludeOutliers?: boolean;
  seqNormalization?: NormalizationMode;
  seqMaxSeqLen?: number;
  mdpRewardScale?: RewardScaleMode;
  mdpMinTrajectorySteps?: number;
  rationale: string;
}

export interface AiCuratorPlan {
  headline: string;
  overallReadiness: 'production_ready' | 'needs_curation' | 'critical_remediation';
  executiveDiagnosis: string;
  prioritizedFindings: Array<{
    severity: 'info' | 'warn' | 'critical';
    dimension: string;
    title: string;
    evidence: string;
    recommendedAction: string;
  }>;
  recommendedEventRules: Array<{
    ruleId: CurationRuleId;
    priority: 'high' | 'medium' | 'low';
    rationale: string;
    expectedBenefit: string;
  }>;
  recommendedConfigPatch: AiCuratorConfigPatch;
  validationChecklist: string[];
  objectiveUsed: string;
  model: string;
  generatedAt: string;
}

export type NlQueryTargetTable = 'events' | 'regression_rows' | 'mdp_transitions';

export type NlQueryOperator = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains';

export interface NlQueryFilterPredicate {
  id: string;
  field: string;
  op: NlQueryOperator;
  value: string | number | boolean;
}

export type NlQueryAggFn = 'count' | 'sum' | 'avg' | 'min' | 'max';

export interface NlQueryAggMetric {
  field: string;
  agg: NlQueryAggFn;
  alias: string;
}

export interface NlQueryPlan {
  question: string;
  targetTable: NlQueryTargetTable;
  intentSummary: string;
  sqlPreview: string;
  filters: NlQueryFilterPredicate[];
  groupBy: string | null;
  metrics: NlQueryAggMetric[];
  sortBy: {
    field: string;
    direction: 'asc' | 'desc';
  };
  limit: number;
  chartType: 'bar' | 'none';
  model: string;
  compiledAt: string;
}

export interface NlQueryColumnMeta {
  key: string;
  label: string;
  isNumeric: boolean;
  format?: 'currency' | 'percent' | 'decimal' | 'int' | 'boolean' | 'text';
}

export interface NlQueryExecutionResult {
  targetTable: NlQueryTargetTable;
  totalSourceRows: number;
  matchedRowCount: number;
  distinctEntities: number;
  columns: NlQueryColumnMeta[];
  rows: Array<Record<string, string | number | boolean>>;
  summaryMetrics: Array<{ label: string; value: string }>;
  isGrouped: boolean;
  chartData: Array<{
    group: string;
    primaryValue: number;
    secondaryValue?: number;
    count: number;
  }>;
  primaryChartLabel: string;
  secondaryChartLabel?: string;
  executionMs: number;
}

export interface RulConfig {
  rulCap: number;
  windowLength: number;
  stride: number;
  eolInactivityGapDays: number;
  normalization: NormalizationMode;
  splitFilter: 'all' | SplitName;
}

export type RulRiskTier = 'critical' | 'warning' | 'nominal';

export interface RulEntitySummary {
  entityId: string;
  split: SplitName;
  firstDay: number;
  eolDay: number;
  cycleSpanDays: number;
  eventCount: number;
  windowCount: number;
  meanSignal: number;
  meanRulCapped: number;
  finalEngagement: number;
  finalHealthPct: number;
  degradationSlope: number;
  anomalousSpikeCount: number;
  riskTier: RulRiskTier;
}

export interface RulCycleRow {
  entityId: string;
  split: SplitName;
  eventId: string;
  timestampDay: number;
  cycleIndex: number;
  channel: string;
  actionLabel: string;
  spendAmount: number;
  engagementScore: number;
  reward: number;
  propensity: number;
  rulRaw: number;
  rulCapped: number;
  rollingMeanSpend: number;
  zScoreAnomaly: number;
  isAnomalySpike: boolean;
}

export interface RulSlidingWindowSample {
  sampleId: string;
  entityId: string;
  split: SplitName;
  startDay: number;
  endDay: number;
  rulTargetRaw: number;
  rulTargetCapped: number;
  tensor: number[][]; // [windowLength, 4]
}

export interface RulTemporalTrendPoint {
  dayRange: string;
  midDay: number;
  meanRulCapped: number;
  meanRulRaw: number;
  p25RulCapped: number;
  p50RulCapped: number;
  p75RulCapped: number;
  p25Base: number;
  iqrSpan: number;
  trainMeanRul: number | null;
  valMeanRul: number | null;
  testMeanRul: number | null;
  meanHealthPct: number;
  meanSignal: number;
  anomalyRatePct: number;
  activeUnitCount: number;
  cycleCount: number;
}

export interface RulRiskTierSummary {
  tier: RulRiskTier;
  label: string;
  criteriaLabel: string;
  unitCount: number;
  sharePct: number;
  meanSlopePctPer100d: number;
  meanSpikes: number;
  meanRulCapped: number;
}

export interface RulPreparationResult {
  unitCount: number;
  cycleRowCount: number;
  windowCount: number;
  tensorShape: [number, number, number];
  meanRulRaw: number;
  meanRulCapped: number;
  medianEolDay: number;
  anomalySpikeCount: number;
  meanDegradationSlope: number;
  fleetDecayRatePctPer100d: number;
  rulTrendSlopePerDay: number;
  anomalyTrendDeltaPct: number;
  splitCounts: Record<SplitName, number>;
  unitSummaries: RulEntitySummary[];
  cycleRows: RulCycleRow[];
  windowSamples: RulSlidingWindowSample[];
  rulHistogram: HistogramBin[];
  degradationCurve: Array<{
    cycleBucket: string;
    meanSignal: number;
    meanEngagement: number;
    meanHealthPct: number;
    meanRulCapped: number;
    trainMeanRul: number | null;
    valMeanRul: number | null;
    testMeanRul: number | null;
    anomalyRatePct: number;
    count: number;
  }>;
  temporalTrends: RulTemporalTrendPoint[];
  riskTierBreakdown: RulRiskTierSummary[];
  featureScalerStats: { name: string; mean: number; std: number; min: number; max: number }[];
}

export type EngineeredFeatureId =
  | 'spend_velocity_slope'
  | 'spend_volatility_std'
  | 'ema_to_mean_momentum'
  | 'peak_to_mean_ratio'
  | 'engagement_decay_slope'
  | 'log_tenure_freq_interaction'
  | 'action_weighted_reward_yield';

export interface EngineeredFeatureDefinition {
  id: EngineeredFeatureId;
  columnName: string;
  label: string;
  formula: string;
  category: 'Temporal' | 'Volatility' | 'Momentum' | 'Interaction';
  targetUseCase: string;
}

export interface EngineeredFeatureEvaluation {
  id: EngineeredFeatureId;
  columnName: string;
  label: string;
  formula: string;
  category: 'Temporal' | 'Volatility' | 'Momentum' | 'Interaction';
  targetUseCase: string;
  enabled: boolean;
  mean: number;
  std: number;
  min: number;
  max: number;
  pearsonR: number;
  univariateR2: number;
  maxExistingCollinearityR: number;
  mostCorrelatedWith: string;
  trainValKlDrift: number;
  recommendationTier: 'strong' | 'moderate' | 'redundant';
}

export interface FeatureEngineeringAiPlan {
  headline: string;
  strategySummary: string;
  recommendedFeatureIds: EngineeredFeatureId[];
  candidateProposals: Array<{
    featureIdOrName: string;
    rationale: string;
    expectedLiftNote: string;
    leakageSafeCheck: string;
  }>;
  collinearityWarnings: string[];
  model: string;
  generatedAt: string;
}

export type WorkflowVertical =
  | 'E-Commerce Retail'
  | 'B2B SaaS'
  | 'Consumer Fintech'
  | 'Industrial IoT & RUL'
  | 'Custom Vertical';

export interface WorkflowTemplate {
  templateId: string;
  ownerId: string;
  name: string;
  vertical: WorkflowVertical;
  description: string;
  recommendedPresetId: string;
  isBuiltIn?: boolean;
  globalConfig: GlobalCurationConfig;
  regConfig: RegressionConfig;
  seqConfig: SequenceConfig;
  mdpConfig: MdpConfig;
  rulConfig?: RulConfig;
  appliedCurationRules?: CurationRuleId[];
  enabledEngineeredFeatures?: EngineeredFeatureId[];
  localTimestampIso?: string;
  createdAt?: { toDate?: () => Date } | null;
  updatedAt?: { toDate?: () => Date } | null;
}

export type MetadataStandard = 'DCAT-3' | 'ML-Croissant' | 'ISO-11179';
export type DataClassification = 'Public' | 'Internal' | 'Confidential' | 'Restricted-PII';
export type GovernanceRetentionPolicy = 'Hot-90d' | 'Warm-1y' | 'Cold-3y' | 'WORM-7y';

export interface GovernancePolicyFlags {
  enforcePiiMasking: boolean;
  requireLeakageGuard: boolean;
  mandateDeterministicSplit: boolean;
  blockUnverifiedExports: boolean;
}

export interface GovernanceRecord {
  recordId: string;
  ownerId: string;
  datasetId: string;
  datasetName: string;
  standard: MetadataStandard;
  steward: string;
  domain: string;
  classification: DataClassification;
  retentionPolicy: GovernanceRetentionPolicy;
  license: string;
  description: string;
  keywords?: string[];
  complianceScore: number;
  policyFlags: GovernancePolicyFlags;
  standardizedFieldsCount: number;
  localTimestampIso?: string;
  createdAt?: { toDate?: () => Date } | null;
  updatedAt?: { toDate?: () => Date } | null;
}

export interface DatasetCommitRecord {
  commitId: string;
  ownerId: string;
  commitHash: string;
  parentHash?: string;
  branch: string;
  tag?: string;
  message: string;
  author: string;
  datasetId: string;
  datasetName: string;
  datasetFingerprint: string;
  eventCount: number;
  entityCount: number;
  globalConfig: GlobalCurationConfig;
  regConfig: RegressionConfig;
  seqConfig: SequenceConfig;
  mdpConfig: MdpConfig;
  rulConfig?: RulConfig;
  appliedCurationRules?: CurationRuleId[];
  enabledEngineeredFeatures?: EngineeredFeatureId[];
  localTimestampIso?: string;
  createdAt?: { toDate?: () => Date } | null;
}

export type ArchiveStorageTier = 'Hot Registry' | 'Warm Object Store' | 'Cold WORM Glacier';
export type ArchiveRetentionWindow = '90 Days' | '1 Year' | '3 Years' | '7 Years (WORM)';

export interface ArchiveBundleRecord {
  archiveId: string;
  ownerId: string;
  archiveUrn: string;
  title: string;
  datasetId: string;
  datasetName: string;
  datasetFingerprint: string;
  sha256Digest: string;
  standard: MetadataStandard;
  storageTier: ArchiveStorageTier;
  retentionWindow: ArchiveRetentionWindow;
  retentionHold: boolean;
  payloadSizeKb: number;
  artifactSummary: {
    regRows: number;
    tensorShape: [number, number, number];
    transitions: number;
    rulWindows: number;
    eventCount: number;
  };
  snapshotConfigs: {
    globalConfig: GlobalCurationConfig;
    regConfig: RegressionConfig;
    seqConfig: SequenceConfig;
    mdpConfig: MdpConfig;
    rulConfig?: RulConfig;
  };
  lastVerifiedIso?: string;
  localTimestampIso?: string;
  createdAt?: { toDate?: () => Date } | null;
  updatedAt?: { toDate?: () => Date } | null;
}


