import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  Download,
  Loader2,
  RotateCcw,
  ShieldAlert,
  SlidersHorizontal,
  Wand2,
  XCircle,
} from 'lucide-react';
import {
  AiCuratorConfigPatch,
  AiCuratorPlan,
  CurationObjectivePreset,
  CurationRuleId,
  CurationTransformResult,
  GlobalCurationConfig,
  MdpConfig,
  MdpResult,
  RawEvent,
  RegressionConfig,
  RegressionResult,
  SequenceConfig,
  SequenceResult,
} from '../types/curation';
import {
  buildCuratorProfileReport,
  CURATION_RULE_META,
} from '../engine/curatorEngine';

interface AiCuratorViewProps {
  datasetName: string;
  datasetDomain: string;
  rawEvents: RawEvent[];
  curationTransform: CurationTransformResult;
  appliedRules: CurationRuleId[];
  onToggleRule: (ruleId: CurationRuleId) => void;
  onApplyRules: (rules: CurationRuleId[]) => void;
  onResetRules: () => void;
  globalConfig: GlobalCurationConfig;
  regConfig: RegressionConfig;
  seqConfig: SequenceConfig;
  mdpConfig: MdpConfig;
  onUpdateRegConfig: React.Dispatch<React.SetStateAction<RegressionConfig>>;
  onUpdateSeqConfig: React.Dispatch<React.SetStateAction<SequenceConfig>>;
  onUpdateMdpConfig: React.Dispatch<React.SetStateAction<MdpConfig>>;
  regResult: RegressionResult;
  seqResult: SequenceResult;
  mdpResult: MdpResult;
  onExportCuratedEventsCsv: () => void;
  onInspectEntityInExplorer: (entityId: string) => void;
}

const OBJECTIVE_PRESETS: { id: CurationObjectivePreset; label: string }[] = [
  { id: 'balanced_multi_paradigm', label: 'Balanced Parity' },
  { id: 'regression_ltv_stability', label: 'Regression LTV' },
  { id: 'sequence_transformer_cleanliness', label: 'Sequence Tensors' },
  { id: 'offline_rl_cql_safety', label: 'Offline RL Safety' },
];

export const AiCuratorView: React.FC<AiCuratorViewProps> = ({
  datasetName,
  datasetDomain,
  rawEvents,
  curationTransform,
  appliedRules,
  onToggleRule,
  onApplyRules,
  onResetRules,
  globalConfig,
  regConfig,
  seqConfig,
  mdpConfig,
  onUpdateRegConfig,
  onUpdateSeqConfig,
  onUpdateMdpConfig,
  regResult,
  seqResult,
  mdpResult,
  onExportCuratedEventsCsv,
  onInspectEntityInExplorer,
}) => {
  const [objective, setObjective] = useState<CurationObjectivePreset>(
    'balanced_multi_paradigm'
  );
  const [customGoal, setCustomGoal] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiPlan, setAiPlan] = useState<AiCuratorPlan | null>(null);
  const [planAppliedNotice, setPlanAppliedNotice] = useState<string | null>(null);

  const profile = useMemo(
    () =>
      buildCuratorProfileReport({
        rawEvents,
        curatedEvents: curationTransform.events,
        regResult,
        seqResult,
        mdpResult,
      }),
    [rawEvents, curationTransform.events, regResult, seqResult, mdpResult]
  );

  const appliedSet = useMemo(() => new Set(appliedRules), [appliedRules]);

  const handleRunAiCurator = async () => {
    setIsAnalyzing(true);
    setAiError(null);
    setPlanAppliedNotice(null);

    try {
      const response = await fetch('/api/curate-dataset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          datasetName,
          datasetDomain,
          objective,
          customGoal: customGoal.trim(),
          appliedRules,
          profileSummary: {
            rawEventCount: profile.rawEventCount,
            curatedEventCount: profile.curatedEventCount,
            rawEntityCount: profile.rawEntityCount,
            curatedEntityCount: profile.curatedEntityCount,
            rawHealthScore: profile.rawHealthScorecard.score,
            curatedHealthScore: profile.curatedHealthScorecard.score,
            negativeRewardCount: profile.negativeRewardCount,
            duplicateEventCount: profile.duplicateEventCount,
            lowPropensityCount: profile.lowPropensityCount,
            singleTouchEntityCount: profile.singleTouchEntityCount,
            outOfBoundsCount: profile.outOfBoundsCount,
            p99SpendCap: Number(profile.p99SpendCap.toFixed(2)),
            healthChecks: profile.curatedHealthScorecard.checks.map((c) => ({
              label: c.label,
              status: c.status,
              metricSummary: c.metricSummary,
            })),
          },
          currentConfigs: {
            splitRatios: `${Math.round(globalConfig.trainRatio * 100)}/${Math.round(
              globalConfig.valRatio * 100
            )}/${Math.round(globalConfig.testRatio * 100)}`,
            regConfig: {
              obsCutoffDay: regConfig.obsCutoffDay,
              horizonDays: regConfig.horizonDays,
              winsorizePercentile: regConfig.winsorizePercentile,
              featureNormalization: regConfig.featureNormalization,
              excludeDetectedOutliers: Boolean(regConfig.excludeDetectedOutliers),
            },
            seqConfig: {
              maxSeqLen: seqConfig.maxSeqLen,
              normalization: seqConfig.normalization,
              padding: seqConfig.padding,
              truncation: seqConfig.truncation,
            },
            mdpConfig: {
              gamma: mdpConfig.gamma,
              rewardScale: mdpConfig.rewardScale,
              minTrajectorySteps: mdpConfig.minTrajectorySteps,
            },
          },
          pipelineTelemetry: {
            regression: {
              rows: regResult.rows.length,
              rSquared: Number(regResult.linearFit.rSquared.toFixed(4)),
              rmse: Number(regResult.linearFit.rmse.toFixed(2)),
              zeroTargetRatePct: Number((regResult.zeroTargetRate * 100).toFixed(1)),
              maxKlDivergence: Number(regResult.driftReport.maxKlDivergence.toFixed(3)),
              driftTier: regResult.driftReport.tier,
              outlierCount: regResult.anomalyReport.outlierCount,
              highCollinearityCount: regResult.featureMatrix.highCollinearityPairs.length,
            },
            sequence: {
              tensorShape: seqResult.tensorShape,
              paddingSparsityPct: Number((seqResult.paddingSparsity * 100).toFixed(1)),
              holdoutR2: seqResult.transformerEval.holdoutMetrics.rSquared,
              lossDiagnosis: seqResult.transformerEval.lossCurve.diagnosisLabel,
            },
            offlineRl: {
              trajectories: mdpResult.trajectoryCount,
              transitions: mdpResult.transitions.length,
              meanInitialReturn: Number(mdpResult.meanInitialReturn.toFixed(2)),
              lowSupportOodRatePct: Number((mdpResult.lowSupportOodRate * 100).toFixed(1)),
            },
          },
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        plan?: AiCuratorPlan;
        error?: string;
      };
      if (!response.ok || !payload.plan) {
        throw new Error(payload.error || `Request failed (${response.status})`);
      }

      setAiPlan(payload.plan);
    } catch (err) {
      setAiError(
        err instanceof Error ? err.message : 'Unable to generate AI curation plan.'
      );
    } finally {
      setIsAnalyzing(false);
    }
  };

  const applyConfigPatch = (patch: AiCuratorConfigPatch) => {
    onUpdateRegConfig((prev) => ({
      ...prev,
      ...(patch.regWinsorizePercentile === 0 ||
      patch.regWinsorizePercentile === 95 ||
      patch.regWinsorizePercentile === 99
        ? { winsorizePercentile: patch.regWinsorizePercentile }
        : {}),
      ...(patch.regNormalization ? { featureNormalization: patch.regNormalization } : {}),
      ...(typeof patch.regExcludeOutliers === 'boolean'
        ? { excludeDetectedOutliers: patch.regExcludeOutliers }
        : {}),
    }));

    onUpdateSeqConfig((prev) => ({
      ...prev,
      ...(patch.seqNormalization ? { normalization: patch.seqNormalization } : {}),
      ...(typeof patch.seqMaxSeqLen === 'number' &&
      patch.seqMaxSeqLen >= 4 &&
      patch.seqMaxSeqLen <= 32
        ? { maxSeqLen: Math.round(patch.seqMaxSeqLen) }
        : {}),
    }));

    onUpdateMdpConfig((prev) => ({
      ...prev,
      ...(patch.mdpRewardScale ? { rewardScale: patch.mdpRewardScale } : {}),
      ...(typeof patch.mdpMinTrajectorySteps === 'number' &&
      patch.mdpMinTrajectorySteps >= 1 &&
      patch.mdpMinTrajectorySteps <= 5
        ? { minTrajectorySteps: Math.round(patch.mdpMinTrajectorySteps) }
        : {}),
    }));
  };

  const handleApplyFullPlan = () => {
    if (!aiPlan) return;
    const validRules = aiPlan.recommendedEventRules
      .map((r) => r.ruleId)
      .filter((id): id is CurationRuleId => id in CURATION_RULE_META);
    const merged = Array.from(new Set([...appliedRules, ...validRules]));
    onApplyRules(merged);
    applyConfigPatch(aiPlan.recommendedConfigPatch);
    setPlanAppliedNotice(
      `Applied ${validRules.length} event curation rule${
        validRules.length === 1 ? '' : 's'
      } and harmonized pipeline parameters.`
    );
  };

  const handleApplyRulesOnly = () => {
    if (!aiPlan) return;
    const validRules = aiPlan.recommendedEventRules
      .map((r) => r.ruleId)
      .filter((id): id is CurationRuleId => id in CURATION_RULE_META);
    const merged = Array.from(new Set([...appliedRules, ...validRules]));
    onApplyRules(merged);
    setPlanAppliedNotice(
      `Applied ${validRules.length} event transformation rule${
        validRules.length === 1 ? '' : 's'
      }.`
    );
  };

  const handleApplyPatchOnly = () => {
    if (!aiPlan) return;
    applyConfigPatch(aiPlan.recommendedConfigPatch);
    setPlanAppliedNotice('Applied recommended Regression, Sequence, and Offline RL config patch.');
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900">
            AI-Powered Data Quality &amp; Curator Engine
          </h1>
          <p className="text-sm text-slate-600 mt-1 max-w-2xl">
            Automated anomaly detection, non-destructive event remediation, and Gemini-driven
            curation planning across {datasetName} ({datasetDomain}).
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {appliedRules.length > 0 && (
            <button
              type="button"
              onClick={() => {
                onResetRules();
                setPlanAppliedNotice(null);
              }}
              className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-md transition-colors inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              <RotateCcw className="w-3.5 h-3.5 text-slate-500" />
              <span>Revert to Raw Stream ({appliedRules.length} active)</span>
            </button>
          )}
          <button
            type="button"
            onClick={onExportCuratedEventsCsv}
            className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-md transition-colors inline-flex items-center gap-1.5 whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5 text-slate-500" />
            <span>Export Curated CSV</span>
          </button>
        </div>
      </div>

      {/* Live Before/After KPI Strip */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-xs text-slate-500">Data Health Score</div>
          <div className="mt-1.5 flex items-baseline gap-2 font-mono tabular-nums">
            <span className="text-2xl font-bold text-slate-900">
              {profile.curatedHealthScorecard.score}
            </span>
            <span className="text-xs text-slate-400">/ 100</span>
            {profile.scoreDelta !== 0 && (
              <span
                className={`text-xs font-semibold ${
                  profile.scoreDelta > 0 ? 'text-emerald-700' : 'text-amber-700'
                }`}
              >
                {profile.scoreDelta > 0 ? `+${profile.scoreDelta}` : profile.scoreDelta} vs raw
              </span>
            )}
          </div>
          <div className="text-[11px] text-slate-500 mt-1">
            {profile.curatedHealthScorecard.tierLabel} ·{' '}
            {profile.curatedHealthScorecard.passCount}/6 checks pass
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-xs text-slate-500">Curated Stream Volume</div>
          <div className="mt-1.5 flex items-baseline gap-2 font-mono tabular-nums">
            <span className="text-2xl font-bold text-slate-900">
              {curationTransform.curatedEventCount.toLocaleString()}
            </span>
            <span className="text-xs text-slate-500">
              / {curationTransform.rawEventCount.toLocaleString()} events
            </span>
          </div>
          <div className="text-[11px] text-slate-500 mt-1 font-mono tabular-nums">
            {curationTransform.removedEventCount} removed · {curationTransform.modifiedEventCount}{' '}
            repaired
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-xs text-slate-500">Regression Fit &amp; KL Drift</div>
          <div className="mt-1.5 flex items-baseline gap-2 font-mono tabular-nums">
            <span className="text-2xl font-bold text-slate-900">
              R² {regResult.linearFit.rSquared.toFixed(3)}
            </span>
            <span className="text-xs text-slate-500">
              · {regResult.driftReport.maxKlDivergence.toFixed(3)} nats
            </span>
          </div>
          <div className="text-[11px] text-slate-500 mt-1">
            RMSE ${regResult.linearFit.rmse.toFixed(2)} · {regResult.anomalyReport.outlierCount}{' '}
            outliers
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-xs text-slate-500">Sequence &amp; Offline RL</div>
          <div className="mt-1.5 flex items-baseline gap-2 font-mono tabular-nums">
            <span className="text-2xl font-bold text-slate-900">
              {(mdpResult.lowSupportOodRate * 100).toFixed(1)}%
            </span>
            <span className="text-xs text-slate-500">OOD rate</span>
          </div>
          <div className="text-[11px] text-slate-500 mt-1 font-mono tabular-nums">
            {(seqResult.paddingSparsity * 100).toFixed(1)}% tensor sparsity ·{' '}
            {mdpResult.trajectoryCount} trajectories
          </div>
        </div>
      </section>

      {/* AI Curator Prompt & Objective Control Surface */}
      <section className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1">
            <h2 className="font-display text-base font-bold text-slate-900">
              AI Curation Objective &amp; Synthesis
            </h2>
            <p className="text-xs text-slate-500">
              Select a primary optimization objective or describe a custom curation policy to inspect live diagnostics and generate an executable plan.
            </p>
          </div>

          <div
            role="tablist"
            aria-label="Curation objective preset"
            className="inline-flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg"
          >
            {OBJECTIVE_PRESETS.map((obj) => {
              const active = objective === obj.id;
              return (
                <button
                  key={obj.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setObjective(obj.id)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    active
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {obj.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-col md:flex-row gap-3">
          <input
            type="text"
            aria-label="Optional custom curation instruction"
            value={customGoal}
            onChange={(e) => setCustomGoal(e.target.value)}
            placeholder="Optional custom goal (e.g. Minimize Offline RL OOD rate while retaining recent high-value cohorts)..."
            className="flex-1 h-10 px-3.5 bg-slate-50 border border-slate-200 rounded-md text-xs text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
          />
          <button
            type="button"
            onClick={handleRunAiCurator}
            disabled={isAnalyzing}
            className="h-10 px-5 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-75 rounded-md transition-colors inline-flex items-center justify-center gap-2 whitespace-nowrap shrink-0"
          >
            {isAnalyzing ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Analyzing &amp; Planning...</span>
              </>
            ) : (
              <>
                <Wand2 className="w-3.5 h-3.5" />
                <span>Run AI Quality Audit &amp; Curation Plan</span>
              </>
            )}
          </button>
        </div>

        {aiError && (
          <div
            role="alert"
            className="bg-red-50 border border-red-200 rounded-md p-3.5 flex items-start gap-2.5 text-xs text-red-900"
          >
            <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
            <div>
              <div className="font-semibold">AI Curator Request Failed</div>
              <p className="mt-0.5 text-red-800">{aiError}</p>
            </div>
          </div>
        )}

        {planAppliedNotice && (
          <div
            role="status"
            className="bg-emerald-50 border border-emerald-200 rounded-md p-3.5 flex items-center justify-between gap-3 text-xs text-emerald-900"
          >
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
              <span className="font-medium">{planAppliedNotice}</span>
            </div>
            <button
              type="button"
              onClick={() => setPlanAppliedNotice(null)}
              className="text-emerald-700 hover:underline text-[11px] font-medium"
            >
              Dismiss
            </button>
          </div>
        )}
      </section>

      {/* Main Split Workspace: AI Plan & Diagnostics vs Live Rule Pipeline */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: AI Plan + Detected Findings */}
        <div className="lg:col-span-7 space-y-6">
          {aiPlan && (
            <section className="bg-white border border-slate-200 rounded-lg p-5 space-y-5">
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 pb-4 border-b border-slate-200">
                <div>
                  <div className="flex items-center gap-2 text-xs font-mono">
                    {aiPlan.overallReadiness === 'production_ready' ? (
                      <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>PRODUCTION READY</span>
                      </span>
                    ) : aiPlan.overallReadiness === 'needs_curation' ? (
                      <span className="inline-flex items-center gap-1 text-amber-700 font-semibold">
                        <AlertTriangle className="w-3.5 h-3.5" />
                        <span>NEEDS CURATION</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-red-700 font-semibold">
                        <XCircle className="w-3.5 h-3.5" />
                        <span>CRITICAL REMEDIATION</span>
                      </span>
                    )}
                    <span className="text-slate-300" aria-hidden="true">·</span>
                    <span className="text-slate-500">{aiPlan.model}</span>
                  </div>
                  <h3 className="font-display text-lg font-bold text-slate-900 mt-1">
                    {aiPlan.headline}
                  </h3>
                </div>

                <button
                  type="button"
                  onClick={handleApplyFullPlan}
                  className="px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-md transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>Apply Full AI Plan</span>
                </button>
              </div>

              <p className="text-xs text-slate-700 leading-relaxed">
                {aiPlan.executiveDiagnosis}
              </p>

              {/* Recommended Event Rules */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-semibold text-slate-900">
                    Recommended Event Transformations ({aiPlan.recommendedEventRules.length})
                  </h4>
                  {aiPlan.recommendedEventRules.length > 0 && (
                    <button
                      type="button"
                      onClick={handleApplyRulesOnly}
                      className="text-xs font-medium text-blue-700 hover:underline"
                    >
                      Apply Event Rules Only
                    </button>
                  )}
                </div>

                {aiPlan.recommendedEventRules.length === 0 ? (
                  <p className="text-xs text-slate-500">
                    No destructive or value-modifying event rules are required for the current stream.
                  </p>
                ) : (
                  <div className="divide-y divide-slate-100 border border-slate-200 rounded-md">
                    {aiPlan.recommendedEventRules.map((rec) => {
                      const meta = CURATION_RULE_META[rec.ruleId];
                      const isActive = appliedSet.has(rec.ruleId);
                      return (
                        <div
                          key={rec.ruleId}
                          className="p-3 flex items-start justify-between gap-3 text-xs"
                        >
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-slate-900">
                                {meta?.label ?? rec.ruleId}
                              </span>
                              <span className="text-slate-400" aria-hidden="true">·</span>
                              <span className="font-mono text-[11px] uppercase text-slate-500">
                                {rec.priority} priority
                              </span>
                            </div>
                            <p className="text-slate-600">{rec.rationale}</p>
                            <div className="text-[11px] text-emerald-700 font-medium">
                              Expected impact: {rec.expectedBenefit}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => onToggleRule(rec.ruleId)}
                            className={`px-3 py-1.5 text-xs font-medium rounded-md border shrink-0 transition-colors ${
                              isActive
                                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                                : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                            }`}
                          >
                            {isActive ? 'Applied' : 'Apply Rule'}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Recommended Pipeline Config Patch */}
              <div className="space-y-2.5 pt-2 border-t border-slate-100">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-900">
                    <SlidersHorizontal className="w-3.5 h-3.5 text-blue-700" />
                    <span>Recommended Pipeline Configuration Patch</span>
                  </div>
                  <button
                    type="button"
                    onClick={handleApplyPatchOnly}
                    className="text-xs font-medium text-blue-700 hover:underline"
                  >
                    Apply Config Patch
                  </button>
                </div>

                <p className="text-xs text-slate-600">
                  {aiPlan.recommendedConfigPatch.rationale}
                </p>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 text-[11px] font-mono bg-slate-50 border border-slate-200 rounded-md p-3">
                  {aiPlan.recommendedConfigPatch.regWinsorizePercentile !== undefined && (
                    <div>
                      <span className="text-slate-500">Reg Winsorize: </span>
                      <strong className="text-slate-900">
                        P{aiPlan.recommendedConfigPatch.regWinsorizePercentile}
                      </strong>
                    </div>
                  )}
                  {aiPlan.recommendedConfigPatch.regNormalization && (
                    <div>
                      <span className="text-slate-500">Reg Norm: </span>
                      <strong className="text-slate-900">
                        {aiPlan.recommendedConfigPatch.regNormalization}
                      </strong>
                    </div>
                  )}
                  {typeof aiPlan.recommendedConfigPatch.regExcludeOutliers === 'boolean' && (
                    <div>
                      <span className="text-slate-500">Exclude Outliers: </span>
                      <strong className="text-slate-900">
                        {String(aiPlan.recommendedConfigPatch.regExcludeOutliers)}
                      </strong>
                    </div>
                  )}
                  {aiPlan.recommendedConfigPatch.seqNormalization && (
                    <div>
                      <span className="text-slate-500">Seq Norm: </span>
                      <strong className="text-slate-900">
                        {aiPlan.recommendedConfigPatch.seqNormalization}
                      </strong>
                    </div>
                  )}
                  {typeof aiPlan.recommendedConfigPatch.seqMaxSeqLen === 'number' && (
                    <div>
                      <span className="text-slate-500">maxSeqLen: </span>
                      <strong className="text-slate-900">
                        {aiPlan.recommendedConfigPatch.seqMaxSeqLen}
                      </strong>
                    </div>
                  )}
                  {aiPlan.recommendedConfigPatch.mdpRewardScale && (
                    <div>
                      <span className="text-slate-500">MDP Reward: </span>
                      <strong className="text-slate-900">
                        {aiPlan.recommendedConfigPatch.mdpRewardScale}
                      </strong>
                    </div>
                  )}
                </div>
              </div>

              {/* Prioritized Findings & Checklist */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-slate-100">
                <div className="space-y-2">
                  <h4 className="text-xs font-semibold text-slate-900">
                    Prioritized AI Findings
                  </h4>
                  <ul className="space-y-2 text-xs">
                    {aiPlan.prioritizedFindings.map((f, i) => (
                      <li key={i} className="space-y-0.5">
                        <div className="font-medium text-slate-900">
                          <span
                            className={`font-mono uppercase text-[10px] mr-1.5 ${
                              f.severity === 'critical'
                                ? 'text-red-700'
                                : f.severity === 'warn'
                                  ? 'text-amber-700'
                                  : 'text-blue-700'
                            }`}
                          >
                            [{f.severity}]
                          </span>
                          {f.title}
                        </div>
                        <div className="text-slate-500 text-[11px]">{f.evidence}</div>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="space-y-2">
                  <h4 className="text-xs font-semibold text-slate-900">
                    Post-Curation Verification Checklist
                  </h4>
                  <ul className="space-y-1.5 text-xs text-slate-700 list-disc pl-4">
                    {aiPlan.validationChecklist.map((item, idx) => (
                      <li key={idx}>{item}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </section>
          )}

          {/* Deterministic Automated Anomaly Scan */}
          <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50/70 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-slate-700" />
                <h3 className="font-display text-sm font-bold text-slate-900">
                  Live Quality Profiler &amp; Flagged Records
                </h3>
              </div>
              <span className="text-xs font-mono tabular-nums text-slate-500">
                {profile.findings.length} finding{profile.findings.length === 1 ? '' : 's'}
              </span>
            </div>

            {profile.findings.length === 0 ? (
              <div className="p-8 text-center space-y-2">
                <CheckCircle2 className="w-6 h-6 text-emerald-600 mx-auto" />
                <div className="text-sm font-semibold text-slate-900">
                  Zero Remaining Stream Anomalies Detected
                </div>
                <p className="text-xs text-slate-500 max-w-md mx-auto">
                  All canonical reward, duplicate, propensity, entity coverage, and unit-bound checks pass cleanly on the active event stream.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {profile.findings.map((finding) => {
                  const ruleActive = finding.ruleId ? appliedSet.has(finding.ruleId) : false;
                  return (
                    <div key={finding.id} className="p-5 space-y-3">
                      <div className="flex items-start justify-between gap-4">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2 text-xs">
                            <span
                              className={`font-mono uppercase text-[11px] font-semibold ${
                                finding.severity === 'critical'
                                  ? 'text-red-700'
                                  : finding.severity === 'warn'
                                    ? 'text-amber-700'
                                    : 'text-blue-700'
                              }`}
                            >
                              {finding.severity}
                            </span>
                            <span className="text-slate-300" aria-hidden="true">·</span>
                            <span className="text-slate-500 font-medium">{finding.category}</span>
                            <span className="text-slate-300" aria-hidden="true">·</span>
                            <span className="font-mono tabular-nums text-slate-600">
                              {finding.affectedEvents.toLocaleString()} events (
                              {finding.affectedRatePct.toFixed(1)}%)
                            </span>
                          </div>
                          <h4 className="text-sm font-semibold text-slate-900">
                            {finding.title}
                          </h4>
                          <p className="text-xs text-slate-600 leading-relaxed">
                            {finding.detail}
                          </p>
                        </div>

                        {finding.ruleId && (
                          <button
                            type="button"
                            onClick={() => onToggleRule(finding.ruleId!)}
                            className={`px-3 py-1.5 text-xs font-medium rounded-md border shrink-0 transition-colors ${
                              ruleActive
                                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                                : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                            }`}
                          >
                            {ruleActive ? 'Fix Applied' : 'Apply Fix'}
                          </button>
                        )}
                      </div>

                      {finding.sampleRows.length > 0 && (
                        <div className="border border-slate-200 rounded-md overflow-hidden">
                          <table className="w-full text-[11px]">
                            <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
                              <tr>
                                <th className="text-left px-3 py-1.5 font-medium">Event ID</th>
                                <th className="text-left px-3 py-1.5 font-medium">Entity ID</th>
                                <th className="text-right px-3 py-1.5 font-medium">Day</th>
                                <th className="text-right px-3 py-1.5 font-medium">
                                  {finding.sampleRows[0].metricLabel}
                                </th>
                                <th className="text-right px-3 py-1.5 font-medium">Inspect</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 font-mono tabular-nums">
                              {finding.sampleRows.map((row) => (
                                <tr key={`${finding.id}-${row.eventId}`}>
                                  <td className="px-3 py-1.5 text-slate-700">{row.eventId}</td>
                                  <td className="px-3 py-1.5 text-slate-900 font-medium">
                                    {row.entityId}
                                  </td>
                                  <td className="px-3 py-1.5 text-right text-slate-600">
                                    {row.timestampDay}
                                  </td>
                                  <td className="px-3 py-1.5 text-right text-slate-900 font-semibold">
                                    {row.metricValue}
                                  </td>
                                  <td className="px-3 py-1.5 text-right font-sans">
                                    <button
                                      type="button"
                                      onClick={() => onInspectEntityInExplorer(row.entityId)}
                                      className="text-blue-700 hover:underline inline-flex items-center gap-0.5"
                                    >
                                      <span>Explorer</span>
                                      <ArrowRight className="w-3 h-3" />
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>

        {/* Right: Interactive Non-Destructive Curation Rule Pipeline */}
        <aside className="lg:col-span-5 bg-white border border-slate-200 rounded-lg overflow-hidden lg:sticky lg:top-6">
          <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50/70 flex items-center justify-between">
            <div>
              <h3 className="font-display text-sm font-bold text-slate-900">
                Curation Transformation Pipeline
              </h3>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Reversible rules materialized across all downstream views
              </p>
            </div>
            <span className="font-mono tabular-nums text-xs font-semibold text-blue-700">
              {appliedRules.length}/{profile.availableRules.length} active
            </span>
          </div>

          <div className="divide-y divide-slate-100">
            {profile.availableRules.map((rule) => {
              const isEnabled = appliedSet.has(rule.id);
              const breakdown = curationTransform.ruleBreakdown[rule.id];
              return (
                <div key={rule.id} className="p-4 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[11px] font-mono text-slate-400">
                        {rule.category}
                      </div>
                      <div className="text-xs font-semibold text-slate-900 mt-0.5">
                        {rule.label}
                      </div>
                    </div>

                    <button
                      type="button"
                      role="switch"
                      aria-checked={isEnabled}
                      aria-label={`Toggle ${rule.label}`}
                      onClick={() => onToggleRule(rule.id)}
                      className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-colors shrink-0 ${
                        isEnabled
                          ? 'bg-blue-700 border-blue-700 text-white hover:bg-blue-800'
                          : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      {isEnabled ? 'Enabled' : 'Enable'}
                    </button>
                  </div>

                  <p className="text-xs text-slate-600 leading-relaxed">
                    {rule.description}
                  </p>

                  <div className="flex flex-wrap items-center gap-3 text-[11px] font-mono tabular-nums text-slate-500 pt-1">
                    <span>
                      Impact:{' '}
                      <strong className="text-slate-800">
                        {rule.affectedEventsCount} events
                      </strong>
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>
                      {rule.affectedEntitiesCount} entities
                    </span>
                    {rule.estimatedScoreDelta !== 0 && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span
                          className={
                            rule.estimatedScoreDelta > 0
                              ? 'text-emerald-700 font-semibold'
                              : 'text-slate-600'
                          }
                        >
                          {rule.estimatedScoreDelta > 0
                            ? `+${rule.estimatedScoreDelta}`
                            : rule.estimatedScoreDelta}{' '}
                          health pts
                        </span>
                      </>
                    )}
                    {isEnabled && breakdown.affected > 0 && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="text-blue-700 font-semibold">
                          {breakdown.affected} {breakdown.action}
                        </span>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </aside>
      </div>
    </div>
  );
};
