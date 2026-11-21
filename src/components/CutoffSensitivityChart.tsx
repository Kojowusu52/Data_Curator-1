import React, { useMemo, useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { SlidersHorizontal, Sparkles } from 'lucide-react';
import {
  CutoffSensitivityPoint,
  GlobalCurationConfig,
  RawEvent,
  RegressionConfig,
} from '../types/curation';
import { computeCutoffSensitivityCurve } from '../engine/curationEngine';

interface CutoffSensitivityChartProps {
  events: RawEvent[];
  globalConfig: GlobalCurationConfig;
  config: RegressionConfig;
  maxDay: number;
  onSelectCutoffDay: (day: number) => void;
}

type CurveMetricMode = 'r2_curves' | 'r2_rmse';

export const CutoffSensitivityChart: React.FC<CutoffSensitivityChartProps> = ({
  events,
  globalConfig,
  config,
  maxDay,
  onSelectCutoffDay,
}) => {
  const [metricMode, setMetricMode] = useState<CurveMetricMode>('r2_curves');

  const sweepPoints = useMemo<CutoffSensitivityPoint[]>(
    () => computeCutoffSensitivityCurve(events, config, globalConfig, maxDay),
    [
      events,
      globalConfig,
      config.horizonDays,
      config.winsorizePercentile,
      config.excludeZeroObsEntities,
      config.featureNormalization,
      config.selectedFeatures,
      config.splitFilter,
      maxDay,
    ]
  );

  const hasHoldout = useMemo(
    () => config.splitFilter === 'all' && sweepPoints.some((p) => p.holdoutR2 !== null),
    [config.splitFilter, sweepPoints]
  );

  const optimalPoint = useMemo(() => {
    if (sweepPoints.length === 0) return null;
    const uncensored = sweepPoints.filter((p) => !p.isHorizonCensored && p.sampleSize >= 3);
    const pool = uncensored.length > 0 ? uncensored : sweepPoints;
    return pool.reduce((best, cur) => {
      const bestScore = best.holdoutR2 ?? best.rSquared;
      const curScore = cur.holdoutR2 ?? cur.rSquared;
      if (curScore > bestScore + 1e-6) return cur;
      if (Math.abs(curScore - bestScore) <= 1e-6 && cur.rSquared > best.rSquared) return cur;
      return best;
    }, pool[0]);
  }, [sweepPoints]);

  const currentPoint = useMemo(() => {
    if (sweepPoints.length === 0) return null;
    return (
      sweepPoints.find((p) => p.obsCutoffDay === config.obsCutoffDay) ??
      sweepPoints.reduce((closest, cur) =>
        Math.abs(cur.obsCutoffDay - config.obsCutoffDay) <
        Math.abs(closest.obsCutoffDay - config.obsCutoffDay)
          ? cur
          : closest
      )
    );
  }, [sweepPoints, config.obsCutoffDay]);

  const uncensoredMaxDay = Math.max(0, maxDay - config.horizonDays);
  const nearestUncensoredCutoff = useMemo(() => {
    const uncensored = sweepPoints.filter((p) => !p.isHorizonCensored);
    if (uncensored.length === 0 || uncensored.length === sweepPoints.length) return null;
    return uncensored[uncensored.length - 1].obsCutoffDay;
  }, [sweepPoints]);

  const maxCutoff = sweepPoints[sweepPoints.length - 1]?.obsCutoffDay ?? Math.max(90, maxDay - 60);

  const handleChartClick = (state: unknown) => {
    const st = state as {
      activeLabel?: string | number;
      activePayload?: { payload?: CutoffSensitivityPoint }[];
    } | null;
    const clickedDay =
      st?.activePayload?.[0]?.payload?.obsCutoffDay ??
      (st?.activeLabel !== undefined ? Number(st.activeLabel) : NaN);
    if (Number.isFinite(clickedDay) && clickedDay >= 60) {
      onSelectCutoffDay(clickedDay);
    }
  };

  const deltaR2 =
    optimalPoint && currentPoint ? optimalPoint.rSquared - currentPoint.rSquared : 0;

  return (
    <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="w-4 h-4 text-blue-700 shrink-0" />
            <h2 className="text-sm font-semibold text-slate-900">
              Observation Cutoff Sensitivity (T_obs vs. Model R²)
            </h2>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Sweeps T_obs across Days 60–{maxCutoff} at H = {config.horizonDays}d to locate peak predictive R² before target-window censoring (T_obs + H &gt; {maxDay}d). Click any point to jump to that cutoff.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {optimalPoint && (
            <button
              type="button"
              disabled={config.obsCutoffDay === optimalPoint.obsCutoffDay}
              onClick={() => onSelectCutoffDay(optimalPoint.obsCutoffDay)}
              className="px-3 py-1.5 text-xs font-medium rounded-md border border-blue-200 bg-blue-50/70 text-blue-800 hover:bg-blue-100/80 disabled:opacity-50 disabled:cursor-not-allowed transition-colors inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>
                {config.obsCutoffDay === optimalPoint.obsCutoffDay
                  ? `At Optimal T_obs (Day ${optimalPoint.obsCutoffDay})`
                  : `Apply Optimal (Day ${optimalPoint.obsCutoffDay})`}
              </span>
            </button>
          )}

          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-md">
            <button
              type="button"
              onClick={() => setMetricMode('r2_curves')}
              className={`px-3 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                metricMode === 'r2_curves'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              R² Curves
            </button>
            <button
              type="button"
              onClick={() => setMetricMode('r2_rmse')}
              className={`px-3 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                metricMode === 'r2_rmse'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              R² vs. RMSE
            </button>
          </div>
        </div>
      </div>

      {/* Diagnostic Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-slate-200 border-b border-slate-200 bg-slate-50/40">
        <div className="px-5 py-3">
          <div className="text-[11px] font-medium text-slate-500">
            Active Cutoff (Day {config.obsCutoffDay})
          </div>
          <div className="text-base font-bold font-mono tabular-nums text-slate-900 mt-0.5">
            R² {currentPoint ? currentPoint.rSquared.toFixed(3) : '—'}
            {currentPoint?.holdoutR2 !== null && currentPoint?.holdoutR2 !== undefined && (
              <span className="ml-2 text-xs font-medium text-emerald-700">
                (Holdout {currentPoint.holdoutR2.toFixed(3)})
              </span>
            )}
          </div>
          <div className="text-[11px] font-mono text-slate-500 tabular-nums mt-0.5">
            RMSE ${currentPoint ? currentPoint.rmse.toFixed(2) : '0.00'} · n ={' '}
            {currentPoint ? currentPoint.sampleSize : 0}
          </div>
        </div>

        <div className="px-5 py-3">
          <div className="text-[11px] font-medium text-slate-500">
            Recommended Optimal Cutoff
          </div>
          <div className="text-base font-bold font-mono tabular-nums text-blue-700 mt-0.5">
            {optimalPoint ? `Day ${optimalPoint.obsCutoffDay}` : '—'}
            {optimalPoint && (
              <span className="ml-2 text-xs font-medium text-slate-700">
                R² {optimalPoint.rSquared.toFixed(3)}
              </span>
            )}
          </div>
          <div className="text-[11px] font-mono text-slate-500 tabular-nums mt-0.5">
            {optimalPoint && currentPoint
              ? deltaR2 > 0.001
                ? `+${deltaR2.toFixed(3)} R² vs. current cutoff`
                : 'Matches peak uncensored R²'
              : 'Insufficient points'}
          </div>
        </div>

        <div className="px-5 py-3">
          <div className="text-[11px] font-medium text-slate-500">
            Full Uncensored Horizon Limit
          </div>
          <div className="text-base font-bold font-mono tabular-nums text-slate-900 mt-0.5">
            T_obs ≤ Day {uncensoredMaxDay}
          </div>
          <div
            className={`text-[11px] font-mono tabular-nums mt-0.5 ${
              config.obsCutoffDay + config.horizonDays > maxDay
                ? 'text-amber-700 font-medium'
                : 'text-emerald-700'
            }`}
          >
            {config.obsCutoffDay + config.horizonDays > maxDay
              ? `Active horizon truncated at Day ${maxDay}`
              : `Full ${config.horizonDays}d horizon fits within Day ${maxDay}`}
          </div>
        </div>
      </div>

      {/* Line Chart */}
      <div className="p-5">
        {sweepPoints.length < 2 ? (
          <div className="py-12 text-center text-xs text-slate-500">
            Dataset time span is too short to sweep multiple observation cutoff days.
          </div>
        ) : (
          <>
            <div style={{ width: '100%', height: 290 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={sweepPoints}
                  margin={{ top: 12, right: metricMode === 'r2_rmse' ? 16 : 20, bottom: 20, left: 4 }}
                  onClick={handleChartClick}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis
                    dataKey="obsCutoffDay"
                    tickFormatter={(v) => `Day ${v}`}
                    tick={{
                      fontSize: 11,
                      fill: '#475569',
                      fontFamily: 'JetBrains Mono, monospace',
                    }}
                    axisLine={{ stroke: '#cbd5e1' }}
                    tickLine={false}
                    label={{
                      value: 'Observation Cutoff Day (T_obs)',
                      position: 'insideBottom',
                      offset: -12,
                      fontSize: 11,
                      fill: '#64748b',
                    }}
                  />
                  <YAxis
                    yAxisId="r2"
                    domain={[0, 1]}
                    tickCount={6}
                    tickFormatter={(v) => Number(v).toFixed(2)}
                    width={50}
                    tick={{
                      fontSize: 11,
                      fill: '#475569',
                      fontFamily: 'JetBrains Mono, monospace',
                    }}
                    axisLine={{ stroke: '#cbd5e1' }}
                    tickLine={false}
                    label={{
                      value: 'Model R²',
                      angle: -90,
                      position: 'insideLeft',
                      offset: 8,
                      style: { textAnchor: 'middle', fontSize: 11, fill: '#64748b' },
                    }}
                  />
                  {metricMode === 'r2_rmse' && (
                    <YAxis
                      yAxisId="rmse"
                      orientation="right"
                      tickFormatter={(v) => `$${Math.round(Number(v))}`}
                      width={56}
                      tick={{
                        fontSize: 11,
                        fill: '#b45309',
                        fontFamily: 'JetBrains Mono, monospace',
                      }}
                      axisLine={{ stroke: '#cbd5e1' }}
                      tickLine={false}
                      label={{
                        value: 'RMSE ($)',
                        angle: 90,
                        position: 'insideRight',
                        offset: 6,
                        style: { textAnchor: 'middle', fontSize: 11, fill: '#b45309' },
                      }}
                    />
                  )}
                  <ReferenceLine
                    x={config.obsCutoffDay}
                    yAxisId="r2"
                    stroke="#1d4ed8"
                    strokeWidth={1.75}
                    label={{
                      value: `Active (Day ${config.obsCutoffDay})`,
                      position: 'top',
                      fill: '#1d4ed8',
                      fontSize: 10,
                      fontFamily: 'JetBrains Mono, monospace',
                    }}
                  />
                  {optimalPoint && optimalPoint.obsCutoffDay !== config.obsCutoffDay && (
                    <ReferenceLine
                      x={optimalPoint.obsCutoffDay}
                      yAxisId="r2"
                      stroke="#059669"
                      strokeDasharray="4 4"
                      strokeWidth={1.5}
                      label={{
                        value: `Optimal (Day ${optimalPoint.obsCutoffDay})`,
                        position: 'top',
                        fill: '#059669',
                        fontSize: 10,
                        fontFamily: 'JetBrains Mono, monospace',
                      }}
                    />
                  )}
                  {nearestUncensoredCutoff !== null && (
                    <ReferenceLine
                      x={nearestUncensoredCutoff}
                      yAxisId="r2"
                      stroke="#d97706"
                      strokeDasharray="2 3"
                      strokeWidth={1.25}
                    />
                  )}
                  <Tooltip
                    content={({ active, payload }) => {
                      if (!active || !payload || payload.length === 0) return null;
                      const pt = payload[0]?.payload as CutoffSensitivityPoint | undefined;
                      if (!pt) return null;
                      return (
                        <div className="bg-white border border-slate-200 rounded-md shadow-md px-3 py-2 text-xs space-y-1">
                          <div className="flex items-center justify-between gap-4">
                            <span className="font-mono font-semibold text-slate-900">
                              T_obs = Day {pt.obsCutoffDay}
                            </span>
                            <span className="font-mono text-[11px] text-slate-500">
                              Horizon {pt.obsCutoffDay + 1}–{pt.horizonEndDay}d
                            </span>
                          </div>
                          <div className="font-mono text-blue-700 font-semibold tabular-nums">
                            OLS R²: {pt.rSquared.toFixed(3)}
                          </div>
                          {pt.holdoutR2 !== null && (
                            <div className="font-mono text-emerald-700 font-semibold tabular-nums">
                              Holdout (Val/Test) R²: {pt.holdoutR2.toFixed(3)}
                            </div>
                          )}
                          <div className="font-mono text-slate-700 tabular-nums">
                            RMSE: ${pt.rmse.toFixed(2)} · n = {pt.sampleSize}
                          </div>
                          <div className="font-mono text-slate-500 tabular-nums">
                            Zero-spend horizon: {(pt.zeroTargetRate * 100).toFixed(1)}%
                          </div>
                          {pt.isHorizonCensored && (
                            <div className="text-[11px] text-amber-700 font-medium pt-0.5 border-t border-slate-100">
                              Right-censored: horizon exceeds Day {maxDay}
                            </div>
                          )}
                        </div>
                      );
                    }}
                  />
                  <Line
                    yAxisId="r2"
                    type="monotone"
                    dataKey="rSquared"
                    name="OLS R²"
                    stroke="#1d4ed8"
                    strokeWidth={2.5}
                    dot={{ r: 3.5, fill: '#1d4ed8', strokeWidth: 0 }}
                    activeDot={{ r: 5.5, fill: '#1d4ed8', stroke: '#ffffff', strokeWidth: 2 }}
                    isAnimationActive={false}
                  />
                  {metricMode === 'r2_curves' && hasHoldout && (
                    <Line
                      yAxisId="r2"
                      type="monotone"
                      dataKey="holdoutR2"
                      name="Holdout (Val/Test) R²"
                      stroke="#059669"
                      strokeWidth={2}
                      strokeDasharray="5 3"
                      dot={{ r: 3, fill: '#059669', strokeWidth: 0 }}
                      activeDot={{ r: 5, fill: '#059669', stroke: '#ffffff', strokeWidth: 2 }}
                      isAnimationActive={false}
                    />
                  )}
                  {metricMode === 'r2_rmse' && (
                    <Line
                      yAxisId="rmse"
                      type="monotone"
                      dataKey="rmse"
                      name="OLS RMSE ($)"
                      stroke="#d97706"
                      strokeWidth={2}
                      dot={{ r: 3, fill: '#d97706', strokeWidth: 0 }}
                      activeDot={{ r: 5, fill: '#d97706', stroke: '#ffffff', strokeWidth: 2 }}
                      isAnimationActive={false}
                    />
                  )}
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* Footer Legend */}
            <div className="pt-3 mt-2 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3 text-[11px] text-slate-600">
              <div className="flex flex-wrap items-center gap-4">
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-3.5 h-0.5 bg-blue-700 inline-block" aria-hidden="true" />
                  <span>OLS R² (fitted cohort)</span>
                </span>
                {metricMode === 'r2_curves' && hasHoldout && (
                  <span className="inline-flex items-center gap-1.5">
                    <span
                      className="w-3.5 h-0.5 border-t-2 border-dashed border-emerald-600 inline-block"
                      aria-hidden="true"
                    />
                    <span>Holdout (Val/Test) R²</span>
                  </span>
                )}
                {metricMode === 'r2_rmse' && (
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-3.5 h-0.5 bg-amber-600 inline-block" aria-hidden="true" />
                    <span>OLS RMSE ($)</span>
                  </span>
                )}
                {nearestUncensoredCutoff !== null && (
                  <span className="inline-flex items-center gap-1.5 text-amber-700">
                    <span
                      className="w-3.5 h-0.5 border-t-2 border-dotted border-amber-600 inline-block"
                      aria-hidden="true"
                    />
                    <span>Uncensored horizon limit (Day {nearestUncensoredCutoff})</span>
                  </span>
                )}
              </div>

              <span className="text-slate-500">
                Reacts live to selected predictors, normalization, and winsorization
              </span>
            </div>
          </>
        )}
      </div>
    </section>
  );
};
