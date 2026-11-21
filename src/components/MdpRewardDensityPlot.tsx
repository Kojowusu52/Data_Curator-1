import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ShieldAlert,
  Waves,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  MdpConfig,
  MdpResult,
  MdpTransition,
  RewardScaleMode,
  SplitName,
} from '../types/curation';

interface MdpRewardDensityPlotProps {
  config: MdpConfig;
  result: MdpResult;
  onChangeRewardScale: (mode: RewardScaleMode) => void;
}

type RewardBasis = 'scaled_sum' | 'raw_sum' | 'discounted_g0';

interface TrajectoryRewardRow {
  entityId: string;
  split: SplitName;
  steps: number;
  value: number;
  zScore: number;
  isOutlier: boolean;
  outlierSide: 'high' | 'low' | 'none';
}

interface DensityPoint {
  x: number;
  density: number;
  cdfPct: number;
  nearbyCount: number;
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

export const MdpRewardDensityPlot: React.FC<MdpRewardDensityPlotProps> = ({
  config,
  result,
  onChangeRewardScale,
}) => {
  const [basis, setBasis] = useState<RewardBasis>('scaled_sum');

  const analysis = useMemo(() => {
    const byEntity = new Map<string, MdpTransition[]>();
    for (const t of result.transitions) {
      const arr = byEntity.get(t.entityId);
      if (arr) arr.push(t);
      else byEntity.set(t.entityId, [t]);
    }

    const baseRows: {
      entityId: string;
      split: SplitName;
      steps: number;
      value: number;
    }[] = [];

    for (const [entityId, trs] of byEntity.entries()) {
      const sortedTrs = [...trs].sort((a, b) => a.stepIdx - b.stepIdx);
      let val = 0;
      if (basis === 'scaled_sum') {
        val = sortedTrs.reduce((acc, t) => acc + t.rewardScaled, 0);
      } else if (basis === 'raw_sum') {
        val = sortedTrs.reduce((acc, t) => acc + t.rewardRaw, 0);
      } else {
        val = sortedTrs[0]?.returnToGo ?? 0;
      }

      baseRows.push({
        entityId,
        split: sortedTrs[0]?.split ?? 'train',
        steps: sortedTrs.length,
        value: Math.round(val * 100) / 100,
      });
    }

    const n = baseRows.length;
    if (n === 0) {
      return {
        rows: [] as TrajectoryRewardRow[],
        outliers: [] as TrajectoryRewardRow[],
        densityCurve: [] as DensityPoint[],
        mean: 0,
        std: 0,
        median: 0,
        q1: 0,
        q3: 0,
        lowerFence: 0,
        upperFence: 0,
        minVal: 0,
        maxVal: 0,
        skewness: 0,
        sparsityCount: 0,
        sparsityPct: 0,
        bandwidth: 1,
        hasZeroInRange: false,
      };
    }

    const vals = baseRows.map((r) => r.value);
    const sorted = [...vals].sort((a, b) => a - b);
    const minVal = sorted[0];
    const maxVal = sorted[n - 1];
    const mean = vals.reduce((a, b) => a + b, 0) / n;

    let m2 = 0;
    let m3 = 0;
    for (const v of vals) {
      const d = v - mean;
      m2 += d * d;
      m3 += d * d * d;
    }
    const variance = m2 / n;
    const std = Math.sqrt(variance);
    const skewness =
      n >= 3 && std > 1e-9 ? m3 / n / Math.pow(std, 3) : 0;

    const q1 = quantileSorted(sorted, 0.25);
    const median = quantileSorted(sorted, 0.5);
    const q3 = quantileSorted(sorted, 0.75);
    const iqr = q3 - q1;
    const lowerFence = q1 - 1.5 * iqr;
    const upperFence = q3 + 1.5 * iqr;

    const sparsityCount = vals.filter((v) => v <= 0).length;
    const sparsityPct = (sparsityCount / n) * 100;

    // Silverman's rule of thumb bandwidth
    const spreadScale =
      iqr > 1e-6 && std > 1e-6
        ? Math.min(std, iqr / 1.34)
        : std > 1e-6
        ? std
        : Math.max(1, (maxVal - minVal) * 0.15);
    const bandwidth = Math.max(
      0.25,
      0.9 * spreadScale * Math.pow(Math.max(2, n), -0.2)
    );

    const gridStart = minVal - 1.5 * bandwidth;
    const gridEnd = maxVal + 1.5 * bandwidth;
    const gridPoints = 72;
    const step = (gridEnd - gridStart) / (gridPoints - 1) || 1;
    const invSqrt2Pi = 1 / Math.sqrt(2 * Math.PI);

    const densityCurve: DensityPoint[] = [];
    for (let g = 0; g < gridPoints; g++) {
      const x = gridStart + g * step;
      let kernelSum = 0;
      let leCount = 0;
      let nearbyCount = 0;
      for (const v of vals) {
        const u = (x - v) / bandwidth;
        kernelSum += invSqrt2Pi * Math.exp(-0.5 * u * u);
        if (v <= x) leCount += 1;
        if (Math.abs(v - x) <= bandwidth) nearbyCount += 1;
      }
      const density = kernelSum / (n * bandwidth);
      densityCurve.push({
        x: Math.round(x * 100) / 100,
        density: Number(density.toFixed(6)),
        cdfPct: Math.round((leCount / n) * 1000) / 10,
        nearbyCount,
      });
    }

    const enrichedRows: TrajectoryRewardRow[] = baseRows.map((r) => {
      const z = std > 1e-9 ? (r.value - mean) / std : 0;
      const isHigh = iqr > 1e-6 ? r.value > upperFence : z > 2.5;
      const isLow = iqr > 1e-6 ? r.value < lowerFence : z < -2.5;
      return {
        ...r,
        zScore: Math.round(z * 100) / 100,
        isOutlier: isHigh || isLow,
        outlierSide: isHigh ? 'high' : isLow ? 'low' : 'none',
      };
    });

    const outliers = enrichedRows
      .filter((r) => r.isOutlier)
      .sort((a, b) => Math.abs(b.zScore) - Math.abs(a.zScore));

    return {
      rows: enrichedRows,
      outliers,
      densityCurve,
      mean,
      std,
      median,
      q1,
      q3,
      lowerFence,
      upperFence,
      minVal,
      maxVal,
      skewness,
      sparsityCount,
      sparsityPct,
      bandwidth,
      hasZeroInRange: gridStart <= 0 && gridEnd >= 0,
    };
  }, [result.transitions, basis]);

  const hasSparsityIssue = analysis.sparsityPct >= 20;
  const hasOutlierIssue =
    analysis.outliers.length >= Math.max(3, Math.ceil(analysis.rows.length * 0.04)) ||
    Math.abs(analysis.skewness) >= 1.5;

  const statusTone =
    hasSparsityIssue && hasOutlierIssue
      ? 'critical'
      : hasSparsityIssue || hasOutlierIssue
      ? 'warn'
      : 'healthy';

  const basisLabel =
    basis === 'scaled_sum'
      ? `Cumulative Scaled Reward (${config.rewardScale})`
      : basis === 'raw_sum'
      ? 'Cumulative Raw Margin Reward'
      : `Discounted Return G₀ (γ=${config.gamma})`;

  return (
    <section
      aria-label="Offline RL Cumulative Reward Density Plot"
      className="bg-white border border-slate-200 rounded-lg overflow-hidden"
    >
      {/* Header */}
      <div className="px-6 py-4 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <Waves className="w-4 h-4 text-blue-700 shrink-0" />
            <h2 className="text-sm font-semibold text-slate-900">
              Trajectory Cumulative Reward Density (KDE)
            </h2>
            <span
              className={`inline-flex items-center gap-1 text-xs font-medium ${
                statusTone === 'critical'
                  ? 'text-rose-700'
                  : statusTone === 'warn'
                  ? 'text-amber-700'
                  : 'text-emerald-700'
              }`}
            >
              {statusTone === 'critical' ? (
                <ShieldAlert className="w-3.5 h-3.5" />
              ) : statusTone === 'warn' ? (
                <AlertTriangle className="w-3.5 h-3.5" />
              ) : (
                <CheckCircle2 className="w-3.5 h-3.5" />
              )}
              <span>
                {statusTone === 'critical'
                  ? 'Sparsity & Heavy-Tail Outliers'
                  : hasSparsityIssue
                  ? 'Elevated Reward Sparsity'
                  : hasOutlierIssue
                  ? 'Extreme Tail Outliers Detected'
                  : 'Well-Behaved Reward Density'}
              </span>
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Gaussian kernel density estimate of {basisLabel.toLowerCase()} across {analysis.rows.length} trajectories (Silverman h = {analysis.bandwidth.toFixed(2)}) to diagnose reward sparsity and Q-value outlier spikes.
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-md self-start lg:self-auto">
          <button
            type="button"
            onClick={() => setBasis('scaled_sum')}
            className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap ${
              basis === 'scaled_sum'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Scaled Σ r_t
          </button>
          <button
            type="button"
            onClick={() => setBasis('raw_sum')}
            className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap ${
              basis === 'raw_sum'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Raw Σ r_t
          </button>
          <button
            type="button"
            onClick={() => setBasis('discounted_g0')}
            className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap ${
              basis === 'discounted_g0'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Return G₀
          </button>
        </div>
      </div>

      {/* Diagnostic Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 divide-y lg:divide-y-0 lg:divide-x divide-slate-200 border-b border-slate-200 bg-slate-50/40">
        <div className="px-5 py-3">
          <div className="text-[11px] font-medium text-slate-500">
            Zero / Non-Positive Sparsity
          </div>
          <div
            className={`text-base font-bold font-mono tabular-nums mt-0.5 ${
              hasSparsityIssue ? 'text-amber-700' : 'text-slate-900'
            }`}
          >
            {analysis.sparsityPct.toFixed(1)}%
          </div>
          <div className="text-[11px] font-mono text-slate-500 tabular-nums mt-0.5">
            {analysis.sparsityCount} / {analysis.rows.length} trajectories ≤ 0
          </div>
        </div>

        <div className="px-5 py-3">
          <div className="text-[11px] font-medium text-slate-500">
            Distribution Skewness (γ₁)
          </div>
          <div
            className={`text-base font-bold font-mono tabular-nums mt-0.5 ${
              Math.abs(analysis.skewness) >= 1.5
                ? 'text-rose-700'
                : 'text-slate-900'
            }`}
          >
            {analysis.skewness.toFixed(2)}
          </div>
          <div className="text-[11px] font-mono text-slate-500 tabular-nums mt-0.5">
            Mean {analysis.mean.toFixed(1)} · Med {analysis.median.toFixed(1)}
          </div>
        </div>

        <div className="px-5 py-3">
          <div className="text-[11px] font-medium text-slate-500">
            IQR Outlier Fence (Q₃ + 1.5·IQR)
          </div>
          <div className="text-base font-bold font-mono tabular-nums text-slate-900 mt-0.5">
            {analysis.upperFence.toFixed(1)}
          </div>
          <div className="text-[11px] font-mono text-slate-500 tabular-nums mt-0.5">
            Q₁ {analysis.q1.toFixed(1)} · Q₃ {analysis.q3.toFixed(1)}
          </div>
        </div>

        <div className="px-5 py-3">
          <div className="text-[11px] font-medium text-slate-500">
            Extreme Trajectory Outliers
          </div>
          <div
            className={`text-base font-bold font-mono tabular-nums mt-0.5 ${
              analysis.outliers.length > 0 ? 'text-rose-700' : 'text-emerald-700'
            }`}
          >
            {analysis.outliers.length} flagged
          </div>
          <div className="text-[11px] font-mono text-slate-500 tabular-nums mt-0.5">
            Range [{analysis.minVal.toFixed(1)}, {analysis.maxVal.toFixed(1)}]
          </div>
        </div>
      </div>

      {analysis.rows.length < 3 ? (
        <div className="py-12 text-center text-xs text-slate-500">
          At least 3 trajectories are required to estimate cumulative reward density.
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-12 divide-y xl:divide-y-0 xl:divide-x divide-slate-200">
          {/* Left: Smooth KDE Density AreaChart */}
          <div className="xl:col-span-8 p-5">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <h3 className="text-xs font-semibold text-slate-900">
                Kernel Density Curve — {basisLabel}
              </h3>

              <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-600">
                <span className="inline-flex items-center gap-1.5">
                  <span
                    className="w-3.5 h-0.5 border-t-2 border-dashed border-slate-600 inline-block"
                    aria-hidden="true"
                  />
                  <span>Median ({analysis.median.toFixed(1)})</span>
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span
                    className="w-3.5 h-0.5 border-t-2 border-dashed border-rose-600 inline-block"
                    aria-hidden="true"
                  />
                  <span>Upper Fence ({analysis.upperFence.toFixed(1)})</span>
                </span>
              </div>
            </div>

            <div style={{ width: '100%', height: 270 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={analysis.densityCurve}
                  margin={{ top: 12, right: 16, bottom: 20, left: 6 }}
                >
                  <defs>
                    <linearGradient id="mdpRewardDensityGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#1d4ed8" stopOpacity={0.28} />
                      <stop offset="95%" stopColor="#1d4ed8" stopOpacity={0.03} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis
                    type="number"
                    dataKey="x"
                    domain={['dataMin', 'dataMax']}
                    tickFormatter={(v) =>
                      Math.abs(Number(v)) >= 100
                        ? String(Math.round(Number(v)))
                        : Number(v).toFixed(1)
                    }
                    tick={{
                      fontSize: 11,
                      fill: '#475569',
                      fontFamily: 'JetBrains Mono, monospace',
                    }}
                    axisLine={{ stroke: '#cbd5e1' }}
                    tickLine={false}
                    label={{
                      value: basisLabel,
                      position: 'insideBottom',
                      offset: -12,
                      fontSize: 11,
                      fill: '#64748b',
                    }}
                  />
                  <YAxis
                    tickFormatter={(v) => Number(v).toFixed(4)}
                    width={58}
                    tick={{
                      fontSize: 10,
                      fill: '#475569',
                      fontFamily: 'JetBrains Mono, monospace',
                    }}
                    axisLine={{ stroke: '#cbd5e1' }}
                    tickLine={false}
                    label={{
                      value: 'Density f(x)',
                      angle: -90,
                      position: 'insideLeft',
                      offset: 4,
                      style: { textAnchor: 'middle', fontSize: 11, fill: '#64748b' },
                    }}
                  />
                  {analysis.hasZeroInRange && (
                    <ReferenceLine
                      x={0}
                      stroke="#d97706"
                      strokeDasharray="2 3"
                      strokeWidth={1.25}
                    />
                  )}
                  <ReferenceLine
                    x={analysis.median}
                    stroke="#475569"
                    strokeDasharray="4 4"
                    strokeWidth={1.5}
                  />
                  <ReferenceLine
                    x={analysis.upperFence}
                    stroke="#e11d48"
                    strokeDasharray="4 4"
                    strokeWidth={1.5}
                  />
                  <Tooltip
                    content={({ active, payload }) => {
                      if (!active || !payload || payload.length === 0) return null;
                      const pt = payload[0]?.payload as DensityPoint | undefined;
                      if (!pt) return null;
                      return (
                        <div className="bg-white border border-slate-200 rounded-md shadow-md px-3 py-2 text-xs space-y-1">
                          <div className="font-mono font-semibold text-slate-900">
                            Reward ≈ {pt.x.toFixed(2)}
                          </div>
                          <div className="font-mono text-blue-700 font-semibold tabular-nums">
                            Density: {pt.density.toFixed(5)}
                          </div>
                          <div className="font-mono text-slate-600 tabular-nums">
                            Percentile: {pt.cdfPct.toFixed(1)}% · Local mass: {pt.nearbyCount} traj
                          </div>
                        </div>
                      );
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="density"
                    stroke="#1d4ed8"
                    strokeWidth={2.25}
                    fill="url(#mdpRewardDensityGrad)"
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Right: Flagged Trajectory Outliers & Mitigation */}
          <div className="xl:col-span-4 p-5 bg-slate-50/50 flex flex-col justify-between gap-4">
            <div>
              <div className="flex items-center justify-between text-xs mb-3">
                <span className="font-semibold text-slate-900">
                  Flagged Reward Outliers (Tukey IQR)
                </span>
                <span className="font-mono text-slate-500 tabular-nums">
                  {analysis.outliers.length} total
                </span>
              </div>

              {analysis.outliers.length === 0 ? (
                <div className="p-3 bg-white border border-slate-200 rounded-md flex items-start gap-2 text-xs text-emerald-700">
                  <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>
                    All trajectory cumulative rewards fall within [{analysis.lowerFence.toFixed(1)},{' '}
                    {analysis.upperFence.toFixed(1)}]. No extreme outliers detected.
                  </span>
                </div>
              ) : (
                <div className="space-y-2 max-h-[210px] overflow-y-auto pr-0.5">
                  {analysis.outliers.slice(0, 8).map((out) => (
                    <div
                      key={out.entityId}
                      className="px-3 py-2 bg-white border border-slate-200 rounded-md flex items-center justify-between gap-2 text-xs"
                    >
                      <div className="min-w-0">
                        <div className="font-mono font-semibold text-slate-900">
                          {out.entityId}{' '}
                          <span className="font-normal text-slate-500">
                            ({out.split})
                          </span>
                        </div>
                        <div className="text-[11px] font-mono text-slate-500">
                          {out.steps} steps · z ={' '}
                          {out.zScore >= 0 ? `+${out.zScore.toFixed(2)}` : out.zScore.toFixed(2)}
                        </div>
                      </div>
                      <span
                        className={`font-mono font-semibold tabular-nums shrink-0 ${
                          out.outlierSide === 'high' ? 'text-rose-700' : 'text-amber-700'
                        }`}
                      >
                        {out.value.toFixed(2)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="pt-3 border-t border-slate-200 space-y-2">
              <p className="text-[11px] text-slate-500 leading-relaxed">
                {config.rewardScale === 'raw' && hasOutlierIssue
                  ? 'Raw margin rewards exhibit heavy upper-tail skew, which can destabilize Bellman backups in CQL.'
                  : 'Reward scaling directly shapes critic TD-error variance across trajectories.'}
              </p>

              {config.rewardScale === 'raw' && (
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => onChangeRewardScale('clipped_10')}
                    className="px-2.5 py-1 text-[11px] font-medium text-blue-700 bg-blue-50/80 border border-blue-200 rounded hover:bg-blue-100/80 transition-colors whitespace-nowrap"
                  >
                    Apply Clipped [-10, +10]
                  </button>
                  <button
                    type="button"
                    onClick={() => onChangeRewardScale('standardized')}
                    className="px-2.5 py-1 text-[11px] font-medium text-slate-700 bg-white border border-slate-200 rounded hover:bg-slate-100 transition-colors whitespace-nowrap"
                  >
                    Apply Z-Score Scale
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
