import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BookOpen,
  Check,
  Copy,
  Loader2,
  Minus,
  RefreshCw,
} from 'lucide-react';
import {
  LinearFeatureImportance,
  RegressionConfig,
  RegressionResult,
} from '../types/curation';

export type StakeholderAudience = 'executive' | 'growth' | 'technical';

interface ExplainedDriverItem {
  feature: string;
  label: string;
  impactRole: string;
  importanceSharePct: number;
  stakeholderExplanation: string;
  businessAction: string;
}

interface LtvAiExplanation {
  headline: string;
  executiveSummary: string;
  modelConfidenceNote: string;
  topDrivers: ExplainedDriverItem[];
  riskCaveats: string[];
  recommendedActions: string[];
}

interface ExplainableAiPanelProps {
  datasetName: string;
  datasetDomain: string;
  config: RegressionConfig;
  result: RegressionResult;
}

const AUDIENCE_OPTIONS: Array<{ id: StakeholderAudience; label: string }> = [
  { id: 'executive', label: 'Executive & Finance' },
  { id: 'growth', label: 'Growth & Retention' },
  { id: 'technical', label: 'Technical Review' },
];

function formatUsd(val: number): string {
  return `$${val.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export const ExplainableAiPanel: React.FC<ExplainableAiPanelProps> = ({
  datasetName,
  datasetDomain,
  config,
  result,
}) => {
  const [audience, setAudience] = useState<StakeholderAudience>('executive');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [explanation, setExplanation] = useState<LtvAiExplanation | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [generatedAudience, setGeneratedAudience] =
    useState<StakeholderAudience | null>(null);
  const [generatedSignature, setGeneratedSignature] = useState<string | null>(
    null
  );
  const [copied, setCopied] = useState(false);

  const sortedFeatures = useMemo(() => {
    return [...result.linearFit.features].sort(
      (a, b) => b.importanceShare - a.importanceShare
    );
  }, [result.linearFit.features]);

  const featureLookup = useMemo(() => {
    const map = new Map<string, LinearFeatureImportance>();
    for (const f of result.linearFit.features) {
      map.set(f.feature, f);
    }
    return map;
  }, [result.linearFit.features]);

  const correlationLookup = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of result.correlations) {
      map.set(c.feature, c.pearsonR);
    }
    return map;
  }, [result.correlations]);

  const currentSignature = useMemo(() => {
    return [
      datasetName,
      config.obsCutoffDay,
      config.horizonDays,
      config.winsorizePercentile,
      config.featureNormalization,
      config.splitFilter,
      config.excludeZeroObsEntities,
      config.excludeDetectedOutliers,
      result.linearFit.sampleSize,
      result.linearFit.rSquared.toFixed(4),
      sortedFeatures.map((f) => `${f.feature}:${f.standardizedBeta.toFixed(3)}`).join(','),
    ].join('|');
  }, [datasetName, config, result.linearFit.sampleSize, result.linearFit.rSquared, sortedFeatures]);

  const isStale =
    explanation !== null &&
    (generatedSignature !== currentSignature || generatedAudience !== audience);

  const handleGenerate = async (targetAudience: StakeholderAudience = audience) => {
    if (sortedFeatures.length === 0) {
      setErrorMsg(
        'Select at least one feature in the predictor panel before generating an explanation.'
      );
      return;
    }

    setIsLoading(true);
    setErrorMsg(null);

    const payload = {
      datasetName,
      datasetDomain,
      audience: targetAudience,
      config: {
        obsCutoffDay: config.obsCutoffDay,
        horizonDays: config.horizonDays,
        winsorizePercentile: config.winsorizePercentile,
        featureNormalization: config.featureNormalization,
        splitFilter: config.splitFilter,
        excludeZeroObsEntities: config.excludeZeroObsEntities,
        excludeDetectedOutliers: config.excludeDetectedOutliers,
      },
      modelMetrics: {
        sampleSize: result.linearFit.sampleSize,
        rSquared: Number(result.linearFit.rSquared.toFixed(4)),
        rmse: Number(result.linearFit.rmse.toFixed(2)),
        mae: Number(result.linearFit.mae.toFixed(2)),
        mape:
          result.linearFit.mape !== null
            ? Number(result.linearFit.mape.toFixed(1))
            : null,
        meanProjectedLtv: Number(result.linearFit.meanProjectedLtv.toFixed(2)),
        meanTargetRaw: Number(result.meanTargetRaw.toFixed(2)),
        meanTargetWinsorized: Number(result.meanTargetWinsorized.toFixed(2)),
        winsorCapValue: Number(result.winsorCapValue.toFixed(2)),
        zeroTargetRate: Number((result.zeroTargetRate * 100).toFixed(1)),
        intercept: Number(result.linearFit.intercept.toFixed(2)),
      },
      features: sortedFeatures.map((f) => ({
        feature: f.feature,
        label: f.label,
        standardizedBeta: Number(f.standardizedBeta.toFixed(4)),
        importanceShare: Number((f.importanceShare * 100).toFixed(1)),
        rawCoefficient: Number(f.rawCoefficient.toFixed(4)),
        univariateR2: Number(f.univariateR2.toFixed(4)),
        direction: f.direction,
        pearsonR: Number((correlationLookup.get(f.feature) ?? 0).toFixed(3)),
      })),
      driftSummary: {
        tier: result.driftReport.tier,
        klExceedsThreshold: result.driftReport.klExceedsThreshold,
        maxKlDivergence: Number(result.driftReport.maxKlDivergence.toFixed(4)),
        klThreshold: result.driftReport.klThreshold,
        flaggedFeatures: result.driftReport.features
          .filter((f) => f.klExceedsThreshold)
          .map((f) => f.label),
      },
      collinearityPairs: result.featureMatrix.highCollinearityPairs.map((p) => ({
        labelA: p.labelA,
        labelB: p.labelB,
        pearsonR: Number(p.pearsonR.toFixed(3)),
        vifEstimate: Number(p.vifEstimate.toFixed(2)),
      })),
      anomalySummary: {
        outlierCount: result.anomalyReport.outlierCount,
        outlierRate: Number((result.anomalyReport.outlierRate * 100).toFixed(1)),
        excludeDetectedOutliers: config.excludeDetectedOutliers,
        thresholdStd: config.outlierStdThreshold,
      },
    };

    try {
      const response = await fetch('/api/explain-ltv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(
          data?.error || `Request failed with status ${response.status}`
        );
      }

      if (!data?.explanation) {
        throw new Error('Malformed explanation payload returned by server.');
      }

      setExplanation(data.explanation as LtvAiExplanation);
      setGeneratedAt(data.generatedAt ?? new Date().toISOString());
      setGeneratedAudience(targetAudience);
      setGeneratedSignature(currentSignature);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopyMarkdown = async () => {
    if (!explanation) return;
    const lines = [
      `# ${explanation.headline}`,
      `Dataset: ${datasetName} (${datasetDomain}) | R² = ${result.linearFit.rSquared.toFixed(3)} | n = ${result.linearFit.sampleSize}`,
      '',
      '## Executive Summary',
      explanation.executiveSummary,
      '',
      '## Model Reliability',
      explanation.modelConfidenceNote,
      '',
      '## Top Features Driving LTV',
      ...explanation.topDrivers.map(
        (d, idx) =>
          `${idx + 1}. **${d.label}** (${d.impactRole} · ${d.importanceSharePct.toFixed(1)}% share): ${d.stakeholderExplanation} _Action:_ ${d.businessAction}`
      ),
      '',
      '## Risk Caveats',
      ...explanation.riskCaveats.map((c) => `- ${c}`),
      '',
      '## Recommended Next Steps',
      ...explanation.recommendedActions.map((a, idx) => `${idx + 1}. ${a}`),
    ];

    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Ignore clipboard permission errors silently
    }
  };

  return (
    <section className="bg-white border border-slate-200 rounded-lg p-5">
      {/* Header & Controls */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 pb-4 border-b border-slate-200">
        <div>
          <div className="flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-blue-700 shrink-0" />
            <h2 className="text-sm font-semibold text-slate-900">
              Explainable AI: Stakeholder Decision Brief
            </h2>
          </div>
          <p className="text-xs text-slate-500 mt-0.5 font-mono tabular-nums">
            {datasetName} · n = {result.linearFit.sampleSize.toLocaleString()} ·
            R² = {result.linearFit.rSquared.toFixed(3)} · RMSE ={' '}
            {formatUsd(result.linearFit.rmse)} · {sortedFeatures.length} active
            predictors
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Audience Lens Selector */}
          <div
            className="inline-flex rounded-md border border-slate-200 bg-slate-50 p-0.5"
            role="group"
            aria-label="Stakeholder briefing audience"
          >
            {AUDIENCE_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                disabled={isLoading}
                onClick={() => setAudience(opt.id)}
                className={`px-2.5 py-1 text-[11px] font-medium rounded transition-colors ${
                  audience === opt.id
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {explanation && (
            <button
              type="button"
              onClick={handleCopyMarkdown}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 transition-colors"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-700" />
                  <span>Copied</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5 text-slate-500" />
                  <span>Copy Brief</span>
                </>
              )}
            </button>
          )}

          <button
            type="button"
            disabled={isLoading || sortedFeatures.length === 0}
            onClick={() => handleGenerate(audience)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-blue-700 rounded-md hover:bg-blue-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isLoading ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Generating Brief...</span>
              </>
            ) : (
              <>
                <RefreshCw className="w-3.5 h-3.5" />
                <span>
                  {explanation ? 'Regenerate Brief' : 'Generate AI Explanation'}
                </span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Error State */}
      {errorMsg && (
        <div
          role="alert"
          className="mt-4 bg-red-50 border border-red-200 rounded-md p-3.5 flex items-start justify-between gap-3"
        >
          <div className="flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 text-red-700 shrink-0 mt-0.5" />
            <div className="text-xs text-red-900">
              <div className="font-semibold">
                Unable to generate Gemini explanation
              </div>
              <div className="mt-0.5 text-red-800">{errorMsg}</div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => handleGenerate(audience)}
            disabled={isLoading}
            className="px-2.5 py-1 text-xs font-medium text-red-800 bg-white border border-red-200 rounded hover:bg-red-100 shrink-0"
          >
            Retry
          </button>
        </div>
      )}

      {/* Stale Configuration Warning */}
      {isStale && !isLoading && (
        <div className="mt-4 bg-amber-50 border border-amber-200 rounded-md px-3.5 py-2.5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs text-amber-900">
            <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
            <span>
              Model features, filters, or target audience changed since this brief
              was generated. Regenerate to reflect the current model weights.
            </span>
          </div>
          <button
            type="button"
            onClick={() => handleGenerate(audience)}
            className="px-2.5 py-1 text-xs font-medium text-amber-900 bg-white border border-amber-300 rounded hover:bg-amber-100 shrink-0"
          >
            Refresh Now
          </button>
        </div>
      )}

      {/* Initial Pre-Generation Preview */}
      {!explanation && !isLoading && (
        <div className="mt-4 grid grid-cols-1 lg:grid-cols-12 gap-4 items-center bg-slate-50/70 border border-slate-200 rounded-md p-4">
          <div className="lg:col-span-7 space-y-1.5">
            <div className="text-xs font-semibold text-slate-900">
              Translate OLS feature weights into a stakeholder narrative
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              Sends the live standardized coefficients, importance shares,
              goodness-of-fit metrics (R², RMSE, MAE), KL-divergence drift
              alerts, and high-VIF pairs to Gemini to produce a concise executive
              explanation and recommended business actions.
            </p>
          </div>
          <div className="lg:col-span-5 grid grid-cols-3 gap-2">
            {sortedFeatures.slice(0, 3).map((feat) => (
              <div
                key={feat.feature}
                className="bg-white border border-slate-200 rounded px-2.5 py-2"
              >
                <div
                  className="text-[11px] font-medium text-slate-700 truncate"
                  title={feat.label}
                >
                  {feat.label}
                </div>
                <div className="mt-1 flex items-baseline justify-between font-mono tabular-nums">
                  <span
                    className={`text-xs font-semibold ${
                      feat.direction === 'negative'
                        ? 'text-amber-700'
                        : 'text-blue-700'
                    }`}
                  >
                    {(feat.importanceShare * 100).toFixed(1)}%
                  </span>
                  <span className="text-[10px] text-slate-500">
                    β={feat.standardizedBeta >= 0 ? '+' : ''}
                    {feat.standardizedBeta.toFixed(2)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Loading Skeleton */}
      {isLoading && (
        <div className="mt-4 border border-slate-200 rounded-md p-5 space-y-3 bg-slate-50/50">
          <div className="flex items-center gap-2 text-xs font-medium text-slate-700">
            <Loader2 className="w-4 h-4 animate-spin text-blue-700" />
            <span>
              Synthesizing {sortedFeatures.length} LTV predictors and model
              diagnostics for{' '}
              {AUDIENCE_OPTIONS.find((a) => a.id === audience)?.label}...
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="h-20 bg-slate-200/70 rounded animate-pulse" />
            <div className="h-20 bg-slate-200/70 rounded animate-pulse" />
            <div className="h-20 bg-slate-200/70 rounded animate-pulse" />
          </div>
        </div>
      )}

      {/* Generated Structured Explanation */}
      {explanation && !isLoading && (
        <div className="mt-4 space-y-4">
          {/* Headline + Confidence Split */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            <div className="lg:col-span-8 bg-slate-50/60 border border-slate-200 rounded-md p-4">
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <span className="text-[11px] font-mono uppercase tracking-wide text-blue-700 font-semibold">
                  {AUDIENCE_OPTIONS.find((a) => a.id === generatedAudience)
                    ?.label ?? 'Stakeholder'}{' '}
                  Summary
                </span>
                {generatedAt && (
                  <span className="text-[11px] font-mono text-slate-400 tabular-nums">
                    Generated {new Date(generatedAt).toLocaleTimeString()}
                  </span>
                )}
              </div>
              <h3 className="text-sm font-semibold text-slate-900">
                {explanation.headline}
              </h3>
              <p className="text-xs text-slate-700 leading-relaxed mt-2">
                {explanation.executiveSummary}
              </p>
            </div>

            <div className="lg:col-span-4 border border-slate-200 rounded-md p-4 bg-white flex flex-col justify-between">
              <div>
                <div className="text-[11px] font-mono uppercase tracking-wide text-slate-500 font-semibold">
                  Model Reliability Assessment
                </div>
                <p className="text-xs text-slate-700 leading-relaxed mt-1.5">
                  {explanation.modelConfidenceNote}
                </p>
              </div>
              <div className="grid grid-cols-3 gap-2 pt-3 mt-3 border-t border-slate-100 font-mono tabular-nums text-[11px]">
                <div>
                  <div className="text-slate-400">Fit R²</div>
                  <div className="font-semibold text-slate-900">
                    {result.linearFit.rSquared.toFixed(3)}
                  </div>
                </div>
                <div>
                  <div className="text-slate-400">MAE</div>
                  <div className="font-semibold text-slate-900">
                    {formatUsd(result.linearFit.mae)}
                  </div>
                </div>
                <div>
                  <div className="text-slate-400">Mean LTV</div>
                  <div className="font-semibold text-slate-900">
                    {formatUsd(result.linearFit.meanProjectedLtv)}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Top Drivers Breakdown */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-xs font-semibold text-slate-900">
                Top LTV Drivers &amp; Business Interpretation
              </h4>
              <span className="text-[11px] font-mono text-slate-500">
                Grounded in standardized OLS weights (β)
              </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {explanation.topDrivers.map((driver, idx) => {
                const live = featureLookup.get(driver.feature);
                const direction = live?.direction ?? 'neutral';
                const isNeg = direction === 'negative';
                const isPos = direction === 'positive';
                const share = live
                  ? live.importanceShare * 100
                  : driver.importanceSharePct;

                return (
                  <div
                    key={`${driver.feature}-${idx}`}
                    className="border border-slate-200 rounded-md p-3.5 bg-white flex flex-col justify-between gap-2.5"
                  >
                    <div>
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          {isPos ? (
                            <ArrowUpRight className="w-4 h-4 text-blue-700 shrink-0" />
                          ) : isNeg ? (
                            <ArrowDownRight className="w-4 h-4 text-amber-700 shrink-0" />
                          ) : (
                            <Minus className="w-4 h-4 text-slate-400 shrink-0" />
                          )}
                          <span className="text-xs font-semibold text-slate-900 truncate">
                            {live?.label ?? driver.label}
                          </span>
                        </div>
                        <span className="text-[11px] font-mono tabular-nums font-semibold text-slate-700 shrink-0">
                          {share.toFixed(1)}% impact
                        </span>
                      </div>

                      {/* Subtle proportionality bar */}
                      <div className="mt-2 h-1.5 w-full bg-slate-100 rounded overflow-hidden">
                        <div
                          className={`h-full rounded ${
                            isNeg ? 'bg-amber-600' : 'bg-blue-700'
                          }`}
                          style={{
                            width: `${Math.max(4, Math.min(100, share))}%`,
                          }}
                        />
                      </div>

                      <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] font-mono tabular-nums text-slate-500">
                        <span>Role: {driver.impactRole}</span>
                        {live && (
                          <>
                            <span>
                              β = {live.standardizedBeta >= 0 ? '+' : ''}
                              {live.standardizedBeta.toFixed(3)}
                            </span>
                            <span>r² = {live.univariateR2.toFixed(3)}</span>
                          </>
                        )}
                      </div>

                      <p className="mt-2 text-xs text-slate-700 leading-relaxed">
                        {driver.stakeholderExplanation}
                      </p>
                    </div>

                    <div className="pt-2 border-t border-slate-100 text-[11px] text-slate-600">
                      <span className="font-semibold text-slate-800">
                        Lever:{' '}
                      </span>
                      {driver.businessAction}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Risk Caveats & Recommended Actions */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 pt-1">
            <div className="border border-slate-200 rounded-md p-3.5 bg-slate-50/50">
              <div className="text-xs font-semibold text-slate-900 mb-2">
                Statistical Caveats &amp; Model Risks
              </div>
              <ul className="space-y-1.5 text-xs text-slate-700">
                {explanation.riskCaveats.map((caveat, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="font-mono text-amber-700 font-semibold mt-0.5">
                      !
                    </span>
                    <span className="leading-relaxed">{caveat}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="border border-slate-200 rounded-md p-3.5 bg-slate-50/50">
              <div className="text-xs font-semibold text-slate-900 mb-2">
                Recommended Stakeholder Actions
              </div>
              <ol className="space-y-1.5 text-xs text-slate-700">
                {explanation.recommendedActions.map((action, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="font-mono text-blue-700 font-semibold tabular-nums">
                      0{i + 1}
                    </span>
                    <span className="leading-relaxed">{action}</span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
