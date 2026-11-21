import React from 'react';
import { AlertTriangle, CheckCircle2, Gauge, ShieldAlert } from 'lucide-react';
import { RegressionConfig, TargetDataQualityReport } from '../types/curation';

interface TargetQualityIndicatorProps {
  quality: TargetDataQualityReport;
  config: RegressionConfig;
  maxDay: number;
  onUpdateConfig: (next: RegressionConfig) => void;
}

export const TargetQualityIndicator: React.FC<TargetQualityIndicatorProps> = ({
  quality,
  config,
  maxDay,
  onUpdateConfig,
}) => {
  const tierStyles =
    quality.tier === 'healthy'
      ? {
          statusText: 'Healthy Convergence',
          scoreColor: 'text-emerald-700',
          barColor: 'bg-emerald-600',
          icon: CheckCircle2,
          bannerBg: 'bg-emerald-50/50 border-emerald-200 text-emerald-900',
        }
      : quality.tier === 'caution'
      ? {
          statusText: 'Moderate Skew / Sparsity',
          scoreColor: 'text-amber-700',
          barColor: 'bg-amber-500',
          icon: AlertTriangle,
          bannerBg: 'bg-amber-50/60 border-amber-200 text-amber-950',
        }
      : {
          statusText: 'High Convergence Risk',
          scoreColor: 'text-rose-700',
          barColor: 'bg-rose-600',
          icon: ShieldAlert,
          bannerBg: 'bg-rose-50/70 border-rose-200 text-rose-950',
        };

  const StatusIcon = tierStyles.icon;
  const isCensored = config.obsCutoffDay + config.horizonDays > maxDay;
  const suggestedUncensoredCutoff = Math.max(60, Math.floor((maxDay - config.horizonDays) / 15) * 15);
  const showWinsorizeFix =
    Math.abs(quality.rawSkewness) >= 1.25 && config.winsorizePercentile === 0;
  const showScalingFix =
    quality.tier !== 'healthy' && config.featureNormalization === 'none';
  const showCutoffFix =
    quality.zeroRate >= 0.35 &&
    isCensored &&
    suggestedUncensoredCutoff < config.obsCutoffDay;

  return (
    <section
      aria-label="Target LTV Data Quality Score"
      className="bg-white border border-slate-200 rounded-lg overflow-hidden"
    >
      <div className="px-6 py-4 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-md bg-slate-100 border border-slate-200 flex items-center justify-center shrink-0 mt-0.5">
            <Gauge className="w-4 h-4 text-slate-700" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2.5">
              <h2 className="text-sm font-semibold text-slate-900">
                Target Distribution Data Quality Score (target_ltv_raw)
              </h2>
              <span
                className={`inline-flex items-center gap-1 text-xs font-medium ${tierStyles.scoreColor}`}
              >
                <StatusIcon className="w-3.5 h-3.5" />
                <span>{tierStyles.statusText}</span>
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Evaluates skewness, zero-inflation sparsity, and tail leverage on target_ltv_raw (n = {quality.sampleSize}) to flag OLS convergence risks.
            </p>
          </div>
        </div>

        {/* Score Readout + Progress Gauge */}
        <div className="flex items-center gap-4 shrink-0">
          <div className="w-40">
            <div className="flex items-center justify-between text-[11px] text-slate-500 mb-1">
              <span>Quality Index</span>
              <span className="font-mono tabular-nums font-semibold text-slate-800">
                {quality.score} / 100
              </span>
            </div>
            <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-300 ${tierStyles.barColor}`}
                style={{ width: `${Math.max(4, quality.score)}%` }}
              />
            </div>
          </div>
          <div className={`text-2xl font-bold font-mono tabular-nums ${tierStyles.scoreColor}`}>
            {quality.score}
          </div>
        </div>
      </div>

      {/* Distribution Diagnostics Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 divide-y lg:divide-y-0 lg:divide-x divide-slate-200 border-b border-slate-200 bg-slate-50/40">
        <div className="px-5 py-3.5">
          <div className="text-[11px] font-medium text-slate-500">
            Raw Skewness (γ₁)
          </div>
          <div
            className={`text-base font-bold font-mono tabular-nums mt-0.5 ${
              Math.abs(quality.rawSkewness) >= 2.2
                ? 'text-rose-700'
                : Math.abs(quality.rawSkewness) >= 1.25
                ? 'text-amber-700'
                : 'text-slate-900'
            }`}
          >
            {quality.rawSkewness.toFixed(2)}
          </div>
          <div className="text-[11px] font-mono text-slate-500 tabular-nums mt-0.5">
            {config.winsorizePercentile > 0
              ? `Post-P${config.winsorizePercentile} winsor: ${quality.winsorizedSkewness.toFixed(2)}`
              : 'Uncapped (no winsorization)'}
          </div>
        </div>

        <div className="px-5 py-3.5">
          <div className="text-[11px] font-medium text-slate-500">
            Zero-Spend Sparsity
          </div>
          <div
            className={`text-base font-bold font-mono tabular-nums mt-0.5 ${
              quality.zeroRate >= 0.45
                ? 'text-rose-700'
                : quality.zeroRate >= 0.25
                ? 'text-amber-700'
                : 'text-slate-900'
            }`}
          >
            {(quality.zeroRate * 100).toFixed(1)}%
          </div>
          <div className="text-[11px] font-mono text-slate-500 tabular-nums mt-0.5">
            {quality.zeroCount} / {quality.sampleSize} entities at $0
          </div>
        </div>

        <div className="px-5 py-3.5">
          <div className="text-[11px] font-medium text-slate-500">
            Excess Kurtosis (Tail Weight)
          </div>
          <div className="text-base font-bold font-mono tabular-nums text-slate-900 mt-0.5">
            {quality.excessKurtosis >= 0
              ? `+${quality.excessKurtosis.toFixed(2)}`
              : quality.excessKurtosis.toFixed(2)}
          </div>
          <div className="text-[11px] font-mono text-slate-500 tabular-nums mt-0.5">
            P95 ${quality.p95Raw.toFixed(0)} · P99 ${quality.p99Raw.toFixed(0)}
          </div>
        </div>

        <div className="px-5 py-3.5">
          <div className="text-[11px] font-medium text-slate-500">
            Tail Concentration (P99 / Med)
          </div>
          <div className="text-base font-bold font-mono tabular-nums text-slate-900 mt-0.5">
            {quality.p99ToMedianRatio !== null
              ? `${quality.p99ToMedianRatio.toFixed(1)}×`
              : '∞ (Med $0)'}
          </div>
          <div className="text-[11px] font-mono text-slate-500 tabular-nums mt-0.5">
            Mean ${quality.meanRaw.toFixed(0)} · Med ${quality.medianRaw.toFixed(0)}
          </div>
        </div>
      </div>

      {/* Convergence Alert / Healthy Confirmation */}
      <div className="px-6 py-3.5">
        {quality.issues.length === 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-emerald-800">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>
                Target distribution is well-conditioned for OLS convergence (|γ₁| ={' '}
                {Math.abs(quality.rawSkewness).toFixed(2)}, sparsity ={' '}
                {(quality.zeroRate * 100).toFixed(1)}%).
              </span>
            </div>
            <span className="font-mono text-[11px] text-slate-500">
              P{config.winsorizePercentile || 'None'} winsorization · {config.horizonDays}d horizon
            </span>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="space-y-2">
              {quality.issues.map((issue) => (
                <div
                  key={issue.code}
                  className={`px-3.5 py-2.5 rounded-md border flex items-start gap-2.5 text-xs ${
                    issue.severity === 'critical'
                      ? 'bg-rose-50/60 border-rose-200 text-rose-950'
                      : 'bg-amber-50/60 border-amber-200 text-amber-950'
                  }`}
                >
                  {issue.severity === 'critical' ? (
                    <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  )}
                  <div className="min-w-0">
                    <div className="font-semibold">{issue.title}</div>
                    <p className="text-[11px] opacity-90 mt-0.5 leading-relaxed">
                      {issue.detail}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            {(showWinsorizeFix || showScalingFix || showCutoffFix) && (
              <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs">
                <span className="text-slate-500 text-[11px]">
                  Recommended mitigations to stabilize regression convergence:
                </span>
                <div className="flex flex-wrap items-center gap-2">
                  {showWinsorizeFix && (
                    <button
                      type="button"
                      onClick={() =>
                        onUpdateConfig({ ...config, winsorizePercentile: 95 })
                      }
                      className="px-2.5 py-1 text-[11px] font-medium text-blue-700 bg-blue-50/80 border border-blue-200 rounded hover:bg-blue-100/80 transition-colors whitespace-nowrap"
                    >
                      Apply P95 Winsorization
                    </button>
                  )}
                  {showScalingFix && (
                    <button
                      type="button"
                      onClick={() =>
                        onUpdateConfig({ ...config, featureNormalization: 'zscore' })
                      }
                      className="px-2.5 py-1 text-[11px] font-medium text-blue-700 bg-blue-50/80 border border-blue-200 rounded hover:bg-blue-100/80 transition-colors whitespace-nowrap"
                    >
                      Enable Z-Score Scaling
                    </button>
                  )}
                  {showCutoffFix && (
                    <button
                      type="button"
                      onClick={() =>
                        onUpdateConfig({
                          ...config,
                          obsCutoffDay: suggestedUncensoredCutoff,
                        })
                      }
                      className="px-2.5 py-1 text-[11px] font-medium text-blue-700 bg-blue-50/80 border border-blue-200 rounded hover:bg-blue-100/80 transition-colors whitespace-nowrap"
                    >
                      Set T_obs to Day {suggestedUncensoredCutoff}
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
};
