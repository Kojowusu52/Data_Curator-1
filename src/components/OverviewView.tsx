import React, { useMemo, useState } from 'react';
import { ArrowRight, CheckCircle2, AlertTriangle, XCircle, Search } from 'lucide-react';
import {
  AuditCheck,
  CurationRuleId,
  EngineeredFeatureId,
  GlobalCurationConfig,
  MdpConfig,
  MdpResult,
  RawEvent,
  RegressionConfig,
  RegressionResult,
  RulConfig,
  SequenceConfig,
  SequenceResult,
  WorkflowTemplate,
  WorkspaceTab,
} from '../types/curation';
import { assignEntitySplit } from '../engine/curationEngine';
import { DistributionHistograms } from './DistributionHistograms';
import { OutlierAnalysisSection } from './OutlierAnalysisSection';
import { CohortLtvHeatmap } from './CohortLtvHeatmap';
import { DataHealthScorecard } from './DataHealthScorecard';
import { PerformanceAlertMonitor } from './PerformanceAlertMonitor';
import { DataLineageVisualizer } from './DataLineageVisualizer';
import { GlobalParameterSyncPanel } from './GlobalParameterSyncPanel';
import { WorkflowTemplatesSection } from './WorkflowTemplatesSection';

interface OverviewViewProps {
  activePresetId: string;
  customDatasetName: string | null;
  datasetName: string;
  datasetDomain: string;
  datasetDescription: string;
  events: RawEvent[];
  globalConfig: GlobalCurationConfig;
  regConfig: RegressionConfig;
  seqConfig: SequenceConfig;
  mdpConfig: MdpConfig;
  rulConfig: RulConfig;
  appliedCurationRules: CurationRuleId[];
  enabledEngineeredFeatures: EngineeredFeatureId[];
  regResult: RegressionResult;
  seqResult: SequenceResult;
  mdpResult: MdpResult;
  audits: AuditCheck[];
  maxDay: number;
  onNavigateTab: (tab: WorkspaceTab) => void;
  onOpenWorkspaces: () => void;
  onApplySyncedConfigs: (next: {
    globalConfig: GlobalCurationConfig;
    regConfig: RegressionConfig;
    seqConfig: SequenceConfig;
    mdpConfig: MdpConfig;
  }) => void;
  onApplyWorkflowTemplate: (
    template: WorkflowTemplate,
    options: { switchDataset: boolean }
  ) => void;
}

const SCHEMA_MAPPING = [
  {
    field: 'entity_id',
    type: 'string',
    regression: 'Primary row key · FNV-1a split key',
    sequence: 'Batch axis B · FNV-1a split key',
    offlineRl: 'Trajectory episode ID · FNV-1a split key',
  },
  {
    field: 'timestamp_day',
    type: 'int32',
    regression: 'Strict cutoff filter (t <= T_obs vs (T_obs, T_obs+H])',
    sequence: 'Chronological sort & delta-time Δt encoding',
    offlineRl: 'Transition ordering & inactivity gap terminal check',
  },
  {
    field: 'spend_amount',
    type: 'float64',
    regression: 'Aggregated monetary_sum_obs & target_ltv label',
    sequence: 'Channel 0 of X[b, t, 0] (scaled on train)',
    offlineRl: 'Cumulative spend state feature s_t[cum_spend]',
  },
  {
    field: 'engagement_score',
    type: 'float32',
    regression: 'Mean observation engagement predictor',
    sequence: 'Channel 1 of X[b, t, 1] (scaled on train)',
    offlineRl: 'Continuous state feature s_t[engagement]',
  },
  {
    field: 'action_id',
    type: 'int8',
    regression: 'Encoded promo_share_obs exposure ratio',
    sequence: 'Action embedding token & next-action auxiliary label',
    offlineRl: 'Discrete MDP action a_t in {0..K-1}',
  },
  {
    field: 'reward',
    type: 'float64',
    regression: 'Excluded from X_obs (margin-adjusted value)',
    sequence: 'Per-step auxiliary reward target',
    offlineRl: 'Immediate transition reward r_t & return-to-go G_t',
  },
  {
    field: 'propensity',
    type: 'float32',
    regression: 'Optional inverse-propensity sample weight',
    sequence: 'Logging policy metadata',
    offlineRl: 'Behavior policy μ(a|s) & CQL OOD support flag',
  },
];

export const OverviewView: React.FC<OverviewViewProps> = ({
  activePresetId,
  customDatasetName,
  datasetName,
  datasetDomain,
  datasetDescription,
  events,
  globalConfig,
  regConfig,
  seqConfig,
  mdpConfig,
  rulConfig,
  appliedCurationRules,
  enabledEngineeredFeatures,
  regResult,
  seqResult,
  mdpResult,
  audits,
  maxDay,
  onNavigateTab,
  onOpenWorkspaces,
  onApplySyncedConfigs,
  onApplyWorkflowTemplate,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [actionFilter, setActionFilter] = useState<number | 'all'>('all');
  const [selectedCell, setSelectedCell] = useState<{ i: number; j: number } | null>(() => {
    const pairs = regResult.featureMatrix.highCollinearityPairs;
    if (pairs.length > 0) {
      const i = regResult.featureMatrix.features.findIndex((f) => f.key === pairs[0].featureA);
      const j = regResult.featureMatrix.features.findIndex((f) => f.key === pairs[0].featureB);
      if (i >= 0 && j >= 0) return { i, j };
    }
    return { i: 0, j: 1 };
  });

  const uniqueActions = useMemo(() => {
    const map = new Map<number, string>();
    for (const e of events) map.set(e.actionId, e.actionLabel);
    return Array.from(map.entries()).sort((a, b) => a[0] - b[0]);
  }, [events]);

  const filteredEvents = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return events
      .filter((e) => {
        if (actionFilter !== 'all' && e.actionId !== actionFilter) return false;
        if (!q) return true;
        return (
          e.entityId.toLowerCase().includes(q) ||
          e.actionLabel.toLowerCase().includes(q) ||
          e.channel.toLowerCase().includes(q)
        );
      })
      .slice(0, 60);
  }, [events, searchTerm, actionFilter]);

  const passCount = audits.filter((a) => a.status === 'pass').length;
  const warnCount = audits.filter((a) => a.status === 'warn').length;
  const failCount = audits.filter((a) => a.status === 'fail').length;

  const { features: matrixFeatures, matrix, highCollinearityPairs } = regResult.featureMatrix;

  const activeCellInfo = useMemo(() => {
    if (!selectedCell || matrixFeatures.length === 0) return null;
    const { i, j } = selectedCell;
    if (i >= matrixFeatures.length || j >= matrixFeatures.length) return null;
    const r = matrix[i]?.[j] ?? 0;
    const absR = Math.abs(r);
    const r2 = Math.round(r * r * 1000) / 1000;
    const vif = i === j ? Infinity : Math.round((1 / Math.max(0.01, 1 - r * r)) * 100) / 100;
    const severity =
      i === j
        ? 'Identity Diagonal'
        : absR >= 0.7
        ? 'High Collinearity'
        : absR >= 0.4
        ? 'Moderate Association'
        : 'Low Collinearity';
    return {
      featureA: matrixFeatures[i],
      featureB: matrixFeatures[j],
      r,
      r2,
      vif,
      severity,
      isDiagonal: i === j,
    };
  }, [selectedCell, matrixFeatures, matrix]);

  const getMatrixCellClasses = (r: number, isDiagonal: boolean) => {
    if (isDiagonal) return 'bg-slate-100 text-slate-500';
    const abs = Math.abs(r);
    if (r > 0) {
      if (abs >= 0.75) return 'bg-blue-700 text-white';
      if (abs >= 0.55) return 'bg-blue-600 text-white';
      if (abs >= 0.35) return 'bg-blue-200 text-slate-900';
      if (abs >= 0.15) return 'bg-blue-100 text-slate-800';
      return 'bg-slate-50 text-slate-700';
    } else if (r < 0) {
      if (abs >= 0.75) return 'bg-rose-700 text-white';
      if (abs >= 0.55) return 'bg-rose-600 text-white';
      if (abs >= 0.35) return 'bg-rose-200 text-slate-900';
      if (abs >= 0.15) return 'bg-rose-100 text-slate-800';
      return 'bg-slate-50 text-slate-700';
    }
    return 'bg-slate-50 text-slate-700';
  };

  return (
    <div className="space-y-8">
      {/* Header Summary */}
      <section className="bg-white border border-slate-200 rounded-lg p-6">
        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-6">
          <div className="max-w-3xl">
            <div className="text-xs font-medium text-slate-500">
              {datasetDomain} · Canonical Event Stream · {Math.round(globalConfig.trainRatio * 100)}/
              {Math.round(globalConfig.valRatio * 100)}/{Math.round(globalConfig.testRatio * 100)} Entity Hash
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 mt-1.5 text-balance">
              {datasetName}
            </h1>
            <p className="text-sm text-slate-600 mt-2 leading-relaxed">
              {datasetDescription} One immutable raw event stream is deterministically split by entity hash and materialized into three leak-free training representations.
            </p>
          </div>

          <div className="shrink-0 flex items-center gap-6 pt-1 text-xs">
            <div>
              <div className="text-slate-500">Audit Status</div>
              <div className="font-mono font-semibold text-slate-900 mt-1 tabular-nums">
                {passCount} pass · {warnCount} warn · {failCount} fail
              </div>
            </div>
            <div className="h-8 w-px bg-slate-200" />
            <div>
              <div className="text-slate-500">Entity Cohort</div>
              <div className="font-mono font-semibold text-slate-900 mt-1 tabular-nums">
                {regResult.splitCounts.train}T / {regResult.splitCounts.val}V / {regResult.splitCounts.test}Te
              </div>
            </div>
          </div>
        </div>

        {/* Three Materialized Paradigm Branches */}
        <div className="mt-6 pt-6 border-t border-slate-200 grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="flex flex-col justify-between p-4 bg-slate-50 border border-slate-200 rounded-md">
            <div>
              <div className="text-xs font-semibold text-slate-500">
                01. Traditional Regression (LTV)
              </div>
              <div className="text-base font-semibold text-slate-900 mt-1">
                Point-in-Time Tabular Matrix
              </div>
              <p className="text-xs text-slate-600 mt-1.5 leading-relaxed">
                Aggregates RFM & exposure features strictly before T_obs and sums target LTV across (T_obs, T_obs + H].
              </p>
              <dl className="mt-4 grid grid-cols-2 gap-y-2 text-xs">
                <dt className="text-slate-500">Materialized Rows</dt>
                <dd className="text-right font-mono font-semibold text-slate-900 tabular-nums">
                  {regResult.rows.length}
                </dd>
                <dt className="text-slate-500">Mean Winsor LTV</dt>
                <dd className="text-right font-mono font-semibold text-slate-900 tabular-nums">
                  ${regResult.meanTargetWinsorized.toFixed(2)}
                </dd>
                <dt className="text-slate-500">Linear R² Est.</dt>
                <dd className="text-right font-mono font-semibold text-slate-900 tabular-nums">
                  {regResult.baselineR2Estimate.toFixed(3)}
                </dd>
              </dl>
            </div>
            <button
              type="button"
              onClick={() => onNavigateTab('regression')}
              className="mt-5 w-full py-2 px-3 text-xs font-medium text-blue-700 bg-white border border-slate-200 rounded hover:bg-blue-50 transition-colors flex items-center justify-between"
            >
              <span>Inspect LTV Matrix</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="flex flex-col justify-between p-4 bg-slate-50 border border-slate-200 rounded-md">
            <div>
              <div className="text-xs font-semibold text-slate-500">
                02. Deep Learning (Transformers &amp; Tensors)
              </div>
              <div className="text-base font-semibold text-slate-900 mt-1">
                {seqResult.transformerEval.architectureLabel} &amp; 3D Tensors
              </div>
              <p className="text-xs text-slate-600 mt-1.5 leading-relaxed">
                Packs event sequences into [B, L, D] tensors with padding masks and trains multi-head Transformer architectures.
              </p>
              <dl className="mt-4 grid grid-cols-2 gap-y-2 text-xs">
                <dt className="text-slate-500">Tensor Shape</dt>
                <dd className="text-right font-mono font-semibold text-slate-900 tabular-nums">
                  [{seqResult.tensorShape.join(', ')}]
                </dd>
                <dt className="text-slate-500">Transformer Config</dt>
                <dd className="text-right font-mono font-semibold text-slate-900 tabular-nums">
                  d={seqResult.transformerEval.dModel} · {seqResult.transformerEval.numHeads}h · {seqResult.transformerEval.numLayers}L
                </dd>
                <dt className="text-slate-500">Holdout R²</dt>
                <dd className="text-right font-mono font-semibold text-blue-700 tabular-nums">
                  {(seqResult.transformerEval.holdoutMetrics.rSquared ?? seqResult.transformerEval.allMetrics.rSquared)?.toFixed(3) ?? '—'}
                </dd>
              </dl>
            </div>
            <button
              type="button"
              onClick={() => onNavigateTab('sequence')}
              className="mt-5 w-full py-2 px-3 text-xs font-medium text-blue-700 bg-white border border-slate-200 rounded hover:bg-blue-50 transition-colors flex items-center justify-between"
            >
              <span>Inspect Transformers &amp; Tensors</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="flex flex-col justify-between p-4 bg-slate-50 border border-slate-200 rounded-md">
            <div>
              <div className="text-xs font-semibold text-slate-500">
                03. Offline RL (CQL / MDP)
              </div>
              <div className="text-base font-semibold text-slate-900 mt-1">
                Markov Transition Replay Set
              </div>
              <p className="text-xs text-slate-600 mt-1.5 leading-relaxed">
                Constructs (s_t, a_t, r_t, s_t+1, done) tuples with inactivity terminal detection, G_t returns, and OOD support flags.
              </p>
              <dl className="mt-4 grid grid-cols-2 gap-y-2 text-xs">
                <dt className="text-slate-500">Transitions</dt>
                <dd className="text-right font-mono font-semibold text-slate-900 tabular-nums">
                  {mdpResult.transitions.length.toLocaleString()}
                </dd>
                <dt className="text-slate-500">Mean Init Return G₀</dt>
                <dd className="text-right font-mono font-semibold text-slate-900 tabular-nums">
                  {mdpResult.meanInitialReturn.toFixed(2)}
                </dd>
                <dt className="text-slate-500">Low-Support OOD</dt>
                <dd className="text-right font-mono font-semibold text-slate-900 tabular-nums">
                  {(mdpResult.lowSupportOodRate * 100).toFixed(1)}%
                </dd>
              </dl>
            </div>
            <button
              type="button"
              onClick={() => onNavigateTab('offline_rl')}
              className="mt-5 w-full py-2 px-3 text-xs font-medium text-blue-700 bg-white border border-slate-200 rounded hover:bg-blue-50 transition-colors flex items-center justify-between"
            >
              <span>Inspect MDP Transitions</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </section>

      {/* Industry Vertical Workflow Templates Library */}
      <WorkflowTemplatesSection
        activePresetId={activePresetId}
        customDatasetName={customDatasetName}
        datasetName={datasetName}
        globalConfig={globalConfig}
        regConfig={regConfig}
        seqConfig={seqConfig}
        mdpConfig={mdpConfig}
        rulConfig={rulConfig}
        appliedCurationRules={appliedCurationRules}
        enabledEngineeredFeatures={enabledEngineeredFeatures}
        onApplyWorkflowTemplate={onApplyWorkflowTemplate}
      />

      {/* Global Parameter Sync Control Panel */}
      <GlobalParameterSyncPanel
        globalConfig={globalConfig}
        regConfig={regConfig}
        seqConfig={seqConfig}
        mdpConfig={mdpConfig}
        maxDay={maxDay}
        onApplySyncedConfigs={onApplySyncedConfigs}
      />

      {/* D3 Data Lineage Transformation Flow (Raw Events -> Processed Artifacts) */}
      <DataLineageVisualizer
        datasetName={datasetName}
        events={events}
        globalConfig={globalConfig}
        regConfig={regConfig}
        seqConfig={seqConfig}
        mdpConfig={mdpConfig}
        regResult={regResult}
        seqResult={seqResult}
        mdpResult={mdpResult}
        onNavigateTab={onNavigateTab}
      />

      {/* Automated Performance Alert Monitor (R² & Loss vs Saved Workspace Runs) */}
      <PerformanceAlertMonitor
        activePresetId={activePresetId}
        customDatasetName={customDatasetName}
        datasetName={datasetName}
        events={events}
        globalConfig={globalConfig}
        regConfig={regConfig}
        seqConfig={seqConfig}
        mdpConfig={mdpConfig}
        regResult={regResult}
        seqResult={seqResult}
        mdpResult={mdpResult}
        onNavigateTab={onNavigateTab}
        onOpenWorkspaces={onOpenWorkspaces}
      />

      {/* Data Health Scorecard & Sanity Gauge */}
      <DataHealthScorecard events={events} />

      {/* Regression Feature Pearson Correlation Matrix */}
      <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              Regression Feature Pearson Correlation Matrix
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Pairwise linear correlation (r) across {regResult.rows.length.toLocaleString()} observation-window entity rows to detect predictor multicollinearity.
            </p>
          </div>
          <div className="flex items-center gap-4 text-[11px] text-slate-600 shrink-0">
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-xs bg-rose-700 inline-block" aria-hidden="true" />
              <span className="font-mono tabular-nums">-1.0 Inverse</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-xs bg-slate-100 border border-slate-200 inline-block" aria-hidden="true" />
              <span className="font-mono tabular-nums">0.0 Orthogonal</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-xs bg-blue-700 inline-block" aria-hidden="true" />
              <span className="font-mono tabular-nums">+1.0 Collinear</span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-12 divide-y xl:divide-y-0 xl:divide-x divide-slate-200">
          <div className="xl:col-span-8 p-5 overflow-x-auto">
            {regResult.rows.length < 2 ? (
              <div className="py-10 text-center text-xs text-slate-500">
                At least 2 materialized regression rows are required to compute feature correlations. Adjust T_obs or dataset filters.
              </div>
            ) : (
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr>
                    <th className="py-2 pr-3 text-left font-semibold text-slate-500 text-[11px] whitespace-nowrap">
                      Predictor
                    </th>
                    {matrixFeatures.map((col, j) => (
                      <th
                        key={col.key}
                        className="py-2 px-1.5 text-center font-semibold text-slate-600 text-[11px] whitespace-nowrap"
                        title={col.label}
                      >
                        {col.shortLabel}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {matrixFeatures.map((rowFeat, i) => (
                    <tr key={rowFeat.key}>
                      <th
                        scope="row"
                        className="py-1.5 pr-3 text-left font-medium text-slate-700 text-[11px] whitespace-nowrap"
                        title={rowFeat.label}
                      >
                        {rowFeat.shortLabel}
                      </th>
                      {matrixFeatures.map((colFeat, j) => {
                        const r = matrix[i]?.[j] ?? 0;
                        const isDiagonal = i === j;
                        const isSelected =
                          selectedCell &&
                          ((selectedCell.i === i && selectedCell.j === j) ||
                            (selectedCell.i === j && selectedCell.j === i));
                        const isFlagged = !isDiagonal && Math.abs(r) >= 0.7;

                        return (
                          <td key={colFeat.key} className="p-0.5">
                            <button
                              type="button"
                              onClick={() => setSelectedCell({ i, j })}
                              onMouseEnter={() => setSelectedCell({ i, j })}
                              aria-label={`${rowFeat.label} vs ${colFeat.label}: r = ${r.toFixed(3)}`}
                              className={`w-full h-9 rounded-xs font-mono text-[11px] tabular-nums transition-transform flex items-center justify-center relative focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${getMatrixCellClasses(
                                r,
                                isDiagonal
                              )} ${
                                isSelected
                                  ? 'ring-2 ring-slate-900 ring-offset-1 z-10'
                                  : ''
                              }`}
                            >
                              {r >= 0 && !isDiagonal ? `+${r.toFixed(2)}` : r.toFixed(2)}
                              {isFlagged && (
                                <span
                                  className="absolute top-0.5 right-1 text-[9px] font-bold leading-none opacity-90"
                                  title="High collinearity (|r| >= 0.70)"
                                >
                                  *
                                </span>
                              )}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Multicollinearity Inspector & Flagged Pairs */}
          <div className="xl:col-span-4 p-5 bg-slate-50/50 flex flex-col justify-between gap-5">
            <div>
              <div className="text-xs font-semibold text-slate-900">
                Pairwise Collinearity Inspector
              </div>
              {activeCellInfo ? (
                <div className="mt-3 space-y-3">
                  <div className="text-xs text-slate-600 leading-relaxed">
                    <span className="font-semibold text-slate-900">
                      {activeCellInfo.featureA.label}
                    </span>{' '}
                    ×{' '}
                    <span className="font-semibold text-slate-900">
                      {activeCellInfo.featureB.label}
                    </span>
                  </div>
                  <dl className="grid grid-cols-3 gap-2 py-2.5 border-y border-slate-200 text-xs">
                    <div>
                      <dt className="text-[11px] text-slate-500">Pearson r</dt>
                      <dd className="font-mono font-semibold text-slate-900 mt-0.5 tabular-nums">
                        {activeCellInfo.r >= 0 && !activeCellInfo.isDiagonal
                          ? `+${activeCellInfo.r.toFixed(3)}`
                          : activeCellInfo.r.toFixed(3)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[11px] text-slate-500">Shared R²</dt>
                      <dd className="font-mono font-semibold text-slate-900 mt-0.5 tabular-nums">
                        {(activeCellInfo.r2 * 100).toFixed(1)}%
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[11px] text-slate-500">Pair VIF</dt>
                      <dd className="font-mono font-semibold text-slate-900 mt-0.5 tabular-nums">
                        {activeCellInfo.isDiagonal ? '—' : activeCellInfo.vif.toFixed(2)}
                      </dd>
                    </div>
                  </dl>
                  <div className="text-xs text-slate-600">
                    <span className="font-semibold text-slate-800">
                      {activeCellInfo.severity}:
                    </span>{' '}
                    {activeCellInfo.isDiagonal
                      ? 'Self-correlation diagonal. Select any off-diagonal cell to evaluate collinearity.'
                      : Math.abs(activeCellInfo.r) >= 0.7
                      ? 'Strong linear dependence (|r| ≥ 0.70). Ordinary least squares coefficients may become unstable; consider Ridge regularization or dropping one predictor.'
                      : Math.abs(activeCellInfo.r) >= 0.4
                      ? 'Moderate shared variance. Tree ensembles tolerate this well, while linear models benefit from L2 regularization.'
                      : 'Predictors contribute largely orthogonal signal with minimal variance inflation.'}
                  </div>
                </div>
              ) : (
                <p className="mt-2 text-xs text-slate-500">
                  Select a matrix cell to inspect pairwise correlation and VIF.
                </p>
              )}

              <div className="mt-5 pt-4 border-t border-slate-200">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-900">
                    Flagged Pairs (|r| ≥ 0.70)
                  </span>
                  <span className="font-mono text-slate-600 tabular-nums">
                    {highCollinearityPairs.length} detected
                  </span>
                </div>
                {highCollinearityPairs.length === 0 ? (
                  <div className="mt-2 text-xs text-emerald-700 flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                    <span>No severe pairwise multicollinearity detected.</span>
                  </div>
                ) : (
                  <ul className="mt-2.5 space-y-2">
                    {highCollinearityPairs.slice(0, 4).map((pair) => (
                      <li
                        key={`${pair.featureA}-${pair.featureB}`}
                        className="flex items-center justify-between text-xs text-slate-700"
                      >
                        <span className="truncate pr-2">
                          {pair.labelA} · {pair.labelB}
                        </span>
                        <span className="font-mono font-semibold text-amber-700 whitespace-nowrap tabular-nums">
                          r={pair.pearsonR.toFixed(2)} (VIF {pair.vifEstimate.toFixed(1)})
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            <button
              type="button"
              onClick={() => onNavigateTab('regression')}
              className="w-full py-2 px-3 text-xs font-medium text-blue-700 bg-white border border-slate-200 rounded hover:bg-blue-50 transition-colors flex items-center justify-between"
            >
              <span>Tune Regression Window & Split</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </section>

      {/* Target & Predictor Distribution Histograms */}
      <DistributionHistograms regResult={regResult} />

      {/* Standard Deviation Outlier Analysis */}
      <OutlierAnalysisSection regResult={regResult} />

      {/* Acquisition Cohort LTV Progression Heatmap */}
      <CohortLtvHeatmap events={events} />

      {/* Cross-Paradigm Schema Alignment + Audit Checklist */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        <section className="xl:col-span-7 bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200">
            <h2 className="text-sm font-semibold text-slate-900">
              Unified Canonical Schema Projection
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              How every canonical field projects across tabular, sequential, and Markov decision formulations.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-600">
                  <th className="py-2.5 px-4">Canonical Field</th>
                  <th className="py-2.5 px-4">Regression (LTV)</th>
                  <th className="py-2.5 px-4">Sequence Tensor</th>
                  <th className="py-2.5 px-4">Offline RL (CQL)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-xs">
                {SCHEMA_MAPPING.map((row) => (
                  <tr key={row.field} className="hover:bg-slate-50/70">
                    <td className="py-2.5 px-4 font-mono font-medium text-slate-900 whitespace-nowrap">
                      {row.field}
                      <span className="ml-1.5 text-[10px] text-slate-400 font-normal">
                        {row.type}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 text-slate-600">{row.regression}</td>
                    <td className="py-2.5 px-4 text-slate-600">{row.sequence}</td>
                    <td className="py-2.5 px-4 text-slate-600">{row.offlineRl}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="xl:col-span-5 bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                Cross-Paradigm Integrity Checks
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Live verification across current curation parameters.
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigateTab('audit_export')}
              className="text-xs font-medium text-blue-700 hover:underline whitespace-nowrap"
            >
              Full Audit & Codegen
            </button>
          </div>
          <div className="divide-y divide-slate-200">
            {audits.map((chk) => (
              <div key={chk.id} className="px-5 py-3.5 flex items-start justify-between gap-3">
                <div className="flex items-start gap-2.5 min-w-0">
                  {chk.status === 'pass' && (
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                  )}
                  {chk.status === 'warn' && (
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  )}
                  {chk.status === 'fail' && (
                    <XCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                  )}
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-slate-900 truncate">
                      {chk.name}
                    </div>
                    <div className="text-[11px] text-slate-500 mt-0.5">
                      {chk.paradigm} · {chk.status === 'pass' ? 'Nominal' : chk.status === 'warn' ? 'Warning' : 'Violation'}
                    </div>
                  </div>
                </div>
                <div className="text-xs font-mono font-medium text-slate-800 whitespace-nowrap tabular-nums shrink-0">
                  {chk.metricValue}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* Canonical Event Ledger */}
      <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              Canonical Event Ledger Sample
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Showing first {filteredEvents.length} of {events.length.toLocaleString()} chronological raw events.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Filter entity or channel..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-md w-48 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
              />
            </div>
            <select
              aria-label="Filter by action"
              value={actionFilter}
              onChange={(e) =>
                setActionFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))
              }
              className="px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
            >
              <option value="all">All Actions</option>
              {uniqueActions.map(([id, label]) => (
                <option key={id} value={id}>
                  {id}: {label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="overflow-x-auto max-h-80">
          <table className="w-full text-left border-collapse">
            <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-600">
              <tr>
                <th className="py-2.5 px-4">Entity ID</th>
                <th className="py-2.5 px-4">Split</th>
                <th className="py-2.5 px-4 text-right">Day (t)</th>
                <th className="py-2.5 px-4">Action</th>
                <th className="py-2.5 px-4">Channel</th>
                <th className="py-2.5 px-4 text-right">Δt Days</th>
                <th className="py-2.5 px-4 text-right">Spend</th>
                <th className="py-2.5 px-4 text-right">Engagement</th>
                <th className="py-2.5 px-4 text-right">Reward</th>
                <th className="py-2.5 px-4 text-right">Propensity μ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-xs">
              {filteredEvents.map((ev) => (
                <tr key={ev.eventId} className="hover:bg-slate-50/80 h-9">
                  <td className="py-2 px-4 font-mono font-medium text-slate-900">
                    {ev.entityId}
                  </td>
                  <td className="py-2 px-4 font-mono text-slate-500">
                    {assignEntitySplit(ev.entityId, globalConfig)}
                  </td>
                  <td className="py-2 px-4 text-right font-mono tabular-nums text-slate-700">
                    {ev.timestampDay}
                  </td>
                  <td className="py-2 px-4 text-slate-700">
                    {ev.actionId} · {ev.actionLabel}
                  </td>
                  <td className="py-2 px-4 text-slate-600">{ev.channel}</td>
                  <td className="py-2 px-4 text-right font-mono tabular-nums text-slate-600">
                    {ev.recencyDays}
                  </td>
                  <td className="py-2 px-4 text-right font-mono tabular-nums text-slate-900">
                    ${ev.spendAmount.toFixed(2)}
                  </td>
                  <td className="py-2 px-4 text-right font-mono tabular-nums text-slate-700">
                    {ev.engagementScore.toFixed(3)}
                  </td>
                  <td className="py-2 px-4 text-right font-mono tabular-nums text-slate-900">
                    {ev.reward.toFixed(2)}
                  </td>
                  <td className="py-2 px-4 text-right font-mono tabular-nums text-slate-600">
                    {ev.propensity.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
