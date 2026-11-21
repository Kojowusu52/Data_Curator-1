import { cloneExperimentConfigs } from './curationEngine';
import {
  GlobalCurationConfig,
  MdpConfig,
  RegressionConfig,
  SequenceConfig,
  SplitName,
} from '../types/curation';

export type GlobalScalingProfile =
  | 'preserve'
  | 'standard_zscore'
  | 'bounded_minmax'
  | 'unscaled_raw';

export interface GlobalSyncDraft {
  trainRatio: number;
  valRatio: number;
  testRatio: number;
  seedSalt: string;
  splitFilter: 'all' | SplitName;
  obsCutoffDay: number;
  horizonDays: number;
  terminalInactivityGapDays: number;
  batchSize: number;
  scalingProfile: GlobalScalingProfile;
  minActivitySteps: number;
  applySplits: boolean;
  applyCutoffAndHorizon: boolean;
  applyBatchAndScaling: boolean;
  applyActivityFloor: boolean;
}

export interface SyncAlignmentItem {
  id: 'cutoff' | 'split_filter' | 'batch_size' | 'scaling' | 'activity_floor';
  label: string;
  inSync: boolean;
  regValue: string;
  seqValue: string;
  mdpValue: string;
  detail: string;
}

export interface CrossParadigmSyncStatus {
  inSync: boolean;
  inSyncCount: number;
  driftCount: number;
  items: SyncAlignmentItem[];
}

export interface AppliedGlobalSyncResult {
  globalConfig: GlobalCurationConfig;
  regConfig: RegressionConfig;
  seqConfig: SequenceConfig;
  mdpConfig: MdpConfig;
  appliedChanges: string[];
}

export function inferScalingProfile(
  reg: RegressionConfig,
  seq: SequenceConfig,
  mdp: MdpConfig
): GlobalScalingProfile {
  if (
    reg.featureNormalization === 'zscore' &&
    seq.normalization === 'zscore' &&
    mdp.rewardScale === 'standardized'
  ) {
    return 'standard_zscore';
  }
  if (
    reg.featureNormalization === 'minmax' &&
    seq.normalization === 'minmax' &&
    mdp.rewardScale === 'clipped_10'
  ) {
    return 'bounded_minmax';
  }
  if (
    reg.featureNormalization === 'none' &&
    seq.normalization === 'log1p_zscore' &&
    mdp.rewardScale === 'raw'
  ) {
    return 'unscaled_raw';
  }
  return 'preserve';
}

export function createInitialSyncDraft(
  globalConfig: GlobalCurationConfig,
  regConfig: RegressionConfig,
  seqConfig: SequenceConfig,
  mdpConfig: MdpConfig
): GlobalSyncDraft {
  return {
    trainRatio: globalConfig.trainRatio,
    valRatio: globalConfig.valRatio,
    testRatio: globalConfig.testRatio,
    seedSalt: globalConfig.seedSalt,
    splitFilter: regConfig.splitFilter,
    obsCutoffDay: regConfig.obsCutoffDay,
    horizonDays: regConfig.horizonDays,
    terminalInactivityGapDays: mdpConfig.terminalInactivityGapDays,
    batchSize: regConfig.batchSize || seqConfig.batchSize || 32,
    scalingProfile: inferScalingProfile(regConfig, seqConfig, mdpConfig),
    minActivitySteps: Math.max(1, seqConfig.minSeqLen),
    applySplits: true,
    applyCutoffAndHorizon: true,
    applyBatchAndScaling: true,
    applyActivityFloor: true,
  };
}

export function detectCrossParadigmSyncStatus(
  regConfig: RegressionConfig,
  seqConfig: SequenceConfig,
  mdpConfig: MdpConfig
): CrossParadigmSyncStatus {
  const cutoffAligned = regConfig.obsCutoffDay === seqConfig.obsCutoffDay;
  const splitFilterAligned =
    regConfig.splitFilter === seqConfig.splitFilter &&
    seqConfig.splitFilter === mdpConfig.splitFilter;
  const regBatch = regConfig.batchSize || 32;
  const seqBatch = seqConfig.batchSize || 32;
  const batchAligned = regBatch === seqBatch;
  const inferredScale = inferScalingProfile(regConfig, seqConfig, mdpConfig);
  const scalingAligned = inferredScale !== 'preserve';
  const activityAligned =
    regConfig.excludeZeroObsEntities === (seqConfig.minSeqLen >= 1) &&
    seqConfig.minSeqLen === mdpConfig.minTrajectorySteps;

  const items: SyncAlignmentItem[] = [
    {
      id: 'cutoff',
      label: 'Observation Cutoff (T_obs)',
      inSync: cutoffAligned,
      regValue: `${regConfig.obsCutoffDay}d`,
      seqValue: `${seqConfig.obsCutoffDay}d`,
      mdpValue: `gap ${mdpConfig.terminalInactivityGapDays}d`,
      detail: cutoffAligned
        ? `Regression & Sequence cutoffs locked at day ${regConfig.obsCutoffDay}.`
        : `Drift: Regression is at day ${regConfig.obsCutoffDay} while Sequence is at day ${seqConfig.obsCutoffDay}.`,
    },
    {
      id: 'split_filter',
      label: 'Active Split Filter',
      inSync: splitFilterAligned,
      regValue: regConfig.splitFilter,
      seqValue: seqConfig.splitFilter,
      mdpValue: mdpConfig.splitFilter,
      detail: splitFilterAligned
        ? `All three pipelines evaluate the "${regConfig.splitFilter}" split.`
        : `Split mismatch across pipelines (${regConfig.splitFilter} / ${seqConfig.splitFilter} / ${mdpConfig.splitFilter}).`,
    },
    {
      id: 'batch_size',
      label: 'Mini-Batch Chunk Size',
      inSync: batchAligned,
      regValue: `${regBatch}`,
      seqValue: `${seqBatch}`,
      mdpValue: 'trajectory',
      detail: batchAligned
        ? `Tabular & Tensor batches aligned at ${regBatch} entities/batch.`
        : `Batch size mismatch: Regression=${regBatch}, Sequence=${seqBatch}.`,
    },
    {
      id: 'scaling',
      label: 'Feature & Reward Scaling',
      inSync: scalingAligned,
      regValue: regConfig.featureNormalization,
      seqValue: seqConfig.normalization,
      mdpValue: mdpConfig.rewardScale,
      detail: scalingAligned
        ? `Unified ${inferredScale.replace('_', ' ')} normalization regime active.`
        : `Mixed scaling modes across Regression (${regConfig.featureNormalization}), Sequence (${seqConfig.normalization}), and MDP (${mdpConfig.rewardScale}).`,
    },
    {
      id: 'activity_floor',
      label: 'Entity Activity Floor',
      inSync: activityAligned,
      regValue: regConfig.excludeZeroObsEntities ? 'obs >= 1' : 'allow 0',
      seqValue: `minLen=${seqConfig.minSeqLen}`,
      mdpValue: `minSteps=${mdpConfig.minTrajectorySteps}`,
      detail: activityAligned
        ? `Minimum sequence length & MDP trajectory steps matched at ${seqConfig.minSeqLen}.`
        : `Mismatch between Sequence minLen (${seqConfig.minSeqLen}) and MDP minSteps (${mdpConfig.minTrajectorySteps}).`,
    },
  ];

  const inSyncCount = items.filter((item) => item.inSync).length;
  const driftCount = items.length - inSyncCount;
  return {
    inSync: driftCount === 0,
    inSyncCount,
    driftCount,
    items,
  };
}

export function normalizeSplitTriple(trainRatio: number, valRatio: number): {
  trainRatio: number;
  valRatio: number;
  testRatio: number;
} {
  const safeTrain = Math.min(0.9, Math.max(0.4, Math.round(trainRatio * 100) / 100));
  const maxVal = Math.max(0.05, Math.round((0.95 - safeTrain) * 100) / 100);
  const safeVal = Math.min(maxVal, Math.max(0.05, Math.round(valRatio * 100) / 100));
  const safeTest = Math.max(0.05, Math.round((1 - safeTrain - safeVal) * 100) / 100);
  return {
    trainRatio: safeTrain,
    valRatio: safeVal,
    testRatio: safeTest,
  };
}

export function applyGlobalParameterSync(
  current: {
    globalConfig: GlobalCurationConfig;
    regConfig: RegressionConfig;
    seqConfig: SequenceConfig;
    mdpConfig: MdpConfig;
  },
  draft: GlobalSyncDraft,
  maxDay: number
): AppliedGlobalSyncResult {
  const cloned = cloneExperimentConfigs(current);
  const nextGlobal = cloned.globalConfig;
  const nextReg = cloned.regConfig;
  const nextSeq = cloned.seqConfig;
  const nextMdp = cloned.mdpConfig;
  const appliedChanges: string[] = [];

  if (draft.applySplits) {
    const normalized = normalizeSplitTriple(draft.trainRatio, draft.valRatio);
    const cleanSalt = draft.seedSalt.trim() || 'stratum-v1';
    if (
      Math.abs(nextGlobal.trainRatio - normalized.trainRatio) > 0.001 ||
      Math.abs(nextGlobal.valRatio - normalized.valRatio) > 0.001 ||
      nextGlobal.seedSalt !== cleanSalt
    ) {
      appliedChanges.push(
        `Splits -> ${Math.round(normalized.trainRatio * 100)}/${Math.round(
          normalized.valRatio * 100
        )}/${Math.round(normalized.testRatio * 100)} (salt="${cleanSalt}")`
      );
    }
    nextGlobal.trainRatio = normalized.trainRatio;
    nextGlobal.valRatio = normalized.valRatio;
    nextGlobal.testRatio = normalized.testRatio;
    nextGlobal.seedSalt = cleanSalt;

    if (
      nextReg.splitFilter !== draft.splitFilter ||
      nextSeq.splitFilter !== draft.splitFilter ||
      nextMdp.splitFilter !== draft.splitFilter
    ) {
      appliedChanges.push(`Split filter -> "${draft.splitFilter}" across Reg/Seq/MDP`);
    }
    nextReg.splitFilter = draft.splitFilter;
    nextSeq.splitFilter = draft.splitFilter;
    nextMdp.splitFilter = draft.splitFilter;
  }

  if (draft.applyCutoffAndHorizon) {
    const safeCutoff = Math.max(15, Math.min(Math.max(30, maxDay - 15), Math.round(draft.obsCutoffDay)));
    const safeHorizon = Math.max(15, Math.min(Math.max(30, maxDay), Math.round(draft.horizonDays)));
    const safeGap = Math.max(7, Math.min(Math.max(30, maxDay), Math.round(draft.terminalInactivityGapDays)));

    if (nextReg.obsCutoffDay !== safeCutoff || nextSeq.obsCutoffDay !== safeCutoff) {
      appliedChanges.push(`T_obs cutoff -> day ${safeCutoff} across Reg & Seq`);
    }
    nextReg.obsCutoffDay = safeCutoff;
    nextSeq.obsCutoffDay = safeCutoff;

    if (nextReg.horizonDays !== safeHorizon) {
      appliedChanges.push(`Regression horizon H -> ${safeHorizon}d`);
    }
    nextReg.horizonDays = safeHorizon;

    if (nextMdp.terminalInactivityGapDays !== safeGap) {
      appliedChanges.push(`MDP terminal inactivity gap -> ${safeGap}d`);
    }
    nextMdp.terminalInactivityGapDays = safeGap;
  }

  if (draft.applyBatchAndScaling) {
    const safeBatch = Math.max(8, Math.min(256, Math.round(draft.batchSize)));
    if ((nextReg.batchSize || 32) !== safeBatch || (nextSeq.batchSize || 32) !== safeBatch) {
      appliedChanges.push(`Batch size -> ${safeBatch} across Reg & Seq`);
    }
    nextReg.batchSize = safeBatch;
    nextSeq.batchSize = safeBatch;

    if (draft.scalingProfile === 'standard_zscore') {
      nextReg.featureNormalization = 'zscore';
      nextSeq.normalization = 'zscore';
      nextMdp.rewardScale = 'standardized';
      appliedChanges.push('Scaling -> Standardized Z-Score across Reg/Seq/MDP');
    } else if (draft.scalingProfile === 'bounded_minmax') {
      nextReg.featureNormalization = 'minmax';
      nextSeq.normalization = 'minmax';
      nextMdp.rewardScale = 'clipped_10';
      appliedChanges.push('Scaling -> Bounded Min-Max / Clipped across Reg/Seq/MDP');
    } else if (draft.scalingProfile === 'unscaled_raw') {
      nextReg.featureNormalization = 'none';
      nextSeq.normalization = 'log1p_zscore';
      nextMdp.rewardScale = 'raw';
      appliedChanges.push('Scaling -> Raw / Log1p across Reg/Seq/MDP');
    }
  }

  if (draft.applyActivityFloor) {
    const safeFloor = Math.max(1, Math.min(10, Math.round(draft.minActivitySteps)));
    if (
      nextSeq.minSeqLen !== safeFloor ||
      nextMdp.minTrajectorySteps !== safeFloor ||
      !nextReg.excludeZeroObsEntities
    ) {
      appliedChanges.push(`Activity floor -> min ${safeFloor} step(s) across Reg/Seq/MDP`);
    }
    nextReg.excludeZeroObsEntities = true;
    nextSeq.minSeqLen = safeFloor;
    nextMdp.minTrajectorySteps = safeFloor;
  }

  return {
    globalConfig: nextGlobal,
    regConfig: nextReg,
    seqConfig: nextSeq,
    mdpConfig: nextMdp,
    appliedChanges,
  };
}
