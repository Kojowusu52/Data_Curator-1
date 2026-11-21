import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ShieldAlert,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  FeatureDriftMetric,
  ModelDriftReport,
  RegressionFeatureKey,
} from '../types/curation';

interface ModelDriftIndicatorProps {
  driftReport: ModelDriftReport;
  onUpdateKlThreshold?: (threshold: number) => void;
}

const KL_THRESHOLD_OPTIONS = [0.1, 0.15, 0.25, 0.5];

export const ModelDriftIndicator: React.FC<ModelDriftIndicatorProps> = ({
  driftReport,
  onUpdateKlThreshold,
}) => {
  const [selectedFeatureKey, setSelectedFeatureKey] =
    useState<RegressionFeatureKey | null>(null);
  const [chartMode, setChartMode] = useState<'kl_bins' | 'ecdf'>('kl_bins');

  useEffect(() => {
    if (
      driftReport.features.length > 0 &&
      (!selectedFeatureKey ||
        !driftReport.features.some((f) => f.feature === selectedFeatureKey))
    ) {
      setSelectedFeatureKey(driftReport.features[0].feature);
    }
  }, [driftReport.features, selectedFeatureKey]);

  const activeFeature = useMemo<FeatureDriftMetric | null>(() => {
    if (driftReport.features.length === 0) return null;
    return (
      driftReport.features.find((f) => f.feature === selectedFeatureKey) ??
      driftReport.features[0]
    );
  }, [driftReport.features, selectedFeatureKey]);

  const tierStyle =
    driftReport.tier === 'aligned'
      ? {
          label: 'Splits Aligned',
          textClass: 'text-emerald-700',
          icon: CheckCircle2,
        }
      : driftReport.tier === 'watch'
      ? {
          label: 'Watch — Mild Shift',
          textClass: 'text-amber-700',
          icon: AlertTriangle,
        }
      : {
          label: driftReport.klExceedsThreshold
            ? 'KL Drift Alert — Threshold Exceeded'
            : 'Drift Alert — Significant Shift',
          textClass: 'text-rose-700',
          icon: ShieldAlert,
        };

  const StatusIcon = tierStyle.icon;

  const klFlaggedFeatures = useMemo(
    () => driftReport.features.filter((f) => f.klExceedsThreshold),
    [driftReport.features]
  );

  const flaggedNames = useMemo(
    () =>
      driftReport.features
        .filter((f) => f.status !== 'stable')
        .map(
          (f) =>
            `${f.csvColumn} (KL=${f.klDivergence.toFixed(3)}, D=${f.ksStatistic.toFixed(2)})`
        ),
    [driftReport.features]
  );

  return (
    <section
      id="model-drift-monitor"
      aria-label="Model Drift KL-Divergence & Kolmogorov-Smirnov Monitor"
      className="bg-white border border-slate-200 rounded-lg overflow-hidden"
    >
      {/* Header */}
      <div className="px-6 py-4 border-b border-slate-200 flex flex-col xl:flex-row xl:items-center xl:justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-md bg-slate-100 border border-slate-200 flex items-center justify-center shrink-0 mt-0.5">
            <Activity className="w-4 h-4 text-slate-700" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2.5">
              <h2 className="text-sm font-semibold text-slate-900">
                Model Drift Monitor (Train vs. Validation KL-Divergence &amp; K-S Test)
              </h2>
              <span
                className={`inline-flex items-center gap-1 text-xs font-medium ${tierStyle.textClass}`}
              >
                <StatusIcon className="w-3.5 h-3.5" />
                <span>{tierStyle.label}</span>
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Compares Train (n = {driftReport.trainCount}) vs. Validation (n = {driftReport.valCount}) across {driftReport.features.length} active predictors using D_KL(P_train || Q_val) and two-sample K-S distance.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-4 text-xs font-mono tabular-nums shrink-0">
          <div>
            <span className="text-slate-500">Max KL Div: </span>
            <span
              className={`font-semibold ${
                driftReport.klExceedsThreshold
                  ? 'text-rose-700'
                  : driftReport.maxKlDivergence >= driftReport.klThreshold * 0.7
                  ? 'text-amber-700'
                  : 'text-emerald-700'
              }`}
            >
              {driftReport.maxKlDivergence.toFixed(3)} nats
            </span>
          </div>
          <span className="text-slate-300" aria-hidden="true">|</span>
          <div>
            <span className="text-slate-500">Max K-S D: </span>
            <span className="font-semibold text-slate-900">
              {driftReport.maxKsStatistic.toFixed(3)}
            </span>
          </div>
          <span className="text-slate-300" aria-hidden="true">|</span>
          <div>
            <span className="text-slate-500">Min p: </span>
            <span
              className={`font-semibold ${
                driftReport.minPValue < driftReport.alpha
                  ? 'text-rose-700'
                  : driftReport.minPValue < 0.15
                  ? 'text-amber-700'
                  : 'text-emerald-700'
              }`}
            >
              {driftReport.minPValue.toFixed(4)}
            </span>
          </div>

          {onUpdateKlThreshold && (
            <>
              <span className="text-slate-300" aria-hidden="true">|</span>
              <div className="flex items-center gap-1.5 font-sans">
                <span className="text-[11px] font-medium text-slate-600">
                  KL Threshold:
                </span>
                <div className="flex items-center gap-0.5 p-0.5 bg-slate-100 rounded-md font-mono">
                  {KL_THRESHOLD_OPTIONS.map((th) => {
                    const active = Math.abs(driftReport.klThreshold - th) < 0.005;
                    return (
                      <button
                        key={th}
                        type="button"
                        onClick={() => onUpdateKlThreshold(th)}
                        className={`px-2 py-0.5 text-[11px] rounded transition-colors ${
                          active
                            ? 'bg-white text-slate-900 font-semibold shadow-xs'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        {th.toFixed(2)}
                      </button>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Alert Banner if KL threshold exceeded or K-S drift/watch detected */}
      {driftReport.tier !== 'aligned' && (
        <div
          role={driftReport.klExceedsThreshold ? 'alert' : undefined}
          className={`px-6 py-3 border-b text-xs flex items-start gap-2.5 ${
            driftReport.tier === 'drift_detected'
              ? 'bg-rose-50/70 border-rose-200 text-rose-950'
              : 'bg-amber-50/60 border-amber-200 text-amber-950'
          }`}
        >
          {driftReport.tier === 'drift_detected' ? (
            <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
          ) : (
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          )}
          <div className="min-w-0 leading-relaxed">
            <span className="font-semibold">
              {driftReport.klExceedsThreshold
                ? `KL-divergence exceeded threshold (${driftReport.klThreshold.toFixed(
                    2
                  )} nats) on ${klFlaggedFeatures.length} feature${
                    klFlaggedFeatures.length === 1 ? '' : 's'
                  }: `
                : driftReport.tier === 'drift_detected'
                ? 'Significant covariate shift detected between Train and Validation splits: '
                : 'Mild distributional shift observed between Train and Validation splits: '}
            </span>
            <span className="font-mono text-[11px]">
              {driftReport.klExceedsThreshold
                ? klFlaggedFeatures
                    .map(
                      (f) =>
                        `${f.csvColumn} (D_KL=${f.klDivergence.toFixed(3)} nats, JS=${f.jsDivergence.toFixed(3)})`
                    )
                    .join(' · ')
                : flaggedNames.join(' · ')}
              .{' '}
            </span>
            <span>
              Feature distribution divergence between Train and Validation splits can degrade out-of-sample LTV generalization. Inspect the distribution bins below, adjust the Entity-Hash Split / Salt in the sidebar, or exclude unstable predictors.
            </span>
          </div>
        </div>
      )}

      {driftReport.trainCount < 5 || driftReport.valCount < 5 ? (
        <div className="py-10 px-6 text-center text-xs text-slate-500">
          At least 5 entities in both Train and Validation splits are required to run a reliable KL-divergence and Kolmogorov–Smirnov drift check (currently Train n={driftReport.trainCount}, Val n={driftReport.valCount}).
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-12 divide-y xl:divide-y-0 xl:divide-x divide-slate-200">
          {/* Left: Per-feature KL & K-S Table */}
          <div className="xl:col-span-7 overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-600">
                <tr>
                  <th className="py-2.5 px-4">Predictor</th>
                  <th className="py-2.5 px-2.5 text-right whitespace-nowrap">Train Mean</th>
                  <th className="py-2.5 px-2.5 text-right whitespace-nowrap">Val Mean</th>
                  <th className="py-2.5 px-2.5 text-right whitespace-nowrap">KL Div (D_KL)</th>
                  <th className="py-2.5 px-2.5 text-right whitespace-nowrap">K-S (D)</th>
                  <th className="py-2.5 px-2.5 text-right whitespace-nowrap">p-val</th>
                  <th className="py-2.5 px-4 whitespace-nowrap">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-xs">
                {driftReport.features.map((feat) => {
                  const isSelected = activeFeature?.feature === feat.feature;
                  const klRatio = Math.min(
                    100,
                    Math.round(
                      (feat.klDivergence / Math.max(0.05, driftReport.klThreshold * 1.5)) *
                        100
                    )
                  );

                  return (
                    <tr
                      key={feat.feature}
                      onClick={() => setSelectedFeatureKey(feat.feature)}
                      className={`cursor-pointer transition-colors h-10 ${
                        isSelected ? 'bg-blue-50/60' : 'hover:bg-slate-50/80'
                      }`}
                    >
                      <td className="py-2 px-4">
                        <div className="font-medium text-slate-900">{feat.shortLabel}</div>
                        <div className="text-[10px] font-mono text-slate-500">
                          {feat.csvColumn}
                        </div>
                      </td>
                      <td className="py-2 px-2.5 text-right font-mono tabular-nums text-slate-700">
                        {feat.trainMean.toFixed(2)}
                      </td>
                      <td className="py-2 px-2.5 text-right font-mono tabular-nums text-slate-700">
                        {feat.valMean.toFixed(2)}
                      </td>
                      <td
                        className="py-2 px-2.5 text-right font-mono tabular-nums"
                        title={`KL(Train||Val) = ${feat.klDivergence.toFixed(4)} nats | JS Div = ${feat.jsDivergence.toFixed(4)} nats | Threshold = ${driftReport.klThreshold.toFixed(2)}`}
                      >
                        <div className="inline-flex items-center justify-end gap-2">
                          <div className="w-10 h-1.5 bg-slate-100 rounded overflow-hidden hidden sm:block">
                            <div
                              className={`h-full rounded ${
                                feat.klExceedsThreshold
                                  ? 'bg-rose-600'
                                  : feat.klDivergence >= driftReport.klThreshold * 0.7
                                  ? 'bg-amber-500'
                                  : 'bg-blue-700'
                              }`}
                              style={{ width: `${Math.max(4, klRatio)}%` }}
                            />
                          </div>
                          <span
                            className={`font-semibold ${
                              feat.klExceedsThreshold
                                ? 'text-rose-700'
                                : feat.klDivergence >= driftReport.klThreshold * 0.7
                                ? 'text-amber-700'
                                : 'text-slate-900'
                            }`}
                          >
                            {feat.klDivergence.toFixed(3)}
                          </span>
                        </div>
                      </td>
                      <td className="py-2 px-2.5 text-right font-mono tabular-nums text-slate-800">
                        {feat.ksStatistic.toFixed(3)}
                      </td>
                      <td
                        className={`py-2 px-2.5 text-right font-mono tabular-nums font-medium ${
                          feat.status === 'significant'
                            ? 'text-rose-700'
                            : feat.status === 'moderate'
                            ? 'text-amber-700'
                            : 'text-slate-600'
                        }`}
                      >
                        {feat.pValue.toFixed(3)}
                      </td>
                      <td className="py-2 px-4 whitespace-nowrap">
                        {feat.klExceedsThreshold ? (
                          <span className="inline-flex items-center gap-1 text-rose-700 font-medium">
                            <ShieldAlert className="w-3.5 h-3.5" />
                            <span>KL Breach</span>
                          </span>
                        ) : feat.status === 'significant' ? (
                          <span className="inline-flex items-center gap-1 text-rose-700 font-medium">
                            <ShieldAlert className="w-3.5 h-3.5" />
                            <span>K-S Drift</span>
                          </span>
                        ) : feat.status === 'moderate' ? (
                          <span className="inline-flex items-center gap-1 text-amber-700 font-medium">
                            <AlertTriangle className="w-3.5 h-3.5" />
                            <span>Watch</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>Aligned</span>
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Right: Binned Train vs Validation Distribution (KL) or ECDF Curve (K-S) */}
          <div className="xl:col-span-5 p-5 flex flex-col justify-between gap-3">
            {activeFeature && (
              <>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h3 className="text-xs font-semibold text-slate-900">
                      {chartMode === 'kl_bins'
                        ? `Density Bins (KL): ${activeFeature.label}`
                        : `ECDF Comparison: ${activeFeature.label}`}
                    </h3>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      {chartMode === 'kl_bins'
                        ? `D_KL(Train || Val) = ${activeFeature.klDivergence.toFixed(
                            4
                          )} nats · JS = ${activeFeature.jsDivergence.toFixed(4)}`
                        : `Max ECDF gap D = ${activeFeature.ksStatistic.toFixed(
                            3
                          )} at x = ${activeFeature.maxGapX} (p = ${activeFeature.pValue.toFixed(
                            4
                          )})`}
                    </p>
                  </div>

                  <div className="flex items-center gap-1 p-0.5 bg-slate-100 rounded-md shrink-0">
                    <button
                      type="button"
                      onClick={() => setChartMode('kl_bins')}
                      className={`px-2 py-1 text-[11px] font-medium rounded transition-colors ${
                        chartMode === 'kl_bins'
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      KL Bins
                    </button>
                    <button
                      type="button"
                      onClick={() => setChartMode('ecdf')}
                      className={`px-2 py-1 text-[11px] font-medium rounded transition-colors ${
                        chartMode === 'ecdf'
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      ECDF
                    </button>
                  </div>
                </div>

                <div style={{ width: '100%', height: 230 }}>
                  {chartMode === 'kl_bins' ? (
                    activeFeature.klBins.length > 0 ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                          data={activeFeature.klBins}
                          margin={{ top: 10, right: 12, bottom: 14, left: 0 }}
                        >
                          <CartesianGrid
                            strokeDasharray="3 3"
                            vertical={false}
                            stroke="#e2e8f0"
                          />
                          <XAxis
                            dataKey="binLabel"
                            tick={{
                              fontSize: 9,
                              fill: '#475569',
                              fontFamily: 'JetBrains Mono, monospace',
                            }}
                            axisLine={{ stroke: '#cbd5e1' }}
                            tickLine={false}
                            interval="preserveStartEnd"
                          />
                          <YAxis
                            tickFormatter={(v) => `${Math.round(Number(v) * 100)}%`}
                            width={38}
                            tick={{
                              fontSize: 10,
                              fill: '#475569',
                              fontFamily: 'JetBrains Mono, monospace',
                            }}
                            axisLine={{ stroke: '#cbd5e1' }}
                            tickLine={false}
                          />
                          <Tooltip
                            content={({ active, payload }) => {
                              if (!active || !payload || payload.length === 0) return null;
                              const b = payload[0]?.payload as
                                | {
                                    binLabel: string;
                                    trainProb: number;
                                    valProb: number;
                                    klContribution: number;
                                  }
                                | undefined;
                              if (!b) return null;
                              return (
                                <div className="bg-white border border-slate-200 rounded-md shadow-md px-3 py-2 text-xs space-y-1">
                                  <div className="font-mono font-semibold text-slate-900">
                                    Range: {b.binLabel}
                                  </div>
                                  <div className="font-mono text-blue-700 tabular-nums">
                                    Train P(x): {(b.trainProb * 100).toFixed(1)}%
                                  </div>
                                  <div className="font-mono text-amber-700 tabular-nums">
                                    Val Q(x): {(b.valProb * 100).toFixed(1)}%
                                  </div>
                                  <div className="font-mono text-slate-600 tabular-nums pt-0.5 border-t border-slate-100">
                                    Bin KL term: {b.klContribution >= 0 ? '+' : ''}
                                    {b.klContribution.toFixed(4)}
                                  </div>
                                </div>
                              );
                            }}
                          />
                          <Bar
                            dataKey="trainProb"
                            name="Train P(x)"
                            fill="#1d4ed8"
                            radius={[2, 2, 0, 0]}
                            isAnimationActive={false}
                          />
                          <Bar
                            dataKey="valProb"
                            name="Val Q(x)"
                            fill="#d97706"
                            radius={[2, 2, 0, 0]}
                            isAnimationActive={false}
                          />
                        </BarChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="h-full flex items-center justify-center text-xs text-slate-500">
                        Zero feature variance across Train and Validation splits.
                      </div>
                    )
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart
                        data={activeFeature.ecdfCurve}
                        margin={{ top: 10, right: 14, bottom: 16, left: 0 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                        <XAxis
                          type="number"
                          dataKey="x"
                          domain={['auto', 'auto']}
                          tickFormatter={(v) =>
                            Math.abs(Number(v)) >= 100
                              ? String(Math.round(Number(v)))
                              : Number(v).toFixed(1)
                          }
                          tick={{
                            fontSize: 10,
                            fill: '#475569',
                            fontFamily: 'JetBrains Mono, monospace',
                          }}
                          axisLine={{ stroke: '#cbd5e1' }}
                          tickLine={false}
                          label={{
                            value: activeFeature.csvColumn,
                            position: 'insideBottom',
                            offset: -10,
                            fontSize: 10,
                            fill: '#64748b',
                          }}
                        />
                        <YAxis
                          domain={[0, 1]}
                          tickCount={5}
                          tickFormatter={(v) => Number(v).toFixed(2)}
                          width={42}
                          tick={{
                            fontSize: 10,
                            fill: '#475569',
                            fontFamily: 'JetBrains Mono, monospace',
                          }}
                          axisLine={{ stroke: '#cbd5e1' }}
                          tickLine={false}
                        />
                        <ReferenceLine
                          x={activeFeature.maxGapX}
                          stroke="#dc2626"
                          strokeDasharray="3 3"
                          strokeWidth={1.25}
                        />
                        <Tooltip
                          content={({ active, payload }) => {
                            if (!active || !payload || payload.length === 0) return null;
                            const pt = payload[0]?.payload as
                              | { x: number; trainCdf: number; valCdf: number }
                              | undefined;
                            if (!pt) return null;
                            const gap = Math.abs(pt.trainCdf - pt.valCdf);
                            return (
                              <div className="bg-white border border-slate-200 rounded-md shadow-md px-3 py-2 text-xs space-y-1">
                                <div className="font-mono font-semibold text-slate-900">
                                  x = {pt.x}
                                </div>
                                <div className="font-mono text-blue-700 tabular-nums">
                                  Train ECDF: {(pt.trainCdf * 100).toFixed(1)}%
                                </div>
                                <div className="font-mono text-amber-700 tabular-nums">
                                  Val ECDF: {(pt.valCdf * 100).toFixed(1)}%
                                </div>
                                <div className="font-mono text-slate-600 tabular-nums pt-0.5 border-t border-slate-100">
                                  |Δ CDF|: {gap.toFixed(3)}
                                </div>
                              </div>
                            );
                          }}
                        />
                        <Line
                          type="stepAfter"
                          dataKey="trainCdf"
                          name="Train ECDF"
                          stroke="#1d4ed8"
                          strokeWidth={2}
                          dot={false}
                          isAnimationActive={false}
                        />
                        <Line
                          type="stepAfter"
                          dataKey="valCdf"
                          name="Validation ECDF"
                          stroke="#d97706"
                          strokeWidth={2}
                          strokeDasharray="4 3"
                          dot={false}
                          isAnimationActive={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  )}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100 text-[11px] text-slate-600">
                  <div className="flex items-center gap-3">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="w-3 h-2 rounded-xs bg-blue-700 inline-block" aria-hidden="true" />
                      <span>Train Split</span>
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="w-3 h-2 rounded-xs bg-amber-600 inline-block" aria-hidden="true" />
                      <span>Validation Split</span>
                    </span>
                  </div>
                  <span className="font-mono text-slate-500">Click any row to inspect</span>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
};

