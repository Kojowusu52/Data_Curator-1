import React, { useMemo, useState } from 'react';
import {
  Activity,
  ArrowLeftRight,
  ArrowUpDown,
  Award,
  BarChart3,
  Check,
  Cpu,
  Download,
  GitCompareArrows,
  Layers,
  Search,
  Waypoints,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  GlobalCurationConfig,
  MdpResult,
  RawEvent,
  RegressionConfig,
  RegressionFeatureKey,
  RegressionNormalizationMode,
  RegressionResult,
  RegressionRow,
  RulConfig,
  RulPreparationResult,
  SequenceResult,
  TransformerArchitectureId,
  WorkspaceTab,
} from '../types/curation';
import {
  buildRegressionDataset,
  REGRESSION_FEATURE_CATALOG,
} from '../engine/curationEngine';
import { computeEntityRulProjection } from '../engine/rulEngine';

interface ModelComparisonViewProps {
  datasetName: string;
  datasetDomain: string;
  events: RawEvent[];
  globalConfig: GlobalCurationConfig;
  baseRegConfig: RegressionConfig;
  regResult: RegressionResult;
  seqResult: SequenceResult;
  mdpResult: MdpResult;
  rulResult: RulPreparationResult;
  rulConfig: RulConfig;
  maxDay: number;
  onPromoteConfig: (config: RegressionConfig) => void;
  onOpenTransformerView: (arch?: TransformerArchitectureId) => void;
  onNavigateTab: (tab: WorkspaceTab) => void;
}

type DashboardSubView = 'leaderboard' | 'ab_lab' | 'rul_rl';
type FamilyFilter = 'all' | 'tabular_ols' | 'recurrent' | 'transformer';
type LeaderboardSortKey =
  | 'r2Holdout'
  | 'r2All'
  | 'rmseHoldout'
  | 'maeHoldout'
  | 'paramCount'
  | 'standardError';

interface UnifiedBenchmarkEntry {
  id: string;
  shortLabel: string;
  modelName: string;
  familyKey: Exclude<FamilyFilter, 'all'>;
  familyLabel: string;
  specSummary: string;
  isActive: boolean;
  paramCount: number;
  r2All: number | null;
  r2Holdout: number | null;
  overfitGap: number | null;
  rmseHoldout: number;
  maeHoldout: number;
  standardError: number;
  ci95Lower: number;
  ci95Upper: number;
  meanAttentionEntropy: number | null;
  actionTarget:
    | { type: 'regression' }
    | { type: 'ab_lab' }
    | { type: 'transformer'; arch?: TransformerArchitectureId };
}

interface ScatterOutcomePoint {
  entityId: string;
  split: RegressionRow['split'];
  observed: number;
  predicted: number;
  residual: number;
}

interface EntityComparisonRow {
  entityId: string;
  split: RegressionRow['split'];
  observedA: number;
  predictedA: number;
  absErrA: number;
  observedB: number;
  predictedB: number;
  absErrB: number;
  predDelta: number;
  closerModel: 'A' | 'B' | 'Tie';
}

type DeltaSortKey =
  | 'entityId'
  | 'observedA'
  | 'predictedA'
  | 'predictedB'
  | 'predDelta'
  | 'absErrDiff';

function triggerDownload(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function formatCurrencyCompact(value: number): string {
  if (Math.abs(value) >= 1000) {
    return `$${(value / 1000).toFixed(1)}k`;
  }
  return `$${Math.round(value)}`;
}

function formatCurrencyFull(value: number): string {
  return `$${value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatParamCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function computeMae(rows: RegressionRow[]): number {
  if (rows.length === 0) return 0;
  const totalErr = rows.reduce(
    (acc, r) => acc + Math.abs(r.predictedHorizonLtv - r.targetLtvWinsorized),
    0
  );
  return totalErr / rows.length;
}

function computeRegressionHoldoutStats(res: RegressionResult) {
  const holdoutRows = res.rows.filter((r) => r.split === 'val' || r.split === 'test');
  const source = holdoutRows.length >= 2 ? holdoutRows : res.rows;
  const n = source.length;
  if (n === 0) {
    return {
      rSquared: res.linearFit.rSquared,
      rmse: res.linearFit.rmse,
      mae: computeMae(res.rows),
      standardError: res.linearFit.meanLtvSe,
      ci95Lower: res.linearFit.ci95Lower,
      ci95Upper: res.linearFit.ci95Upper,
      hasHoldout: false,
    };
  }
  const actuals = source.map((r) => r.targetLtvWinsorized);
  const preds = source.map((r) => r.predictedHorizonLtv);
  const meanAct = actuals.reduce((a, b) => a + b, 0) / n;
  const meanPred = preds.reduce((a, b) => a + b, 0) / n;

  let sse = 0;
  let sst = 0;
  let absErr = 0;
  for (let i = 0; i < n; i++) {
    const err = preds[i] - actuals[i];
    sse += err * err;
    absErr += Math.abs(err);
    const dev = actuals[i] - meanAct;
    sst += dev * dev;
  }
  const rmse = Math.sqrt(sse / n);
  const mae = absErr / n;
  const rSquared =
    n >= 3 && sst > 1e-6 ? Math.round((1 - sse / sst) * 1000) / 1000 : res.linearFit.rSquared;
  const se = rmse / Math.sqrt(n);
  return {
    rSquared,
    rmse: Math.round(rmse * 100) / 100,
    mae: Math.round(mae * 100) / 100,
    standardError: Math.round(se * 100) / 100,
    ci95Lower: Math.max(0, Math.round((meanPred - 1.96 * se) * 100) / 100),
    ci95Upper: Math.round((meanPred + 1.96 * se) * 100) / 100,
    hasHoldout: holdoutRows.length >= 2,
  };
}

function summarizeConfig(cfg: RegressionConfig): string {
  const norm =
    cfg.featureNormalization === 'zscore'
      ? 'Z-Score'
      : cfg.featureNormalization === 'minmax'
      ? 'Min-Max'
      : 'Raw';
  const win = cfg.winsorizePercentile === 0 ? 'No Win' : `P${cfg.winsorizePercentile}`;
  return `T_obs ${cfg.obsCutoffDay}d · H ${cfg.horizonDays}d · ${norm} · ${win} · ${cfg.selectedFeatures.length}f`;
}

interface ConfigEditorPanelProps {
  label: string;
  accentColor: 'slate' | 'blue';
  config: RegressionConfig;
  onChange: (next: RegressionConfig) => void;
  onLoadBase: () => void;
  onPromote: () => void;
  maxDay: number;
  result: RegressionResult;
}

const ConfigEditorPanel: React.FC<ConfigEditorPanelProps> = ({
  label,
  accentColor,
  config,
  onChange,
  onLoadBase,
  onPromote,
  maxDay,
  result,
}) => {
  const activeKeys =
    config.selectedFeatures.length > 0
      ? config.selectedFeatures
      : REGRESSION_FEATURE_CATALOG.map((f) => f.key);

  const toggleFeature = (key: RegressionFeatureKey) => {
    const isSelected = activeKeys.includes(key);
    if (isSelected) {
      if (activeKeys.length <= 1) return;
      onChange({
        ...config,
        selectedFeatures: activeKeys.filter((k) => k !== key),
      });
    } else {
      const nextSet = new Set([...activeKeys, key]);
      onChange({
        ...config,
        selectedFeatures: REGRESSION_FEATURE_CATALOG.filter((f) =>
          nextSet.has(f.key)
        ).map((f) => f.key),
      });
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-200">
        <div className="flex items-center gap-2">
          <span
            className={`w-2.5 h-2.5 rounded-xs shrink-0 ${
              accentColor === 'blue' ? 'bg-blue-700' : 'bg-slate-700'
            }`}
            aria-hidden="true"
          />
          <div>
            <h2 className="text-sm font-semibold text-slate-900">{label}</h2>
            <div className="text-[11px] font-mono text-slate-500 mt-0.5 tabular-nums">
              R² {result.linearFit.rSquared.toFixed(3)} · RMSE $
              {result.linearFit.rmse.toFixed(2)} · n = {result.rows.length}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <button
            type="button"
            onClick={onLoadBase}
            className="px-2.5 py-1 text-[11px] font-medium text-slate-700 bg-slate-50 border border-slate-200 rounded hover:bg-slate-100 transition-colors whitespace-nowrap"
          >
            Sync Active Tab
          </button>
          <button
            type="button"
            onClick={onPromote}
            className="px-2.5 py-1 text-[11px] font-medium text-blue-700 bg-blue-50/70 border border-blue-200 rounded hover:bg-blue-100/70 transition-colors whitespace-nowrap"
          >
            Apply to Regression
          </button>
        </div>
      </div>

      {/* Hyperparameters Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <div className="flex items-center justify-between text-xs mb-1.5">
            <label className="font-medium text-slate-700">
              Observation Cutoff (T_obs)
            </label>
            <span className="font-mono font-semibold text-slate-900 tabular-nums">
              Day {config.obsCutoffDay}
            </span>
          </div>
          <input
            type="range"
            min={60}
            max={Math.max(90, maxDay - 60)}
            step={15}
            value={config.obsCutoffDay}
            onChange={(e) =>
              onChange({ ...config, obsCutoffDay: Number(e.target.value) })
            }
            className="w-full accent-blue-700"
          />
        </div>

        <div>
          <div className="text-xs font-medium text-slate-700 mb-1.5">
            Prediction Horizon (H)
          </div>
          <div className="grid grid-cols-4 gap-1 p-1 bg-slate-100 rounded-md">
            {[60, 90, 120, 180].map((h) => (
              <button
                key={h}
                type="button"
                onClick={() => onChange({ ...config, horizonDays: h })}
                className={`py-1 text-xs font-mono rounded transition-colors ${
                  config.horizonDays === h
                    ? 'bg-white text-slate-900 font-semibold shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {h}d
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="text-xs font-medium text-slate-700 mb-1.5">
            Feature Normalization
          </div>
          <div className="grid grid-cols-3 gap-1 p-1 bg-slate-100 rounded-md">
            {(
              [
                { id: 'none', label: 'None' },
                { id: 'zscore', label: 'Z-Score' },
                { id: 'minmax', label: 'Min-Max' },
              ] as { id: RegressionNormalizationMode; label: string }[]
            ).map((mode) => (
              <button
                key={mode.id}
                type="button"
                onClick={() =>
                  onChange({ ...config, featureNormalization: mode.id })
                }
                className={`py-1 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                  config.featureNormalization === mode.id
                    ? 'bg-white text-slate-900 font-semibold shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {mode.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="text-xs font-medium text-slate-700 mb-1.5">
            Winsorization &amp; Cold-Start
          </div>
          <div className="flex items-center gap-2">
            <div className="flex-1 grid grid-cols-3 gap-1 p-1 bg-slate-100 rounded-md">
              {([0, 95, 99] as const).map((pct) => (
                <button
                  key={pct}
                  type="button"
                  onClick={() => onChange({ ...config, winsorizePercentile: pct })}
                  className={`py-1 text-xs font-mono rounded transition-colors ${
                    config.winsorizePercentile === pct
                      ? 'bg-white text-slate-900 font-semibold shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {pct === 0 ? 'None' : `P${pct}`}
                </button>
              ))}
            </div>
            <label
              className="flex items-center gap-1.5 text-[11px] text-slate-700 cursor-pointer select-none whitespace-nowrap"
              title="Exclude entities with 0 events before T_obs"
            >
              <input
                type="checkbox"
                checked={config.excludeZeroObsEntities}
                onChange={(e) =>
                  onChange({
                    ...config,
                    excludeZeroObsEntities: e.target.checked,
                  })
                }
                className="w-3.5 h-3.5 rounded border-slate-300 text-blue-700 focus:ring-blue-600"
              />
              <span>No 0-obs</span>
            </label>
          </div>
        </div>
      </div>

      {/* Feature Set Selection */}
      <div className="pt-3 border-t border-slate-200">
        <div className="flex items-center justify-between gap-2 mb-2">
          <span className="text-xs font-medium text-slate-700">
            Input Features ({activeKeys.length}/{REGRESSION_FEATURE_CATALOG.length})
          </span>
          <div className="flex items-center gap-2.5 text-[11px]">
            <button
              type="button"
              onClick={() =>
                onChange({
                  ...config,
                  selectedFeatures: ['monetarySumObs', 'txCountObs', 'recencyAtCutoff'],
                })
              }
              className="text-slate-600 hover:text-slate-900 font-medium"
            >
              Core RFM (3)
            </button>
            <span className="text-slate-300" aria-hidden="true">|</span>
            <button
              type="button"
              onClick={() =>
                onChange({
                  ...config,
                  selectedFeatures: REGRESSION_FEATURE_CATALOG.map((f) => f.key),
                })
              }
              className="text-blue-700 hover:text-blue-800 font-medium"
            >
              All (7)
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
          {REGRESSION_FEATURE_CATALOG.map((feat) => {
            const isSelected = activeKeys.includes(feat.key);
            const isLast = isSelected && activeKeys.length <= 1;
            return (
              <button
                key={feat.key}
                type="button"
                aria-pressed={isSelected}
                disabled={isLast}
                onClick={() => toggleFeature(feat.key)}
                className={`px-2 py-1.5 rounded border text-left transition-colors flex items-center justify-between gap-1.5 ${
                  isSelected
                    ? accentColor === 'blue'
                      ? 'bg-blue-50/70 border-blue-200 text-slate-900'
                      : 'bg-slate-100 border-slate-300 text-slate-900'
                    : 'bg-white border-slate-200 text-slate-400 hover:text-slate-700'
                } ${isLast ? 'cursor-not-allowed' : 'cursor-pointer'}`}
                title={feat.csvColumn}
              >
                <span className="text-[11px] font-medium truncate">
                  {feat.shortLabel}
                </span>
                <span
                  className={`w-3.5 h-3.5 rounded-xs border flex items-center justify-center shrink-0 ${
                    isSelected
                      ? accentColor === 'blue'
                        ? 'bg-blue-700 border-blue-700 text-white'
                        : 'bg-slate-800 border-slate-800 text-white'
                      : 'bg-white border-slate-300 text-transparent'
                  }`}
                  aria-hidden="true"
                >
                  <Check className="w-2.5 h-2.5 stroke-[2.5]" />
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export const ModelComparisonView: React.FC<ModelComparisonViewProps> = ({
  datasetName,
  datasetDomain,
  events,
  globalConfig,
  baseRegConfig,
  regResult,
  seqResult,
  mdpResult,
  rulResult,
  rulConfig,
  maxDay,
  onPromoteConfig,
  onOpenTransformerView,
  onNavigateTab,
}) => {
  const [subView, setSubView] = useState<DashboardSubView>('leaderboard');
  const [familyFilter, setFamilyFilter] = useState<FamilyFilter>('all');
  const [leaderboardSortKey, setLeaderboardSortKey] = useState<LeaderboardSortKey>('r2Holdout');
  const [leaderboardSortDir, setLeaderboardSortDir] = useState<'asc' | 'desc'>('desc');
  const [pinModelAId, setPinModelAId] = useState<string>('ols_active');
  const [pinModelBId, setPinModelBId] = useState<string>(seqResult.transformerEval.architecture);

  const [configA, setConfigA] = useState<RegressionConfig>(() => ({
    ...baseRegConfig,
    featureNormalization: 'none',
    selectedFeatures: REGRESSION_FEATURE_CATALOG.map((f) => f.key),
  }));

  const [configB, setConfigB] = useState<RegressionConfig>(() => ({
    ...baseRegConfig,
    featureNormalization: 'zscore',
    selectedFeatures: [
      'monetarySumObs',
      'txCountObs',
      'recencyAtCutoff',
      'avgOrderValueObs',
    ],
  }));

  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<DeltaSortKey>('predDelta');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [inspectedEntityId, setInspectedEntityId] = useState<string | null>(null);

  const resultA = useMemo(
    () => buildRegressionDataset(events, configA, globalConfig),
    [events, configA, globalConfig]
  );

  const resultB = useMemo(
    () => buildRegressionDataset(events, configB, globalConfig),
    [events, configB, globalConfig]
  );

  const maeA = useMemo(() => computeMae(resultA.rows), [resultA.rows]);
  const maeB = useMemo(() => computeMae(resultB.rows), [resultB.rows]);

  const r2Delta = resultB.linearFit.rSquared - resultA.linearFit.rSquared;
  const rmseDelta = resultB.linearFit.rmse - resultA.linearFit.rmse;
  const maeDelta = maeB - maeA;

  // Unified Cross-Paradigm Predictive Model Leaderboard (Tabular OLS + Sequence + Transformer)
  const unifiedLeaderboard = useMemo<UnifiedBenchmarkEntry[]>(() => {
    const activeHoldout = computeRegressionHoldoutStats(regResult);
    const holdoutA = computeRegressionHoldoutStats(resultA);
    const holdoutB = computeRegressionHoldoutStats(resultB);

    const activeTrainR2 =
      regResult.evaluationMatrix.splitMetrics.find((m) => m.split === 'train')?.rSquared ?? null;

    const entries: UnifiedBenchmarkEntry[] = [
      {
        id: 'ols_active',
        shortLabel: 'OLS Active',
        modelName: 'Tabular OLS (Workspace Active)',
        familyKey: 'tabular_ols',
        familyLabel: 'Tabular OLS',
        specSummary: summarizeConfig(baseRegConfig),
        isActive: true,
        paramCount: baseRegConfig.selectedFeatures.length + 1,
        r2All: regResult.linearFit.rSquared,
        r2Holdout: activeHoldout.rSquared,
        overfitGap:
          activeTrainR2 !== null ? Math.round((activeTrainR2 - activeHoldout.rSquared) * 1000) / 1000 : null,
        rmseHoldout: activeHoldout.rmse,
        maeHoldout: activeHoldout.mae,
        standardError: activeHoldout.standardError,
        ci95Lower: activeHoldout.ci95Lower,
        ci95Upper: activeHoldout.ci95Upper,
        meanAttentionEntropy: null,
        actionTarget: { type: 'regression' },
      },
      {
        id: 'ols_config_a',
        shortLabel: 'OLS Config A',
        modelName: 'Tabular OLS (A/B Baseline)',
        familyKey: 'tabular_ols',
        familyLabel: 'Tabular OLS',
        specSummary: summarizeConfig(configA),
        isActive: false,
        paramCount: configA.selectedFeatures.length + 1,
        r2All: resultA.linearFit.rSquared,
        r2Holdout: holdoutA.rSquared,
        overfitGap:
          resultA.evaluationMatrix.overfitDeltaR2 !== null
            ? resultA.evaluationMatrix.overfitDeltaR2
            : null,
        rmseHoldout: holdoutA.rmse,
        maeHoldout: holdoutA.mae,
        standardError: holdoutA.standardError,
        ci95Lower: holdoutA.ci95Lower,
        ci95Upper: holdoutA.ci95Upper,
        meanAttentionEntropy: null,
        actionTarget: { type: 'ab_lab' },
      },
      {
        id: 'ols_config_b',
        shortLabel: 'OLS Config B',
        modelName: 'Tabular OLS (A/B Challenger)',
        familyKey: 'tabular_ols',
        familyLabel: 'Tabular OLS',
        specSummary: summarizeConfig(configB),
        isActive: false,
        paramCount: configB.selectedFeatures.length + 1,
        r2All: resultB.linearFit.rSquared,
        r2Holdout: holdoutB.rSquared,
        overfitGap:
          resultB.evaluationMatrix.overfitDeltaR2 !== null
            ? resultB.evaluationMatrix.overfitDeltaR2
            : null,
        rmseHoldout: holdoutB.rmse,
        maeHoldout: holdoutB.mae,
        standardError: holdoutB.standardError,
        ci95Lower: holdoutB.ci95Lower,
        ci95Upper: holdoutB.ci95Upper,
        meanAttentionEntropy: null,
        actionTarget: { type: 'ab_lab' },
      },
    ];

    for (const b of seqResult.transformerEval.benchmarks) {
      const familyKey: UnifiedBenchmarkEntry['familyKey'] =
        b.family === 'Transformer'
          ? 'transformer'
          : b.family === 'Recurrent Baseline'
          ? 'recurrent'
          : 'tabular_ols';
      const r2Hold = b.rSquaredHoldout ?? b.rSquaredAll;
      const r2All = b.rSquaredAll;
      const shortLabel =
        b.modelId === 'ols_linear'
          ? 'Seq Mean-Pool'
          : b.modelId === 'gru_seq'
          ? 'GRU Seq'
          : b.modelId === 'transformer_encoder'
          ? 'Tx Encoder'
          : b.modelId === 'causal_gpt'
          ? 'Causal GPT'
          : 'Temporal Fusion';

      entries.push({
        id: `seq_${b.modelId}`,
        shortLabel,
        modelName: b.modelName,
        familyKey,
        familyLabel: b.family,
        specSummary:
          b.modelId === 'ols_linear'
            ? `Pooled Sequence Features · ${seqResult.tensorShape[1]} steps`
            : `d=${seqResult.transformerEval.dModel}, ${seqResult.transformerEval.numHeads}h, ${seqResult.transformerEval.numLayers}L`,
        isActive: b.isActive,
        paramCount: b.paramCount,
        r2All,
        r2Holdout: r2Hold,
        overfitGap:
          b.isActive && seqResult.transformerEval.overfitDeltaR2 !== null
            ? seqResult.transformerEval.overfitDeltaR2
            : r2All !== null && r2Hold !== null
            ? Math.round((r2All - r2Hold) * 1000) / 1000
            : null,
        rmseHoldout: b.rmseHoldout ?? b.rmseAll,
        maeHoldout: b.maeHoldout ?? b.maeAll,
        standardError: b.standardError,
        ci95Lower: b.ci95Lower,
        ci95Upper: b.ci95Upper,
        meanAttentionEntropy: b.meanAttentionEntropy,
        actionTarget:
          b.family === 'Transformer'
            ? { type: 'transformer', arch: b.modelId as TransformerArchitectureId }
            : { type: 'transformer' },
      });
    }

    return entries;
  }, [regResult, resultA, resultB, baseRegConfig, configA, configB, seqResult]);

  const sortedLeaderboard = useMemo(() => {
    const filtered =
      familyFilter === 'all'
        ? unifiedLeaderboard
        : unifiedLeaderboard.filter((m) => m.familyKey === familyFilter);

    return [...filtered].sort((a, b) => {
      const readVal = (item: UnifiedBenchmarkEntry): number => {
        if (leaderboardSortKey === 'r2Holdout') return item.r2Holdout ?? -999;
        if (leaderboardSortKey === 'r2All') return item.r2All ?? -999;
        if (leaderboardSortKey === 'rmseHoldout') return item.rmseHoldout;
        if (leaderboardSortKey === 'maeHoldout') return item.maeHoldout;
        if (leaderboardSortKey === 'paramCount') return item.paramCount;
        return item.standardError;
      };
      const va = readVal(a);
      const vb = readVal(b);
      return leaderboardSortDir === 'asc' ? va - vb : vb - va;
    });
  }, [unifiedLeaderboard, familyFilter, leaderboardSortKey, leaderboardSortDir]);

  const topR2Model = useMemo(() => {
    return [...unifiedLeaderboard].sort(
      (a, b) => (b.r2Holdout ?? -999) - (a.r2Holdout ?? -999)
    )[0];
  }, [unifiedLeaderboard]);

  const lowestRmseModel = useMemo(() => {
    return [...unifiedLeaderboard].sort((a, b) => a.rmseHoldout - b.rmseHoldout)[0];
  }, [unifiedLeaderboard]);

  const linearBaselineRef = useMemo(
    () =>
      unifiedLeaderboard.find((m) => m.id === 'seq_ols_linear') ??
      unifiedLeaderboard.find((m) => m.id === 'ols_active') ??
      unifiedLeaderboard[0],
    [unifiedLeaderboard]
  );

  // Pin A vs B Head-to-Head resolution
  const effectivePinA = useMemo(
    () => unifiedLeaderboard.find((m) => m.id === pinModelAId) ?? unifiedLeaderboard[0],
    [unifiedLeaderboard, pinModelAId]
  );
  const effectivePinB = useMemo(() => {
    const candidate = unifiedLeaderboard.find((m) => m.id === pinModelBId);
    if (candidate) return candidate;
    return (
      unifiedLeaderboard.find((m) => m.id === `seq_${seqResult.transformerEval.architecture}`) ??
      unifiedLeaderboard[unifiedLeaderboard.length - 1]
    );
  }, [unifiedLeaderboard, pinModelBId, seqResult.transformerEval.architecture]);

  // RUL Backtest: EMA Trend vs Linear Extrapolation at 65% lifecycle prefix
  const rulBacktest = useMemo(() => {
    const candidates = rulResult.unitSummaries.filter((u) => u.eventCount >= 4).slice(0, 60);
    const rowsByEntity = new Map<string, typeof rulResult.cycleRows>();
    for (const r of rulResult.cycleRows) {
      const arr = rowsByEntity.get(r.entityId) ?? [];
      arr.push(r);
      rowsByEntity.set(r.entityId, arr);
    }

    const perUnit: Array<{
      entityId: string;
      actualEolDay: number;
      emaPredEol: number | null;
      emaAbsErr: number | null;
      linearPredEol: number | null;
      linearAbsErr: number | null;
      winner: 'EMA' | 'Linear' | 'Tie' | '—';
    }> = [];

    const emaErrors: number[] = [];
    const linearErrors: number[] = [];
    const emaSigned: number[] = [];
    const linearSigned: number[] = [];
    let emaWithin15 = 0;
    let linearWithin15 = 0;

    for (const u of candidates) {
      const uRows = rowsByEntity.get(u.entityId) ?? [];
      if (uRows.length < 4) continue;

      const evalForecaster = (method: 'ema' | 'linear') => {
        const hProj = computeEntityRulProjection({
          entityId: u.entityId,
          unitRows: uRows,
          summary: u,
          axisMode: 'calendar_day',
          metricMode: 'health_pct',
          method,
          anchorMode: 'mid_life_65',
          obsCutoffDay: baseRegConfig.obsCutoffDay,
          emaAlpha: 0.45,
          horizonX: 240,
          rulCap: rulConfig.rulCap,
          signalFailureCeiling: 150,
        });
        if (hProj.projectedFailureX !== null) {
          return {
            predEol: hProj.projectedFailureX,
            signedErr: hProj.projectedFailureX - u.eolDay,
          };
        }
        const rProj = computeEntityRulProjection({
          entityId: u.entityId,
          unitRows: uRows,
          summary: u,
          axisMode: 'calendar_day',
          metricMode: 'rul_raw',
          method,
          anchorMode: 'mid_life_65',
          obsCutoffDay: baseRegConfig.obsCutoffDay,
          emaAlpha: 0.45,
          horizonX: 240,
          rulCap: rulConfig.rulCap,
          signalFailureCeiling: 150,
        });
        if (rProj.projectedFailureX !== null) {
          return {
            predEol: rProj.projectedFailureX,
            signedErr: rProj.projectedFailureX - u.eolDay,
          };
        }
        return null;
      };

      const emaRes = evalForecaster('ema');
      const linRes = evalForecaster('linear');

      const emaAbs = emaRes ? Math.round(Math.abs(emaRes.signedErr) * 10) / 10 : null;
      const linAbs = linRes ? Math.round(Math.abs(linRes.signedErr) * 10) / 10 : null;

      if (emaRes && emaAbs !== null) {
        emaErrors.push(emaAbs);
        emaSigned.push(emaRes.signedErr);
        if (emaAbs <= 15) emaWithin15 += 1;
      }
      if (linRes && linAbs !== null) {
        linearErrors.push(linAbs);
        linearSigned.push(linRes.signedErr);
        if (linAbs <= 15) linearWithin15 += 1;
      }

      let winner: 'EMA' | 'Linear' | 'Tie' | '—' = '—';
      if (emaAbs !== null && linAbs !== null) {
        winner = Math.abs(emaAbs - linAbs) < 0.5 ? 'Tie' : emaAbs < linAbs ? 'EMA' : 'Linear';
      } else if (emaAbs !== null) {
        winner = 'EMA';
      } else if (linAbs !== null) {
        winner = 'Linear';
      }

      perUnit.push({
        entityId: u.entityId,
        actualEolDay: u.eolDay,
        emaPredEol: emaRes ? Math.round(emaRes.predEol * 10) / 10 : null,
        emaAbsErr: emaAbs,
        linearPredEol: linRes ? Math.round(linRes.predEol * 10) / 10 : null,
        linearAbsErr: linAbs,
        winner,
      });
    }

    const summarize = (errs: number[], signed: number[], within15: number, total: number) => {
      if (errs.length === 0) {
        return { mae: 0, rmse: 0, bias: 0, hit15Pct: 0, coveragePct: 0, count: 0 };
      }
      const mae = errs.reduce((a, b) => a + b, 0) / errs.length;
      const rmse = Math.sqrt(errs.reduce((a, b) => a + b * b, 0) / errs.length);
      const bias = signed.reduce((a, b) => a + b, 0) / signed.length;
      return {
        mae: Math.round(mae * 10) / 10,
        rmse: Math.round(rmse * 10) / 10,
        bias: Math.round(bias * 10) / 10,
        hit15Pct: Math.round((within15 / errs.length) * 1000) / 10,
        coveragePct: Math.round((errs.length / Math.max(1, total)) * 1000) / 10,
        count: errs.length,
      };
    };

    const emaStats = summarize(emaErrors, emaSigned, emaWithin15, candidates.length);
    const linearStats = summarize(linearErrors, linearSigned, linearWithin15, candidates.length);

    const bestModel =
      emaStats.count > 0 && linearStats.count > 0
        ? emaStats.mae <= linearStats.mae
          ? 'EMA Trend (α=0.45)'
          : 'Linear Extrapolation'
        : emaStats.count > 0
        ? 'EMA Trend (α=0.45)'
        : 'Linear Extrapolation';

    return {
      sampleCount: candidates.length,
      emaStats,
      linearStats,
      bestModel,
      bestMae: Math.min(
        emaStats.count > 0 ? emaStats.mae : 999,
        linearStats.count > 0 ? linearStats.mae : 999
      ),
      bestHit15Pct:
        bestModel.startsWith('EMA') ? emaStats.hit15Pct : linearStats.hit15Pct,
      chartData: [
        { metric: 'EOL MAE (days)', ema: emaStats.mae, linear: linearStats.mae },
        { metric: 'EOL RMSE (days)', ema: emaStats.rmse, linear: linearStats.rmse },
        {
          metric: '|Mean Bias| (days)',
          ema: Math.round(Math.abs(emaStats.bias) * 10) / 10,
          linear: Math.round(Math.abs(linearStats.bias) * 10) / 10,
        },
      ],
      perUnit: perUnit.slice(0, 20),
    };
  }, [rulResult, baseRegConfig.obsCutoffDay, rulConfig.rulCap]);

  // Offline RL Policy Comparison from mdpResult
  const rlPolicyComparison = useMemo(() => {
    const allTrans = mdpResult.transitions;
    const inSupport = allTrans.filter((t) => !t.isLowSupportOod);
    const bestAction = [...mdpResult.actionBreakdown].sort(
      (a, b) => b.meanReturnToGo - a.meanReturnToGo
    )[0];
    const bestActionTrans = bestAction
      ? allTrans.filter((t) => t.actionId === bestAction.actionId)
      : [];

    const avg = (arr: typeof allTrans, pick: (t: (typeof allTrans)[number]) => number) =>
      arr.length > 0
        ? Math.round((arr.reduce((a, t) => a + pick(t), 0) / arr.length) * 100) / 100
        : 0;

    return {
      policies: [
        {
          name: 'Empirical Behavior Policy',
          criteria: 'All observed dataset transitions',
          transitionCount: allTrans.length,
          meanReward: avg(allTrans, (t) => t.rewardScaled),
          meanReturnToGo: avg(allTrans, (t) => t.returnToGo),
          oodSharePct: Math.round(mdpResult.lowSupportOodRate * 1000) / 10,
        },
        {
          name: 'Conservative In-Support (CQL-Safe)',
          criteria: 'Support ≥ min threshold (0% OOD leakage)',
          transitionCount: inSupport.length,
          meanReward: avg(inSupport, (t) => t.rewardScaled),
          meanReturnToGo: avg(inSupport, (t) => t.returnToGo),
          oodSharePct: 0,
        },
        {
          name: bestAction
            ? `Action-Focused: ${bestAction.actionLabel}`
            : 'Best Action Subset',
          criteria: 'Highest empirical mean Return-to-Go action',
          transitionCount: bestActionTrans.length,
          meanReward: bestAction ? Math.round(bestAction.meanReward * 100) / 100 : 0,
          meanReturnToGo: bestAction ? Math.round(bestAction.meanReturnToGo * 100) / 100 : 0,
          oodSharePct:
            bestAction && bestAction.count > 0
              ? Math.round((bestAction.lowSupportCount / bestAction.count) * 1000) / 10
              : 0,
        },
      ],
      bestActionLabel: bestAction?.actionLabel ?? '—',
      cqlSafeReturn: avg(inSupport, (t) => t.returnToGo),
      behaviorReturn: avg(allTrans, (t) => t.returnToGo),
    };
  }, [mdpResult]);

  const featureComparisonData = useMemo(() => {
    const mapA = new Map(resultA.linearFit.features.map((f) => [f.feature, f]));
    const mapB = new Map(resultB.linearFit.features.map((f) => [f.feature, f]));

    return REGRESSION_FEATURE_CATALOG.map((feat) => {
      const fA = mapA.get(feat.key);
      const fB = mapB.get(feat.key);
      return {
        feature: feat.shortLabel,
        label: feat.label,
        betaA: fA ? Math.abs(fA.standardizedBeta) : 0,
        betaB: fB ? Math.abs(fB.standardizedBeta) : 0,
        r2A: fA ? fA.univariateR2 : 0,
        r2B: fB ? fB.univariateR2 : 0,
      };
    });
  }, [resultA.linearFit.features, resultB.linearFit.features]);

  const r2SummaryBars = useMemo(
    () => [
      {
        metric: 'Joint OLS R²',
        modelA: resultA.linearFit.rSquared,
        modelB: resultB.linearFit.rSquared,
      },
      {
        metric: 'Top Feature R²',
        modelA: Math.max(0, ...resultA.linearFit.features.map((f) => f.univariateR2)),
        modelB: Math.max(0, ...resultB.linearFit.features.map((f) => f.univariateR2)),
      },
    ],
    [resultA.linearFit, resultB.linearFit]
  );

  // Shared axis domain for side-by-side Predicted vs Observed scatter plots
  const { scatterA, scatterB, sharedAxisMax } = useMemo(() => {
    let maxVal = 100;
    const toSplits = (rows: RegressionRow[]) => {
      const train: ScatterOutcomePoint[] = [];
      const val: ScatterOutcomePoint[] = [];
      const test: ScatterOutcomePoint[] = [];
      for (const r of rows) {
        maxVal = Math.max(maxVal, r.targetLtvWinsorized, r.predictedHorizonLtv);
        const pt: ScatterOutcomePoint = {
          entityId: r.entityId,
          split: r.split,
          observed: r.targetLtvWinsorized,
          predicted: r.predictedHorizonLtv,
          residual:
            Math.round((r.predictedHorizonLtv - r.targetLtvWinsorized) * 100) / 100,
        };
        if (r.split === 'train') train.push(pt);
        else if (r.split === 'val') val.push(pt);
        else test.push(pt);
      }
      return { train, val, test };
    };

    const sA = toSplits(resultA.rows);
    const sB = toSplits(resultB.rows);
    const paddedMax = Math.ceil((maxVal * 1.08) / 50) * 50;
    return {
      scatterA: sA,
      scatterB: sB,
      sharedAxisMax: Math.max(100, paddedMax),
    };
  }, [resultA.rows, resultB.rows]);

  // Entity-level A vs B outcome rows
  const entityComparisonRows = useMemo(() => {
    const mapB = new Map(resultB.rows.map((r) => [r.entityId, r]));
    const joined: EntityComparisonRow[] = [];

    for (const rA of resultA.rows) {
      const rB = mapB.get(rA.entityId);
      if (!rB) continue;
      const errA = Math.abs(rA.predictedHorizonLtv - rA.targetLtvWinsorized);
      const errB = Math.abs(rB.predictedHorizonLtv - rB.targetLtvWinsorized);
      const closerModel: EntityComparisonRow['closerModel'] =
        Math.abs(errA - errB) < 0.5 ? 'Tie' : errB < errA ? 'B' : 'A';
      joined.push({
        entityId: rA.entityId,
        split: rA.split,
        observedA: rA.targetLtvWinsorized,
        predictedA: rA.predictedHorizonLtv,
        absErrA: Math.round(errA * 100) / 100,
        observedB: rB.targetLtvWinsorized,
        predictedB: rB.predictedHorizonLtv,
        absErrB: Math.round(errB * 100) / 100,
        predDelta:
          Math.round((rB.predictedHorizonLtv - rA.predictedHorizonLtv) * 100) / 100,
        closerModel,
      });
    }
    return joined;
  }, [resultA.rows, resultB.rows]);

  const bWinRate = useMemo(() => {
    if (entityComparisonRows.length === 0) return { aWins: 0, bWins: 0, ties: 0 };
    let aWins = 0;
    let bWins = 0;
    let ties = 0;
    for (const row of entityComparisonRows) {
      if (row.closerModel === 'B') bWins += 1;
      else if (row.closerModel === 'A') aWins += 1;
      else ties += 1;
    }
    return { aWins, bWins, ties };
  }, [entityComparisonRows]);

  const filteredDeltaRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q
      ? entityComparisonRows.filter((r) => r.entityId.toLowerCase().includes(q))
      : entityComparisonRows;

    return [...list]
      .sort((a, b) => {
        const readVal = (row: EntityComparisonRow) => {
          if (sortKey === 'entityId') return row.entityId;
          if (sortKey === 'predDelta') return Math.abs(row.predDelta);
          if (sortKey === 'absErrDiff') return row.absErrA - row.absErrB;
          return row[sortKey];
        };
        const va = readVal(a);
        const vb = readVal(b);
        if (typeof va === 'string' && typeof vb === 'string') {
          return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
        }
        return sortDir === 'asc'
          ? Number(va) - Number(vb)
          : Number(vb) - Number(va);
      })
      .slice(0, 80);
  }, [entityComparisonRows, search, sortKey, sortDir]);

  const toggleSort = (key: DeltaSortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  const toggleLeaderboardSort = (key: LeaderboardSortKey) => {
    if (leaderboardSortKey === key) {
      setLeaderboardSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setLeaderboardSortKey(key);
      setLeaderboardSortDir(key === 'rmseHoldout' || key === 'maeHoldout' ? 'asc' : 'desc');
    }
  };

  const handleExportBenchmarkCsv = () => {
    const header =
      'model_id,model_name,family,params,r2_all,r2_holdout,overfit_gap,rmse_holdout,mae_holdout,se,ci95_lower,ci95_upper,spec';
    const lines = sortedLeaderboard.map((m) =>
      [
        m.id,
        `"${m.modelName.replace(/"/g, '""')}"`,
        `"${m.familyLabel}"`,
        m.paramCount,
        m.r2All ?? '',
        m.r2Holdout ?? '',
        m.overfitGap ?? '',
        m.rmseHoldout,
        m.maeHoldout,
        m.standardError,
        m.ci95Lower,
        m.ci95Upper,
        `"${m.specSummary.replace(/"/g, '""')}"`,
      ].join(',')
    );
    triggerDownload('stratum_model_comparison_leaderboard.csv', [header, ...lines].join('\n'), 'text/csv');
  };

  const applyPresetScenario = (
    scenario: 'norm_vs_raw' | 'all_vs_rfm' | 'winsor_vs_raw' | 'horizon_180_90'
  ) => {
    const allKeys = REGRESSION_FEATURE_CATALOG.map((f) => f.key);
    if (scenario === 'norm_vs_raw') {
      setConfigA({ ...baseRegConfig, featureNormalization: 'none', selectedFeatures: allKeys });
      setConfigB({ ...baseRegConfig, featureNormalization: 'zscore', selectedFeatures: allKeys });
    } else if (scenario === 'all_vs_rfm') {
      setConfigA({ ...baseRegConfig, featureNormalization: 'zscore', selectedFeatures: allKeys });
      setConfigB({
        ...baseRegConfig,
        featureNormalization: 'zscore',
        selectedFeatures: ['monetarySumObs', 'txCountObs', 'recencyAtCutoff'],
      });
    } else if (scenario === 'winsor_vs_raw') {
      setConfigA({ ...baseRegConfig, winsorizePercentile: 0, selectedFeatures: allKeys });
      setConfigB({ ...baseRegConfig, winsorizePercentile: 95, selectedFeatures: allKeys });
    } else {
      setConfigA({ ...baseRegConfig, horizonDays: 180, selectedFeatures: allKeys });
      setConfigB({ ...baseRegConfig, horizonDays: 90, selectedFeatures: allKeys });
    }
  };

  const handleSwap = () => {
    const prevA = configA;
    setConfigA(configB);
    setConfigB(prevA);
  };

  const handleScatterClick = (point: unknown) => {
    const p = point as { payload?: ScatterOutcomePoint; entityId?: string } | undefined;
    const id = p?.payload?.entityId ?? p?.entityId;
    if (id) {
      setInspectedEntityId(id);
      setSearch(id);
    }
  };

  const renderOutcomeScatter = (
    title: string,
    accent: 'slate' | 'blue',
    cfg: RegressionConfig,
    res: RegressionResult,
    splits: {
      train: ScatterOutcomePoint[];
      val: ScatterOutcomePoint[];
      test: ScatterOutcomePoint[];
    }
  ) => (
    <div className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
        <div>
          <div className="flex items-center gap-2">
            <span
              className={`w-2.5 h-2.5 rounded-xs shrink-0 ${
                accent === 'blue' ? 'bg-blue-700' : 'bg-slate-700'
              }`}
              aria-hidden="true"
            />
            <h3 className="text-xs font-semibold text-slate-900">{title}</h3>
          </div>
          <p className="text-[11px] font-mono text-slate-500 mt-0.5">
            {summarizeConfig(cfg)}
          </p>
        </div>

        <div className="text-right font-mono tabular-nums text-xs">
          <span className="font-semibold text-slate-900">
            R² {res.linearFit.rSquared.toFixed(3)}
          </span>
          <span className="mx-1.5 text-slate-300" aria-hidden="true">
            ·
          </span>
          <span className="text-slate-600">
            RMSE ${res.linearFit.rmse.toFixed(2)}
          </span>
        </div>
      </div>

      {res.rows.length < 3 ? (
        <div className="py-16 text-center text-xs text-slate-500">
          At least 3 materialized entities are required to render outcomes.
        </div>
      ) : (
        <div style={{ width: '100%', height: 310 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ top: 10, right: 16, bottom: 24, left: 6 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis
                type="number"
                dataKey="observed"
                domain={[0, sharedAxisMax]}
                tickFormatter={formatCurrencyCompact}
                tick={{
                  fontSize: 11,
                  fill: '#475569',
                  fontFamily: 'JetBrains Mono, monospace',
                }}
                axisLine={{ stroke: '#cbd5e1' }}
                tickLine={false}
                label={{
                  value: `Observed Target LTV (${cfg.obsCutoffDay + 1}–${
                    cfg.obsCutoffDay + cfg.horizonDays
                  }d)`,
                  position: 'insideBottom',
                  offset: -14,
                  fontSize: 11,
                  fill: '#64748b',
                }}
              />
              <YAxis
                type="number"
                dataKey="predicted"
                domain={[0, sharedAxisMax]}
                tickFormatter={formatCurrencyCompact}
                width={58}
                tick={{
                  fontSize: 11,
                  fill: '#475569',
                  fontFamily: 'JetBrains Mono, monospace',
                }}
                axisLine={{ stroke: '#cbd5e1' }}
                tickLine={false}
                label={{
                  value: 'Predicted LTV ($)',
                  angle: -90,
                  position: 'insideLeft',
                  offset: 4,
                  style: { textAnchor: 'middle', fontSize: 11, fill: '#64748b' },
                }}
              />
              <ReferenceLine
                segment={[
                  { x: 0, y: 0 },
                  { x: sharedAxisMax, y: sharedAxisMax },
                ]}
                stroke="#94a3b8"
                strokeDasharray="4 4"
                strokeWidth={1.5}
              />
              <Tooltip
                cursor={{ strokeDasharray: '3 3', stroke: '#94a3b8' }}
                content={({ active, payload }) => {
                  if (!active || !payload || payload.length === 0) return null;
                  const d = payload[0]?.payload as ScatterOutcomePoint | undefined;
                  if (!d) return null;
                  return (
                    <div className="bg-white border border-slate-200 rounded-md shadow-md px-3 py-2 text-xs space-y-1">
                      <div className="flex items-center justify-between gap-4">
                        <span className="font-mono font-semibold text-slate-900">
                          {d.entityId}
                        </span>
                        <span className="font-mono text-[11px] uppercase text-slate-500">
                          {d.split}
                        </span>
                      </div>
                      <div className="font-mono text-slate-700 tabular-nums">
                        Observed: {formatCurrencyFull(d.observed)}
                      </div>
                      <div className="font-mono text-blue-700 font-semibold tabular-nums">
                        Predicted: {formatCurrencyFull(d.predicted)}
                      </div>
                      <div className="font-mono text-slate-600 tabular-nums pt-0.5 border-t border-slate-100">
                        Residual: {d.residual >= 0 ? '+' : ''}
                        {formatCurrencyFull(d.residual)}
                      </div>
                    </div>
                  );
                }}
              />
              {splits.train.length > 0 && (
                <Scatter
                  name="Train"
                  data={splits.train}
                  fill="#1d4ed8"
                  fillOpacity={0.7}
                  isAnimationActive={false}
                  onClick={handleScatterClick}
                />
              )}
              {splits.val.length > 0 && (
                <Scatter
                  name="Val"
                  data={splits.val}
                  fill="#d97706"
                  fillOpacity={0.8}
                  isAnimationActive={false}
                  onClick={handleScatterClick}
                />
              )}
              {splits.test.length > 0 && (
                <Scatter
                  name="Test"
                  data={splits.test}
                  fill="#059669"
                  fillOpacity={0.8}
                  isAnimationActive={false}
                  onClick={handleScatterClick}
                />
              )}
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );

  // Chart data for Leaderboard & Benchmarks
  const benchmarkR2ChartData = useMemo(
    () =>
      unifiedLeaderboard.map((m) => ({
        name: m.shortLabel,
        fullName: m.modelName,
        r2All: m.r2All ?? 0,
        r2Holdout: m.r2Holdout ?? 0,
        rmse: m.rmseHoldout,
        mae: m.maeHoldout,
        params: m.paramCount,
      })),
    [unifiedLeaderboard]
  );

  const pinR2Delta =
    effectivePinB && effectivePinA && effectivePinB.r2Holdout !== null && effectivePinA.r2Holdout !== null
      ? effectivePinB.r2Holdout - effectivePinA.r2Holdout
      : 0;
  const pinRmseDelta =
    effectivePinB && effectivePinA ? effectivePinB.rmseHoldout - effectivePinA.rmseHoldout : 0;
  const pinMaeDelta =
    effectivePinB && effectivePinA ? effectivePinB.maeHoldout - effectivePinA.maeHoldout : 0;

  return (
    <div className="space-y-6">
      {/* Unified Dashboard Header & Sub-View Switcher */}
      <div className="flex flex-col xl:flex-row xl:items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <GitCompareArrows className="w-5 h-5 text-blue-700 shrink-0" />
            <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900">
              Model Comparison Dashboard
            </h1>
          </div>
          <p className="text-sm text-slate-600 mt-1 max-w-3xl">
            Evaluate and compare predictive accuracy, generalization gap, error bounds, and policy
            value across Tabular OLS, Deep Sequence Transformers, RUL Prognostics, and Offline RL.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500 font-mono tabular-nums">
            <span>{datasetName}</span>
            <span aria-hidden="true">·</span>
            <span>{datasetDomain}</span>
            <span aria-hidden="true">·</span>
            <span>{unifiedLeaderboard.length} Predictive Models</span>
            <span aria-hidden="true">·</span>
            <span>{rulBacktest.sampleCount} RUL Backtest Units</span>
            <span aria-hidden="true">·</span>
            <span>{mdpResult.transitions.length.toLocaleString()} RL Transitions</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 shrink-0">
          <div className="inline-flex p-1 bg-slate-100 rounded-lg">
            <button
              type="button"
              onClick={() => setSubView('leaderboard')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                subView === 'leaderboard'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Leaderboard &amp; Benchmarks
            </button>
            <button
              type="button"
              onClick={() => setSubView('ab_lab')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                subView === 'ab_lab'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              A/B Regression Lab
            </button>
            <button
              type="button"
              onClick={() => setSubView('rul_rl')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                subView === 'rul_rl'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              RUL &amp; Offline RL
            </button>
          </div>

          <button
            type="button"
            onClick={handleExportBenchmarkCsv}
            className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-md transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
          >
            <Download className="w-3.5 h-3.5 text-slate-500" />
            <span>Export Leaderboard CSV</span>
          </button>
        </div>
      </div>

      {/* Executive Cross-Paradigm Winner KPI Strip */}
      <section className="bg-white border border-slate-200 rounded-lg grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-slate-200">
        <div className="p-5">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Best Holdout Fit (R²)</span>
            <Award className="w-3.5 h-3.5 text-blue-700" />
          </div>
          <div className="mt-1 text-2xl font-bold font-mono tabular-nums text-blue-700">
            {topR2Model?.r2Holdout !== null && topR2Model?.r2Holdout !== undefined
              ? topR2Model.r2Holdout.toFixed(3)
              : '—'}
          </div>
          <div className="mt-1 text-xs font-medium text-slate-900 truncate">
            {topR2Model?.modelName}
          </div>
          <div className="text-[11px] font-mono tabular-nums text-slate-500 mt-0.5">
            {topR2Model?.familyLabel} · RMSE ${topR2Model?.rmseHoldout.toFixed(2)}
          </div>
        </div>

        <div className="p-5">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Lowest Prediction Error (RMSE)</span>
            <BarChart3 className="w-3.5 h-3.5 text-teal-700" />
          </div>
          <div className="mt-1 text-2xl font-bold font-mono tabular-nums text-teal-700">
            ${lowestRmseModel?.rmseHoldout.toFixed(2) ?? '0.00'}
          </div>
          <div className="mt-1 text-xs font-medium text-slate-900 truncate">
            {lowestRmseModel?.modelName}
          </div>
          <div className="text-[11px] font-mono tabular-nums text-slate-500 mt-0.5">
            MAE ${lowestRmseModel?.maeHoldout.toFixed(2)}
            {linearBaselineRef && linearBaselineRef.rmseHoldout > 0
              ? ` · ${(
                  ((lowestRmseModel.rmseHoldout - linearBaselineRef.rmseHoldout) /
                    linearBaselineRef.rmseHoldout) *
                  100
                ).toFixed(1)}% vs baseline`
              : ''}
          </div>
        </div>

        <div className="p-5">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>RUL EOL Backtest Winner</span>
            <Activity className="w-3.5 h-3.5 text-amber-700" />
          </div>
          <div className="mt-1 text-2xl font-bold font-mono tabular-nums text-slate-900">
            {rulBacktest.bestMae < 999 ? `${rulBacktest.bestMae.toFixed(1)}d MAE` : '—'}
          </div>
          <div className="mt-1 text-xs font-medium text-slate-900 truncate">
            {rulBacktest.bestModel}
          </div>
          <div className="text-[11px] font-mono tabular-nums text-slate-500 mt-0.5">
            ±15d hit rate {rulBacktest.bestHit15Pct.toFixed(1)}% · n = {rulBacktest.sampleCount}
          </div>
        </div>

        <div className="p-5">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Offline RL Support Value (CQL)</span>
            <Waypoints className="w-3.5 h-3.5 text-slate-700" />
          </div>
          <div className="mt-1 text-2xl font-bold font-mono tabular-nums text-slate-900">
            {rlPolicyComparison.cqlSafeReturn.toFixed(2)}
          </div>
          <div className="mt-1 text-xs font-medium text-slate-900 truncate">
            Best Action: {rlPolicyComparison.bestActionLabel}
          </div>
          <div className="text-[11px] font-mono tabular-nums text-slate-500 mt-0.5">
            Behavior {rlPolicyComparison.behaviorReturn.toFixed(2)} · OOD{' '}
            {(mdpResult.lowSupportOodRate * 100).toFixed(1)}%
          </div>
        </div>
      </section>

      {/* SUB-VIEW 1: LEADERBOARD & BENCHMARKS */}
      {subView === 'leaderboard' && (
        <>
          {/* Interactive Head-to-Head Model Pinning Comparator */}
          {effectivePinA && effectivePinB && (
            <section className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 pb-3 border-b border-slate-100">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">
                    Head-to-Head Model Comparator
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Pair any two models from Tabular OLS, Recurrent, or Transformer families to inspect exact holdout deltas.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <select
                    aria-label="Baseline model for head-to-head comparison"
                    value={effectivePinA.id}
                    onChange={(e) => setPinModelAId(e.target.value)}
                    className="h-9 px-2.5 text-xs font-medium bg-slate-50 border border-slate-200 rounded-md text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  >
                    {unifiedLeaderboard.map((m) => (
                      <option key={m.id} value={m.id}>
                        Baseline: {m.modelName}
                      </option>
                    ))}
                  </select>

                  <button
                    type="button"
                    onClick={() => {
                      const a = effectivePinA.id;
                      const b = effectivePinB.id;
                      setPinModelAId(b);
                      setPinModelBId(a);
                    }}
                    title="Swap baseline and challenger models"
                    className="h-9 px-2.5 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-md inline-flex items-center gap-1 whitespace-nowrap shrink-0"
                  >
                    <ArrowLeftRight className="w-3.5 h-3.5" />
                    <span>Swap</span>
                  </button>

                  <select
                    aria-label="Challenger model for head-to-head comparison"
                    value={effectivePinB.id}
                    onChange={(e) => setPinModelBId(e.target.value)}
                    className="h-9 px-2.5 text-xs font-medium bg-blue-50/60 border border-blue-200 rounded-md text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  >
                    {unifiedLeaderboard.map((m) => (
                      <option key={m.id} value={m.id}>
                        Challenger: {m.modelName}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-0 lg:divide-x lg:divide-slate-200 text-xs">
                <div className="lg:pr-4">
                  <div className="text-slate-500">Holdout R² Lift (B − A)</div>
                  <div
                    className={`mt-1 text-lg font-bold font-mono tabular-nums ${
                      pinR2Delta > 0.002
                        ? 'text-emerald-700'
                        : pinR2Delta < -0.002
                        ? 'text-rose-700'
                        : 'text-slate-900'
                    }`}
                  >
                    {pinR2Delta >= 0 ? `+${pinR2Delta.toFixed(3)}` : pinR2Delta.toFixed(3)}
                  </div>
                  <div className="text-[11px] font-mono tabular-nums text-slate-500 mt-0.5">
                    A: {effectivePinA.r2Holdout?.toFixed(3) ?? '—'} · B:{' '}
                    {effectivePinB.r2Holdout?.toFixed(3) ?? '—'}
                  </div>
                </div>

                <div className="lg:px-4">
                  <div className="text-slate-500">Holdout RMSE Delta (B − A)</div>
                  <div
                    className={`mt-1 text-lg font-bold font-mono tabular-nums ${
                      pinRmseDelta < -0.5
                        ? 'text-emerald-700'
                        : pinRmseDelta > 0.5
                        ? 'text-rose-700'
                        : 'text-slate-900'
                    }`}
                  >
                    {pinRmseDelta >= 0
                      ? `+$${pinRmseDelta.toFixed(2)}`
                      : `-$${Math.abs(pinRmseDelta).toFixed(2)}`}
                  </div>
                  <div className="text-[11px] font-mono tabular-nums text-slate-500 mt-0.5">
                    A: ${effectivePinA.rmseHoldout.toFixed(2)} · B: $
                    {effectivePinB.rmseHoldout.toFixed(2)}
                  </div>
                </div>

                <div className="lg:px-4">
                  <div className="text-slate-500">Holdout MAE Delta (B − A)</div>
                  <div
                    className={`mt-1 text-lg font-bold font-mono tabular-nums ${
                      pinMaeDelta < -0.5
                        ? 'text-emerald-700'
                        : pinMaeDelta > 0.5
                        ? 'text-rose-700'
                        : 'text-slate-900'
                    }`}
                  >
                    {pinMaeDelta >= 0
                      ? `+$${pinMaeDelta.toFixed(2)}`
                      : `-$${Math.abs(pinMaeDelta).toFixed(2)}`}
                  </div>
                  <div className="text-[11px] font-mono tabular-nums text-slate-500 mt-0.5">
                    A: ${effectivePinA.maeHoldout.toFixed(2)} · B: $
                    {effectivePinB.maeHoldout.toFixed(2)}
                  </div>
                </div>

                <div className="lg:pl-4">
                  <div className="text-slate-500">Capacity &amp; Verdict</div>
                  <div className="mt-1 text-lg font-bold font-mono tabular-nums text-slate-900">
                    {formatParamCount(effectivePinA.paramCount)} vs{' '}
                    {formatParamCount(effectivePinB.paramCount)}
                  </div>
                  <div className="text-[11px] text-slate-600 mt-0.5">
                    {pinRmseDelta < -0.5
                      ? `Challenger lowers RMSE by $${Math.abs(pinRmseDelta).toFixed(2)}`
                      : pinRmseDelta > 0.5
                      ? `Baseline leads by $${pinRmseDelta.toFixed(2)} RMSE`
                      : 'Comparable holdout accuracy'}
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* 2-Column Analytical Benchmark Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <section className="lg:col-span-7 bg-white border border-slate-200 rounded-lg p-5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">
                    All-Splits vs. Holdout R² Across Model Families
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Higher R² indicates stronger variance explained; tight gaps between bars indicate low overfitting.
                  </p>
                </div>
                <div className="flex items-center gap-3 text-[11px] text-slate-600">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-xs bg-slate-600 inline-block" aria-hidden="true" />
                    <span>All-Splits R²</span>
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-xs bg-blue-700 inline-block" aria-hidden="true" />
                    <span>Holdout R²</span>
                  </span>
                </div>
              </div>

              <div className="h-72 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={benchmarkR2ChartData}
                    margin={{ top: 10, right: 12, left: 0, bottom: 20 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                    <XAxis
                      dataKey="name"
                      tick={{ fontSize: 10, fill: '#475569' }}
                      interval={0}
                      angle={-18}
                      textAnchor="end"
                      height={46}
                    />
                    <YAxis
                      domain={[0, 1]}
                      tick={{ fontSize: 11, fill: '#475569' }}
                      tickFormatter={(v) => Number(v).toFixed(2)}
                      width={44}
                    />
                    <Tooltip
                      cursor={{ fill: '#f8fafc' }}
                      content={({ active, payload }) => {
                        if (!active || !payload || payload.length === 0) return null;
                        const row = payload[0]?.payload as
                          | (typeof benchmarkR2ChartData)[number]
                          | undefined;
                        if (!row) return null;
                        return (
                          <div className="bg-white border border-slate-300 rounded-md px-3 py-2 shadow-sm text-xs space-y-1">
                            <div className="font-semibold text-slate-900">{row.fullName}</div>
                            <div className="font-mono tabular-nums text-slate-700">
                              All-Splits R²: {row.r2All.toFixed(3)}
                            </div>
                            <div className="font-mono tabular-nums text-blue-700 font-semibold">
                              Holdout R²: {row.r2Holdout.toFixed(3)}
                            </div>
                            <div className="font-mono tabular-nums text-slate-600 pt-0.5 border-t border-slate-100">
                              RMSE ${row.rmse.toFixed(2)} · MAE ${row.mae.toFixed(2)} · Params{' '}
                              {formatParamCount(row.params)}
                            </div>
                          </div>
                        );
                      }}
                    />
                    <Bar
                      dataKey="r2All"
                      name="All-Splits R²"
                      fill="#475569"
                      radius={[3, 3, 0, 0]}
                      isAnimationActive={false}
                    />
                    <Bar
                      dataKey="r2Holdout"
                      name="Holdout R²"
                      fill="#1d4ed8"
                      radius={[3, 3, 0, 0]}
                      isAnimationActive={false}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </section>

            <section className="lg:col-span-5 bg-white border border-slate-200 rounded-lg p-5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">
                    Prediction Error Profile (RMSE vs. MAE)
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Lower bars indicate tighter holdout prediction accuracy ($).
                  </p>
                </div>
                <div className="flex items-center gap-3 text-[11px] text-slate-600">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-xs bg-amber-600 inline-block" aria-hidden="true" />
                    <span>RMSE ($)</span>
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-xs bg-teal-700 inline-block" aria-hidden="true" />
                    <span>MAE ($)</span>
                  </span>
                </div>
              </div>

              <div className="h-72 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={benchmarkR2ChartData}
                    margin={{ top: 10, right: 12, left: 0, bottom: 20 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                    <XAxis
                      dataKey="name"
                      tick={{ fontSize: 10, fill: '#475569' }}
                      interval={0}
                      angle={-18}
                      textAnchor="end"
                      height={46}
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: '#475569' }}
                      tickFormatter={formatCurrencyCompact}
                      width={48}
                    />
                    <Tooltip
                      cursor={{ fill: '#f8fafc' }}
                      content={({ active, payload }) => {
                        if (!active || !payload || payload.length === 0) return null;
                        const row = payload[0]?.payload as
                          | (typeof benchmarkR2ChartData)[number]
                          | undefined;
                        if (!row) return null;
                        return (
                          <div className="bg-white border border-slate-300 rounded-md px-3 py-2 shadow-sm text-xs space-y-1">
                            <div className="font-semibold text-slate-900">{row.fullName}</div>
                            <div className="font-mono tabular-nums text-amber-700 font-semibold">
                              Holdout RMSE: ${row.rmse.toFixed(2)}
                            </div>
                            <div className="font-mono tabular-nums text-teal-700 font-semibold">
                              Holdout MAE: ${row.mae.toFixed(2)}
                            </div>
                            <div className="font-mono tabular-nums text-slate-500">
                              Capacity: {formatParamCount(row.params)} params
                            </div>
                          </div>
                        );
                      }}
                    />
                    <Bar
                      dataKey="rmse"
                      name="Holdout RMSE"
                      fill="#d97706"
                      radius={[3, 3, 0, 0]}
                      isAnimationActive={false}
                    />
                    <Bar
                      dataKey="mae"
                      name="Holdout MAE"
                      fill="#0f766e"
                      radius={[3, 3, 0, 0]}
                      isAnimationActive={false}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </section>
          </div>

          {/* Unified Sortable & Filterable Cross-Model Leaderboard Table */}
          <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
              <div className="flex items-start gap-2.5">
                <Cpu className="w-4 h-4 text-blue-700 shrink-0 mt-0.5" />
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">
                    Unified Cross-Paradigm Model Leaderboard
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Click column headers to rank models on the deterministic FNV-1a cohort split.
                  </p>
                </div>
              </div>

              <div className="inline-flex p-1 bg-slate-100 rounded-lg self-start lg:self-auto">
                {(
                  [
                    { id: 'all', label: `All (${unifiedLeaderboard.length})` },
                    {
                      id: 'tabular_ols',
                      label: `Tabular / Linear (${
                        unifiedLeaderboard.filter((m) => m.familyKey === 'tabular_ols').length
                      })`,
                    },
                    {
                      id: 'recurrent',
                      label: `Recurrent (${
                        unifiedLeaderboard.filter((m) => m.familyKey === 'recurrent').length
                      })`,
                    },
                    {
                      id: 'transformer',
                      label: `Transformers (${
                        unifiedLeaderboard.filter((m) => m.familyKey === 'transformer').length
                      })`,
                    },
                  ] as { id: FamilyFilter; label: string }[]
                ).map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setFamilyFilter(tab.id)}
                    className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                      familyFilter === tab.id
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-600">
                    <th className="py-2.5 px-4">Rank</th>
                    <th className="py-2.5 px-4">Model</th>
                    <th className="py-2.5 px-3">Family &amp; Spec</th>
                    <th className="py-2.5 px-3 text-right">
                      <button
                        type="button"
                        onClick={() => toggleLeaderboardSort('paramCount')}
                        className="inline-flex items-center gap-1 hover:text-slate-900"
                      >
                        <span>Params</span>
                        <ArrowUpDown className="w-3 h-3" />
                      </button>
                    </th>
                    <th className="py-2.5 px-3 text-right">
                      <button
                        type="button"
                        onClick={() => toggleLeaderboardSort('r2All')}
                        className="inline-flex items-center gap-1 hover:text-slate-900"
                      >
                        <span>All R²</span>
                        <ArrowUpDown className="w-3 h-3" />
                      </button>
                    </th>
                    <th className="py-2.5 px-3 text-right">
                      <button
                        type="button"
                        onClick={() => toggleLeaderboardSort('r2Holdout')}
                        className="inline-flex items-center gap-1 hover:text-slate-900"
                      >
                        <span>Holdout R²</span>
                        <ArrowUpDown className="w-3 h-3" />
                      </button>
                    </th>
                    <th className="py-2.5 px-3 text-right">
                      <button
                        type="button"
                        onClick={() => toggleLeaderboardSort('rmseHoldout')}
                        className="inline-flex items-center gap-1 hover:text-slate-900"
                      >
                        <span>RMSE</span>
                        <ArrowUpDown className="w-3 h-3" />
                      </button>
                    </th>
                    <th className="py-2.5 px-3 text-right">
                      <button
                        type="button"
                        onClick={() => toggleLeaderboardSort('maeHoldout')}
                        className="inline-flex items-center gap-1 hover:text-slate-900"
                      >
                        <span>MAE</span>
                        <ArrowUpDown className="w-3 h-3" />
                      </button>
                    </th>
                    <th className="py-2.5 px-3 text-right">
                      <button
                        type="button"
                        onClick={() => toggleLeaderboardSort('standardError')}
                        className="inline-flex items-center gap-1 hover:text-slate-900"
                      >
                        <span>SE (±$)</span>
                        <ArrowUpDown className="w-3 h-3" />
                      </button>
                    </th>
                    <th className="py-2.5 px-3 text-right">95% CI (Mean ŷ)</th>
                    <th className="py-2.5 px-4 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-xs font-mono tabular-nums">
                  {sortedLeaderboard.map((m, idx) => (
                    <tr
                      key={m.id}
                      className={m.isActive ? 'bg-blue-50/60 hover:bg-blue-50/90' : 'hover:bg-slate-50'}
                    >
                      <td className="py-2.5 px-4 text-slate-500 font-semibold">#{idx + 1}</td>
                      <td className="py-2.5 px-4 font-sans font-semibold text-slate-900 whitespace-nowrap">
                        <span>{m.modelName}</span>
                        {m.isActive && (
                          <span className="ml-2 text-[11px] font-mono text-blue-700 font-semibold">
                            · Active
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 font-sans text-[11px] text-slate-600">
                        <span className="font-medium text-slate-800">{m.familyLabel}</span>
                        <span className="mx-1.5 text-slate-300" aria-hidden="true">·</span>
                        <span>{m.specSummary}</span>
                      </td>
                      <td className="py-2.5 px-3 text-right text-slate-700">
                        {formatParamCount(m.paramCount)}
                      </td>
                      <td className="py-2.5 px-3 text-right text-slate-700">
                        {m.r2All !== null ? m.r2All.toFixed(3) : '—'}
                      </td>
                      <td
                        className={`py-2.5 px-3 text-right font-semibold ${
                          idx === 0 && leaderboardSortKey === 'r2Holdout' && leaderboardSortDir === 'desc'
                            ? 'text-blue-700'
                            : 'text-slate-900'
                        }`}
                      >
                        {m.r2Holdout !== null ? m.r2Holdout.toFixed(3) : '—'}
                      </td>
                      <td className="py-2.5 px-3 text-right text-slate-800">
                        ${m.rmseHoldout.toFixed(2)}
                      </td>
                      <td className="py-2.5 px-3 text-right text-slate-700">
                        ${m.maeHoldout.toFixed(2)}
                      </td>
                      <td className="py-2.5 px-3 text-right text-slate-700">
                        ±${m.standardError.toFixed(2)}
                      </td>
                      <td className="py-2.5 px-3 text-right text-slate-700 whitespace-nowrap">
                        ${m.ci95Lower.toFixed(0)}–${m.ci95Upper.toFixed(0)}
                      </td>
                      <td className="py-2.5 px-4 text-right font-sans">
                        {m.actionTarget.type === 'transformer' ? (
                          <button
                            type="button"
                            onClick={() => onOpenTransformerView(m.actionTarget.type === 'transformer' ? m.actionTarget.arch : undefined)}
                            className="text-[11px] font-medium text-blue-700 hover:underline whitespace-nowrap"
                          >
                            Tune Transformers →
                          </button>
                        ) : m.actionTarget.type === 'regression' ? (
                          <button
                            type="button"
                            onClick={() => onNavigateTab('regression')}
                            className="text-[11px] font-medium text-blue-700 hover:underline whitespace-nowrap"
                          >
                            Open Regression →
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setSubView('ab_lab')}
                            className="text-[11px] font-medium text-blue-700 hover:underline whitespace-nowrap"
                          >
                            Inspect in A/B Lab →
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {/* SUB-VIEW 2: A/B REGRESSION LAB */}
      {subView === 'ab_lab' && (
        <>
          {/* Quick Comparison Presets Bar */}
          <section className="bg-white border border-slate-200 rounded-lg p-5">
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">
                  LTV Regression A/B Configuration Lab (Config A vs. Config B)
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Vary feature subsets, scaling, winsorization, cutoff, or horizon across two live OLS specifications.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => applyPresetScenario('norm_vs_raw')}
                  className="px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-slate-50 border border-slate-200 rounded-md hover:bg-slate-100 transition-colors whitespace-nowrap"
                >
                  Raw vs. Z-Score
                </button>
                <button
                  type="button"
                  onClick={() => applyPresetScenario('all_vs_rfm')}
                  className="px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-slate-50 border border-slate-200 rounded-md hover:bg-slate-100 transition-colors whitespace-nowrap"
                >
                  All 7 vs. Core RFM
                </button>
                <button
                  type="button"
                  onClick={() => applyPresetScenario('winsor_vs_raw')}
                  className="px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-slate-50 border border-slate-200 rounded-md hover:bg-slate-100 transition-colors whitespace-nowrap"
                >
                  Uncapped vs. P95
                </button>
                <button
                  type="button"
                  onClick={() => applyPresetScenario('horizon_180_90')}
                  className="px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-slate-50 border border-slate-200 rounded-md hover:bg-slate-100 transition-colors whitespace-nowrap"
                >
                  180d vs. 90d Horizon
                </button>
                <button
                  type="button"
                  onClick={handleSwap}
                  className="px-2.5 py-1.5 text-xs font-medium text-blue-700 bg-blue-50/70 border border-blue-200 rounded-md hover:bg-blue-100/80 transition-colors inline-flex items-center gap-1.5 whitespace-nowrap"
                >
                  <ArrowLeftRight className="w-3.5 h-3.5" />
                  <span>Swap A ⇄ B</span>
                </button>
              </div>
            </div>
          </section>

          {/* Side-by-Side Config Editors */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <ConfigEditorPanel
              label="Model A (Baseline)"
              accentColor="slate"
              config={configA}
              onChange={setConfigA}
              onLoadBase={() => setConfigA({ ...baseRegConfig })}
              onPromote={() => onPromoteConfig(configA)}
              maxDay={maxDay}
              result={resultA}
            />
            <ConfigEditorPanel
              label="Model B (Challenger)"
              accentColor="blue"
              config={configB}
              onChange={setConfigB}
              onLoadBase={() => setConfigB({ ...baseRegConfig })}
              onPromote={() => onPromoteConfig(configB)}
              maxDay={maxDay}
              result={resultB}
            />
          </div>

          {/* Delta KPI Strip */}
          <section className="bg-white border border-slate-200 rounded-lg grid grid-cols-2 lg:grid-cols-4 divide-y lg:divide-y-0 lg:divide-x divide-slate-200">
            <div className="p-5">
              <div className="text-xs text-slate-500">OLS R² Difference (B − A)</div>
              <div className="flex items-baseline gap-2 mt-1">
                <span
                  className={`text-2xl font-bold font-mono tabular-nums ${
                    r2Delta > 0.001
                      ? 'text-emerald-700'
                      : r2Delta < -0.001
                      ? 'text-rose-700'
                      : 'text-slate-900'
                  }`}
                >
                  {r2Delta >= 0 ? `+${r2Delta.toFixed(3)}` : r2Delta.toFixed(3)}
                </span>
              </div>
              <div className="text-xs text-slate-500 mt-1 font-mono tabular-nums">
                A: {resultA.linearFit.rSquared.toFixed(3)} · B:{' '}
                {resultB.linearFit.rSquared.toFixed(3)}
              </div>
            </div>

            <div className="p-5">
              <div className="text-xs text-slate-500">RMSE Difference (B − A)</div>
              <div className="flex items-baseline gap-2 mt-1">
                <span
                  className={`text-2xl font-bold font-mono tabular-nums ${
                    rmseDelta < -0.5
                      ? 'text-emerald-700'
                      : rmseDelta > 0.5
                      ? 'text-rose-700'
                      : 'text-slate-900'
                  }`}
                >
                  {rmseDelta >= 0
                    ? `+$${rmseDelta.toFixed(2)}`
                    : `-$${Math.abs(rmseDelta).toFixed(2)}`}
                </span>
              </div>
              <div className="text-xs text-slate-500 mt-1 font-mono tabular-nums">
                A: ${resultA.linearFit.rmse.toFixed(2)} · B: $
                {resultB.linearFit.rmse.toFixed(2)}
              </div>
            </div>

            <div className="p-5">
              <div className="text-xs text-slate-500">Mean Abs Error (MAE)</div>
              <div className="flex items-baseline gap-2 mt-1">
                <span
                  className={`text-2xl font-bold font-mono tabular-nums ${
                    maeDelta < -0.5
                      ? 'text-emerald-700'
                      : maeDelta > 0.5
                      ? 'text-rose-700'
                      : 'text-slate-900'
                  }`}
                >
                  {maeDelta >= 0
                    ? `+$${maeDelta.toFixed(2)}`
                    : `-$${Math.abs(maeDelta).toFixed(2)}`}
                </span>
              </div>
              <div className="text-xs text-slate-500 mt-1 font-mono tabular-nums">
                A: ${maeA.toFixed(2)} · B: ${maeB.toFixed(2)}
              </div>
            </div>

            <div className="p-5">
              <div className="text-xs text-slate-500">Entity Accuracy Head-to-Head</div>
              <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 mt-1">
                {bWinRate.bWins} vs {bWinRate.aWins}
              </div>
              <div className="text-xs text-slate-500 mt-1 font-mono tabular-nums">
                B closer: {bWinRate.bWins} · A closer: {bWinRate.aWins} · Tie: {bWinRate.ties}
              </div>
            </div>
          </section>

          {/* R-Squared & Standardized Feature Importance Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <section className="lg:col-span-5 bg-white border border-slate-200 rounded-lg p-5">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">
                    R-Squared Comparison
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Joint OLS R² and strongest single-feature R² across A vs. B.
                  </p>
                </div>
                <div className="flex items-center gap-3 text-[11px] text-slate-600">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-xs bg-slate-700 inline-block" aria-hidden="true" />
                    <span>Model A</span>
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-xs bg-blue-700 inline-block" aria-hidden="true" />
                    <span>Model B</span>
                  </span>
                </div>
              </div>

              <div style={{ width: '100%', height: 250 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={r2SummaryBars}
                    margin={{ top: 12, right: 16, bottom: 8, left: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                    <XAxis
                      dataKey="metric"
                      tick={{ fontSize: 11, fill: '#475569', fontFamily: 'DM Sans, sans-serif' }}
                      axisLine={{ stroke: '#cbd5e1' }}
                      tickLine={false}
                    />
                    <YAxis
                      domain={[0, 1]}
                      tickCount={6}
                      tickFormatter={(v) => Number(v).toFixed(2)}
                      width={44}
                      tick={{ fontSize: 11, fill: '#475569', fontFamily: 'JetBrains Mono, monospace' }}
                      axisLine={{ stroke: '#cbd5e1' }}
                      tickLine={false}
                    />
                    <Tooltip
                      cursor={{ fill: '#f8fafc' }}
                      content={({ active, payload, label }) => {
                        if (!active || !payload || payload.length === 0) return null;
                        const row = payload[0]?.payload as
                          | { metric: string; modelA: number; modelB: number }
                          | undefined;
                        if (!row) return null;
                        const diff = row.modelB - row.modelA;
                        return (
                          <div className="bg-white border border-slate-200 rounded-md shadow-md px-3 py-2 text-xs space-y-1">
                            <div className="font-semibold text-slate-900">{label}</div>
                            <div className="font-mono text-slate-700 tabular-nums">
                              Model A: {row.modelA.toFixed(3)}
                            </div>
                            <div className="font-mono text-blue-700 font-semibold tabular-nums">
                              Model B: {row.modelB.toFixed(3)}
                            </div>
                            <div className="font-mono text-slate-600 tabular-nums pt-0.5 border-t border-slate-100">
                              Δ (B − A): {diff >= 0 ? `+${diff.toFixed(3)}` : diff.toFixed(3)}
                            </div>
                          </div>
                        );
                      }}
                    />
                    <Bar
                      dataKey="modelA"
                      name="Model A"
                      fill="#334155"
                      radius={[4, 4, 0, 0]}
                      barSize={36}
                      isAnimationActive={false}
                    />
                    <Bar
                      dataKey="modelB"
                      name="Model B"
                      fill="#1d4ed8"
                      radius={[4, 4, 0, 0]}
                      barSize={36}
                      isAnimationActive={false}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </section>

            <section className="lg:col-span-7 bg-white border border-slate-200 rounded-lg p-5">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">
                    Standardized Feature Weight Comparison (|β|)
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Shows how feature selection, normalization, and winsorization shift predictor weights (0 = excluded).
                  </p>
                </div>
                <div className="text-[11px] font-mono text-slate-500 tabular-nums">
                  Collinear pairs: A={resultA.featureMatrix.highCollinearityPairs.length} · B=
                  {resultB.featureMatrix.highCollinearityPairs.length}
                </div>
              </div>

              <div style={{ width: '100%', height: 250 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={featureComparisonData}
                    margin={{ top: 12, right: 16, bottom: 8, left: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                    <XAxis
                      dataKey="feature"
                      tick={{ fontSize: 11, fill: '#475569', fontFamily: 'DM Sans, sans-serif' }}
                      axisLine={{ stroke: '#cbd5e1' }}
                      tickLine={false}
                    />
                    <YAxis
                      tickFormatter={(v) => Number(v).toFixed(2)}
                      width={44}
                      tick={{ fontSize: 11, fill: '#475569', fontFamily: 'JetBrains Mono, monospace' }}
                      axisLine={{ stroke: '#cbd5e1' }}
                      tickLine={false}
                    />
                    <Tooltip
                      cursor={{ fill: '#f8fafc' }}
                      content={({ active, payload }) => {
                        if (!active || !payload || payload.length === 0) return null;
                        const d = payload[0]?.payload as
                          | (typeof featureComparisonData)[number]
                          | undefined;
                        if (!d) return null;
                        return (
                          <div className="bg-white border border-slate-200 rounded-md shadow-md px-3 py-2 text-xs space-y-1">
                            <div className="font-semibold text-slate-900">{d.label}</div>
                            <div className="font-mono text-slate-700 tabular-nums">
                              Model A |β|: {d.betaA.toFixed(3)} (Uni R² {d.r2A.toFixed(3)})
                            </div>
                            <div className="font-mono text-blue-700 font-semibold tabular-nums">
                              Model B |β|: {d.betaB.toFixed(3)} (Uni R² {d.r2B.toFixed(3)})
                            </div>
                          </div>
                        );
                      }}
                    />
                    <Bar
                      dataKey="betaA"
                      name="Model A |β|"
                      fill="#334155"
                      radius={[3, 3, 0, 0]}
                      isAnimationActive={false}
                    />
                    <Bar
                      dataKey="betaB"
                      name="Model B |β|"
                      fill="#1d4ed8"
                      radius={[3, 3, 0, 0]}
                      isAnimationActive={false}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </section>
          </div>

          {/* Side-by-Side Predicted vs Observed Scatter Plots */}
          <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">
                  Predicted vs. Observed Outcomes (Side-by-Side)
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Both scatter plots share an identical [0, {sharedAxisMax}] coordinate scale and dashed 1:1 parity line (y = x). Click any point to filter below.
                </p>
              </div>
              <div className="flex items-center gap-3 text-[11px] text-slate-600 shrink-0">
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-blue-700 inline-block" aria-hidden="true" />
                  <span>Train</span>
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-600 inline-block" aria-hidden="true" />
                  <span>Val</span>
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-600 inline-block" aria-hidden="true" />
                  <span>Test</span>
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-slate-200">
              {renderOutcomeScatter(
                'Model A (Baseline): Predicted vs. Observed',
                'slate',
                configA,
                resultA,
                scatterA
              )}
              {renderOutcomeScatter(
                'Model B (Challenger): Predicted vs. Observed',
                'blue',
                configB,
                resultB,
                scatterB
              )}
            </div>
          </section>

          {/* Entity-Level Prediction Delta Matrix */}
          <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">
                  Entity Prediction Disagreement &amp; Residual Audit
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Comparing {filteredDeltaRows.length} of {entityComparisonRows.length} shared entities across Model A and Model B.
                  {inspectedEntityId && (
                    <button
                      type="button"
                      onClick={() => {
                        setInspectedEntityId(null);
                        setSearch('');
                      }}
                      className="ml-2 text-blue-700 hover:text-blue-800 font-medium"
                    >
                      Clear filter ({inspectedEntityId})
                    </button>
                  )}
                </p>
              </div>

              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Search Entity ID..."
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    if (!e.target.value) setInspectedEntityId(null);
                  }}
                  className="pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-md w-52 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                />
              </div>
            </div>

            <div className="overflow-x-auto max-h-[380px]">
              <table className="w-full text-left border-collapse">
                <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-600">
                  <tr>
                    <th className="py-2.5 px-4">
                      <button
                        type="button"
                        onClick={() => toggleSort('entityId')}
                        className="inline-flex items-center gap-1 hover:text-slate-900"
                      >
                        <span>Entity ID</span>
                        <ArrowUpDown className="w-3 h-3" />
                      </button>
                    </th>
                    <th className="py-2.5 px-4">Split</th>
                    <th className="py-2.5 px-4 text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => toggleSort('observedA')}
                        className="inline-flex items-center gap-1 hover:text-slate-900"
                      >
                        <span>Observed (A)</span>
                        <ArrowUpDown className="w-3 h-3" />
                      </button>
                    </th>
                    <th className="py-2.5 px-4 text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => toggleSort('predictedA')}
                        className="inline-flex items-center gap-1 hover:text-slate-900"
                      >
                        <span>Pred A</span>
                        <ArrowUpDown className="w-3 h-3" />
                      </button>
                    </th>
                    <th className="py-2.5 px-4 text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => toggleSort('predictedB')}
                        className="inline-flex items-center gap-1 hover:text-slate-900"
                      >
                        <span>Pred B</span>
                        <ArrowUpDown className="w-3 h-3" />
                      </button>
                    </th>
                    <th className="py-2.5 px-4 text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => toggleSort('predDelta')}
                        className="inline-flex items-center gap-1 hover:text-slate-900"
                      >
                        <span>Pred Δ (B−A)</span>
                        <ArrowUpDown className="w-3 h-3" />
                      </button>
                    </th>
                    <th className="py-2.5 px-4 text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => toggleSort('absErrDiff')}
                        className="inline-flex items-center gap-1 hover:text-slate-900"
                      >
                        <span>|Err A| vs |Err B|</span>
                        <ArrowUpDown className="w-3 h-3" />
                      </button>
                    </th>
                    <th className="py-2.5 px-4 whitespace-nowrap">Closer Fit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-xs">
                  {filteredDeltaRows.map((row) => (
                    <tr key={row.entityId} className="hover:bg-slate-50/80 h-9">
                      <td className="py-2 px-4 font-mono font-medium text-slate-900">
                        {row.entityId}
                      </td>
                      <td className="py-2 px-4 font-mono text-slate-500">{row.split}</td>
                      <td className="py-2 px-4 text-right font-mono tabular-nums text-slate-900">
                        ${row.observedA.toFixed(2)}
                        {Math.abs(row.observedA - row.observedB) > 0.01 && (
                          <span className="text-[10px] text-slate-400 ml-1">
                            (${row.observedB.toFixed(0)})
                          </span>
                        )}
                      </td>
                      <td className="py-2 px-4 text-right font-mono tabular-nums text-slate-700">
                        ${row.predictedA.toFixed(2)}
                      </td>
                      <td className="py-2 px-4 text-right font-mono tabular-nums font-medium text-blue-700">
                        ${row.predictedB.toFixed(2)}
                      </td>
                      <td
                        className={`py-2 px-4 text-right font-mono tabular-nums ${
                          row.predDelta > 0.5
                            ? 'text-blue-700'
                            : row.predDelta < -0.5
                            ? 'text-amber-700'
                            : 'text-slate-500'
                        }`}
                      >
                        {row.predDelta >= 0
                          ? `+$${row.predDelta.toFixed(2)}`
                          : `-$${Math.abs(row.predDelta).toFixed(2)}`}
                      </td>
                      <td className="py-2 px-4 text-right font-mono tabular-nums text-slate-600">
                        ${row.absErrA.toFixed(1)} vs ${row.absErrB.toFixed(1)}
                      </td>
                      <td className="py-2 px-4 font-mono font-semibold">
                        <span
                          className={
                            row.closerModel === 'B'
                              ? 'text-blue-700'
                              : row.closerModel === 'A'
                              ? 'text-slate-800'
                              : 'text-slate-400'
                          }
                        >
                          {row.closerModel === 'Tie' ? 'Tie' : `Model ${row.closerModel}`}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {filteredDeltaRows.length === 0 && (
                    <tr>
                      <td colSpan={8} className="py-10 text-center text-slate-500">
                        No shared entities match the current filter criteria.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {/* SUB-VIEW 3: RUL & OFFLINE RL BENCHMARKS */}
      {subView === 'rul_rl' && (
        <>
          {/* RUL Prognostic Forecaster Comparison */}
          <section className="bg-white border border-slate-200 rounded-lg p-5 space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
              <div className="flex items-start gap-2.5">
                <Activity className="w-4 h-4 text-teal-700 shrink-0 mt-0.5" />
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">
                    RUL Prognostic Model Backtest: EMA Trend (α=0.45) vs. Linear Extrapolation
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Evaluated from 65% lifecycle observation prefix across {rulBacktest.sampleCount} multi-cycle assets.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => onNavigateTab('rul_timeseries')}
                className="px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50/70 border border-blue-200 rounded-md hover:bg-blue-100/70 transition-colors whitespace-nowrap self-start sm:self-auto"
              >
                Open RUL Time-Series →
              </button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              <div className="lg:col-span-5 space-y-4">
                <div className="border border-slate-200 rounded-md overflow-hidden">
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-slate-600">
                        <th className="px-3 py-2 text-left font-semibold">Metric</th>
                        <th className="px-3 py-2 text-right font-semibold">EMA (α=0.45)</th>
                        <th className="px-3 py-2 text-right font-semibold">Linear OLS</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 font-mono tabular-nums">
                      <tr>
                        <td className="px-3 py-2 font-sans text-slate-700">EOL MAE (days)</td>
                        <td className="px-3 py-2 text-right font-semibold text-blue-700">
                          {rulBacktest.emaStats.mae.toFixed(1)}d
                        </td>
                        <td className="px-3 py-2 text-right font-semibold text-slate-900">
                          {rulBacktest.linearStats.mae.toFixed(1)}d
                        </td>
                      </tr>
                      <tr>
                        <td className="px-3 py-2 font-sans text-slate-700">EOL RMSE (days)</td>
                        <td className="px-3 py-2 text-right text-slate-900">
                          {rulBacktest.emaStats.rmse.toFixed(1)}d
                        </td>
                        <td className="px-3 py-2 text-right text-slate-900">
                          {rulBacktest.linearStats.rmse.toFixed(1)}d
                        </td>
                      </tr>
                      <tr>
                        <td className="px-3 py-2 font-sans text-slate-700">Mean Signed Bias</td>
                        <td className="px-3 py-2 text-right text-slate-700">
                          {rulBacktest.emaStats.bias >= 0 ? '+' : ''}
                          {rulBacktest.emaStats.bias.toFixed(1)}d
                        </td>
                        <td className="px-3 py-2 text-right text-slate-700">
                          {rulBacktest.linearStats.bias >= 0 ? '+' : ''}
                          {rulBacktest.linearStats.bias.toFixed(1)}d
                        </td>
                      </tr>
                      <tr>
                        <td className="px-3 py-2 font-sans text-slate-700">Within ±15d Rate</td>
                        <td className="px-3 py-2 text-right text-teal-700 font-semibold">
                          {rulBacktest.emaStats.hit15Pct.toFixed(1)}%
                        </td>
                        <td className="px-3 py-2 text-right text-teal-700 font-semibold">
                          {rulBacktest.linearStats.hit15Pct.toFixed(1)}%
                        </td>
                      </tr>
                      <tr>
                        <td className="px-3 py-2 font-sans text-slate-700">Crossing Coverage</td>
                        <td className="px-3 py-2 text-right text-slate-700">
                          {rulBacktest.emaStats.coveragePct.toFixed(1)}%
                        </td>
                        <td className="px-3 py-2 text-right text-slate-700">
                          {rulBacktest.linearStats.coveragePct.toFixed(1)}%
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <div className="h-56 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={rulBacktest.chartData}
                      margin={{ top: 8, right: 12, left: 0, bottom: 4 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                      <XAxis dataKey="metric" tick={{ fontSize: 10, fill: '#475569' }} />
                      <YAxis tick={{ fontSize: 11, fill: '#475569' }} width={40} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: '#ffffff',
                          borderColor: '#cbd5e1',
                          borderRadius: '6px',
                          fontSize: '12px',
                        }}
                      />
                      <Legend wrapperStyle={{ fontSize: '11px' }} />
                      <Bar
                        dataKey="ema"
                        name="EMA Trend (α=0.45)"
                        fill="#1d4ed8"
                        radius={[3, 3, 0, 0]}
                        isAnimationActive={false}
                      />
                      <Bar
                        dataKey="linear"
                        name="Linear Extrapolation"
                        fill="#334155"
                        radius={[3, 3, 0, 0]}
                        isAnimationActive={false}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="lg:col-span-7 border border-slate-200 rounded-md overflow-hidden">
                <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-900">
                    Per-Unit 65% Prefix EOL Backtest Sample (Top 20)
                  </span>
                  <span className="font-mono text-[11px] text-slate-500">
                    Winner: {rulBacktest.bestModel}
                  </span>
                </div>
                <div className="overflow-x-auto max-h-88">
                  <table className="w-full text-xs border-collapse">
                    <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 text-slate-600">
                      <tr>
                        <th className="px-3 py-2 text-left font-semibold">Entity</th>
                        <th className="px-3 py-2 text-right font-semibold">Actual EOL</th>
                        <th className="px-3 py-2 text-right font-semibold">EMA Pred</th>
                        <th className="px-3 py-2 text-right font-semibold">|Err|</th>
                        <th className="px-3 py-2 text-right font-semibold">Linear Pred</th>
                        <th className="px-3 py-2 text-right font-semibold">|Err|</th>
                        <th className="px-3 py-2 text-left font-semibold">Closer</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 font-mono tabular-nums">
                      {rulBacktest.perUnit.map((row) => (
                        <tr key={row.entityId} className="hover:bg-slate-50">
                          <td className="px-3 py-2 font-medium text-slate-900">{row.entityId}</td>
                          <td className="px-3 py-2 text-right text-slate-700">d{row.actualEolDay}</td>
                          <td className="px-3 py-2 text-right text-blue-700">
                            {row.emaPredEol !== null ? `d${row.emaPredEol}` : '—'}
                          </td>
                          <td className="px-3 py-2 text-right text-slate-600">
                            {row.emaAbsErr !== null ? `${row.emaAbsErr}d` : '—'}
                          </td>
                          <td className="px-3 py-2 text-right text-slate-800">
                            {row.linearPredEol !== null ? `d${row.linearPredEol}` : '—'}
                          </td>
                          <td className="px-3 py-2 text-right text-slate-600">
                            {row.linearAbsErr !== null ? `${row.linearAbsErr}d` : '—'}
                          </td>
                          <td className="px-3 py-2 font-sans font-semibold">
                            <span
                              className={
                                row.winner === 'EMA'
                                  ? 'text-blue-700'
                                  : row.winner === 'Linear'
                                  ? 'text-slate-800'
                                  : 'text-slate-400'
                              }
                            >
                              {row.winner}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </section>

          {/* Offline RL Policy & Action Value Comparison */}
          <section className="bg-white border border-slate-200 rounded-lg p-5 space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
              <div className="flex items-start gap-2.5">
                <Layers className="w-4 h-4 text-blue-700 shrink-0 mt-0.5" />
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">
                    Offline RL Policy &amp; Action Support Comparison (MDP / CQL)
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Evaluates Empirical Behavior Policy vs. Support-Constrained Conservative Q-Learning (0% OOD leakage).
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => onNavigateTab('offline_rl')}
                className="px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50/70 border border-blue-200 rounded-md hover:bg-blue-100/70 transition-colors whitespace-nowrap self-start sm:self-auto"
              >
                Open Offline RL →
              </button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              <div className="lg:col-span-6 border border-slate-200 rounded-md overflow-hidden">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-slate-600">
                      <th className="px-3.5 py-2.5 text-left font-semibold">Policy Regime</th>
                      <th className="px-3 py-2.5 text-right font-semibold">Transitions</th>
                      <th className="px-3 py-2.5 text-right font-semibold">Mean Reward</th>
                      <th className="px-3 py-2.5 text-right font-semibold">Return-to-Go</th>
                      <th className="px-3.5 py-2.5 text-right font-semibold">OOD Rate</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-mono tabular-nums">
                    {rlPolicyComparison.policies.map((p) => (
                      <tr key={p.name} className="hover:bg-slate-50">
                        <td className="px-3.5 py-2.5 font-sans">
                          <div className="font-semibold text-slate-900">{p.name}</div>
                          <div className="text-[11px] text-slate-500">{p.criteria}</div>
                        </td>
                        <td className="px-3 py-2.5 text-right text-slate-700">
                          {p.transitionCount.toLocaleString()}
                        </td>
                        <td className="px-3 py-2.5 text-right text-slate-800">
                          {p.meanReward.toFixed(2)}
                        </td>
                        <td className="px-3 py-2.5 text-right font-semibold text-blue-700">
                          {p.meanReturnToGo.toFixed(2)}
                        </td>
                        <td
                          className={`px-3.5 py-2.5 text-right ${
                            p.oodSharePct === 0 ? 'text-teal-700 font-semibold' : 'text-amber-700'
                          }`}
                        >
                          {p.oodSharePct.toFixed(1)}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="lg:col-span-6 h-56 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={mdpResult.actionBreakdown}
                    margin={{ top: 8, right: 16, left: 0, bottom: 4 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                    <XAxis dataKey="actionLabel" tick={{ fontSize: 10, fill: '#475569' }} />
                    <YAxis tick={{ fontSize: 11, fill: '#475569' }} width={44} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#ffffff',
                        borderColor: '#cbd5e1',
                        borderRadius: '6px',
                        fontSize: '12px',
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: '11px' }} />
                    <Bar
                      dataKey="meanReturnToGo"
                      name="Mean Return-to-Go"
                      fill="#1d4ed8"
                      radius={[3, 3, 0, 0]}
                      isAnimationActive={false}
                    />
                    <Bar
                      dataKey="meanReward"
                      name="Mean Step Reward"
                      fill="#0f766e"
                      radius={[3, 3, 0, 0]}
                      isAnimationActive={false}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
};
