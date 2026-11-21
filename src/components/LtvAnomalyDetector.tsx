import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  FilterX,
  ShieldAlert,
} from 'lucide-react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  LtvAnomalyReport,
  LtvTrendPoint,
  RegressionRow,
} from '../types/curation';

interface LtvAnomalyDetectorProps {
  anomalyReport: LtvAnomalyReport;
  horizonDays: number;
  obsCutoffDay: number;
  maxObservedDay: number;
  rows: RegressionRow[];
  onUpdateThreshold: (stdThreshold: number) => void;
  onToggleExcludeOutliers: (exclude: boolean) => void;
}

type TrendChartMode = 'time_trend' | 'cohort_zscore';

function formatCurrency(val: number): string {
  if (Math.abs(val) >= 1000) return `$${(val / 1000).toFixed(1)}k`;
  return `$${Math.round(val)}`;
}

export const LtvAnomalyDetector: React.FC<LtvAnomalyDetectorProps> = ({
  anomalyReport,
  horizonDays,
  obsCutoffDay,
  maxObservedDay,
  rows,
  onUpdateThreshold,
  onToggleExcludeOutliers,
}) => {
  const [chartMode, setChartMode] = useState<TrendChartMode>('time_trend');

  const thresholdOptions = [1.5, 2.0, 2.5, 3.0];

  const trendChartData = useMemo(
    () =>
      anomalyReport.trendSeries.map((pt) => ({
        ...pt,
        bandRange: [pt.lowerThresholdLtv, pt.upperThresholdLtv] as [number, number],
      })),
    [anomalyReport.trendSeries]
  );

  // Build entity-level scatter series for the Cohort Z-Score view
  const { normalPoints, outlierPoints } = useMemo(() => {
    const outlierSet = new Set(anomalyReport.outlierEntityIds);
    const sorted = [...rows].sort(
      (a, b) => a.currentObservedLtv - b.currentObservedLtv
    );
    const normal: {
      idx: number;
      entityId: string;
      split: string;
      targetLtvRaw: number;
      observedLtv: number;
      zScore: number;
    }[] = [];
    const outlier: typeof normal = [];

    sorted.forEach((r, idx) => {
      const z =
        anomalyReport.stdTargetLtv > 1e-6
          ? (r.targetLtvRaw - anomalyReport.meanTargetLtv) /
            anomalyReport.stdTargetLtv
          : 0;
      const item = {
        idx: idx + 1,
        entityId: r.entityId,
        split: r.split,
        targetLtvRaw: r.targetLtvRaw,
        observedLtv: r.currentObservedLtv,
        zScore: Math.round(z * 100) / 100,
      };
      if (outlierSet.has(r.entityId)) {
        outlier.push(item);
      } else {
        normal.push(item);
      }
    });

    // Also include excluded train outliers in outlier scatter if currently excluded from rows
    if (anomalyReport.excludeEnabled) {
      for (const oe of anomalyReport.outlierEntities) {
        if (oe.excludedFromTraining && !outlier.some((p) => p.entityId === oe.entityId)) {
          outlier.push({
            idx: sorted.length + outlier.length + 1,
            entityId: oe.entityId,
            split: `${oe.split} (excl)`,
            targetLtvRaw: oe.targetLtvRaw,
            observedLtv: oe.currentObservedLtv,
            zScore: oe.zScore,
          });
        }
      }
    }

    return { normalPoints: normal, outlierPoints: outlier };
  }, [rows, anomalyReport]);

  const hasOutliers = anomalyReport.outlierCount > 0;

  return (
    <section
      aria-label="Automated LTV Anomaly Detection"
      className="bg-white border border-slate-200 rounded-lg overflow-hidden"
    >
      {/* Header & Controls */}
      <div className="px-6 py-4 border-b border-slate-200 flex flex-col xl:flex-row xl:items-center xl:justify-between gap-4">
        <div className="flex items-start gap-2.5">
          {hasOutliers ? (
            <ShieldAlert className="w-4 h-4 text-rose-700 shrink-0 mt-0.5" />
          ) : (
            <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
          )}
          <div>
            <div className="flex flex-wrap items-center gap-2.5">
              <h2 className="text-sm font-semibold text-slate-900">
                Automated LTV Anomaly Detection (±{anomalyReport.stdThreshold.toFixed(1)}σ Threshold)
              </h2>
              <span
                className={`text-xs font-mono font-semibold ${
                  hasOutliers ? 'text-rose-700' : 'text-emerald-700'
                }`}
              >
                {hasOutliers
                  ? `${anomalyReport.outlierCount} outlier${anomalyReport.outlierCount === 1 ? '' : 's'} detected (${anomalyReport.trainOutlierCount} in Train)`
                  : '0 outliers detected'}
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Flags entities whose horizon LTV (Day {obsCutoffDay + 1}–{obsCutoffDay + horizonDays}) deviates by ≥ {anomalyReport.stdThreshold.toFixed(1)}σ from the training cohort mean (${anomalyReport.meanTargetLtv.toFixed(2)} ± ${anomalyReport.stdTargetLtv.toFixed(2)}).
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 shrink-0">
          {/* Std Dev Threshold Segmented Selector */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-slate-600 whitespace-nowrap">
              Threshold:
            </span>
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-md">
              {thresholdOptions.map((th) => (
                <button
                  key={th}
                  type="button"
                  onClick={() => onUpdateThreshold(th)}
                  className={`px-2.5 py-1 text-xs font-mono rounded transition-colors whitespace-nowrap ${
                    Math.abs(anomalyReport.stdThreshold - th) < 0.05
                      ? 'bg-white text-slate-900 font-semibold shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  ±{th.toFixed(1)}σ
                </button>
              ))}
            </div>
          </div>

          {/* Exclude Outliers Toggle */}
          <button
            type="button"
            aria-pressed={anomalyReport.excludeEnabled}
            onClick={() => onToggleExcludeOutliers(!anomalyReport.excludeEnabled)}
            disabled={anomalyReport.trainOutlierCount === 0 && !anomalyReport.excludeEnabled}
            className={`px-3.5 py-2 text-xs font-medium rounded-md border transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 disabled:opacity-50 disabled:cursor-not-allowed ${
              anomalyReport.excludeEnabled
                ? 'bg-rose-700 border-rose-700 text-white hover:bg-rose-800'
                : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
            }`}
          >
            <FilterX className="w-3.5 h-3.5" />
            <span>
              {anomalyReport.excludeEnabled
                ? `Excluded ${anomalyReport.excludedFromTrainCount} Train Outlier${anomalyReport.excludedFromTrainCount === 1 ? '' : 's'}`
                : `Exclude Train Outliers (${anomalyReport.trainOutlierCount})`}
            </span>
          </button>
        </div>
      </div>

      {/* 4-Column Anomaly Summary Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 divide-y lg:divide-y-0 lg:divide-x divide-slate-200 border-b border-slate-200 bg-slate-50/40">
        <div className="p-4">
          <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">
            Upper Anomaly Bound (+{anomalyReport.stdThreshold.toFixed(1)}σ)
          </div>
          <div className="text-lg font-bold font-mono tabular-nums text-rose-700 mt-1">
            ${anomalyReport.upperBound.toFixed(2)}
          </div>
          <div className="text-[11px] font-mono tabular-nums text-slate-500 mt-0.5">
            Lower bound: ${anomalyReport.lowerBound.toFixed(2)}
          </div>
        </div>

        <div className="p-4">
          <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">
            Cohort Mean ± Std Dev (μ ± σ)
          </div>
          <div className="text-lg font-bold font-mono tabular-nums text-slate-900 mt-1">
            ${anomalyReport.meanTargetLtv.toFixed(0)} ± ${anomalyReport.stdTargetLtv.toFixed(0)}
          </div>
          <div className="text-[11px] font-mono tabular-nums text-slate-500 mt-0.5">
            Fit on n={anomalyReport.trainBaselineCount} train baseline entities
          </div>
        </div>

        <div className="p-4">
          <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">
            Flagged Outliers
          </div>
          <div className="text-lg font-bold font-mono tabular-nums text-slate-900 mt-1">
            {anomalyReport.outlierCount}{' '}
            <span className="text-xs font-medium text-slate-500">
              ({(anomalyReport.outlierRate * 100).toFixed(1)}%)
            </span>
          </div>
          <div className="text-[11px] font-mono tabular-nums text-slate-500 mt-0.5">
            {anomalyReport.trainOutlierCount} train ·{' '}
            {anomalyReport.outlierCount - anomalyReport.trainOutlierCount} val/test
          </div>
        </div>

        <div className="p-4">
          <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">
            Training Set Action
          </div>
          <div
            className={`text-lg font-bold font-mono tabular-nums mt-1 ${
              anomalyReport.excludeEnabled ? 'text-emerald-700' : 'text-slate-800'
            }`}
          >
            {anomalyReport.excludeEnabled
              ? `${anomalyReport.excludedFromTrainCount} Excluded`
              : 'All Included'}
          </div>
          <div className="text-[11px] font-mono tabular-nums text-slate-500 mt-0.5">
            {anomalyReport.excludeEnabled
              ? 'OLS & scalers retrained cleanly'
              : 'Toggle button above to filter'}
          </div>
        </div>
      </div>

      {/* Main Content: LTV Trend Lines Chart + Outlier Roster */}
      <div className="grid grid-cols-1 xl:grid-cols-12 divide-y xl:divide-y-0 xl:divide-x divide-slate-200">
        {/* Left: Trend Chart */}
        <div className="xl:col-span-7 p-5">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3">
            <div>
              <h3 className="text-xs font-semibold text-slate-900">
                {chartMode === 'time_trend'
                  ? `Cumulative LTV Trend Lines vs. ±${anomalyReport.stdThreshold.toFixed(1)}σ Envelope (Days 0–${maxObservedDay})`
                  : `Entity Target LTV Scatter vs. +${anomalyReport.stdThreshold.toFixed(1)}σ Threshold`}
              </h3>
              <p className="text-[11px] text-slate-500">
                {chartMode === 'time_trend'
                  ? 'Tracks cohort mean LTV growth over time against the standard-deviation threshold band and highlighted outlier trajectories.'
                  : 'Ordered entities showing raw target LTV against the cohort mean and upper σ anomaly threshold.'}
              </p>
            </div>

            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-md self-start shrink-0">
              <button
                type="button"
                onClick={() => setChartMode('time_trend')}
                className={`px-2.5 py-1 text-[11px] font-medium rounded transition-colors whitespace-nowrap ${
                  chartMode === 'time_trend'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                LTV Time Trend
              </button>
              <button
                type="button"
                onClick={() => setChartMode('cohort_zscore')}
                className={`px-2.5 py-1 text-[11px] font-medium rounded transition-colors whitespace-nowrap ${
                  chartMode === 'cohort_zscore'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Entity Outliers
              </button>
            </div>
          </div>

          {chartMode === 'time_trend' ? (
            <>
              <div className="flex flex-wrap items-center gap-5 mb-3 text-[11px] text-slate-600">
                <span className="inline-flex items-center gap-1.5 font-medium text-slate-800">
                  <span className="w-4 h-0.5 bg-blue-700 inline-block" aria-hidden="true" />
                  <span>Cohort Mean LTV</span>
                </span>
                <span className="inline-flex items-center gap-1.5 font-medium text-amber-700">
                  <span
                    className="w-4 border-t-2 border-dashed border-amber-600 inline-block"
                    aria-hidden="true"
                  />
                  <span>+{anomalyReport.stdThreshold.toFixed(1)}σ Upper Threshold</span>
                </span>
                {hasOutliers && (
                  <>
                    <span className="inline-flex items-center gap-1.5 font-medium text-rose-700">
                      <span
                        className="w-4 h-0.5 bg-rose-600 inline-block"
                        aria-hidden="true"
                      />
                      <span>Flagged Outliers Mean</span>
                    </span>
                    <span className="inline-flex items-center gap-1.5 font-medium text-rose-900">
                      <span
                        className="w-2.5 h-2.5 rounded-full bg-rose-700 inline-block"
                        aria-hidden="true"
                      />
                      <span>Peak Outlier Trajectory</span>
                    </span>
                  </>
                )}
              </div>

              <div className="h-64 w-full">
                {trendChartData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart
                      data={trendChartData}
                      margin={{ top: 8, right: 16, left: 6, bottom: 8 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis
                        dataKey="label"
                        tick={{ fontSize: 11, fill: '#475569' }}
                        tickLine={false}
                        axisLine={{ stroke: '#cbd5e1' }}
                      />
                      <YAxis
                        tick={{ fontSize: 11, fill: '#475569' }}
                        tickLine={false}
                        axisLine={{ stroke: '#cbd5e1' }}
                        width={54}
                        tickFormatter={formatCurrency}
                      />
                      <Tooltip
                        content={({ active, payload }) => {
                          if (!active || !payload || payload.length === 0) return null;
                          const pt = payload[0].payload as LtvTrendPoint;
                          return (
                            <div className="bg-white border border-slate-200 rounded-md px-3 py-2 shadow-sm text-xs font-mono tabular-nums space-y-1">
                              <div className="font-semibold text-slate-900 border-b border-slate-100 pb-1">
                                {pt.label} (n={pt.activeCohortCount})
                              </div>
                              <div className="flex justify-between gap-4 text-blue-700">
                                <span>Cohort Mean:</span>
                                <span className="font-semibold">
                                  ${pt.meanCumulativeLtv.toFixed(2)}
                                </span>
                              </div>
                              <div className="flex justify-between gap-4 text-amber-700">
                                <span>+{anomalyReport.stdThreshold.toFixed(1)}σ Limit:</span>
                                <span className="font-semibold">
                                  ${pt.upperThresholdLtv.toFixed(2)}
                                </span>
                              </div>
                              {pt.outlierMeanLtv !== null && (
                                <div className="flex justify-between gap-4 text-rose-700 pt-0.5 border-t border-slate-100">
                                  <span>Outliers Mean ({pt.outlierCount}):</span>
                                  <span className="font-semibold">
                                    ${pt.outlierMeanLtv.toFixed(2)}
                                  </span>
                                </div>
                              )}
                              {pt.topOutlierEntityId && pt.topOutlierLtv !== null && (
                                <div className="flex justify-between gap-4 text-rose-900">
                                  <span>Peak ({pt.topOutlierEntityId}):</span>
                                  <span className="font-semibold">
                                    ${pt.topOutlierLtv.toFixed(2)}
                                  </span>
                                </div>
                              )}
                            </div>
                          );
                        }}
                      />
                      <Area
                        type="monotone"
                        dataKey="upperThresholdLtv"
                        fill="#fef3c7"
                        fillOpacity={0.35}
                        stroke="none"
                        isAnimationActive={false}
                      />
                      <Line
                        type="monotone"
                        dataKey="upperThresholdLtv"
                        name="Upper σ Threshold"
                        stroke="#d97706"
                        strokeWidth={1.75}
                        strokeDasharray="5 3"
                        dot={false}
                        isAnimationActive={false}
                      />
                      <Line
                        type="monotone"
                        dataKey="meanCumulativeLtv"
                        name="Cohort Mean LTV"
                        stroke="#1d4ed8"
                        strokeWidth={2.25}
                        dot={false}
                        isAnimationActive={false}
                      />
                      {hasOutliers && (
                        <Line
                          type="monotone"
                          dataKey="outlierMeanLtv"
                          name="Flagged Outliers Mean"
                          stroke="#e11d48"
                          strokeWidth={2}
                          dot={{ r: 3, fill: '#e11d48' }}
                          isAnimationActive={false}
                        />
                      )}
                      {hasOutliers && (
                        <Line
                          type="monotone"
                          dataKey="topOutlierLtv"
                          name="Peak Outlier"
                          stroke="#881337"
                          strokeWidth={1.5}
                          strokeDasharray="2 2"
                          dot={{ r: 3.5, fill: '#be123c', stroke: '#ffffff', strokeWidth: 1 }}
                          isAnimationActive={false}
                        />
                      )}
                    </ComposedChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="py-12 text-center text-xs text-slate-500">
                    Insufficient timestamped events to build LTV trend series.
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-5 mb-3 text-[11px] text-slate-600">
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-slate-500 inline-block" />
                  <span>In-Bounds Entity</span>
                </span>
                <span className="inline-flex items-center gap-1.5 font-medium text-rose-700">
                  <span className="w-2.5 h-2.5 rounded-full bg-rose-700 inline-block" />
                  <span>Flagged Outlier (|z| ≥ {anomalyReport.stdThreshold.toFixed(1)})</span>
                </span>
              </div>

              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <ScatterChart margin={{ top: 8, right: 16, left: 6, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis
                      type="number"
                      dataKey="idx"
                      tick={{ fontSize: 11, fill: '#475569' }}
                      tickLine={false}
                      axisLine={{ stroke: '#cbd5e1' }}
                    />
                    <YAxis
                      type="number"
                      dataKey="targetLtvRaw"
                      tick={{ fontSize: 11, fill: '#475569' }}
                      tickLine={false}
                      axisLine={{ stroke: '#cbd5e1' }}
                      width={54}
                      tickFormatter={formatCurrency}
                    />
                    <ReferenceLine
                      y={anomalyReport.meanTargetLtv}
                      stroke="#1d4ed8"
                      strokeDasharray="4 4"
                      label={{
                        value: `Mean $${Math.round(anomalyReport.meanTargetLtv)}`,
                        position: 'insideBottomRight',
                        fontSize: 10,
                        fill: '#1d4ed8',
                      }}
                    />
                    <ReferenceLine
                      y={anomalyReport.upperBound}
                      stroke="#dc2626"
                      strokeDasharray="5 3"
                      label={{
                        value: `+${anomalyReport.stdThreshold.toFixed(1)}σ ($${Math.round(
                          anomalyReport.upperBound
                        )})`,
                        position: 'insideTopRight',
                        fontSize: 10,
                        fill: '#dc2626',
                      }}
                    />
                    <Tooltip
                      content={({ active, payload }) => {
                        if (!active || !payload || payload.length === 0) return null;
                        const pt = payload[0].payload as (typeof normalPoints)[number];
                        return (
                          <div className="bg-white border border-slate-200 rounded-md px-3 py-2 shadow-sm text-xs font-mono tabular-nums space-y-1">
                            <div className="font-semibold text-slate-900">
                              {pt.entityId} ({pt.split})
                            </div>
                            <div className="text-slate-700">
                              Raw Target LTV: ${pt.targetLtvRaw.toFixed(2)}
                            </div>
                            <div
                              className={
                                Math.abs(pt.zScore) >= anomalyReport.stdThreshold
                                  ? 'text-rose-700 font-semibold'
                                  : 'text-slate-600'
                              }
                            >
                              Z-Score: {pt.zScore >= 0 ? '+' : ''}
                              {pt.zScore.toFixed(2)}σ
                            </div>
                          </div>
                        );
                      }}
                    />
                    <Scatter
                      name="In-Bounds"
                      data={normalPoints}
                      fill="#64748b"
                      fillOpacity={0.65}
                      isAnimationActive={false}
                    />
                    <Scatter
                      name="Outliers"
                      data={outlierPoints}
                      fill="#be123c"
                      isAnimationActive={false}
                    />
                  </ScatterChart>
                </ResponsiveContainer>
              </div>
            </>
          )}
        </div>

        {/* Right: Highlighted Outlier Roster */}
        <div className="xl:col-span-5 flex flex-col">
          <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between gap-2">
            <div>
              <h3 className="text-xs font-semibold text-slate-900">
                Highlighted LTV Outliers (|z| ≥ {anomalyReport.stdThreshold.toFixed(1)})
              </h3>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Sorted by standard deviation magnitude from training mean
              </p>
            </div>
          </div>

          {anomalyReport.outlierEntities.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500 flex-1 flex flex-col items-center justify-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-emerald-600" />
              <span>
                No entities exceed ±{anomalyReport.stdThreshold.toFixed(1)}σ from the cohort mean (${anomalyReport.meanTargetLtv.toFixed(2)}). Lower the threshold to ±1.5σ or ±2.0σ to inspect upper-tail spenders.
              </span>
            </div>
          ) : (
            <div className="overflow-x-auto max-h-[300px] overflow-y-auto">
              <table className="w-full text-left border-collapse">
                <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-600">
                  <tr>
                    <th className="py-2 px-3">Entity</th>
                    <th className="py-2 px-2">Split</th>
                    <th className="py-2 px-2 text-right">Raw LTV</th>
                    <th className="py-2 px-2 text-right">Z-Score</th>
                    <th className="py-2 px-3 text-right">Train Set</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-[11px] font-mono tabular-nums">
                  {anomalyReport.outlierEntities.map((oe) => (
                    <tr
                      key={oe.entityId}
                      className={
                        oe.excludedFromTraining
                          ? 'bg-rose-50/50 text-slate-700'
                          : 'bg-white text-slate-800'
                      }
                    >
                      <td className="py-2 px-3 font-semibold text-slate-900">
                        {oe.entityId}
                      </td>
                      <td className="py-2 px-2 text-slate-500">{oe.split}</td>
                      <td className="py-2 px-2 text-right font-semibold text-rose-700">
                        ${oe.targetLtvRaw.toFixed(2)}
                      </td>
                      <td className="py-2 px-2 text-right font-semibold text-rose-700">
                        +{oe.zScore.toFixed(2)}σ
                      </td>
                      <td className="py-2 px-3 text-right font-sans">
                        {oe.excludedFromTraining ? (
                          <span className="text-rose-700 font-semibold">Excluded</span>
                        ) : oe.split === 'train' ? (
                          <span className="text-amber-700 font-medium">Included</span>
                        ) : (
                          <span className="text-slate-400">Holdout</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {anomalyReport.excludeEnabled && anomalyReport.excludedFromTrainCount > 0 && (
            <div className="px-5 py-2.5 border-t border-slate-200 bg-amber-50/60 text-[11px] text-amber-900 flex items-center gap-2">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-700 shrink-0" />
              <span>
                {anomalyReport.excludedFromTrainCount} training outlier
                {anomalyReport.excludedFromTrainCount === 1 ? ' is' : 's are'} excluded from OLS fitting and train-split scalers; validation/test splits remain intact.
              </span>
            </div>
          )}
        </div>
      </div>
    </section>
  );
};
