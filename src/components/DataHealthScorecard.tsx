import React, { useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ShieldAlert,
  XCircle,
} from 'lucide-react';
import { DataHealthCheckItem, RawEvent } from '../types/curation';
import { computeDataHealthScorecard } from '../engine/curationEngine';

interface DataHealthScorecardProps {
  events: RawEvent[];
}

function polarToCartesian(
  cx: number,
  cy: number,
  r: number,
  scoreVal: number
): { x: number; y: number } {
  const clamped = Math.max(0, Math.min(100, scoreVal));
  const rad = ((180 - clamped * 1.8) * Math.PI) / 180;
  return {
    x: cx + r * Math.cos(rad),
    y: cy - r * Math.sin(rad),
  };
}

function describeScoreArc(
  cx: number,
  cy: number,
  r: number,
  startScore: number,
  endScore: number
): string {
  const s1 = Math.max(0, Math.min(100, startScore));
  const s2 = Math.max(0, Math.min(100, endScore));
  if (s2 <= s1) return '';
  const start = polarToCartesian(cx, cy, r, s1);
  const end = polarToCartesian(cx, cy, r, s2);
  return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${r} ${r} 0 0 1 ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
}

export const DataHealthScorecard: React.FC<DataHealthScorecardProps> = ({
  events,
}) => {
  const scorecard = useMemo(() => computeDataHealthScorecard(events), [events]);
  const [filterMode, setFilterMode] = useState<'all' | 'flagged'>('all');
  const [selectedCheckId, setSelectedCheckId] = useState<
    DataHealthCheckItem['id'] | null
  >(null);

  const visibleChecks = useMemo(() => {
    if (filterMode === 'flagged') {
      return scorecard.checks.filter((c) => c.status !== 'pass');
    }
    return scorecard.checks;
  }, [scorecard.checks, filterMode]);

  const activeCheck = useMemo(() => {
    if (visibleChecks.length === 0) return null;
    return (
      visibleChecks.find((c) => c.id === selectedCheckId) ??
      visibleChecks.find((c) => c.status !== 'pass') ??
      visibleChecks[0]
    );
  }, [visibleChecks, selectedCheckId]);

  const tierStyle =
    scorecard.tier === 'healthy'
      ? {
          stroke: '#059669',
          textClass: 'text-emerald-700',
          icon: CheckCircle2,
        }
      : scorecard.tier === 'caution'
      ? {
          stroke: '#d97706',
          textClass: 'text-amber-700',
          icon: AlertTriangle,
        }
      : {
          stroke: '#e11d48',
          textClass: 'text-rose-700',
          icon: ShieldAlert,
        };

  const TierIcon = tierStyle.icon;

  // Gauge geometry
  const cx = 130;
  const cy = 126;
  const radius = 88;
  const needleEnd = polarToCartesian(cx, cy, radius - 14, scorecard.score);
  const maxBucketCount = Math.max(
    1,
    ...scorecard.timestampBuckets.map((b) => b.count)
  );

  return (
    <section
      aria-label="Data Health Scorecard"
      className="bg-white border border-slate-200 rounded-lg overflow-hidden"
    >
      {/* Header */}
      <div className="px-6 py-4 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-md bg-slate-100 border border-slate-200 flex items-center justify-center shrink-0 mt-0.5">
            <Activity className="w-4 h-4 text-slate-700" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2.5">
              <h2 className="text-sm font-semibold text-slate-900">
                Data Health Scorecard &amp; Sanity Diagnostics
              </h2>
              <span
                className={`inline-flex items-center gap-1 text-xs font-semibold ${tierStyle.textClass}`}
              >
                <TierIcon className="w-3.5 h-3.5" />
                <span>{scorecard.tierLabel}</span>
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5 font-mono tabular-nums">
              {scorecard.totalEvents.toLocaleString()} events ·{' '}
              {scorecard.uniqueEntities.toLocaleString()} entities ·{' '}
              {scorecard.passCount} pass · {scorecard.warnCount} warn ·{' '}
              {scorecard.failCount} fail
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-md self-start shrink-0">
          <button
            type="button"
            onClick={() => setFilterMode('all')}
            className={`px-3 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
              filterMode === 'all'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            All Checks ({scorecard.checks.length})
          </button>
          <button
            type="button"
            onClick={() => setFilterMode('flagged')}
            className={`px-3 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
              filterMode === 'flagged'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Flagged ({scorecard.warnCount + scorecard.failCount})
          </button>
        </div>
      </div>

      {/* Main Grid: Gauge Chart (Left) + Sanity Check Matrix (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-slate-200">
        {/* Gauge + Timestamp Distribution Mini Chart */}
        <div className="lg:col-span-4 p-5 flex flex-col justify-between gap-5 bg-slate-50/40">
          <div>
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="font-semibold text-slate-800">
                Composite Health Gauge
              </span>
              <span className="font-mono text-[11px] text-slate-500 tabular-nums">
                0–100 Scale
              </span>
            </div>

            <div className="flex justify-center pt-1">
              <svg
                viewBox="0 0 260 156"
                className="w-full max-w-[260px] overflow-visible"
                role="img"
                aria-label={`Data health gauge showing ${scorecard.score} out of 100 (${scorecard.tierLabel})`}
              >
                {/* Background zone arcs */}
                <path
                  d={describeScoreArc(cx, cy, radius, 0, 55)}
                  fill="none"
                  stroke="#ffe4e6"
                  strokeWidth={14}
                  strokeLinecap="butt"
                />
                <path
                  d={describeScoreArc(cx, cy, radius, 55, 80)}
                  fill="none"
                  stroke="#fef3c7"
                  strokeWidth={14}
                  strokeLinecap="butt"
                />
                <path
                  d={describeScoreArc(cx, cy, radius, 80, 100)}
                  fill="none"
                  stroke="#d1fae5"
                  strokeWidth={14}
                  strokeLinecap="butt"
                />

                {/* Active score arc */}
                {scorecard.score > 0 && (
                  <path
                    d={describeScoreArc(cx, cy, radius, 0, scorecard.score)}
                    fill="none"
                    stroke={tierStyle.stroke}
                    strokeWidth={14}
                    strokeLinecap="round"
                  />
                )}

                {/* Zone threshold ticks */}
                {[0, 55, 80, 100].map((tick) => {
                  const inner = polarToCartesian(cx, cy, radius - 11, tick);
                  const outer = polarToCartesian(cx, cy, radius + 11, tick);
                  const lbl = polarToCartesian(cx, cy, radius + 22, tick);
                  return (
                    <g key={tick}>
                      <line
                        x1={inner.x}
                        y1={inner.y}
                        x2={outer.x}
                        y2={outer.y}
                        stroke="#94a3b8"
                        strokeWidth={1.25}
                      />
                      <text
                        x={lbl.x}
                        y={lbl.y + 3}
                        textAnchor="middle"
                        className="fill-slate-500 text-[10px] font-mono"
                      >
                        {tick}
                      </text>
                    </g>
                  );
                })}

                {/* Pointer Needle */}
                <line
                  x1={cx}
                  y1={cy}
                  x2={needleEnd.x}
                  y2={needleEnd.y}
                  stroke="#0f172a"
                  strokeWidth={2.5}
                  strokeLinecap="round"
                />
                <circle cx={cx} cy={cy} r={5} fill="#0f172a" />
                <circle cx={cx} cy={cy} r={2} fill="#ffffff" />

                {/* Central Score Readout */}
                <text
                  x={cx}
                  y={cy - 22}
                  textAnchor="middle"
                  className="fill-slate-900 text-[28px] font-bold font-mono"
                >
                  {scorecard.score}
                </text>
                <text
                  x={cx}
                  y={cy + 20}
                  textAnchor="middle"
                  className="fill-slate-500 text-[11px] font-mono"
                >
                  HEALTH SCORE / 100
                </text>
              </svg>
            </div>
          </div>

          {/* Temporal Timestamp Distribution Preview */}
          <div className="pt-4 border-t border-slate-200">
            <div className="flex items-center justify-between text-xs mb-2">
              <span className="font-semibold text-slate-800">
                Timestamp Horizon Density
              </span>
              <span className="font-mono text-[11px] text-slate-500 tabular-nums">
                CV {scorecard.timestampBinCv.toFixed(2)} · Peak{' '}
                {(scorecard.maxSingleDayShare * 100).toFixed(1)}%
              </span>
            </div>
            {scorecard.timestampBuckets.length > 0 ? (
              <div className="h-20 flex items-end gap-1.5 pt-2">
                {scorecard.timestampBuckets.map((b) => {
                  const pct = Math.max(
                    8,
                    Math.round((b.count / maxBucketCount) * 100)
                  );
                  return (
                    <div
                      key={b.label}
                      className="flex-1 flex flex-col items-center justify-end h-full"
                      title={`${b.label}: ${b.count} events (${(b.share * 100).toFixed(1)}%)`}
                    >
                      <div
                        className={`w-full rounded-t-xs ${
                          scorecard.timestampBinCv > 0.95
                            ? 'bg-rose-600'
                            : scorecard.timestampBinCv > 0.55
                            ? 'bg-amber-500'
                            : 'bg-blue-700'
                        }`}
                        style={{ height: `${pct}%` }}
                      />
                      <span className="text-[9px] font-mono text-slate-500 mt-1 truncate max-w-full">
                        {b.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="py-4 text-center text-xs text-slate-500">
                No valid timestamps recorded.
              </div>
            )}
          </div>
        </div>

        {/* Sanity Check Table & Detail Inspector */}
        <div className="lg:col-span-8 flex flex-col justify-between">
          {visibleChecks.length === 0 ? (
            <div className="p-10 flex flex-col items-center justify-center text-center">
              <CheckCircle2 className="w-7 h-7 text-emerald-600 mb-2" />
              <div className="text-sm font-semibold text-slate-900">
                Zero Sanity Anomalies Flagged
              </div>
              <p className="text-xs text-slate-500 mt-1 max-w-md">
                All {scorecard.checks.length} automated sanity checks passed across negative rewards, duplicate entity keys, timestamp spread, numeric bounds, and propensity support.
              </p>
              <button
                type="button"
                onClick={() => setFilterMode('all')}
                className="mt-3 px-3 py-1.5 text-xs font-medium text-blue-700 bg-slate-50 border border-slate-200 rounded hover:bg-blue-50 transition-colors"
              >
                Show All {scorecard.checks.length} Checks
              </button>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-600">
                      <th className="py-2.5 px-4">Sanity Check</th>
                      <th className="py-2.5 px-3">Category</th>
                      <th className="py-2.5 px-3 text-right">Observed Metric</th>
                      <th className="py-2.5 px-3 text-right">Deduction</th>
                      <th className="py-2.5 px-4 text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 text-xs">
                    {visibleChecks.map((chk) => {
                      const isSelected = activeCheck?.id === chk.id;
                      return (
                        <tr
                          key={chk.id}
                          onClick={() => setSelectedCheckId(chk.id)}
                          className={`cursor-pointer transition-colors ${
                            isSelected
                              ? 'bg-blue-50/70'
                              : 'bg-white hover:bg-slate-50'
                          }`}
                        >
                          <td className="py-2.5 px-4 font-medium text-slate-900">
                            <div className="flex items-center gap-2">
                              {chk.status === 'pass' && (
                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                              )}
                              {chk.status === 'warn' && (
                                <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                              )}
                              {chk.status === 'fail' && (
                                <XCircle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                              )}
                              <span>{chk.label}</span>
                            </div>
                          </td>
                          <td className="py-2.5 px-3 text-slate-500 whitespace-nowrap">
                            {chk.category}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-800 whitespace-nowrap">
                            {chk.metricSummary}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                            <span
                              className={
                                chk.scoreDeduction > 0
                                  ? 'text-rose-700 font-semibold'
                                  : 'text-slate-400'
                              }
                            >
                              {chk.scoreDeduction > 0
                                ? `-${chk.scoreDeduction} pts`
                                : '0 pts'}
                            </span>
                          </td>
                          <td className="py-2.5 px-4 text-right font-semibold whitespace-nowrap">
                            <span
                              className={
                                chk.status === 'pass'
                                  ? 'text-emerald-700'
                                  : chk.status === 'warn'
                                  ? 'text-amber-700'
                                  : 'text-rose-700'
                              }
                            >
                              {chk.status === 'pass'
                                ? 'Pass'
                                : chk.status === 'warn'
                                ? 'Warning'
                                : 'Fail'}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Selected Check Diagnostic Footer */}
              {activeCheck && (
                <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-200 text-xs space-y-1.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold text-slate-900">
                      {activeCheck.label}
                    </span>
                    <span className="font-mono text-[11px] text-slate-500">
                      Rule: {activeCheck.thresholdRule}
                    </span>
                  </div>
                  <p className="text-slate-600 leading-relaxed">
                    {activeCheck.detail}
                  </p>
                  {activeCheck.sampleEntities.length > 0 && (
                    <div className="text-[11px] font-mono text-slate-600 pt-0.5">
                      Sample affected entities:{' '}
                      <span className="text-slate-900 font-semibold">
                        {activeCheck.sampleEntities.join(', ')}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
};
