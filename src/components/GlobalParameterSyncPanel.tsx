import React, { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  RotateCcw,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import {
  applyGlobalParameterSync,
  createInitialSyncDraft,
  detectCrossParadigmSyncStatus,
  GlobalScalingProfile,
  GlobalSyncDraft,
  normalizeSplitTriple,
} from '../engine/globalSyncEngine';
import { cloneExperimentConfigs } from '../engine/curationEngine';
import {
  GlobalCurationConfig,
  MdpConfig,
  RegressionConfig,
  SequenceConfig,
  SplitName,
} from '../types/curation';

interface GlobalParameterSyncPanelProps {
  globalConfig: GlobalCurationConfig;
  regConfig: RegressionConfig;
  seqConfig: SequenceConfig;
  mdpConfig: MdpConfig;
  maxDay: number;
  onApplySyncedConfigs: (next: {
    globalConfig: GlobalCurationConfig;
    regConfig: RegressionConfig;
    seqConfig: SequenceConfig;
    mdpConfig: MdpConfig;
  }) => void;
  onCloseModal?: () => void;
}

const BATCH_OPTIONS = [16, 32, 64, 128];
const SPLIT_FILTER_OPTIONS: { value: 'all' | SplitName; label: string }[] = [
  { value: 'all', label: 'All Splits' },
  { value: 'train', label: 'Train' },
  { value: 'val', label: 'Val' },
  { value: 'test', label: 'Test' },
];

const SCALING_OPTIONS: {
  value: GlobalScalingProfile;
  label: string;
  mapping: string;
}[] = [
  {
    value: 'standard_zscore',
    label: 'Standardized Z-Score',
    mapping: 'Reg: zscore · Seq: zscore · MDP: standardized',
  },
  {
    value: 'bounded_minmax',
    label: 'Bounded Min-Max',
    mapping: 'Reg: minmax · Seq: minmax · MDP: clipped_10',
  },
  {
    value: 'unscaled_raw',
    label: 'Raw / Log1p',
    mapping: 'Reg: none · Seq: log1p_zscore · MDP: raw',
  },
  {
    value: 'preserve',
    label: 'Preserve Custom',
    mapping: 'Keep each pipeline’s current normalization mode',
  },
];

export const GlobalParameterSyncPanel: React.FC<GlobalParameterSyncPanelProps> = ({
  globalConfig,
  regConfig,
  seqConfig,
  mdpConfig,
  maxDay,
  onApplySyncedConfigs,
  onCloseModal,
}) => {
  const [draft, setDraft] = useState<GlobalSyncDraft>(() =>
    createInitialSyncDraft(globalConfig, regConfig, seqConfig, mdpConfig)
  );
  const [lastBackup, setLastBackup] = useState<{
    globalConfig: GlobalCurationConfig;
    regConfig: RegressionConfig;
    seqConfig: SequenceConfig;
    mdpConfig: MdpConfig;
  } | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    setDraft(createInitialSyncDraft(globalConfig, regConfig, seqConfig, mdpConfig));
  }, [globalConfig, regConfig, seqConfig, mdpConfig]);

  const syncStatus = useMemo(
    () => detectCrossParadigmSyncStatus(regConfig, seqConfig, mdpConfig),
    [regConfig, seqConfig, mdpConfig]
  );

  const previewResult = useMemo(
    () =>
      applyGlobalParameterSync(
        { globalConfig, regConfig, seqConfig, mdpConfig },
        draft,
        maxDay
      ),
    [globalConfig, regConfig, seqConfig, mdpConfig, draft, maxDay]
  );

  const applyDraftPreset = (preset: 'balanced' | 'high_train' | 'strict_parity') => {
    if (preset === 'balanced') {
      setDraft((prev) => ({
        ...prev,
        trainRatio: 0.7,
        valRatio: 0.15,
        testRatio: 0.15,
        splitFilter: 'all',
        batchSize: 32,
        scalingProfile: 'standard_zscore',
        minActivitySteps: 1,
        applySplits: true,
        applyCutoffAndHorizon: true,
        applyBatchAndScaling: true,
        applyActivityFloor: true,
      }));
    } else if (preset === 'high_train') {
      setDraft((prev) => ({
        ...prev,
        trainRatio: 0.8,
        valRatio: 0.1,
        testRatio: 0.1,
        splitFilter: 'all',
        batchSize: 64,
        scalingProfile: 'unscaled_raw',
        minActivitySteps: 1,
        applySplits: true,
        applyCutoffAndHorizon: true,
        applyBatchAndScaling: true,
        applyActivityFloor: true,
      }));
    } else {
      setDraft((prev) => ({
        ...prev,
        trainRatio: 0.7,
        valRatio: 0.15,
        testRatio: 0.15,
        obsCutoffDay: Math.max(30, Math.round(maxDay * 0.5)),
        horizonDays: Math.max(30, Math.round(maxDay * 0.45)),
        terminalInactivityGapDays: 45,
        batchSize: 32,
        scalingProfile: 'standard_zscore',
        minActivitySteps: 2,
        applySplits: true,
        applyCutoffAndHorizon: true,
        applyBatchAndScaling: true,
        applyActivityFloor: true,
      }));
    }
    setFeedback(null);
  };

  const handleApply = () => {
    const backup = cloneExperimentConfigs({
      globalConfig,
      regConfig,
      seqConfig,
      mdpConfig,
    });
    const next = applyGlobalParameterSync(backup, draft, maxDay);
    setLastBackup(backup);
    onApplySyncedConfigs({
      globalConfig: next.globalConfig,
      regConfig: next.regConfig,
      seqConfig: next.seqConfig,
      mdpConfig: next.mdpConfig,
    });
    setFeedback(
      next.appliedChanges.length > 0
        ? `Synchronized ${next.appliedChanges.length} parameter group(s) across Regression, Sequence, and MDP.`
        : 'All selected pipeline constraints are already synchronized.'
    );
  };

  const handleUndo = () => {
    if (!lastBackup) return;
    onApplySyncedConfigs(lastBackup);
    setLastBackup(null);
    setFeedback('Reverted to pre-sync pipeline configurations.');
  };

  const safeMaxCutoff = Math.max(45, maxDay - 15);
  const selectedScalingInfo = SCALING_OPTIONS.find(
    (s) => s.value === draft.scalingProfile
  );

  return (
    <section
      aria-label="Global Parameter Sync"
      className="bg-white border border-slate-200 rounded-lg p-6 space-y-5"
    >
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 pb-4 border-b border-slate-200">
        <div>
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="w-4 h-4 text-blue-700" />
            <h2 className="text-base font-semibold text-slate-900">
              Global Parameter Sync
            </h2>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Enforce shared split ratios, temporal cutoffs, batching, and scaling constraints across Regression, Sequence, and Offline RL simultaneously.
          </p>
        </div>

        <div className="flex items-center gap-4 shrink-0">
          <div className="text-xs font-mono tabular-nums flex items-center gap-1.5">
            {syncStatus.inSync ? (
              <>
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                <span className="text-emerald-700 font-semibold">
                  {syncStatus.inSyncCount}/{syncStatus.items.length} Constraints Aligned
                </span>
              </>
            ) : (
              <>
                <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                <span className="text-amber-700 font-semibold">
                  {syncStatus.driftCount} Cross-Pipeline Drift{syncStatus.driftCount > 1 ? 's' : ''}
                </span>
              </>
            )}
          </div>
          {onCloseModal && (
            <button
              type="button"
              onClick={onCloseModal}
              aria-label="Close global parameter sync dialog"
              className="p-1.5 text-slate-400 hover:text-slate-700 rounded hover:bg-slate-100"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Quick Sync Profiles */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs font-medium text-slate-600">
          Quick Constraint Templates
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => applyDraftPreset('balanced')}
            className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-md transition-colors"
          >
            70/15/15 · Z-Score Parity
          </button>
          <button
            type="button"
            onClick={() => applyDraftPreset('high_train')}
            className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-md transition-colors"
          >
            80/10/10 · High-Train Raw
          </button>
          <button
            type="button"
            onClick={() => applyDraftPreset('strict_parity')}
            className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-md transition-colors"
          >
            Strict Parity (Min 2 Steps)
          </button>
        </div>
      </div>

      {/* 4 Synchronized Constraint Control Groups */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* 1. Split Ratios & Seed */}
        <div className="p-4 bg-slate-50/70 border border-slate-200 rounded-md space-y-3.5">
          <div className="flex items-center justify-between gap-2">
            <label className="flex items-center gap-2 text-xs font-semibold text-slate-900 cursor-pointer">
              <input
                type="checkbox"
                checked={draft.applySplits}
                onChange={(e) =>
                  setDraft((prev) => ({ ...prev, applySplits: e.target.checked }))
                }
                className="rounded border-slate-300 text-blue-700 focus:ring-blue-600"
              />
              <span>01. Cohort Split Ratios &amp; Filter</span>
            </label>
            <span className="font-mono text-[11px] font-semibold text-slate-700 tabular-nums">
              {Math.round(draft.trainRatio * 100)} / {Math.round(draft.valRatio * 100)} /{' '}
              {Math.round(draft.testRatio * 100)}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="flex justify-between text-[11px] text-slate-600 mb-1">
                <span>Train Ratio</span>
                <span className="font-mono tabular-nums">
                  {Math.round(draft.trainRatio * 100)}%
                </span>
              </div>
              <input
                type="range"
                min={0.5}
                max={0.85}
                step={0.05}
                disabled={!draft.applySplits}
                value={draft.trainRatio}
                onChange={(e) => {
                  const nextTrain = Number(e.target.value);
                  const remaining = Math.max(0.1, Number((1 - nextTrain).toFixed(2)));
                  const balancedVal = Number((remaining / 2).toFixed(2));
                  const norm = normalizeSplitTriple(nextTrain, balancedVal);
                  setDraft((prev) => ({ ...prev, ...norm }));
                }}
                className="w-full accent-blue-700"
              />
            </div>

            <div>
              <div className="flex justify-between text-[11px] text-slate-600 mb-1">
                <span>Val Ratio (Test auto-fills)</span>
                <span className="font-mono tabular-nums">
                  {Math.round(draft.valRatio * 100)}% / {Math.round(draft.testRatio * 100)}%
                </span>
              </div>
              <input
                type="range"
                min={0.05}
                max={Math.max(0.05, Number((0.95 - draft.trainRatio).toFixed(2)))}
                step={0.05}
                disabled={!draft.applySplits}
                value={draft.valRatio}
                onChange={(e) => {
                  const norm = normalizeSplitTriple(draft.trainRatio, Number(e.target.value));
                  setDraft((prev) => ({ ...prev, ...norm }));
                }}
                className="w-full accent-blue-700"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <div className="inline-flex rounded-md border border-slate-200 bg-white p-0.5">
              {SPLIT_FILTER_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  disabled={!draft.applySplits}
                  onClick={() =>
                    setDraft((prev) => ({ ...prev, splitFilter: opt.value }))
                  }
                  className={`px-2 py-1 text-[11px] font-medium rounded transition-colors ${
                    draft.splitFilter === opt.value
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1.5 text-[11px]">
              <span className="text-slate-500">Salt</span>
              <input
                type="text"
                disabled={!draft.applySplits}
                aria-label="Global entity hash salt"
                value={draft.seedSalt}
                onChange={(e) =>
                  setDraft((prev) => ({ ...prev, seedSalt: e.target.value }))
                }
                className="w-24 px-2 py-1 font-mono text-[11px] bg-white border border-slate-200 rounded text-slate-800"
              />
            </div>
          </div>
        </div>

        {/* 2. Temporal Cutoffs & Horizons */}
        <div className="p-4 bg-slate-50/70 border border-slate-200 rounded-md space-y-3.5">
          <div className="flex items-center justify-between gap-2">
            <label className="flex items-center gap-2 text-xs font-semibold text-slate-900 cursor-pointer">
              <input
                type="checkbox"
                checked={draft.applyCutoffAndHorizon}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    applyCutoffAndHorizon: e.target.checked,
                  }))
                }
                className="rounded border-slate-300 text-blue-700 focus:ring-blue-600"
              />
              <span>02. Temporal Cutoffs &amp; Horizon</span>
            </label>
            <span className="font-mono text-[11px] font-semibold text-blue-700 tabular-nums">
              T_obs={draft.obsCutoffDay}d · H={draft.horizonDays}d
            </span>
          </div>

          <div className="space-y-2.5">
            <div>
              <div className="flex justify-between text-[11px] text-slate-600 mb-1">
                <span>Shared Observation Cutoff (Reg + Seq T_obs)</span>
                <span className="font-mono tabular-nums font-semibold text-slate-800">
                  Day {draft.obsCutoffDay}
                </span>
              </div>
              <input
                type="range"
                min={30}
                max={safeMaxCutoff}
                step={5}
                disabled={!draft.applyCutoffAndHorizon}
                value={draft.obsCutoffDay}
                onChange={(e) =>
                  setDraft((prev) => ({ ...prev, obsCutoffDay: Number(e.target.value) }))
                }
                className="w-full accent-blue-700"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="flex justify-between text-[11px] text-slate-600 mb-1">
                  <span>LTV Horizon (H)</span>
                  <span className="font-mono tabular-nums">{draft.horizonDays}d</span>
                </div>
                <input
                  type="range"
                  min={30}
                  max={Math.max(60, maxDay)}
                  step={15}
                  disabled={!draft.applyCutoffAndHorizon}
                  value={draft.horizonDays}
                  onChange={(e) =>
                    setDraft((prev) => ({ ...prev, horizonDays: Number(e.target.value) }))
                  }
                  className="w-full accent-blue-700"
                />
              </div>

              <div>
                <div className="flex justify-between text-[11px] text-slate-600 mb-1">
                  <span>MDP Inactivity Gap</span>
                  <span className="font-mono tabular-nums">
                    {draft.terminalInactivityGapDays}d
                  </span>
                </div>
                <input
                  type="range"
                  min={14}
                  max={120}
                  step={7}
                  disabled={!draft.applyCutoffAndHorizon}
                  value={draft.terminalInactivityGapDays}
                  onChange={(e) =>
                    setDraft((prev) => ({
                      ...prev,
                      terminalInactivityGapDays: Number(e.target.value),
                    }))
                  }
                  className="w-full accent-blue-700"
                />
              </div>
            </div>
          </div>
        </div>

        {/* 3. Batching & Scaling Parity */}
        <div className="p-4 bg-slate-50/70 border border-slate-200 rounded-md space-y-3">
          <div className="flex items-center justify-between gap-2">
            <label className="flex items-center gap-2 text-xs font-semibold text-slate-900 cursor-pointer">
              <input
                type="checkbox"
                checked={draft.applyBatchAndScaling}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    applyBatchAndScaling: e.target.checked,
                  }))
                }
                className="rounded border-slate-300 text-blue-700 focus:ring-blue-600"
              />
              <span>03. Batch Size &amp; Scaling Regime</span>
            </label>
            <span className="font-mono text-[11px] text-slate-600 tabular-nums">
              batch={draft.batchSize}
            </span>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-[11px] text-slate-600">Batch Chunk (Reg + Seq)</div>
            <div className="inline-flex rounded-md border border-slate-200 bg-white p-0.5">
              {BATCH_OPTIONS.map((b) => (
                <button
                  key={b}
                  type="button"
                  disabled={!draft.applyBatchAndScaling}
                  onClick={() => setDraft((prev) => ({ ...prev, batchSize: b }))}
                  className={`px-2.5 py-1 text-[11px] font-mono font-medium rounded transition-colors ${
                    draft.batchSize === b
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {b}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="global-scaling-profile"
              className="block text-[11px] text-slate-600"
            >
              Cross-Pipeline Scaling Profile
            </label>
            <select
              id="global-scaling-profile"
              disabled={!draft.applyBatchAndScaling}
              value={draft.scalingProfile}
              onChange={(e) =>
                setDraft((prev) => ({
                  ...prev,
                  scalingProfile: e.target.value as GlobalScalingProfile,
                }))
              }
              className="w-full px-2.5 py-1.5 text-xs font-medium bg-white border border-slate-200 rounded-md text-slate-800"
            >
              {SCALING_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            {selectedScalingInfo && (
              <div className="text-[11px] font-mono text-slate-500">
                {selectedScalingInfo.mapping}
              </div>
            )}
          </div>
        </div>

        {/* 4. Entity Activity Floor */}
        <div className="p-4 bg-slate-50/70 border border-slate-200 rounded-md space-y-3 flex flex-col justify-between">
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <label className="flex items-center gap-2 text-xs font-semibold text-slate-900 cursor-pointer">
                <input
                  type="checkbox"
                  checked={draft.applyActivityFloor}
                  onChange={(e) =>
                    setDraft((prev) => ({
                      ...prev,
                      applyActivityFloor: e.target.checked,
                    }))
                  }
                  className="rounded border-slate-300 text-blue-700 focus:ring-blue-600"
                />
                <span>04. Minimum Entity Activity Floor</span>
              </label>
              <span className="font-mono text-[11px] text-slate-600 tabular-nums">
                min {draft.minActivitySteps} step(s)
              </span>
            </div>

            <p className="text-[11px] text-slate-500 leading-relaxed">
              Synchronizes Regression zero-observation filtering with Sequence <code className="font-mono">minSeqLen</code> and MDP <code className="font-mono">minTrajectorySteps</code>.
            </p>
          </div>

          <div className="flex items-center justify-between gap-3 pt-1">
            <span className="text-[11px] text-slate-600">Minimum Events / Steps</span>
            <div className="inline-flex rounded-md border border-slate-200 bg-white p-0.5">
              {[1, 2, 3].map((steps) => (
                <button
                  key={steps}
                  type="button"
                  disabled={!draft.applyActivityFloor}
                  onClick={() =>
                    setDraft((prev) => ({ ...prev, minActivitySteps: steps }))
                  }
                  className={`px-3 py-1 text-[11px] font-mono font-medium rounded transition-colors ${
                    draft.minActivitySteps === steps
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  &ge;{steps}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Live Alignment Matrix */}
      <div className="border border-slate-200 rounded-md overflow-hidden">
        <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-700">
            Current Cross-Pipeline Parameter Alignment
          </span>
          <span className="text-[11px] font-mono text-slate-500 tabular-nums">
            {previewResult.appliedChanges.length > 0
              ? `${previewResult.appliedChanges.length} pending change(s)`
              : 'No pending drift'}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 text-[11px] font-semibold text-slate-500 bg-white">
                <th className="py-2 px-4">Constraint</th>
                <th className="py-2 px-3">Regression</th>
                <th className="py-2 px-3">Sequence</th>
                <th className="py-2 px-3">Offline RL (MDP)</th>
                <th className="py-2 px-4 text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-xs font-mono tabular-nums">
              {syncStatus.items.map((item) => (
                <tr key={item.id} className="bg-white">
                  <td className="py-2 px-4 font-sans font-medium text-slate-800">
                    {item.label}
                  </td>
                  <td className="py-2 px-3 text-slate-700">{item.regValue}</td>
                  <td className="py-2 px-3 text-slate-700">{item.seqValue}</td>
                  <td className="py-2 px-3 text-slate-700">{item.mdpValue}</td>
                  <td
                    className={`py-2 px-4 text-right font-semibold ${
                      item.inSync ? 'text-emerald-700' : 'text-amber-700'
                    }`}
                  >
                    {item.inSync ? 'Aligned' : 'Drifted'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Footer Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-1">
        <div className="text-xs text-slate-600">
          {feedback ? (
            <span className="text-emerald-700 font-medium">{feedback}</span>
          ) : previewResult.appliedChanges.length > 0 ? (
            <span className="font-mono text-[11px] text-slate-600">
              Pending: {previewResult.appliedChanges.join(' · ')}
            </span>
          ) : (
            <span>All checked constraints match your active pipeline configs.</span>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {lastBackup && (
            <button
              type="button"
              onClick={handleUndo}
              className="px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 inline-flex items-center gap-1.5"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Undo Sync</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setDraft(
                createInitialSyncDraft(globalConfig, regConfig, seqConfig, mdpConfig)
              );
              setFeedback(null);
            }}
            className="px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 inline-flex items-center gap-1.5"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Reset</span>
          </button>
          <button
            type="button"
            onClick={handleApply}
            className="px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-md transition-colors"
          >
            Apply to All Pipelines
          </button>
        </div>
      </div>
    </section>
  );
};
