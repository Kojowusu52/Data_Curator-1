import React, { useMemo, useState } from 'react';
import { RegressionResult, RegressionRow } from '../types/curation';

type DistributionMetricKey =
  | 'targetLtvRaw'
  | 'targetLtvWinsorized'
  | 'monetarySumObs'
  | 'txCountObs'
  | 'recencyAtCutoff';

interface MetricOption {
  key: DistributionMetricKey;
  field: string;
  label: string;
  unit: 'currency' | 'count' | 'days';
  description: string;
}

const METRIC_OPTIONS: MetricOption[] = [
  {
    key: 'targetLtvRaw',
    field: 'target_ltv_raw',
    label: 'target_ltv_raw',
    unit: 'currency',
    description:
      'Uncapped horizon spend across (T_obs, T_obs + H]. Exposes heavy-tail whales and zero-spend mass before winsorization.',
  },
  {
    key: 'targetLtvWinsorized',
    field: 'target_ltv_winsorized',
    label: 'target_ltv_winsorized',
    unit: 'currency',
    description:
      'Train-fit capped horizon spend target used for OLS & gradient-boosted training stability.',
  },
  {
    key: 'monetarySumObs',
    field: 'monetary_sum_obs',
    label: 'monetary_sum_obs',
    unit: 'currency',
    description:
      'Cumulative entity spend during the observation window [0, T_obs].',
  },
  {
    key: 'txCountObs',
    field: 'tx_count_obs',
    label: 'tx_count_obs',
    unit: 'count',
    description:
      'Observation-window transaction frequency count per entity.',
  },
  {
    key: 'recencyAtCutoff',
    field: 'recency_at_cutoff',
    label: 'recency_at_cutoff',
    unit: 'days',
    description:
      'Days elapsed since last observed event up to T_obs.',
  },
];

function formatMetricValue(val: number, unit: MetricOption['unit']): string {
  if (!Number.isFinite(val)) return '0';
  if (unit === 'currency') {
    return val >= 1000 ? `$${Math.round(val).toLocaleString()}` : `$${val.toFixed(0)}`;
  }
  if (unit === 'days') {
    return `${Math.round(val)}d`;
  }
  return Number.isInteger(val) ? String(val) : val.toFixed(1);
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

interface DistributionHistogramsProps {
  regResult: RegressionResult;
}

export const DistributionHistograms: React.FC<DistributionHistogramsProps> = ({
  regResult,
}) => {
  const [selectedMetric, setSelectedMetric] =
    useState<DistributionMetricKey>('targetLtvRaw');
  const [hoveredBinIdx, setHoveredBinIdx] = useState<number | null>(null);

  const activeOption =
    METRIC_OPTIONS.find((m) => m.key === selectedMetric) ?? METRIC_OPTIONS[0];

  const stats = useMemo(() => {
    const rows: RegressionRow[] = regResult.rows;
    const values = rows
      .map((r) => Number(r[selectedMetric]))
      .filter((v) => Number.isFinite(v));

    if (values.length === 0) {
      return null;
    }

    const sorted = [...values].sort((a, b) => a - b);
    const n = sorted.length;
    const min = sorted[0];
    const max = sorted[n - 1];
    const mean = values.reduce((a, b) => a + b, 0) / n;
    const median = quantileSorted(sorted, 0.5);
    const q1 = quantileSorted(sorted, 0.25);
    const q3 = quantileSorted(sorted, 0.75);
    const p95 = quantileSorted(sorted, 0.95);
    const p99 = quantileSorted(sorted, 0.99);

    const iqr = q3 - q1;
    const upperFence = q3 + 1.5 * iqr;

    const variance = values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / n;
    const std = Math.sqrt(variance);
    const skewness =
      std > 1e-9
        ? values.reduce((acc, v) => acc + ((v - mean) / std) ** 3, 0) / n
        : 0;

    const outlierCount = values.filter((v) => v > upperFence).length;
    const outlierRate = outlierCount / n;
    const zeroCount = values.filter((v) => v === 0).length;

    const binCount = 12;
    const span = max - min || 1;
    const step = span / binCount;
    const bins = Array.from({ length: binCount }, (_, idx) => {
      const bMin = min + idx * step;
      const bMax = idx === binCount - 1 ? max : bMin + step;
      return {
        idx,
        min: bMin,
        max: bMax,
        count: 0,
        isOutlierTail: bMin >= upperFence && upperFence < max,
      };
    });

    for (const v of values) {
      let idx = Math.floor((v - min) / step);
      if (idx >= binCount) idx = binCount - 1;
      if (idx < 0) idx = 0;
      bins[idx].count += 1;
    }

    const maxBinCount = Math.max(1, ...bins.map((b) => b.count));

    const skewLabel =
      skewness > 1.0
        ? 'High right skew'
        : skewness > 0.5
        ? 'Moderate right skew'
        : skewness < -0.5
        ? 'Left-skewed'
        : 'Near-symmetric';

    return {
      n,
      min,
      max,
      mean,
      median,
      q1,
      q3,
      p95,
      p99,
      upperFence,
      std,
      skewness,
      skewLabel,
      outlierCount,
      outlierRate,
      zeroCount,
      bins,
      maxBinCount,
    };
  }, [regResult.rows, selectedMetric]);

  const hoveredBin =
    stats && hoveredBinIdx !== null ? stats.bins[hoveredBinIdx] ?? null : null;

  return (
    <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">
            Regression Target & Predictor Distribution Histograms
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            {activeOption.description}
          </p>
        </div>

        <div
          className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-md self-start lg:self-auto"
          role="tablist"
          aria-label="Select distribution metric"
        >
          {METRIC_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              type="button"
              role="tab"
              aria-selected={selectedMetric === opt.key}
              onClick={() => {
                setSelectedMetric(opt.key);
                setHoveredBinIdx(null);
              }}
              className={`px-2.5 py-1.5 text-[11px] font-mono rounded transition-colors whitespace-nowrap ${
                selectedMetric === opt.key
                  ? 'bg-white text-slate-900 font-semibold shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {!stats ? (
        <div className="p-8 text-center text-xs text-slate-500">
          No regression rows materialized yet. Adjust observation cutoff or dataset filters to inspect distributions.
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-12 divide-y xl:divide-y-0 xl:divide-x divide-slate-200">
          {/* Histogram Plot */}
          <div className="xl:col-span-8 p-6">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4 text-xs">
              <div className="font-mono text-slate-600 tabular-nums">
                {hoveredBin ? (
                  <span>
                    Bin [{formatMetricValue(hoveredBin.min, activeOption.unit)},{' '}
                    {formatMetricValue(hoveredBin.max, activeOption.unit)}]:{' '}
                    <strong className="text-slate-900">{hoveredBin.count}</strong>{' '}
                    entities ({((hoveredBin.count / stats.n) * 100).toFixed(1)}%)
                  </span>
                ) : (
                  <span>
                    12-bin histogram across n ={' '}
                    <strong className="text-slate-900">{stats.n}</strong>{' '}
                    entities · Hover a bar for exact bin density
                  </span>
                )}
              </div>

              <div className="flex items-center gap-4 text-[11px] text-slate-600">
                <span className="inline-flex items-center gap-1.5">
                  <span
                    className="w-2.5 h-2.5 rounded-xs bg-blue-700 inline-block"
                    aria-hidden="true"
                  />
                  <span>In-range density</span>
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span
                    className="w-2.5 h-2.5 rounded-xs bg-amber-600 inline-block"
                    aria-hidden="true"
                  />
                  <span>Outlier tail (&gt; Q3 + 1.5·IQR)</span>
                </span>
              </div>
            </div>

            <div className="h-52 flex items-end gap-1.5 pt-4 border-b border-slate-200 pb-2">
              {stats.bins.map((bin) => {
                const heightPct = Math.round((bin.count / stats.maxBinCount) * 100);
                const isHovered = hoveredBinIdx === bin.idx;
                return (
                  <button
                    key={bin.idx}
                    type="button"
                    onMouseEnter={() => setHoveredBinIdx(bin.idx)}
                    onMouseLeave={() => setHoveredBinIdx(null)}
                    onFocus={() => setHoveredBinIdx(bin.idx)}
                    aria-label={`Range ${formatMetricValue(bin.min, activeOption.unit)} to ${formatMetricValue(bin.max, activeOption.unit)}: ${bin.count} entities`}
                    className="flex-1 flex flex-col items-center justify-end h-full min-w-0 group focus:outline-none"
                  >
                    <span className="text-[10px] font-mono tabular-nums text-slate-500 mb-1">
                      {bin.count > 0 ? bin.count : ''}
                    </span>
                    <div
                      className={`w-full rounded-t transition-all duration-150 ${
                        bin.isOutlierTail
                          ? isHovered
                            ? 'bg-amber-700'
                            : 'bg-amber-600'
                          : isHovered
                          ? 'bg-blue-800'
                          : 'bg-blue-700/85'
                      }`}
                      style={{
                        height: `${bin.count === 0 ? 2 : Math.max(4, heightPct)}%`,
                        opacity: bin.count === 0 ? 0.2 : 1,
                      }}
                    />
                  </button>
                );
              })}
            </div>

            <div className="flex items-center justify-between text-[10px] font-mono text-slate-500 mt-2 tabular-nums">
              <span>Min: {formatMetricValue(stats.min, activeOption.unit)}</span>
              <span>Median: {formatMetricValue(stats.median, activeOption.unit)}</span>
              <span>
                IQR Fence: {formatMetricValue(stats.upperFence, activeOption.unit)}
              </span>
              <span>Max: {formatMetricValue(stats.max, activeOption.unit)}</span>
            </div>
          </div>

          {/* Skewness & Outlier Diagnostics */}
          <div className="xl:col-span-4 p-5 bg-slate-50/50 flex flex-col justify-between gap-4">
            <div>
              <div className="text-xs font-semibold text-slate-900">
                Skew &amp; Outlier Diagnostics
              </div>
              <p className="text-[11px] text-slate-500 mt-0.5">
                {stats.skewLabel} (γ₁ = {stats.skewness.toFixed(2)})
              </p>

              <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-xs border-y border-slate-200 py-3.5">
                <div>
                  <dt className="text-[11px] text-slate-500">Mean / Median</dt>
                  <dd className="font-mono font-semibold text-slate-900 mt-0.5 tabular-nums">
                    {formatMetricValue(stats.mean, activeOption.unit)} /{' '}
                    {formatMetricValue(stats.median, activeOption.unit)}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] text-slate-500">Skewness (γ₁)</dt>
                  <dd
                    className={`font-mono font-semibold mt-0.5 tabular-nums ${
                      Math.abs(stats.skewness) > 1
                        ? 'text-amber-700'
                        : 'text-slate-900'
                    }`}
                  >
                    {stats.skewness >= 0
                      ? `+${stats.skewness.toFixed(2)}`
                      : stats.skewness.toFixed(2)}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] text-slate-500">P95 / P99 Tail</dt>
                  <dd className="font-mono font-semibold text-slate-900 mt-0.5 tabular-nums">
                    {formatMetricValue(stats.p95, activeOption.unit)} /{' '}
                    {formatMetricValue(stats.p99, activeOption.unit)}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] text-slate-500">IQR Outliers</dt>
                  <dd
                    className={`font-mono font-semibold mt-0.5 tabular-nums ${
                      stats.outlierCount > 0 ? 'text-amber-700' : 'text-emerald-700'
                    }`}
                  >
                    {stats.outlierCount} ({(stats.outlierRate * 100).toFixed(1)}%)
                  </dd>
                </div>
              </dl>

              <div className="mt-3.5 text-xs text-slate-600 leading-relaxed">
                {selectedMetric === 'targetLtvRaw' && (
                  <>
                    Train-fit winsorization caps{' '}
                    <span className="font-mono font-semibold text-slate-900">
                      target_ltv_raw
                    </span>{' '}
                    at{' '}
                    <span className="font-mono font-semibold text-slate-900">
                      ${regResult.winsorCapValue.toFixed(0)}
                    </span>
                    , dampening extreme tail leverage on squared-error regression loss.
                  </>
                )}
                {selectedMetric === 'targetLtvWinsorized' && (
                  <>
                    Capping at{' '}
                    <span className="font-mono font-semibold text-slate-900">
                      ${regResult.winsorCapValue.toFixed(0)}
                    </span>{' '}
                    constrains upper-tail variance while preserving{' '}
                    <span className="font-mono font-semibold text-slate-900">
                      {stats.zeroCount}
                    </span>{' '}
                    zero-target entities ({((stats.zeroCount / stats.n) * 100).toFixed(1)}%).
                  </>
                )}
                {selectedMetric !== 'targetLtvRaw' &&
                  selectedMetric !== 'targetLtvWinsorized' && (
                    <>
                      {stats.skewness > 1
                        ? 'Strong positive skew detected. Consider log1p scaling before fitting unregularized linear models.'
                        : 'Distribution spread is within manageable bounds for standard linear or tree-based predictors.'}
                    </>
                  )}
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
