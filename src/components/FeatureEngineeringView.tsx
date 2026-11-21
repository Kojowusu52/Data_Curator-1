import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FlaskConical,
  Loader2,
  Sparkles,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  EngineeredFeatureId,
  FeatureEngineeringAiPlan,
  PiiMaskingConfig,
  RawEvent,
  RegressionConfig,
  RegressionResult,
} from '../types/curation';
import {
  evaluateEngineeredFeatures,
  exportAugmentedRegressionCsv,
} from '../engine/featureEngineeringEngine';

interface FeatureEngineeringViewProps {
  datasetName: string;
  datasetDomain: string;
  events: RawEvent[];
  regConfig: RegressionConfig;
  regResult: RegressionResult;
  piiMaskingConfig: PiiMaskingConfig;
  enabledFeatureIds: EngineeredFeatureId[];
  onToggleFeature: (id: EngineeredFeatureId) => void;
  onApplyFeatureSet: (ids: EngineeredFeatureId[]) => void;
}

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

export const FeatureEngineeringView: React.FC<FeatureEngineeringViewProps> = ({
  datasetName,
  datasetDomain,
  events,
  regConfig,
  regResult,
  piiMaskingConfig,
  enabledFeatureIds,
  onToggleFeature,
  onApplyFeatureSet,
}) => {
  const [targetParadigm, setTargetParadigm] = useState('Regression LTV & Horizon Spend');
  const [customGoal, setCustomGoal] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiPlan, setAiPlan] = useState<FeatureEngineeringAiPlan | null>(null);

  const evaluations = useMemo(
    () =>
      evaluateEngineeredFeatures({
        events,
        regResult,
        regConfig,
        enabledFeatureIds,
      }),
    [events, regResult, regConfig, enabledFeatureIds]
  );

  const chartData = useMemo(
    () =>
      evaluations.map((e) => ({
        name: e.label.split(' ').slice(0, 3).join(' '),
        absR: Math.round(Math.abs(e.pearsonR) * 1000) / 1000,
        collinearity: e.maxExistingCollinearityR,
      })),
    [evaluations]
  );

  const handleRequestAiRecommendations = async () => {
    if (isGenerating) return;
    setIsGenerating(true);
    setAiError(null);
    try {
      const response = await fetch('/api/feature-engineering', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          datasetName,
          datasetDomain,
          targetParadigm,
          goal: customGoal.trim(),
          baseLinearR2: Math.round(regResult.linearFit.rSquared * 10000) / 10000,
          highCollinearityCount: regResult.featureMatrix.highCollinearityPairs.length,
          evaluatedCandidates: evaluations.map((e) => ({
            id: e.id,
            label: e.label,
            pearsonR: e.pearsonR,
            univariateR2: e.univariateR2,
            maxExistingCollinearityR: e.maxExistingCollinearityR,
            mostCorrelatedWith: e.mostCorrelatedWith,
            trainValKlDrift: e.trainValKlDrift,
            recommendationTier: e.recommendationTier,
          })),
        }),
      });
      const payload = (await response.json()) as {
        plan?: FeatureEngineeringAiPlan;
        error?: string;
      };
      if (!response.ok || !payload.plan) {
        throw new Error(payload.error || `Request failed (${response.status})`);
      }
      setAiPlan(payload.plan);
    } catch (err) {
      setAiError(
        err instanceof Error ? err.message : 'Unable to generate feature engineering plan.'
      );
    } finally {
      setIsGenerating(false);
    }
  };

  const handleExportAugmented = () => {
    const csv = exportAugmentedRegressionCsv({
      events,
      regResult,
      regConfig,
      enabledFeatureIds,
      piiMaskingConfig,
    });
    triggerDownload('stratum_regression_engineered_features.csv', csv, 'text/csv');
  };

  const strongCount = evaluations.filter((e) => e.recommendationTier === 'strong').length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900">
            Feature Engineering Assistant
          </h1>
          <p className="text-sm text-slate-600 mt-1 max-w-2xl">
            Synthesize leak-free temporal, volatility, momentum, and interaction features computed
            strictly before T_obs (Day {regConfig.obsCutoffDay}), audit collinearity and KL drift,
            and export augmented training matrices.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500 font-mono tabular-nums">
            <span>{datasetName}</span>
            <span aria-hidden="true">·</span>
            <span>{enabledFeatureIds.length} active engineered features</span>
            <span aria-hidden="true">·</span>
            <span>{strongCount} high-signal orthogonal candidates</span>
          </div>
        </div>

        <button
          type="button"
          onClick={handleExportAugmented}
          disabled={regResult.rows.length === 0}
          className="px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-md transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 disabled:opacity-50"
        >
          <Download className="w-3.5 h-3.5" />
          <span>Export Augmented CSV (+{enabledFeatureIds.length} cols)</span>
        </button>
      </div>

      {/* Gemini Feature Advisor */}
      <section className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <FlaskConical className="w-4 h-4 text-blue-700" />
            <h2 className="text-sm font-semibold text-slate-900">
              AI Feature Discovery &amp; Orthogonality Advisor
            </h2>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <select
              aria-label="Target modeling paradigm"
              value={targetParadigm}
              onChange={(e) => setTargetParadigm(e.target.value)}
              className="h-9 px-2.5 text-xs bg-slate-50 border border-slate-200 rounded-md text-slate-800"
            >
              <option value="Regression LTV & Horizon Spend">Regression LTV &amp; Spend</option>
              <option value="RUL & Degradation Forecasting">RUL &amp; Degradation</option>
              <option value="Cross-Paradigm Orthogonality">Low-VIF Orthogonality</option>
            </select>

            <input
              type="text"
              aria-label="Optional modeling objective"
              value={customGoal}
              onChange={(e) => setCustomGoal(e.target.value)}
              placeholder="Optional goal (e.g. maximize holdout R² without VIF > 3)..."
              className="w-64 h-9 px-3 text-xs bg-slate-50 border border-slate-200 rounded-md text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
            />

            <button
              type="button"
              onClick={handleRequestAiRecommendations}
              disabled={isGenerating}
              className="h-9 px-4 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-60 rounded-md transition-colors inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Analyzing Signals...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Recommend Features</span>
                </>
              )}
            </button>
          </div>
        </div>

        {aiError && (
          <div role="alert" className="p-3 bg-red-50 border border-red-200 rounded-md text-xs text-red-800">
            {aiError}
          </div>
        )}

        {aiPlan ? (
          <div className="space-y-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 bg-slate-50 border border-slate-200 rounded-md p-4">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">{aiPlan.headline}</h3>
                <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                  {aiPlan.strategySummary}
                </p>
              </div>
              <button
                type="button"
                onClick={() => onApplyFeatureSet(aiPlan.recommendedFeatureIds)}
                className="px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-md transition-colors whitespace-nowrap shrink-0"
              >
                Enable Recommended ({aiPlan.recommendedFeatureIds.length})
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {aiPlan.candidateProposals.map((prop, idx) => (
                <div
                  key={idx}
                  className="p-3.5 border border-slate-200 rounded-md space-y-1.5 text-xs"
                >
                  <div className="font-semibold text-slate-900 font-mono">
                    {prop.featureIdOrName}
                  </div>
                  <p className="text-slate-600 leading-relaxed">{prop.rationale}</p>
                  <div className="text-emerald-700 font-medium">{prop.expectedLiftNote}</div>
                  <div className="text-slate-500">{prop.leakageSafeCheck}</div>
                </div>
              ))}
            </div>

            {aiPlan.collinearityWarnings.length > 0 && (
              <div className="space-y-1 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md p-3">
                {aiPlan.collinearityWarnings.map((w, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span>{w}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="text-xs text-slate-500">
            Click <strong>Recommend Features</strong> to run Gemini 4 Hydrogen analysis over live
            Pearson r, univariate R², collinearity, and Train/Val KL divergence, or toggle derived
            features manually below.
          </div>
        )}
      </section>

      {/* Signal vs Collinearity Chart */}
      <section className="bg-white border border-slate-200 rounded-lg p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">
            Target Signal Strength (|Pearson r|) vs Existing Feature Collinearity
          </h2>
          <span className="text-xs text-slate-500 font-mono">
            Pre-cutoff window t ≤ {regConfig.obsCutoffDay}d
          </span>
        </div>
        <div className="h-56 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 8, right: 16, left: 4, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#475569' }} />
              <YAxis tick={{ fontSize: 11, fill: '#475569' }} domain={[0, 1]} width={40} />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#ffffff',
                  borderColor: '#cbd5e1',
                  borderRadius: '6px',
                  fontSize: '12px',
                }}
              />
              <Bar dataKey="absR" name="|Pearson r| vs Target" fill="#1d4ed8" radius={[4, 4, 0, 0]} />
              <Bar
                dataKey="collinearity"
                name="Max |r| vs Base Features"
                fill="#94a3b8"
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      {/* Candidate Feature Synthesis Table */}
      <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50/70 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-900">
            Synthesized Derived Features ({evaluations.length})
          </h2>
          <div className="flex items-center gap-3 text-xs">
            <button
              type="button"
              onClick={() =>
                onApplyFeatureSet(
                  evaluations
                    .filter((e) => e.recommendationTier === 'strong')
                    .map((e) => e.id)
                )
              }
              className="text-blue-700 hover:underline font-medium"
            >
              Enable Strong Only
            </button>
            <span className="text-slate-300" aria-hidden="true">|</span>
            <button
              type="button"
              onClick={() => onApplyFeatureSet([])}
              className="text-slate-600 hover:text-slate-900"
            >
              Clear All
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-200 text-slate-600 bg-slate-50/40">
                <th className="px-4 py-2.5 text-left font-semibold">Feature &amp; Formula</th>
                <th className="px-4 py-2.5 text-left font-semibold">Category</th>
                <th className="px-4 py-2.5 text-right font-semibold">Mean ± Std</th>
                <th className="px-4 py-2.5 text-right font-semibold">Target r</th>
                <th className="px-4 py-2.5 text-right font-semibold">Max Base |r|</th>
                <th className="px-4 py-2.5 text-right font-semibold">KL Drift</th>
                <th className="px-4 py-2.5 text-left font-semibold">Assessment</th>
                <th className="px-4 py-2.5 text-right font-semibold">Include</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {evaluations.map((fe) => (
                <tr key={fe.id} className="hover:bg-slate-50/80">
                  <td className="px-4 py-3">
                    <div className="font-semibold text-slate-900">{fe.label}</div>
                    <div className="font-mono text-[11px] text-slate-500 mt-0.5">
                      {fe.columnName} = {fe.formula}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{fe.category}</td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-800">
                    {fe.mean.toFixed(2)} ± {fe.std.toFixed(2)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums font-semibold text-blue-700">
                    {fe.pearsonR >= 0 ? `+${fe.pearsonR.toFixed(3)}` : fe.pearsonR.toFixed(3)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-700">
                    {fe.maxExistingCollinearityR.toFixed(3)} ({fe.mostCorrelatedWith})
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-700">
                    {fe.trainValKlDrift.toFixed(3)}
                  </td>
                  <td className="px-4 py-3">
                    {fe.recommendationTier === 'strong' && (
                      <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Strong signal</span>
                      </span>
                    )}
                    {fe.recommendationTier === 'moderate' && (
                      <span className="text-slate-600">Moderate</span>
                    )}
                    {fe.recommendationTier === 'redundant' && (
                      <span className="inline-flex items-center gap-1 text-amber-700 font-medium">
                        <AlertTriangle className="w-3.5 h-3.5" />
                        <span>High collinearity</span>
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={fe.enabled}
                      aria-label={`Toggle ${fe.label}`}
                      onClick={() => onToggleFeature(fe.id)}
                      className={`px-3 py-1 rounded-md font-medium transition-colors ${
                        fe.enabled
                          ? 'bg-blue-700 text-white hover:bg-blue-800'
                          : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                      }`}
                    >
                      {fe.enabled ? 'Active' : 'Enable'}
                    </button>
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
