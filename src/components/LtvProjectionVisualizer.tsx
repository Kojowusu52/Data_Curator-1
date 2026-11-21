import React, { useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Search, TrendingUp } from 'lucide-react';
import { RegressionConfig, RegressionResult, RegressionRow } from '../types/curation';

interface LtvProjectionVisualizerProps {
  config: RegressionConfig;
  result: RegressionResult;
}

type ProjectionViewMode = 'forward' | 'calibration';
type RankMode = 'projected' | 'observed' | 'upside';

interface ScatterDatum {
  entityId: string;
  split: RegressionRow['split'];
  x: number;
  y: number;
  observedHistorical: number;
  projectedFuture: number;
  projectedTotal: number;
  actualHorizon: number;
  predictedHorizon: number;
  trailingTxCount: number;
}

interface BarDatum {
  entityId: string;
  split: RegressionRow['split'];
  observed: number;
  projected: number;
  total: number;
  actualHorizon: number;
  predictedHorizon: number;
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

export const LtvProjectionVisualizer: React.FC<LtvProjectionVisualizerProps> = ({
  config,
  result,
}) => {
  const [viewMode, setViewMode] = useState<ProjectionViewMode>('forward');
  const [rankMode, setRankMode] = useState<RankMode>('projected');
  const [entityQuery, setEntityQuery] = useState('');
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);

  const rows = result.rows;
  const horizonEndDay = result.maxObservedDay + config.horizonDays;

  const summary = useMemo(() => {
    const count = rows.length || 1;
    const totalObserved = rows.reduce((acc, r) => acc + r.currentObservedLtv, 0);
    const totalProjected = rows.reduce((acc, r) => acc + r.projectedFutureLtv, 0);
    const totalCumulative = totalObserved + totalProjected;
    const liftPct = totalObserved > 0 ? (totalProjected / totalObserved) * 100 : 0;
    const expandingCount = rows.filter(
      (r) => r.projectedFutureLtv > r.currentObservedLtv
    ).length;
    const positiveProjectionCount = rows.filter((r) => r.projectedFutureLtv > 0).length;

    const absErrorSum = rows.reduce(
      (acc, r) => acc + Math.abs(r.predictedHorizonLtv - r.targetLtvWinsorized),
      0
    );
    const mae = absErrorSum / count;

    return {
      totalObserved,
      totalProjected,
      totalCumulative,
      meanObserved: totalObserved / count,
      meanProjected: totalProjected / count,
      liftPct,
      expandingCount,
      positiveProjectionCount,
      mae,
    };
  }, [rows]);

  const scatterBySplit = useMemo(() => {
    const train: ScatterDatum[] = [];
    const val: ScatterDatum[] = [];
    const test: ScatterDatum[] = [];
    let maxCoord = 100;

    for (const r of rows) {
      const x =
        viewMode === 'forward' ? r.currentObservedLtv : r.targetLtvWinsorized;
      const y =
        viewMode === 'forward' ? r.projectedFutureLtv : r.predictedHorizonLtv;
      maxCoord = Math.max(maxCoord, x, y);

      const item: ScatterDatum = {
        entityId: r.entityId,
        split: r.split,
        x,
        y,
        observedHistorical: r.currentObservedLtv,
        projectedFuture: r.projectedFutureLtv,
        projectedTotal:
          Math.round((r.currentObservedLtv + r.projectedFutureLtv) * 100) / 100,
        actualHorizon: r.targetLtvWinsorized,
        predictedHorizon: r.predictedHorizonLtv,
        trailingTxCount: r.trailingTxCount,
      };

      if (r.split === 'train') train.push(item);
      else if (r.split === 'val') val.push(item);
      else test.push(item);
    }

    const paddedMax = Math.ceil((maxCoord * 1.08) / 50) * 50;
    return { train, val, test, axisMax: Math.max(100, paddedMax) };
  }, [rows, viewMode]);

  const barData = useMemo<BarDatum[]>(() => {
    const q = entityQuery.trim().toLowerCase();
    const pool = q
      ? rows.filter((r) => r.entityId.toLowerCase().includes(q))
      : rows;

    const sorted = [...pool].sort((a, b) => {
      if (viewMode === 'calibration') {
        if (rankMode === 'observed') {
          return b.targetLtvWinsorized - a.targetLtvWinsorized;
        }
        if (rankMode === 'upside') {
          return (
            Math.abs(b.predictedHorizonLtv - b.targetLtvWinsorized) -
            Math.abs(a.predictedHorizonLtv - a.targetLtvWinsorized)
          );
        }
        return b.predictedHorizonLtv - a.predictedHorizonLtv;
      }

      if (rankMode === 'observed') {
        return b.currentObservedLtv - a.currentObservedLtv;
      }
      if (rankMode === 'upside') {
        return (
          b.projectedFutureLtv -
          b.currentObservedLtv -
          (a.projectedFutureLtv - a.currentObservedLtv)
        );
      }
      return b.projectedFutureLtv - a.projectedFutureLtv;
    });

    const topRows = sorted.slice(0, 9);
    if (
      selectedEntityId &&
      !topRows.some((r) => r.entityId === selectedEntityId)
    ) {
      const selected = rows.find((r) => r.entityId === selectedEntityId);
      if (selected) {
        topRows.pop();
        topRows.push(selected);
      }
    }

    return topRows.map((r) => ({
      entityId: r.entityId,
      split: r.split,
      observed: r.currentObservedLtv,
      projected: r.projectedFutureLtv,
      total: Math.round((r.currentObservedLtv + r.projectedFutureLtv) * 100) / 100,
      actualHorizon: r.targetLtvWinsorized,
      predictedHorizon: r.predictedHorizonLtv,
    }));
  }, [rows, entityQuery, rankMode, viewMode, selectedEntityId]);

  const spotlightRow = useMemo(() => {
    if (rows.length === 0) return null;
    if (selectedEntityId) {
      const found = rows.find((r) => r.entityId === selectedEntityId);
      if (found) return found;
    }
    if (barData.length > 0) {
      return rows.find((r) => r.entityId === barData[0].entityId) ?? rows[0];
    }
    return rows[0];
  }, [rows, selectedEntityId, barData]);

  const handleScatterClick = (point: unknown) => {
    const p = point as { payload?: ScatterDatum; entityId?: string } | undefined;
    const id = p?.payload?.entityId ?? p?.entityId;
    if (id) {
      setSelectedEntityId(id);
    }
  };

  return (
    <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-blue-700 shrink-0" />
            <h2 className="text-sm font-semibold text-slate-900">
              OLS LTV Future Value Projections vs. Observed Historical Spend
            </h2>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            {viewMode === 'forward'
              ? `Applies the fitted ${result.linearFit.features.length}-feature OLS model (R² = ${result.linearFit.rSquared.toFixed(
                  3
                )}) to each current user's trailing ${config.obsCutoffDay}d window to project upcoming +${config.horizonDays}d spend (Days ${
                  result.maxObservedDay + 1
                }–${horizonEndDay}) against cumulative observed history (Days 0–${result.maxObservedDay}).`
              : `Backtests OLS predicted horizon LTV against observed actual spend over (Day ${
                  config.obsCutoffDay
                }, Day ${config.obsCutoffDay + config.horizonDays}] across ${
                  rows.length
                } materialized entities.`}
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-md self-start lg:self-auto">
          <button
            type="button"
            onClick={() => setViewMode('forward')}
            className={`px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap ${
              viewMode === 'forward'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Forward Projection (+{config.horizonDays}d)
          </button>
          <button
            type="button"
            onClick={() => setViewMode('calibration')}
            className={`px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap ${
              viewMode === 'calibration'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Actual vs. Predicted Fit
          </button>
        </div>
      </div>

      {/* Portfolio Summary Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 divide-y lg:divide-y-0 lg:divide-x divide-slate-200 border-b border-slate-200 bg-slate-50/40">
        <div className="px-5 py-3.5">
          <div className="text-[11px] font-medium text-slate-500">
            Observed Historical Value (0–{result.maxObservedDay}d)
          </div>
          <div className="text-lg font-bold font-mono tabular-nums text-slate-900 mt-0.5">
            {formatCurrencyFull(summary.totalObserved)}
          </div>
          <div className="text-[11px] font-mono text-slate-500 tabular-nums mt-0.5">
            Mean {formatCurrencyFull(summary.meanObserved)} / user
          </div>
        </div>

        <div className="px-5 py-3.5">
          <div className="text-[11px] font-medium text-slate-500">
            Projected Next-{config.horizonDays}d Value
          </div>
          <div className="text-lg font-bold font-mono tabular-nums text-blue-700 mt-0.5">
            {formatCurrencyFull(summary.totalProjected)}
          </div>
          <div className="text-[11px] font-mono text-slate-500 tabular-nums mt-0.5">
            Mean {formatCurrencyFull(summary.meanProjected)} / user
          </div>
        </div>

        <div className="px-5 py-3.5">
          <div className="text-[11px] font-medium text-slate-500">
            Projected Cumulative LTV
          </div>
          <div className="text-lg font-bold font-mono tabular-nums text-slate-900 mt-0.5">
            {formatCurrencyFull(summary.totalCumulative)}
          </div>
          <div className="text-[11px] font-mono text-emerald-700 tabular-nums mt-0.5">
            +{summary.liftPct.toFixed(1)}% projected horizon lift
          </div>
        </div>

        <div className="px-5 py-3.5">
          <div className="text-[11px] font-medium text-slate-500">
            OLS Fit Accuracy / Growth Cohort
          </div>
          <div className="text-lg font-bold font-mono tabular-nums text-slate-900 mt-0.5">
            R² {result.linearFit.rSquared.toFixed(3)} · MAE ${summary.mae.toFixed(0)}
          </div>
          <div className="text-[11px] font-mono text-slate-500 tabular-nums mt-0.5">
            {summary.expandingCount} expanding · {summary.positiveProjectionCount}/{rows.length} active
          </div>
        </div>
      </div>

      {rows.length < 3 ? (
        <div className="py-12 text-center text-xs text-slate-500">
          At least 3 materialized entities are required to generate OLS LTV projections. Adjust T_obs or split filters.
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-12 divide-y xl:divide-y-0 xl:divide-x divide-slate-200">
          {/* Left: Scatter Chart */}
          <div className="xl:col-span-7 p-5">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <div>
                <h3 className="text-xs font-semibold text-slate-900">
                  {viewMode === 'forward'
                    ? 'Entity Scatter: Observed Historical Spend vs. Projected Future LTV'
                    : 'Calibration Scatter: Observed Horizon LTV vs. OLS Predicted LTV'}
                </h3>
                <p className="text-[11px] text-slate-500">
                  {viewMode === 'forward'
                    ? 'Points above the dashed 1:1 parity line are projected to generate more value next horizon than cumulative history to date.'
                    : 'Points clustered along the dashed 1:1 line indicate calibrated horizon predictions.'}
                </p>
              </div>

              <div className="flex items-center gap-3 text-[11px] text-slate-600">
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

            <div style={{ width: '100%', height: 330 }}>
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart margin={{ top: 10, right: 18, bottom: 24, left: 6 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis
                    type="number"
                    dataKey="x"
                    domain={[0, scatterBySplit.axisMax]}
                    tickFormatter={formatCurrencyCompact}
                    tick={{ fontSize: 11, fill: '#475569', fontFamily: 'JetBrains Mono, monospace' }}
                    axisLine={{ stroke: '#cbd5e1' }}
                    tickLine={false}
                    label={{
                      value:
                        viewMode === 'forward'
                          ? `Observed Historical Spend (Days 0–${result.maxObservedDay})`
                          : `Observed Horizon LTV (Days ${config.obsCutoffDay + 1}–${
                              config.obsCutoffDay + config.horizonDays
                            })`,
                      position: 'insideBottom',
                      offset: -14,
                      fontSize: 11,
                      fill: '#64748b',
                    }}
                  />
                  <YAxis
                    type="number"
                    dataKey="y"
                    domain={[0, scatterBySplit.axisMax]}
                    tickFormatter={formatCurrencyCompact}
                    width={62}
                    tick={{ fontSize: 11, fill: '#475569', fontFamily: 'JetBrains Mono, monospace' }}
                    axisLine={{ stroke: '#cbd5e1' }}
                    tickLine={false}
                    label={{
                      value:
                        viewMode === 'forward'
                          ? `Projected +${config.horizonDays}d LTV ($)`
                          : 'OLS Predicted LTV ($)',
                      angle: -90,
                      position: 'insideLeft',
                      offset: 4,
                      style: { textAnchor: 'middle', fontSize: 11, fill: '#64748b' },
                    }}
                  />
                  <ReferenceLine
                    segment={[
                      { x: 0, y: 0 },
                      { x: scatterBySplit.axisMax, y: scatterBySplit.axisMax },
                    ]}
                    stroke="#94a3b8"
                    strokeDasharray="4 4"
                    strokeWidth={1.5}
                  />
                  <Tooltip
                    cursor={{ strokeDasharray: '3 3', stroke: '#94a3b8' }}
                    content={({ active, payload }) => {
                      if (!active || !payload || payload.length === 0) return null;
                      const d = payload[0]?.payload as ScatterDatum | undefined;
                      if (!d) return null;
                      const residual = d.predictedHorizon - d.actualHorizon;
                      const pctRatio =
                        d.observedHistorical > 0
                          ? (d.projectedFuture / d.observedHistorical) * 100
                          : 0;
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
                          {viewMode === 'forward' ? (
                            <>
                              <div className="font-mono text-slate-700 tabular-nums">
                                Observed Historical: {formatCurrencyFull(d.observedHistorical)}
                              </div>
                              <div className="font-mono text-blue-700 font-semibold tabular-nums">
                                Projected +{config.horizonDays}d: {formatCurrencyFull(d.projectedFuture)}
                              </div>
                              <div className="font-mono text-slate-600 tabular-nums pt-0.5 border-t border-slate-100">
                                Total Projected: {formatCurrencyFull(d.projectedTotal)} ({pctRatio.toFixed(0)}% ratio)
                              </div>
                            </>
                          ) : (
                            <>
                              <div className="font-mono text-slate-700 tabular-nums">
                                Actual Horizon: {formatCurrencyFull(d.actualHorizon)}
                              </div>
                              <div className="font-mono text-blue-700 font-semibold tabular-nums">
                                OLS Predicted: {formatCurrencyFull(d.predictedHorizon)}
                              </div>
                              <div className="font-mono text-slate-600 tabular-nums pt-0.5 border-t border-slate-100">
                                Residual (Pred - Act): {residual >= 0 ? '+' : ''}
                                {formatCurrencyFull(residual)}
                              </div>
                            </>
                          )}
                        </div>
                      );
                    }}
                  />
                  {scatterBySplit.train.length > 0 && (
                    <Scatter
                      name="Train"
                      data={scatterBySplit.train}
                      fill="#1d4ed8"
                      fillOpacity={0.72}
                      isAnimationActive={false}
                      onClick={handleScatterClick}
                    />
                  )}
                  {scatterBySplit.val.length > 0 && (
                    <Scatter
                      name="Validation"
                      data={scatterBySplit.val}
                      fill="#d97706"
                      fillOpacity={0.8}
                      isAnimationActive={false}
                      onClick={handleScatterClick}
                    />
                  )}
                  {scatterBySplit.test.length > 0 && (
                    <Scatter
                      name="Test"
                      data={scatterBySplit.test}
                      fill="#059669"
                      fillOpacity={0.8}
                      isAnimationActive={false}
                      onClick={handleScatterClick}
                    />
                  )}
                </ScatterChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Right: Top / Inspected Users Bar Comparison */}
          <div className="xl:col-span-5 p-5 flex flex-col justify-between gap-4">
            <div>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3">
                <h3 className="text-xs font-semibold text-slate-900">
                  {viewMode === 'forward'
                    ? 'Entity Value Breakdown (Observed + Projected)'
                    : 'Entity Horizon Comparison (Actual vs. Predicted)'}
                </h3>

                <div className="flex items-center gap-1 p-0.5 bg-slate-100 rounded text-[11px]">
                  {(
                    [
                      { id: 'projected', label: viewMode === 'forward' ? 'Top Proj' : 'Top Pred' },
                      { id: 'observed', label: 'Top Hist' },
                      { id: 'upside', label: viewMode === 'forward' ? 'Top Lift' : 'Max Err' },
                    ] as { id: RankMode; label: string }[]
                  ).map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setRankMode(opt.id)}
                      className={`px-2 py-1 rounded transition-colors whitespace-nowrap ${
                        rankMode === opt.id
                          ? 'bg-white text-slate-900 font-semibold shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="relative mb-3">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={entityQuery}
                  onChange={(e) => setEntityQuery(e.target.value)}
                  placeholder="Filter or inspect Entity ID (click any point)..."
                  className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                />
              </div>

              {barData.length === 0 ? (
                <div className="py-12 text-center text-xs text-slate-500">
                  No entities match &ldquo;{entityQuery}&rdquo;.
                </div>
              ) : (
                <div style={{ width: '100%', height: 245 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={barData}
                      layout="vertical"
                      margin={{ top: 2, right: 12, bottom: 2, left: 4 }}
                    >
                      <CartesianGrid
                        strokeDasharray="3 3"
                        horizontal={false}
                        stroke="#e2e8f0"
                      />
                      <XAxis
                        type="number"
                        tickFormatter={formatCurrencyCompact}
                        tick={{
                          fontSize: 10,
                          fill: '#475569',
                          fontFamily: 'JetBrains Mono, monospace',
                        }}
                        axisLine={{ stroke: '#cbd5e1' }}
                        tickLine={false}
                      />
                      <YAxis
                        type="category"
                        dataKey="entityId"
                        width={76}
                        tick={{
                          fontSize: 10,
                          fill: '#0f172a',
                          fontFamily: 'JetBrains Mono, monospace',
                        }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <Tooltip
                        cursor={{ fill: '#f8fafc' }}
                        content={({ active, payload }) => {
                          if (!active || !payload || payload.length === 0) return null;
                          const d = payload[0]?.payload as BarDatum | undefined;
                          if (!d) return null;
                          return (
                            <div className="bg-white border border-slate-200 rounded-md shadow-md px-3 py-2 text-xs space-y-1">
                              <div className="font-mono font-semibold text-slate-900">
                                {d.entityId} ({d.split})
                              </div>
                              {viewMode === 'forward' ? (
                                <>
                                  <div className="font-mono text-slate-700 tabular-nums">
                                    Observed Historical: {formatCurrencyFull(d.observed)}
                                  </div>
                                  <div className="font-mono text-blue-700 font-semibold tabular-nums">
                                    Projected +{config.horizonDays}d: {formatCurrencyFull(d.projected)}
                                  </div>
                                  <div className="font-mono text-slate-900 font-semibold tabular-nums pt-0.5 border-t border-slate-100">
                                    Cumulative Projected: {formatCurrencyFull(d.total)}
                                  </div>
                                </>
                              ) : (
                                <>
                                  <div className="font-mono text-slate-700 tabular-nums">
                                    Actual Horizon: {formatCurrencyFull(d.actualHorizon)}
                                  </div>
                                  <div className="font-mono text-blue-700 font-semibold tabular-nums">
                                    OLS Predicted: {formatCurrencyFull(d.predictedHorizon)}
                                  </div>
                                </>
                              )}
                            </div>
                          );
                        }}
                      />
                      {viewMode === 'forward' ? (
                        <>
                          <Bar
                            dataKey="observed"
                            stackId="ltv"
                            fill="#334155"
                            radius={[0, 0, 0, 0]}
                            isAnimationActive={false}
                          />
                          <Bar
                            dataKey="projected"
                            stackId="ltv"
                            fill="#1d4ed8"
                            radius={[0, 3, 3, 0]}
                            isAnimationActive={false}
                          />
                        </>
                      ) : (
                        <>
                          <Bar
                            dataKey="actualHorizon"
                            fill="#334155"
                            radius={[0, 3, 3, 0]}
                            isAnimationActive={false}
                          />
                          <Bar
                            dataKey="predictedHorizon"
                            fill="#1d4ed8"
                            radius={[0, 3, 3, 0]}
                            isAnimationActive={false}
                          />
                        </>
                      )}
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            {/* Selected Entity Spotlight & Legend */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between text-[11px] text-slate-600">
                <div className="flex items-center gap-3">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-xs bg-slate-700 inline-block" aria-hidden="true" />
                    <span>
                      {viewMode === 'forward' ? 'Observed Historical' : 'Actual Horizon'}
                    </span>
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-xs bg-blue-700 inline-block" aria-hidden="true" />
                    <span>
                      {viewMode === 'forward'
                        ? `Projected +${config.horizonDays}d`
                        : 'OLS Predicted'}
                    </span>
                  </span>
                </div>
                {selectedEntityId && (
                  <button
                    type="button"
                    onClick={() => setSelectedEntityId(null)}
                    className="text-blue-700 hover:text-blue-800 font-medium"
                  >
                    Clear selection
                  </button>
                )}
              </div>

              {spotlightRow && (
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-md text-xs space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-mono font-semibold text-slate-900">
                      Spotlight: {spotlightRow.entityId}{' '}
                      <span className="font-normal text-slate-500">
                        · {spotlightRow.split} · {spotlightRow.trailingTxCount} recent tx
                      </span>
                    </div>
                    <span className="font-mono text-[11px] text-slate-500 tabular-nums">
                      Eng {spotlightRow.meanEngagementObs.toFixed(2)} · AOV $
                      {spotlightRow.avgOrderValueObs.toFixed(0)}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 pt-1 border-t border-slate-200/80 font-mono tabular-nums">
                    <div>
                      <div className="text-[10px] font-sans text-slate-500">Observed Hist</div>
                      <div className="font-semibold text-slate-900">
                        {formatCurrencyFull(spotlightRow.currentObservedLtv)}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] font-sans text-slate-500">
                        Projected +{config.horizonDays}d
                      </div>
                      <div className="font-semibold text-blue-700">
                        {formatCurrencyFull(spotlightRow.projectedFutureLtv)}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] font-sans text-slate-500">Total Projected</div>
                      <div className="font-semibold text-slate-900">
                        {formatCurrencyFull(
                          spotlightRow.currentObservedLtv + spotlightRow.projectedFutureLtv
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
