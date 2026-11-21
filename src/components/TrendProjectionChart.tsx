import React, { useMemo, useState } from 'react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Eye, EyeOff, TrendingUp } from 'lucide-react';
import {
  RawEvent,
  RegressionConfig,
  RegressionRow,
  TrendProjectionWindow,
} from '../types/curation';
import { computeLtvTrendProjection } from '../engine/curationEngine';

interface TrendProjectionChartProps {
  events: RawEvent[];
  rows: RegressionRow[];
  maxObservedDay: number;
  splitFilter: RegressionConfig['splitFilter'];
}

type ScaleView = 'per_entity' | 'total_cohort';

interface ChartDatum {
  day: number;
  label: string;
  isForecast: boolean;
  daysAhead: number;
  observed: number | null;
  trendFit: number | null;
  projected: number | null;
  ciLower: number | null;
  ciUpper: number | null;
  ciBase: number | null;
  ciSpan: number | null;
}

function formatUsdCompact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${(value / 1_000).toFixed(1)}k`;
  return `$${Math.round(value)}`;
}

function formatUsdFull(value: number): string {
  return `$${value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export const TrendProjectionChart: React.FC<TrendProjectionChartProps> = ({
  events,
  rows,
  maxObservedDay,
  splitFilter,
}) => {
  const [showConfidenceInterval, setShowConfidenceInterval] = useState(true);
  const [confidenceLevel, setConfidenceLevel] = useState<90 | 95 | 99>(95);
  const [fitWindow, setFitWindow] = useState<TrendProjectionWindow>('full');
  const [scaleView, setScaleView] = useState<ScaleView>('per_entity');

  const report = useMemo(
    () =>
      computeLtvTrendProjection(events, rows, maxObservedDay, {
        fitWindow,
        confidenceLevel,
        forecastDays: 90,
      }),
    [events, rows, maxObservedDay, fitWindow, confidenceLevel]
  );

  const chartData = useMemo<ChartDatum[]>(() => {
    const mult = scaleView === 'total_cohort' ? report.cohortSize : 1;
    return report.points.map((pt) => {
      const observed =
        scaleView === 'total_cohort' ? pt.observedCohortLtv : pt.observedLtv;
      const trendFit =
        pt.trendFitLtv !== null
          ? Math.round(pt.trendFitLtv * mult * 100) / 100
          : null;
      const projected =
        scaleView === 'total_cohort' ? pt.projectedCohortLtv : pt.projectedLtv;
      const ciLower =
        scaleView === 'total_cohort' ? pt.cohortCiLower : pt.ciLower;
      const ciUpper =
        scaleView === 'total_cohort' ? pt.cohortCiUpper : pt.ciUpper;
      const ciSpan =
        ciLower !== null && ciUpper !== null
          ? Math.max(0, Math.round((ciUpper - ciLower) * 100) / 100)
          : null;

      return {
        day: pt.day,
        label: pt.label,
        isForecast: pt.isForecast,
        daysAhead: Math.max(0, pt.day - report.historicalEndDay),
        observed,
        trendFit,
        projected,
        ciLower,
        ciUpper,
        ciBase: ciLower,
        ciSpan,
      };
    });
  }, [report, scaleView]);

  const kpis = useMemo(() => {
    const mult = scaleView === 'total_cohort' ? report.cohortSize : 1;
    const currentVal = Math.round(report.currentMeanLtv * mult * 100) / 100;
    const projected90dVal =
      Math.round(report.projected90dMeanLtv * mult * 100) / 100;
    const liftUsd = Math.round((projected90dVal - currentVal) * 100) / 100;
    const slopeDisplay = Math.round(report.slopePerDay * mult * 100) / 100;
    const ciLower90dVal = Math.round(report.ciLower90d * mult * 100) / 100;
    const ciUpper90dVal = Math.round(report.ciUpper90d * mult * 100) / 100;
    const halfWidth =
      Math.round(((ciUpper90dVal - ciLower90dVal) / 2) * 100) / 100;

    return {
      currentVal,
      projected90dVal,
      liftUsd,
      slopeDisplay,
      ciLower90dVal,
      ciUpper90dVal,
      halfWidth,
    };
  }, [report, scaleView]);

  const splitLabel =
    splitFilter === 'all' ? 'All Splits' : `${splitFilter.toUpperCase()} Split`;

  return (
    <section className="bg-white border border-slate-200 rounded-lg p-5">
      {/* Header & Single-Line Controls */}
      <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-3 pb-4 border-b border-slate-200">
        <div>
          <div className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-blue-700 shrink-0" />
            <h2 className="text-sm font-semibold text-slate-900">
              90-Day LTV Trend Projection (Linear Extrapolation)
            </h2>
          </div>
          <p className="text-xs text-slate-500 mt-0.5 font-mono tabular-nums">
            {splitLabel} · n = {report.cohortSize.toLocaleString()} entities ·
            Observed Day 0–{report.historicalEndDay} → Forecast Day{' '}
            {report.forecastEndDay} (+90d)
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Confidence Interval Toggle */}
          <button
            type="button"
            onClick={() => setShowConfidenceInterval((prev) => !prev)}
            aria-pressed={showConfidenceInterval}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border transition-colors ${
              showConfidenceInterval
                ? 'bg-blue-50 text-blue-800 border-blue-300'
                : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
            }`}
          >
            {showConfidenceInterval ? (
              <Eye className="w-3.5 h-3.5 text-blue-700" />
            ) : (
              <EyeOff className="w-3.5 h-3.5 text-slate-400" />
            )}
            <span>
              Confidence Interval: {showConfidenceInterval ? 'On' : 'Off'}
            </span>
          </button>

          {/* Confidence Level Selector */}
          <div
            className={`inline-flex rounded-md border border-slate-200 bg-slate-50 p-0.5 ${
              showConfidenceInterval ? '' : 'opacity-50'
            }`}
            role="group"
            aria-label="Confidence interval level"
          >
            {([90, 95, 99] as const).map((lvl) => (
              <button
                key={lvl}
                type="button"
                disabled={!showConfidenceInterval}
                onClick={() => setConfidenceLevel(lvl)}
                className={`px-2 py-1 text-[11px] font-mono tabular-nums font-medium rounded transition-colors ${
                  confidenceLevel === lvl
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                } disabled:cursor-not-allowed`}
              >
                {lvl}%
              </button>
            ))}
          </div>

          {/* OLS Fit Window Selector */}
          <div
            className="inline-flex rounded-md border border-slate-200 bg-slate-50 p-0.5"
            role="group"
            aria-label="Linear regression fit window"
          >
            {(
              [
                { id: 'full', label: 'Full History' },
                { id: 'recent_half', label: 'Recent 50%' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setFitWindow(opt.id)}
                className={`px-2.5 py-1 text-[11px] font-medium rounded transition-colors ${
                  fitWindow === opt.id
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* Metric Scale Toggle */}
          <div
            className="inline-flex rounded-md border border-slate-200 bg-slate-50 p-0.5"
            role="group"
            aria-label="LTV scale view"
          >
            {(
              [
                { id: 'per_entity', label: 'Per-Entity ($)' },
                { id: 'total_cohort', label: 'Total Cohort ($)' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setScaleView(opt.id)}
                className={`px-2.5 py-1 text-[11px] font-medium rounded transition-colors ${
                  scaleView === opt.id
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {report.points.length === 0 ? (
        <div className="py-12 text-center text-xs text-slate-500">
          No active entities match the current split and outlier filters. Adjust
          your filters to generate the 90-day linear trend projection.
        </div>
      ) : (
        <>
          {/* 4-Column KPI Summary Strip */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 my-4">
            <div className="border border-slate-200 rounded-md px-3.5 py-2.5 bg-slate-50/50">
              <div className="text-[11px] font-medium text-slate-500">
                Observed LTV (Day {report.historicalEndDay})
              </div>
              <div className="text-lg font-semibold font-mono tabular-nums text-slate-900 mt-0.5">
                {formatUsdFull(kpis.currentVal)}
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">
                {scaleView === 'per_entity'
                  ? 'Historical cohort average'
                  : `Sum across ${report.cohortSize.toLocaleString()} entities`}
              </div>
            </div>

            <div className="border border-slate-200 rounded-md px-3.5 py-2.5 bg-slate-50/50">
              <div className="text-[11px] font-medium text-slate-500">
                Projected +90d LTV (Day {report.forecastEndDay})
              </div>
              <div className="text-lg font-semibold font-mono tabular-nums text-blue-700 mt-0.5">
                {formatUsdFull(kpis.projected90dVal)}
              </div>
              <div className="text-[11px] font-mono tabular-nums text-emerald-700 mt-0.5">
                +{formatUsdFull(Math.max(0, kpis.liftUsd))} (+
                {report.projected90dLiftPct.toFixed(1)}%)
              </div>
            </div>

            <div className="border border-slate-200 rounded-md px-3.5 py-2.5 bg-slate-50/50">
              <div className="text-[11px] font-medium text-slate-500">
                Linear Accrual Rate (β₁) &amp; Fit
              </div>
              <div className="text-lg font-semibold font-mono tabular-nums text-slate-900 mt-0.5">
                {formatUsdFull(kpis.slopeDisplay)}/day
              </div>
              <div className="text-[11px] font-mono tabular-nums text-slate-600 mt-0.5">
                Trend R² = {report.fitR2.toFixed(3)} · SE = $
                {report.residualStdError.toFixed(2)}
              </div>
            </div>

            <div className="border border-slate-200 rounded-md px-3.5 py-2.5 bg-slate-50/50">
              <div className="text-[11px] font-medium text-slate-500">
                {confidenceLevel}% Confidence Interval (+90d)
              </div>
              {showConfidenceInterval ? (
                <>
                  <div className="text-sm font-semibold font-mono tabular-nums text-slate-900 mt-1">
                    {formatUsdCompact(kpis.ciLower90dVal)} –{' '}
                    {formatUsdCompact(kpis.ciUpper90dVal)}
                  </div>
                  <div className="text-[11px] font-mono tabular-nums text-slate-600 mt-1">
                    ±{formatUsdFull(kpis.halfWidth)} at Day{' '}
                    {report.forecastEndDay}
                  </div>
                </>
              ) : (
                <>
                  <div className="text-sm font-semibold text-slate-500 mt-1">
                    Band Hidden
                  </div>
                  <div className="text-[11px] font-mono tabular-nums text-slate-500 mt-1">
                    Toggle On to display ±{formatUsdFull(kpis.halfWidth)}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Recharts ComposedChart */}
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={chartData}
                margin={{ top: 12, right: 20, left: 6, bottom: 8 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis
                  dataKey="day"
                  type="number"
                  domain={['dataMin', 'dataMax']}
                  tickCount={8}
                  tickFormatter={(v) => `Day ${Math.round(Number(v))}`}
                  tick={{ fontSize: 11, fill: '#64748b', fontFamily: 'monospace' }}
                  stroke="#cbd5e1"
                />
                <YAxis
                  tickFormatter={(v) => formatUsdCompact(Number(v))}
                  tick={{ fontSize: 11, fill: '#64748b', fontFamily: 'monospace' }}
                  stroke="#cbd5e1"
                  width={68}
                />
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload || payload.length === 0) return null;
                    const datum = payload[0]?.payload as ChartDatum | undefined;
                    if (!datum) return null;

                    return (
                      <div className="bg-white border border-slate-200 rounded-md px-3 py-2.5 shadow-md text-xs space-y-1.5 min-w-[215px]">
                        <div className="flex items-center justify-between gap-4 border-b border-slate-100 pb-1">
                          <span className="font-semibold font-mono text-slate-900">
                            Day {datum.day}
                          </span>
                          <span className="text-[11px] font-mono text-slate-500">
                            {datum.isForecast
                              ? `+${datum.daysAhead}d Forecast`
                              : 'Observed'}
                          </span>
                        </div>

                        {datum.observed !== null && (
                          <div className="flex items-center justify-between gap-4">
                            <span className="text-slate-600">Observed LTV</span>
                            <span className="font-mono tabular-nums font-semibold text-slate-900">
                              {formatUsdFull(datum.observed)}
                            </span>
                          </div>
                        )}

                        {datum.trendFit !== null && (
                          <div className="flex items-center justify-between gap-4">
                            <span className="text-slate-500">OLS Trend Fit</span>
                            <span className="font-mono tabular-nums text-slate-700">
                              {formatUsdFull(datum.trendFit)}
                            </span>
                          </div>
                        )}

                        {datum.projected !== null && (
                          <div className="flex items-center justify-between gap-4">
                            <span className="text-blue-700 font-medium">
                              Linear Projection
                            </span>
                            <span className="font-mono tabular-nums font-semibold text-blue-700">
                              {formatUsdFull(datum.projected)}
                            </span>
                          </div>
                        )}

                        {showConfidenceInterval &&
                          datum.ciLower !== null &&
                          datum.ciUpper !== null && (
                            <div className="pt-1 border-t border-slate-100 flex items-center justify-between gap-4">
                              <span className="text-slate-500">
                                {confidenceLevel}% CI
                              </span>
                              <span className="font-mono tabular-nums text-slate-700">
                                {formatUsdFull(datum.ciLower)} –{' '}
                                {formatUsdFull(datum.ciUpper)}
                              </span>
                            </div>
                          )}
                      </div>
                    );
                  }}
                />

                <ReferenceLine
                  x={report.historicalEndDay}
                  stroke="#94a3b8"
                  strokeDasharray="4 4"
                  label={{
                    value: `T_max (Day ${report.historicalEndDay})`,
                    position: 'insideTopLeft',
                    fill: '#475569',
                    fontSize: 10,
                  }}
                />

                {showConfidenceInterval && (
                  <>
                    <Area
                      type="monotone"
                      dataKey="ciBase"
                      stackId="ci"
                      stroke="none"
                      fill="transparent"
                      isAnimationActive={false}
                    />
                    <Area
                      type="monotone"
                      dataKey="ciSpan"
                      stackId="ci"
                      stroke="none"
                      fill="#93c5fd"
                      fillOpacity={0.32}
                      isAnimationActive={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="ciUpper"
                      stroke="#60a5fa"
                      strokeWidth={1.25}
                      strokeDasharray="3 3"
                      dot={false}
                      isAnimationActive={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="ciLower"
                      stroke="#60a5fa"
                      strokeWidth={1.25}
                      strokeDasharray="3 3"
                      dot={false}
                      isAnimationActive={false}
                    />
                  </>
                )}

                <Line
                  type="monotone"
                  dataKey="observed"
                  stroke="#0f172a"
                  strokeWidth={2.25}
                  dot={{ r: 2.5, fill: '#0f172a', strokeWidth: 0 }}
                  activeDot={{ r: 4.5, fill: '#0f172a' }}
                  isAnimationActive={false}
                />

                <Line
                  type="linear"
                  dataKey="trendFit"
                  stroke="#64748b"
                  strokeWidth={1.5}
                  strokeDasharray="2 3"
                  dot={false}
                  isAnimationActive={false}
                />

                <Line
                  type="linear"
                  dataKey="projected"
                  stroke="#1d4ed8"
                  strokeWidth={2.5}
                  strokeDasharray="6 4"
                  dot={{ r: 3, fill: '#1d4ed8', stroke: '#ffffff', strokeWidth: 1.5 }}
                  activeDot={{ r: 5, fill: '#1d4ed8' }}
                  isAnimationActive={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          {/* Inline Legend & Statistical Formula Note */}
          <div className="mt-3 pt-3 border-t border-slate-100 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-2 text-[11px] text-slate-600">
            <div className="flex flex-wrap items-center gap-4">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-4 h-0.5 bg-slate-900 inline-block" />
                Observed Cumulative LTV
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-4 border-t-2 border-dotted border-slate-500 inline-block" />
                OLS Fit ({fitWindow === 'full' ? 'Day 0–T_max' : 'Recent 50%'})
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-4 border-t-2 border-dashed border-blue-700 inline-block" />
                90-Day Linear Extrapolation
              </span>
              {showConfidenceInterval && (
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-3.5 h-2.5 bg-blue-300/50 border border-blue-400 border-dashed inline-block rounded-xs" />
                  {confidenceLevel}% Student-t Confidence Interval
                </span>
              )}
            </div>

            <div className="font-mono text-slate-500 tabular-nums">
              ŷ(t) = {report.intercept.toFixed(2)} + {report.slopePerDay.toFixed(3)}·t
              {showConfidenceInterval &&
                ` · ±t·s_e·√(1/n + (t−t̄)²/S_tt)`}
            </div>
          </div>
        </>
      )}
    </section>
  );
};
