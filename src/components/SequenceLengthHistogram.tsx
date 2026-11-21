import React, { useMemo, useState } from 'react';
import { BarChart3 } from 'lucide-react';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  SequenceConfig,
  SequenceHistogramBinMode,
  SequenceLengthDistributionBin,
  SequenceResult,
  TruncationStrategy,
} from '../types/curation';
import { computeSequenceLengthAnalysis } from '../engine/curationEngine';

interface SequenceLengthHistogramProps {
  config: SequenceConfig;
  onUpdateConfig: (next: SequenceConfig) => void;
  result: SequenceResult;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{
    payload: SequenceLengthDistributionBin;
  }>;
  maxSeqLen: number;
  truncation: TruncationStrategy;
}

const HistogramTooltip: React.FC<CustomTooltipProps> = ({
  active,
  payload,
  maxSeqLen,
  truncation,
}) => {
  if (!active || !payload || payload.length === 0) return null;
  const bin = payload[0].payload;
  const lengthHeading =
    bin.minLen === bin.maxLen
      ? `Sequence Length = ${bin.minLen} events`
      : `Sequence Lengths ${bin.minLen}–${bin.maxLen} events`;

  return (
    <div className="bg-white border border-slate-200 rounded-md shadow-sm px-3.5 py-2.5 text-xs text-slate-700 min-w-56">
      <div className="font-semibold text-slate-900 font-mono">{lengthHeading}</div>
      <div className="mt-1.5 space-y-1 font-mono tabular-nums">
        <div className="flex items-center justify-between gap-4">
          <span className="text-slate-500">Entities:</span>
          <span className="font-semibold text-slate-900">
            {bin.entityCount} ({bin.sharePct.toFixed(1)}%)
          </span>
        </div>
        {bin.withinBudgetCount > 0 && (
          <div className="flex items-center justify-between gap-4">
            <span className="text-blue-700">Within L={maxSeqLen}:</span>
            <span className="font-semibold text-blue-700">{bin.withinBudgetCount}</span>
          </div>
        )}
        {bin.truncatedCount > 0 && (
          <div className="flex items-center justify-between gap-4">
            <span className="text-amber-700">
              Truncated ({truncation === 'recent' ? 'drop early' : 'drop recent'}):
            </span>
            <span className="font-semibold text-amber-700">{bin.truncatedCount}</span>
          </div>
        )}
        <div className="flex items-center justify-between gap-4">
          <span className="text-slate-500">Cumulative ≤ {bin.maxLen}:</span>
          <span className="font-semibold text-slate-900">
            {bin.cumulativePct.toFixed(1)}%
          </span>
        </div>
        <div className="pt-1 mt-1 border-t border-slate-100 flex items-center justify-between gap-3 text-[11px] text-slate-500">
          <span>Train {bin.trainCount}</span>
          <span>Val {bin.valCount}</span>
          <span>Test {bin.testCount}</span>
        </div>
      </div>
      <div className="mt-1.5 pt-1 border-t border-slate-100 text-[11px] text-blue-700 font-medium">
        Click bar to set maxSeqLen = {Math.max(2, bin.maxLen)}
      </div>
    </div>
  );
};

export const SequenceLengthHistogram: React.FC<SequenceLengthHistogramProps> = ({
  config,
  onUpdateConfig,
  result,
}) => {
  const [binMode, setBinMode] = useState<SequenceHistogramBinMode>('auto');
  const [showCumulative, setShowCumulative] = useState<boolean>(true);

  const analysis = useMemo(
    () =>
      computeSequenceLengthAnalysis(
        result.samples,
        config.maxSeqLen,
        config.truncation,
        binMode
      ),
    [result.samples, config.maxSeqLen, config.truncation, binMode]
  );

  const { percentiles, bins } = analysis;
  const hasSamples = percentiles.count > 0 && bins.length > 0;
  const sliderMin = Math.max(2, percentiles.min || 2);
  const sliderMax = Math.max(20, Math.min(64, percentiles.max || 24), config.maxSeqLen);

  const activeCutoffBin = bins.find(
    (b) => config.maxSeqLen >= b.minLen && config.maxSeqLen <= b.maxLen
  );
  const p90Bin = bins.find(
    (b) =>
      analysis.recommendedP90 >= b.minLen &&
      analysis.recommendedP90 <= b.maxLen
  );
  const showP90RefLine =
    Boolean(p90Bin) && p90Bin?.label !== activeCutoffBin?.label;

  const recommendationTargets = useMemo(() => {
    if (!hasSamples) return [];
    const candidates = [
      { key: 'P50', len: Math.max(2, Math.round(percentiles.p50)) },
      { key: 'P75', len: Math.max(2, Math.ceil(percentiles.p75)) },
      { key: 'P90', len: analysis.recommendedP90 },
      { key: 'P95', len: analysis.recommendedP95 },
      { key: 'Max', len: Math.max(2, percentiles.max) },
    ];
    const seen = new Set<number>();
    const deduped: Array<{ key: string; len: number }> = [];
    for (const c of candidates) {
      if (c.len <= 64 && !seen.has(c.len)) {
        seen.add(c.len);
        deduped.push(c);
      }
    }
    return deduped;
  }, [
    hasSamples,
    percentiles.p50,
    percentiles.p75,
    percentiles.max,
    analysis.recommendedP90,
    analysis.recommendedP95,
  ]);

  const setMaxSeqLen = (nextLen: number) => {
    const clamped = Math.max(2, Math.min(64, Math.round(nextLen)));
    if (clamped !== config.maxSeqLen) {
      onUpdateConfig({ ...config, maxSeqLen: clamped });
    }
  };

  const handleBarClick = (entry: unknown) => {
    const candidate = entry as
      | { payload?: SequenceLengthDistributionBin; maxLen?: number }
      | undefined;
    const bin = candidate?.payload ?? (candidate as SequenceLengthDistributionBin | undefined);
    if (bin && typeof bin.maxLen === 'number') {
      setMaxSeqLen(bin.maxLen);
    }
  };

  return (
    <section
      aria-label="Sequence Length Distribution and Truncation Tuner"
      className="bg-white border border-slate-200 rounded-lg overflow-hidden"
    >
      {/* Header */}
      <div className="px-6 py-4 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <BarChart3 className="w-4 h-4 text-blue-700 shrink-0 mt-0.5" />
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              Sequence Length Distribution &amp; Truncation Tuner
            </h2>
            <p className="text-xs text-slate-500 mt-0.5 font-mono tabular-nums">
              Pre-truncation event counts (t ≤ Day {config.obsCutoffDay}) · n={percentiles.count}{' '}
              entities · range {percentiles.min}–{percentiles.max} · mean={percentiles.mean.toFixed(1)} ·
              L={config.maxSeqLen} ({config.truncation === 'recent' ? 'Keep Recent' : 'Keep Early'})
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 self-start">
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-md">
            {(
              [
                { id: 'auto', label: 'Auto Bins' },
                { id: 'exact', label: 'Exact' },
                { id: 'grouped', label: 'Grouped' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setBinMode(opt.id)}
                className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                  binMode === opt.id
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            aria-pressed={showCumulative}
            onClick={() => setShowCumulative((prev) => !prev)}
            className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-colors whitespace-nowrap ${
              showCumulative
                ? 'bg-slate-900 border-slate-900 text-white'
                : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
            }`}
          >
            Cumulative % {showCumulative ? 'On' : 'Off'}
          </button>
        </div>
      </div>

      {/* 4-Metric Distribution & Trade-off Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 divide-y lg:divide-y-0 lg:divide-x divide-slate-200 border-b border-slate-200 bg-slate-50/50">
        <div className="p-4">
          <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">
            Length Percentiles
          </div>
          <div className="text-lg font-bold font-mono tabular-nums text-slate-900 mt-1">
            P50={percentiles.p50} · P90={percentiles.p90}
          </div>
          <div className="text-[11px] font-mono tabular-nums text-slate-500 mt-0.5">
            Min {percentiles.min} · P75 {percentiles.p75} · P95 {percentiles.p95} · Max{' '}
            {percentiles.max}
          </div>
        </div>

        <div className="p-4">
          <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">
            Truncated Entities (&gt; L)
          </div>
          <div
            className={`text-lg font-bold font-mono tabular-nums mt-1 ${
              analysis.truncatedEntitiesPct > 25
                ? 'text-amber-700'
                : 'text-slate-900'
            }`}
          >
            {analysis.truncatedEntities} ({analysis.truncatedEntitiesPct.toFixed(1)}%)
          </div>
          <div className="text-[11px] font-mono tabular-nums text-slate-500 mt-0.5">
            {analysis.exactFitEntities} exact-fit · {analysis.paddedEntities} padded
          </div>
        </div>

        <div className="p-4">
          <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">
            Event Retention vs Dropped
          </div>
          <div className="text-lg font-bold font-mono tabular-nums text-blue-700 mt-1">
            {analysis.retainedEventsPct.toFixed(1)}% kept
          </div>
          <div className="text-[11px] font-mono tabular-nums text-slate-500 mt-0.5">
            {analysis.droppedEvents} / {analysis.totalEventsBeforeCutoff} dropped (
            {analysis.droppedEventsPct.toFixed(1)}%)
          </div>
        </div>

        <div className="p-4">
          <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">
            Zero-Mask Padding Sparsity
          </div>
          <div className="text-lg font-bold font-mono tabular-nums text-slate-900 mt-1">
            {analysis.paddingSparsityPct.toFixed(1)}%
          </div>
          <div className="text-[11px] font-mono tabular-nums text-slate-500 mt-0.5">
            {analysis.paddedSlots.toLocaleString()} pad slots /{' '}
            {analysis.totalTensorSlots.toLocaleString()} total
          </div>
        </div>
      </div>

      {/* Inline Parameter Tuning Controls */}
      <div className="px-6 py-3.5 border-b border-slate-200 bg-white flex flex-col xl:flex-row xl:items-center xl:justify-between gap-4">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 flex-1 min-w-0">
          <div className="flex items-center gap-2 shrink-0">
            <label
              htmlFor="seq-hist-maxlen-range"
              className="text-xs font-medium text-slate-700 whitespace-nowrap"
            >
              Tune maxSeqLen (L)
            </label>
            <span className="text-xs font-mono font-semibold text-blue-700 tabular-nums whitespace-nowrap">
              L = {config.maxSeqLen}
            </span>
          </div>
          <input
            id="seq-hist-maxlen-range"
            type="range"
            min={sliderMin}
            max={sliderMax}
            step={1}
            value={Math.min(sliderMax, Math.max(sliderMin, config.maxSeqLen))}
            onChange={(e) => setMaxSeqLen(Number(e.target.value))}
            className="w-full sm:max-w-44 accent-blue-700"
          />

          {recommendationTargets.length > 0 && (
            <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-md">
              {recommendationTargets.map((rec) => {
                const isActive = config.maxSeqLen === rec.len;
                return (
                  <button
                    key={rec.key}
                    type="button"
                    onClick={() => setMaxSeqLen(rec.len)}
                    className={`px-2 py-1 text-[11px] font-mono rounded transition-colors whitespace-nowrap ${
                      isActive
                        ? 'bg-white text-blue-700 font-semibold shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {rec.key} ({rec.len})
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs font-medium text-slate-700 whitespace-nowrap">
            Truncation Policy
          </span>
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-md">
            {(['recent', 'early'] as TruncationStrategy[]).map((tr) => (
              <button
                key={tr}
                type="button"
                onClick={() => onUpdateConfig({ ...config, truncation: tr })}
                className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                  config.truncation === tr
                    ? 'bg-white text-slate-900 font-semibold shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {tr === 'recent' ? 'Keep Recent' : 'Keep Early'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Histogram Chart */}
      <div className="p-5">
        {hasSamples ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 mb-3 text-xs text-slate-600">
              <div className="flex flex-wrap items-center gap-5">
                <span className="inline-flex items-center gap-2 font-medium text-slate-700">
                  <span
                    className="inline-block w-3 h-3 rounded-xs bg-blue-700"
                    aria-hidden="true"
                  />
                  <span>Within Budget (len ≤ L)</span>
                </span>
                <span className="inline-flex items-center gap-2 font-medium text-slate-700">
                  <span
                    className="inline-block w-3 h-3 rounded-xs bg-amber-600"
                    aria-hidden="true"
                  />
                  <span>
                    Truncated (len &gt; L ·{' '}
                    {config.truncation === 'recent'
                      ? 'earliest events trimmed'
                      : 'latest events trimmed'}
                    )
                  </span>
                </span>
                {showCumulative && (
                  <span className="inline-flex items-center gap-2 font-medium text-slate-700">
                    <span
                      className="inline-block w-4 h-0.5 bg-slate-900"
                      aria-hidden="true"
                    />
                    <span>Cumulative Coverage (%)</span>
                  </span>
                )}
              </div>
              <span className="text-[11px] font-mono tabular-nums text-slate-500">
                {analysis.resolvedBinMode === 'exact'
                  ? '1 bin = 1 event length · click any bar to set L'
                  : `Grouped width = ${analysis.binWidth} events · click any bar to set L`}
              </span>
            </div>

            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                  data={bins}
                  margin={{ top: 18, right: showCumulative ? 16 : 12, left: 4, bottom: 16 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 11, fill: '#475569' }}
                    stroke="#cbd5e1"
                    interval={bins.length > 18 ? 1 : 0}
                    label={{
                      value: 'Pre-Truncation Sequence Length (Events per Entity)',
                      position: 'insideBottom',
                      offset: -10,
                      style: { fontSize: 11, fill: '#64748b' },
                    }}
                  />
                  <YAxis
                    yAxisId="count"
                    allowDecimals={false}
                    tick={{ fontSize: 11, fill: '#475569' }}
                    stroke="#cbd5e1"
                    width={44}
                    label={{
                      value: 'Entities',
                      angle: -90,
                      position: 'insideLeft',
                      style: { fontSize: 11, fill: '#64748b' },
                    }}
                  />
                  {showCumulative && (
                    <YAxis
                      yAxisId="pct"
                      orientation="right"
                      domain={[0, 100]}
                      tickFormatter={(v: number) => `${v}%`}
                      tick={{ fontSize: 11, fill: '#475569' }}
                      stroke="#cbd5e1"
                      width={44}
                    />
                  )}
                  <Tooltip
                    content={
                      <HistogramTooltip
                        maxSeqLen={config.maxSeqLen}
                        truncation={config.truncation}
                      />
                    }
                  />

                  {activeCutoffBin && (
                    <ReferenceLine
                      x={activeCutoffBin.label}
                      yAxisId="count"
                      stroke="#1d4ed8"
                      strokeWidth={2}
                      strokeDasharray="4 3"
                      label={{
                        value: `L=${config.maxSeqLen}`,
                        position: 'top',
                        fill: '#1d4ed8',
                        fontSize: 11,
                        fontWeight: 600,
                      }}
                    />
                  )}

                  {showP90RefLine && p90Bin && (
                    <ReferenceLine
                      x={p90Bin.label}
                      yAxisId="count"
                      stroke="#475569"
                      strokeWidth={1.25}
                      strokeDasharray="2 3"
                      label={{
                        value: `P90=${analysis.recommendedP90}`,
                        position: 'top',
                        fill: '#475569',
                        fontSize: 10,
                      }}
                    />
                  )}

                  <Bar
                    yAxisId="count"
                    dataKey="withinBudgetCount"
                    name="Within Budget"
                    stackId="seqLen"
                    fill="#1d4ed8"
                    radius={[0, 0, 0, 0]}
                    cursor="pointer"
                    onClick={handleBarClick}
                  />
                  <Bar
                    yAxisId="count"
                    dataKey="truncatedCount"
                    name="Truncated"
                    stackId="seqLen"
                    fill="#d97706"
                    radius={[3, 3, 0, 0]}
                    cursor="pointer"
                    onClick={handleBarClick}
                  />

                  {showCumulative && (
                    <Line
                      yAxisId="pct"
                      type="monotone"
                      dataKey="cumulativePct"
                      name="Cumulative %"
                      stroke="#0f172a"
                      strokeWidth={2}
                      dot={{ r: 2.5, fill: '#0f172a' }}
                      activeDot={{ r: 4.5, fill: '#1d4ed8' }}
                      isAnimationActive={false}
                    />
                  )}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </>
        ) : (
          <div className="py-12 text-center text-xs text-slate-500">
            No entity sequences match the active split and minimum length filter.
          </div>
        )}
      </div>

      {/* Trade-off Analysis Footer */}
      <div className="px-6 py-3 bg-slate-50/70 border-t border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-xs text-slate-600">
        <span>{analysis.tradeoffNote}</span>
        {hasSamples && config.maxSeqLen !== analysis.recommendedP90 && (
          <button
            type="button"
            onClick={() => setMaxSeqLen(analysis.recommendedP90)}
            className="text-xs font-medium text-blue-700 hover:text-blue-800 whitespace-nowrap self-start sm:self-auto"
          >
            Apply P90 Cutoff (L={analysis.recommendedP90}) →
          </button>
        )}
      </div>
    </section>
  );
};
