import { REGRESSION_FEATURE_CATALOG, cloneExperimentConfigs } from '../engine/curationEngine';
import {
  CurationRuleId,
  EngineeredFeatureId,
  GlobalCurationConfig,
  MdpConfig,
  RegressionConfig,
  RulConfig,
  SequenceConfig,
  WorkflowTemplate,
  WorkflowVertical,
} from '../types/curation';

const ALL_REG_FEATURES = REGRESSION_FEATURE_CATALOG.map((f) => f.key);

export const WORKFLOW_VERTICALS: WorkflowVertical[] = [
  'E-Commerce Retail',
  'B2B SaaS',
  'Consumer Fintech',
  'Industrial IoT & RUL',
  'Custom Vertical',
];

export const BUILTIN_WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  {
    templateId: 'tpl-builtin-ecom-ltv-cql',
    ownerId: 'stratum-builtin',
    name: 'E-Commerce High-Velocity LTV & Promo CQL',
    vertical: 'E-Commerce Retail',
    recommendedPresetId: 'ecommerce_ltv_rl',
    isBuiltIn: true,
    description:
      'Point-in-time T=150d observation cutoff paired with 16-step time-delta Attention-Pool Transformer and γ=0.92 promo-attribution MDP trajectories.',
    globalConfig: {
      trainRatio: 0.7,
      valRatio: 0.15,
      testRatio: 0.15,
      seedSalt: 'ecom-ltv-v1',
    },
    regConfig: {
      obsCutoffDay: 150,
      horizonDays: 180,
      winsorizePercentile: 99,
      excludeZeroObsEntities: true,
      featureNormalization: 'zscore',
      selectedFeatures: [...ALL_REG_FEATURES],
      batchSize: 32,
      splitFilter: 'all',
      klDriftThreshold: 0.22,
      outlierStdThreshold: 2.5,
      excludeDetectedOutliers: false,
    },
    seqConfig: {
      maxSeqLen: 16,
      padding: 'pre',
      truncation: 'recent',
      normalization: 'zscore',
      minSeqLen: 2,
      obsCutoffDay: 150,
      batchSize: 32,
      learningRate: 0.001,
      splitFilter: 'all',
      transformerArch: 'transformer_encoder',
      dModel: 128,
      numHeads: 4,
      numLayers: 2,
      dropoutRate: 0.1,
      positionalEncoding: 'time_delta',
      poolingMode: 'attention_pool',
    },
    mdpConfig: {
      gamma: 0.92,
      terminalInactivityGapDays: 45,
      rewardScale: 'raw',
      minTrajectorySteps: 2,
      includeAbsorbingStep: true,
      splitFilter: 'all',
    },
    rulConfig: {
      rulCap: 125,
      windowLength: 8,
      stride: 1,
      eolInactivityGapDays: 45,
      normalization: 'zscore',
      splitFilter: 'all',
    },
    appliedCurationRules: ['winsorize_spend_tail'],
    enabledEngineeredFeatures: ['spend_velocity_slope', 'ema_to_mean_momentum'],
  },
  {
    templateId: 'tpl-builtin-saas-arr-policy',
    ownerId: 'stratum-builtin',
    name: 'B2B SaaS Annual Contract & Expansion Policy',
    vertical: 'B2B SaaS',
    recommendedPresetId: 'saas_lifecycle',
    isBuiltIn: true,
    description:
      'Long-horizon γ=0.98 renewal MDP with clipped rewards, deduplicated billing telemetry, and 4-layer Causal GPT Decoder using RoPE embeddings.',
    globalConfig: {
      trainRatio: 0.7,
      valRatio: 0.15,
      testRatio: 0.15,
      seedSalt: 'saas-arr-v2',
    },
    regConfig: {
      obsCutoffDay: 180,
      horizonDays: 180,
      winsorizePercentile: 99,
      excludeZeroObsEntities: true,
      featureNormalization: 'zscore',
      selectedFeatures: [...ALL_REG_FEATURES],
      batchSize: 32,
      splitFilter: 'all',
      klDriftThreshold: 0.2,
      outlierStdThreshold: 3.0,
      excludeDetectedOutliers: false,
    },
    seqConfig: {
      maxSeqLen: 12,
      padding: 'pre',
      truncation: 'recent',
      normalization: 'zscore',
      minSeqLen: 2,
      obsCutoffDay: 180,
      batchSize: 32,
      learningRate: 0.0008,
      splitFilter: 'all',
      transformerArch: 'causal_gpt',
      dModel: 128,
      numHeads: 4,
      numLayers: 4,
      dropoutRate: 0.1,
      positionalEncoding: 'rotary_rope',
      poolingMode: 'last_token',
    },
    mdpConfig: {
      gamma: 0.98,
      terminalInactivityGapDays: 75,
      rewardScale: 'clipped_10',
      minTrajectorySteps: 2,
      includeAbsorbingStep: true,
      splitFilter: 'all',
    },
    rulConfig: {
      rulCap: 150,
      windowLength: 6,
      stride: 1,
      eolInactivityGapDays: 75,
      normalization: 'zscore',
      splitFilter: 'all',
    },
    appliedCurationRules: ['deduplicate_events'],
    enabledEngineeredFeatures: ['engagement_decay_slope', 'log_tenure_freq_interaction'],
  },
  {
    templateId: 'tpl-builtin-fintech-credit-cql',
    ownerId: 'stratum-builtin',
    name: 'Consumer Fintech Risk-Adjusted Credit MDP',
    vertical: 'Consumer Fintech',
    recommendedPresetId: 'fintech_credit_policy',
    isBuiltIn: true,
    description:
      'Conservative P95 outlier suppression, tight KL=0.18 drift guard, log1p sequence normalization, and 80/10/10 standardized credit-line CQL replay trajectories.',
    globalConfig: {
      trainRatio: 0.8,
      valRatio: 0.1,
      testRatio: 0.1,
      seedSalt: 'fintech-cql-v1',
    },
    regConfig: {
      obsCutoffDay: 180,
      horizonDays: 180,
      winsorizePercentile: 95,
      excludeZeroObsEntities: true,
      featureNormalization: 'minmax',
      selectedFeatures: [...ALL_REG_FEATURES],
      batchSize: 64,
      splitFilter: 'all',
      klDriftThreshold: 0.18,
      outlierStdThreshold: 2.2,
      excludeDetectedOutliers: true,
    },
    seqConfig: {
      maxSeqLen: 14,
      padding: 'pre',
      truncation: 'recent',
      normalization: 'log1p_zscore',
      minSeqLen: 3,
      obsCutoffDay: 180,
      batchSize: 64,
      learningRate: 0.0005,
      splitFilter: 'all',
      transformerArch: 'transformer_encoder',
      dModel: 128,
      numHeads: 4,
      numLayers: 2,
      dropoutRate: 0.15,
      positionalEncoding: 'time_delta',
      poolingMode: 'cls_mean',
    },
    mdpConfig: {
      gamma: 0.9,
      terminalInactivityGapDays: 60,
      rewardScale: 'standardized',
      minTrajectorySteps: 3,
      includeAbsorbingStep: true,
      splitFilter: 'all',
    },
    rulConfig: {
      rulCap: 120,
      windowLength: 8,
      stride: 1,
      eolInactivityGapDays: 60,
      normalization: 'log1p_zscore',
      splitFilter: 'all',
    },
    appliedCurationRules: ['clamp_propensity_bounds', 'winsorize_spend_tail'],
    enabledEngineeredFeatures: ['spend_volatility_std', 'action_weighted_reward_yield'],
  },
  {
    templateId: 'tpl-builtin-iot-predictive-rul',
    ownerId: 'stratum-builtin',
    name: 'Industrial IoT Predictive Maintenance & RUL',
    vertical: 'Industrial IoT & RUL',
    recommendedPresetId: 'industrial_sensor_rul',
    isBuiltIn: true,
    description:
      'Temporal Fusion Transformer (18-step window) + capped 125-cycle RUL sliding-window tensor prep and γ=0.95 maintenance intervention MDP.',
    globalConfig: {
      trainRatio: 0.7,
      valRatio: 0.15,
      testRatio: 0.15,
      seedSalt: 'iot-rul-v1',
    },
    regConfig: {
      obsCutoffDay: 150,
      horizonDays: 180,
      winsorizePercentile: 99,
      excludeZeroObsEntities: true,
      featureNormalization: 'zscore',
      selectedFeatures: [...ALL_REG_FEATURES],
      batchSize: 32,
      splitFilter: 'all',
      klDriftThreshold: 0.25,
      outlierStdThreshold: 2.5,
      excludeDetectedOutliers: false,
    },
    seqConfig: {
      maxSeqLen: 18,
      padding: 'post',
      truncation: 'recent',
      normalization: 'zscore',
      minSeqLen: 2,
      obsCutoffDay: 150,
      batchSize: 32,
      learningRate: 0.001,
      splitFilter: 'all',
      transformerArch: 'temporal_fusion',
      dModel: 128,
      numHeads: 4,
      numLayers: 2,
      dropoutRate: 0.1,
      positionalEncoding: 'time_delta',
      poolingMode: 'attention_pool',
    },
    mdpConfig: {
      gamma: 0.95,
      terminalInactivityGapDays: 45,
      rewardScale: 'raw',
      minTrajectorySteps: 2,
      includeAbsorbingStep: true,
      splitFilter: 'all',
    },
    rulConfig: {
      rulCap: 125,
      windowLength: 10,
      stride: 1,
      eolInactivityGapDays: 60,
      normalization: 'zscore',
      splitFilter: 'all',
    },
    appliedCurationRules: ['deduplicate_events'],
    enabledEngineeredFeatures: [
      'spend_velocity_slope',
      'peak_to_mean_ratio',
      'engagement_decay_slope',
    ],
  },
];

export const LOCAL_WORKFLOW_TEMPLATES_KEY = 'stratum_local_workflow_templates_v1';

export function cloneWorkflowTemplateBundle(template: {
  globalConfig: GlobalCurationConfig;
  regConfig: RegressionConfig;
  seqConfig: SequenceConfig;
  mdpConfig: MdpConfig;
  rulConfig?: RulConfig;
  appliedCurationRules?: CurationRuleId[];
  enabledEngineeredFeatures?: EngineeredFeatureId[];
}) {
  const core = cloneExperimentConfigs({
    globalConfig: template.globalConfig,
    regConfig: template.regConfig,
    seqConfig: template.seqConfig,
    mdpConfig: template.mdpConfig,
  });

  const rulConfig: RulConfig = template.rulConfig
    ? { ...template.rulConfig }
    : {
        rulCap: 125,
        windowLength: 8,
        stride: 1,
        eolInactivityGapDays: core.mdpConfig.terminalInactivityGapDays,
        normalization: core.seqConfig.normalization,
        splitFilter: 'all',
      };

  return {
    ...core,
    rulConfig,
    appliedCurationRules: Array.isArray(template.appliedCurationRules)
      ? ([...template.appliedCurationRules] as CurationRuleId[])
      : [],
    enabledEngineeredFeatures: Array.isArray(template.enabledEngineeredFeatures)
      ? ([...template.enabledEngineeredFeatures] as EngineeredFeatureId[])
      : [],
  };
}

export function isWorkflowTemplateActive(
  template: WorkflowTemplate,
  current: {
    globalConfig: GlobalCurationConfig;
    regConfig: RegressionConfig;
    seqConfig: SequenceConfig;
    mdpConfig: MdpConfig;
  }
): boolean {
  return (
    Math.abs(template.globalConfig.trainRatio - current.globalConfig.trainRatio) < 1e-4 &&
    Math.abs(template.globalConfig.valRatio - current.globalConfig.valRatio) < 1e-4 &&
    template.globalConfig.seedSalt === current.globalConfig.seedSalt &&
    template.regConfig.obsCutoffDay === current.regConfig.obsCutoffDay &&
    template.regConfig.horizonDays === current.regConfig.horizonDays &&
    template.regConfig.winsorizePercentile === current.regConfig.winsorizePercentile &&
    template.regConfig.featureNormalization === current.regConfig.featureNormalization &&
    template.seqConfig.maxSeqLen === current.seqConfig.maxSeqLen &&
    template.seqConfig.transformerArch === current.seqConfig.transformerArch &&
    template.seqConfig.normalization === current.seqConfig.normalization &&
    Math.abs(template.mdpConfig.gamma - current.mdpConfig.gamma) < 1e-4 &&
    template.mdpConfig.rewardScale === current.mdpConfig.rewardScale &&
    template.mdpConfig.terminalInactivityGapDays ===
      current.mdpConfig.terminalInactivityGapDays
  );
}
