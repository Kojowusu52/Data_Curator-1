import React, { useMemo, useState } from 'react';
import { AlertTriangle, BarChart3, CheckCircle2 } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { RawEvent, RegressionConfig, RegressionResult } from '../types/curation';

interface SegmentVarianceVisualizerProps {
  events: RawEvent[];
  config: RegressionConfig;
  result: RegressionResult;
}

type SegmentDimension = 'channel' | 'cohort' | 'action';
type ChartMetricMode = 'variance' | 'stddev';

interface SegmentStat {
  key: string;
  label: string;
  sortOrder: number;
  count: number;
  mean: number;
  variance: number;
  stdDev: number;
  cv: number;
  p95: number;
  max: number;
  varianceRatio: number;
  isHighVolatility: boolean;
}

function quantileSorted(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sorted[base + 1] !== undefined) {
    return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
  }
  return sorted[base];
}

function formatCompactNumber(val: number): string {
  if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(1)}M`;
  if (val >= 1000) return `${(val / 1000).toFixed(1)}k`;
  return String(Math.round(val));
}

export const SegmentVarianceVisualizer: React.FC<SegmentVarianceVisualizerProps> = ({
  events,
  config,
  result,
}) => {
  const [dimension, setDimension] = useState<SegmentDimension>('channel');
  const [metricMode, setMetricMode] = useState<ChartMetricMode>('variance');

  const entityMeta = useMemo(() => {
    const byEntity = new Map<string, RawEvent[]>();
    for (const ev of events) {
      const list = byEntity.get(ev.entityId);
      if (list) list.push(ev);
      else byEntity.set(ev.entityId, [ev]);
    }

    const meta = new Map<
      string,
      { primaryChannel: string; acqMonth: number; primaryAction: string }
    >();

    for (const [entityId, evs] of byEntity.entries()) {
      const sorted = [...evs].sort((a, b) => a.timestampDay - b.timestampDay);
      const firstDay = sorted[0]?.timestampDay ?? 1;
      const acqMonth = Math.floor(Math.max(0, firstDay - 1) / 30);

      // Determine modal channel and action strictly within [0, obsCutoffDay] to prevent leakage
      const obsEvs = sorted.filter((e) => e.timestampDay <= config.obsCutoffDay);
      const source = obsEvs.length > 0 ? obsEvs : sorted;

      const channelCounts = new Map<string, number>();
      const actionCounts = new Map<string, number>();
      for (const e of source) {
        channelCounts.set(e.channel, (channelCounts.get(e.channel) ?? 0) + 1);
        actionCounts.set(e.actionLabel, (actionCounts.get(e.actionLabel) ?? 0) + 1);
      }

      let primaryChannel = source[0]?.channel ?? 'Unknown';
      let maxCh = -1;
      for (const [ch, cnt] of channelCounts.entries()) {
        if (cnt > maxCh) {
          maxCh = cnt;
          primaryChannel = ch;
        }
      }

      let primaryAction = source[0]?.actionLabel ?? 'Organic';
      let maxAct = -1;
      for (const [act, cnt] of actionCounts.entries()) {
        if (cnt > maxAct) {
          maxAct = cnt;
          primaryAction = act;
        }
      }

      meta.set(entityId, { primaryChannel, acqMonth, primaryAction });
    }

    return meta;
  }, [events, config.obsCutoffDay]);

  const { segments, globalVariance, globalStdDev, globalMean } = useMemo(() => {
    const rows = result.rows;
    if (rows.length === 0) {
      return {
        segments: [] as SegmentStat[],
        globalVariance: 0,
        globalStdDev: 0,
        globalMean: 0,
      };
    }

    const allTargets = rows.map((r) => r.targetLtvRaw);
    const gMean = allTargets.reduce((a, b) => a + b, 0) / allTargets.length;
    const gVar =
      allTargets.reduce((acc, v) => acc + (v - gMean) ** 2, 0) /
      allTargets.length;
    const gStd = Math.sqrt(gVar);

    const groups = new Map<
      string,
      { label: string; sortOrder: number; values: number[] }
    >();

    for (const r of rows) {
      const m = entityMeta.get(r.entityId);
      let key = 'Unknown';
      let label = 'Unknown';
      let sortOrder = 0;

      if (dimension === 'channel') {
        key = m?.primaryChannel ?? 'Unknown';
        label = key;
      } else if (dimension === 'cohort') {
        const acqMonth = m?.acqMonth ?? 0;
        key = `M${acqMonth + 1}`;
        const dStart = acqMonth * 30 + 1;
        const dEnd = (acqMonth + 1) * 30;
        label = `M${acqMonth + 1} (d${dStart}–${dEnd})`;
        sortOrder = acqMonth;
      } else {
        key = m?.primaryAction ?? 'Unknown';
        label = key;
      }

      let bucket = groups.get(key);
      if (!bucket) {
        bucket = { label, sortOrder, values: [] };
        groups.set(key, bucket);
      }
      bucket.values.push(r.targetLtvRaw);
    }

    const computed: SegmentStat[] = Array.from(groups.entries()).map(
      ([key, g]) => {
        const n = g.values.length;
        const mean = g.values.reduce((a, b) => a + b, 0) / n;
        const variance =
          g.values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / n;
        const stdDev = Math.sqrt(variance);
        const cv = mean > 1e-6 ? stdDev / mean : 0;
        const sorted = [...g.values].sort((a, b) => a - b);
        const p95 = quantileSorted(sorted, 0.95);
        const max = sorted[sorted.length - 1] ?? 0;
        const varianceRatio = gVar > 1e-6 ? variance / gVar : 1;
        const isHighVolatility =
          n >= 5 && (varianceRatio >= 1.35 || (gVar > 0 && cv >= 1.35));

        return {
          key,
          label: g.label,
          sortOrder: g.sortOrder,
          count: n,
          mean: Math.round(mean * 100) / 100,
          variance: Math.round(variance),
          stdDev: Math.round(stdDev * 100) / 100,
          cv: Math.round(cv * 100) / 100,
          p95: Math.round(p95 * 100) / 100,
          max: Math.round(max * 100) / 100,
          varianceRatio: Math.round(varianceRatio * 100) / 100,
          isHighVolatility,
        };
      }
    );

    if (dimension === 'cohort') {
      computed.sort((a, b) => a.sortOrder - b.sortOrder);
    } else {
      computed.sort((a, b) => b.variance - a.variance);
    }

    return {
      segments: computed,
      globalVariance: Math.round(gVar),
      globalStdDev: Math.round(gStd * 100) / 100,
      globalMean: Math.round(gMean * 100) / 100,
    };
  }, [result.rows, entityMeta, dimension]);

  const highestVolSegment = useMemo(() => {
    if (segments.length === 0) return null;
    return segments.reduce(
      (best, cur) => (cur.variance > best.variance ? cur : best),
      segments[0]
    );
  }, [segments]);

  const lowestVolSegment = useMemo(() => {
    const valid = segments.filter((s) => s.count >= 3 && s.variance > 0);
    if (valid.length === 0) return null;
    return valid.reduce(
      (best, cur) => (cur.variance < best.variance ? cur : best),
      valid[0]
    );
  }, [segments]);

  const highVolCount = segments.filter((s) => s.isHighVolatility).length;
  const spreadRatio =
    highestVolSegment && lowestVolSegment && lowestVolSegment.variance > 0
      ? highestVolSegment.variance / lowestVolSegment.variance
      : 1;

  const dimensionTitle =
    dimension === 'channel'
      ? 'Primary Channel'
      : dimension === 'cohort'
      ? 'Acquisition Cohort'
      : 'Dominant Action';

  return (
    <section
      aria-label="Target LTV Segment Variance Analysis"
      className="bg-white border border-slate-200 rounded-lg overflow-hidden"
    >
      {/* Header */}
      <div className="px-6 py-4 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-blue-700 shrink-0" />
            <h2 className="text-sm font-semibold text-slate-900">
              Segment Volatility: Target LTV Variance (target_ltv_raw)
            </h2>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Measures variance (σ²) and standard deviation (σ) of target_ltv_raw across {dimensionTitle.toLowerCase()} segments (n = {result.rows.length}) to pinpoint heteroscedastic or volatile sub-cohorts.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-md">
            {(
              [
                { id: 'channel', label: 'Channel' },
                { id: 'cohort', label: 'Acq Cohort' },
                { id: 'action', label: 'Primary Action' },
              ] as { id: SegmentDimension; label: string }[]
            ).map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => setDimension(d.id)}
                className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                  dimension === d.id
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {d.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-md">
            <button
              type="button"
              onClick={() => setMetricMode('variance')}
              className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                metricMode === 'variance'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Variance (σ²)
            </button>
            <button
              type="button"
              onClick={() => setMetricMode('stddev')}
              className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                metricMode === 'stddev'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Std Dev vs Mean
            </button>
          </div>
        </div>
      </div>

      {/* Summary Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-slate-200 border-b border-slate-200 bg-slate-50/40">
        <div className="px-5 py-3">
          <div className="text-[11px] font-medium text-slate-500">
            Cohort Target Variance (σ²)
          </div>
          <div className="text-base font-bold font-mono tabular-nums text-slate-900 mt-0.5">
            {globalVariance.toLocaleString()}
          </div>
          <div className="text-[11px] font-mono text-slate-500 tabular-nums mt-0.5">
            Cohort σ = ${globalStdDev.toFixed(2)} · Mean = ${globalMean.toFixed(2)}
          </div>
        </div>

        <div className="px-5 py-3">
          <div className="text-[11px] font-medium text-slate-500">
            Highest Volatility Segment
          </div>
          <div className="text-base font-bold font-mono tabular-nums text-rose-700 mt-0.5">
            {highestVolSegment ? highestVolSegment.label : '—'}
          </div>
          <div className="text-[11px] font-mono text-slate-500 tabular-nums mt-0.5">
            {highestVolSegment
              ? `σ² = ${highestVolSegment.variance.toLocaleString()} (${highestVolSegment.varianceRatio.toFixed(2)}× cohort avg)`
              : 'No data'}
          </div>
        </div>

        <div className="px-5 py-3">
          <div className="text-[11px] font-medium text-slate-500">
            Cross-Segment Heteroscedasticity
          </div>
          <div className="text-base font-bold font-mono tabular-nums text-slate-900 mt-0.5">
            {spreadRatio.toFixed(2)}× Max/Min σ²
          </div>
          <div
            className={`text-[11px] font-mono tabular-nums mt-0.5 ${
              highVolCount > 0 ? 'text-amber-700 font-medium' : 'text-emerald-700'
            }`}
          >
            {highVolCount > 0
              ? `${highVolCount} high-volatility segment${highVolCount > 1 ? 's' : ''} (≥1.35× cohort σ²)`
              : 'Variance balanced across segments'}
          </div>
        </div>
      </div>

      {segments.length === 0 ? (
        <div className="py-12 text-center text-xs text-slate-500">
          No materialized entities available to compute segment variance.
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-12 divide-y xl:divide-y-0 xl:divide-x divide-slate-200">
          {/* Left: Recharts Variance / StdDev Bar Chart */}
          <div className="xl:col-span-7 p-5">
            <div className="flex items-center justify-between gap-2 mb-3">
              <h3 className="text-xs font-semibold text-slate-900">
                {metricMode === 'variance'
                  ? `target_ltv_raw Variance (σ²) by ${dimensionTitle}`
                  : `target_ltv_raw Mean vs. Std Dev (σ) by ${dimensionTitle}`}
              </h3>
              <div className="flex items-center gap-3 text-[11px] text-slate-600">
                {metricMode === 'variance' ? (
                  <>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-xs bg-rose-600 inline-block" aria-hidden="true" />
                      <span>High Vol (≥1.35×)</span>
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-xs bg-blue-700 inline-block" aria-hidden="true" />
                      <span>Baseline Vol</span>
                    </span>
                  </>
                ) : (
                  <>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-xs bg-slate-700 inline-block" aria-hidden="true" />
                      <span>Mean ($)</span>
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-xs bg-amber-600 inline-block" aria-hidden="true" />
                      <span>Std Dev σ ($)</span>
                    </span>
                  </>
                )}
              </div>
            </div>

            <div style={{ width: '100%', height: 270 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={segments}
                  margin={{ top: 12, right: 16, bottom: 16, left: 4 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    vertical={false}
                    stroke="#e2e8f0"
                  />
                  <XAxis
                    dataKey="label"
                    tick={{
                      fontSize: 11,
                      fill: '#475569',
                      fontFamily: 'DM Sans, sans-serif',
                    }}
                    axisLine={{ stroke: '#cbd5e1' }}
                    tickLine={false}
                  />
                  <YAxis
                    tickFormatter={(v) =>
                      metricMode === 'variance'
                        ? formatCompactNumber(Number(v))
                        : `$${Math.round(Number(v))}`
                    }
                    width={54}
                    tick={{
                      fontSize: 11,
                      fill: '#475569',
                      fontFamily: 'JetBrains Mono, monospace',
                    }}
                    axisLine={{ stroke: '#cbd5e1' }}
                    tickLine={false}
                  />
                  {metricMode === 'variance' && globalVariance > 0 && (
                    <ReferenceLine
                      y={globalVariance}
                      stroke="#64748b"
                      strokeDasharray="4 4"
                      strokeWidth={1.5}
                      label={{
                        value: `Cohort σ² (${formatCompactNumber(globalVariance)})`,
                        position: 'insideTopRight',
                        fill: '#475569',
                        fontSize: 10,
                        fontFamily: 'JetBrains Mono, monospace',
                      }}
                    />
                  )}
                  <Tooltip
                    cursor={{ fill: '#f8fafc' }}
                    content={({ active, payload }) => {
                      if (!active || !payload || payload.length === 0) return null;
                      const d = payload[0]?.payload as SegmentStat | undefined;
                      if (!d) return null;
                      return (
                        <div className="bg-white border border-slate-200 rounded-md shadow-md px-3 py-2 text-xs space-y-1">
                          <div className="flex items-center justify-between gap-4">
                            <span className="font-semibold text-slate-900">
                              {d.label}
                            </span>
                            <span className="font-mono text-[11px] text-slate-500">
                              n = {d.count}
                            </span>
                          </div>
                          <div className="font-mono text-slate-900 font-semibold tabular-nums">
                            Variance (σ²): {d.variance.toLocaleString()} ({d.varianceRatio.toFixed(2)}× cohort)
                          </div>
                          <div className="font-mono text-slate-700 tabular-nums">
                            Std Dev (σ): ${d.stdDev.toFixed(2)} · Mean: ${d.mean.toFixed(2)}
                          </div>
                          <div className="font-mono text-slate-500 tabular-nums pt-0.5 border-t border-slate-100">
                            CV: {d.cv.toFixed(2)} · P95: ${d.p95.toFixed(0)} · Max: ${d.max.toFixed(0)}
                          </div>
                        </div>
                      );
                    }}
                  />
                  {metricMode === 'variance' ? (
                    <Bar
                      dataKey="variance"
                      name="Variance (σ²)"
                      radius={[4, 4, 0, 0]}
                      isAnimationActive={false}
                    >
                      {segments.map((seg) => (
                        <Cell
                          key={seg.key}
                          fill={seg.isHighVolatility ? '#e11d48' : '#1d4ed8'}
                        />
                      ))}
                    </Bar>
                  ) : (
                    <>
                      <Bar
                        dataKey="mean"
                        name="Mean Target ($)"
                        fill="#334155"
                        radius={[4, 4, 0, 0]}
                        isAnimationActive={false}
                      />
                      <Bar
                        dataKey="stdDev"
                        name="Std Dev σ ($)"
                        fill="#d97706"
                        radius={[4, 4, 0, 0]}
                        isAnimationActive={false}
                      />
                    </>
                  )}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Right: Segment Volatility Breakdown Table */}
          <div className="xl:col-span-5 overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-600">
                <tr>
                  <th className="py-2.5 px-4">{dimensionTitle}</th>
                  <th className="py-2.5 px-3 text-right">n</th>
                  <th className="py-2.5 px-3 text-right">Mean</th>
                  <th className="py-2.5 px-3 text-right">Std Dev (σ)</th>
                  <th className="py-2.5 px-3 text-right">Variance (σ²)</th>
                  <th className="py-2.5 px-4">Volatility</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-xs">
                {segments.map((seg) => (
                  <tr key={seg.key} className="hover:bg-slate-50/80 h-10">
                    <td className="py-2 px-4 font-medium text-slate-900">
                      {seg.label}
                    </td>
                    <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-600">
                      {seg.count}
                    </td>
                    <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-700">
                      ${seg.mean.toFixed(0)}
                    </td>
                    <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-700">
                      ${seg.stdDev.toFixed(1)}
                    </td>
                    <td className="py-2 px-3 text-right font-mono tabular-nums font-semibold text-slate-900">
                      {seg.variance.toLocaleString()}
                    </td>
                    <td className="py-2 px-4">
                      {seg.isHighVolatility ? (
                        <span className="inline-flex items-center gap-1 text-rose-700 font-medium">
                          <AlertTriangle className="w-3.5 h-3.5" />
                          <span>High ({seg.varianceRatio.toFixed(1)}×)</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>Normal</span>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
};
