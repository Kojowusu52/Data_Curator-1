import React, { useEffect, useMemo, useState } from 'react';
import { ArrowRight, RotateCcw, SlidersHorizontal } from 'lucide-react';
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
  MdpConfig,
  MdpDistributionShapeMode,
  MdpGammaSweepPoint,
  MdpResult,
  MdpSensitivityBin,
  RewardScaleMode,
} from '../types/curation';
import { computeMdpSensitivityAnalysis } from '../engine/curationEngine';

interface MdpSensitivityAnalyzerProps {
  config: MdpConfig;
  result: MdpResult;
  onApplyConfig: (next: MdpConfig) => void;
}

const GAMMA_PRESETS = [0.7, 0.85, 0.9, 0.95, 0.99];

const DistTooltip: React.FC<{
  active?: boolean;
  payload?: Array<{ payload: MdpSensitivityBin }>;
  showActiveOverlay: boolean;
  simLabel: string;
  activeLabel: string;
  shapeMode: MdpDistributionShapeMode;
}> = ({ active, payload, showActiveOverlay, simLabel, activeLabel, shapeMode }) => {
  if (!active || !payload || payload.length === 0) return null;
  const bin = payload[0].payload;
  return (
    <div className="bg-white border border-slate-200 rounded-md shadow-sm px-3 py-2 text-xs text-slate-700 min-w-52">
      <div className="font-mono font-semibold text-slate-900">
        {shapeMode === 'normalized_z' ? 'Z-Score Bin: ' : 'Return G₀ Bin: '}
        {bin.binLabel}
      </div>
      <div className="mt-1.5 space-y-1 font-mono tabular-nums">
        <div className="flex items-center justify-between gap-4 text-blue-700">
          <span>Simulated ({simLabel}):</span>
          <span className="font-semibold">
            {bin.simulatedCount} ({bin.simulatedPct.toFixed(1)}%)
          </span>
        </div>
        {showActiveOverlay && (
          <div className="flex items-center justify-between gap-4 text-slate-600">
            <span>Active ({activeLabel}):</span>
            <span className="font-semibold">
              {bin.activeCount} ({bin.activePct.toFixed(1)}%)
            </span>
          </div>
        )}
      </div>
    </div>
  );
};

const SweepTooltip: React.FC<{
  active?: boolean;
  payload?: Array<{ payload: MdpGammaSweepPoint }>;
}> = ({ active, payload }) => {
  if (!active || !payload || payload.length === 0) return null;
  const pt = payload[0].payload;
  return (
    <div className="bg-white border border-slate-200 rounded-md shadow-sm px-3 py-2 text-xs text-slate-700 min-w-48">
      <div className="font-mono font-semibold text-slate-900">
        γ = {pt.gammaLabel} · Horizon ≈ {pt.effectiveHorizon} steps
      </div>
      <div className="mt-1.5 space-y-1 font-mono tabular-nums">
        <div className="flex items-center justify-between gap-4">
          <span className="text-slate-500">Mean G₀:</span>
          <span className="font-semibold text-blue-700">{pt.meanG0.toFixed(2)}</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-slate-500">Median (P50):</span>
          <span className="font-semibold text-slate-900">{pt.medianG0.toFixed(2)}</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-slate-500">P10 / P90:</span>
          <span>
            {pt.p10G0.toFixed(1)} / {pt.p90G0.toFixed(1)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-slate-500">Std Dev (σ):</span>
          <span>{pt.stdG0.toFixed(2)}</span>
        </div>
      </div>
    </div>
  );
};

export const MdpSensitivityAnalyzer: React.FC<MdpSensitivityAnalyzerProps> = ({
  config,
  result,
  onApplyConfig,
}) => {
  const [simGamma, setSimGamma] = useState<number>(config.gamma);
  const [simRewardScale, setSimRewardScale] = useState<RewardScaleMode>(
    config.rewardScale
  );
  const [shapeMode, setShapeMode] =
    useState<MdpDistributionShapeMode>('native');

  useEffect(() => {
    setSimGamma(config.gamma);
  }, [config.gamma]);

  useEffect(() => {
    setSimRewardScale(config.rewardScale);
  }, [config.rewardScale]);

  const report = useMemo(
    () =>
      computeMdpSensitivityAnalysis({
        result,
        activeConfig: config,
        simGamma,
        simRewardScale,
        shapeMode,
      }),
    [result, config, simGamma, simRewardScale, shapeMode]
  );

  const hasPendingChanges =
    Math.abs(simGamma - config.gamma) >= 0.005 ||
    simRewardScale !== config.rewardScale;

  const showActiveOverlay =
    report.sameScale || report.shapeMode === 'normalized_z';

  const { activeStats, simulatedStats } = report;
  const meanDelta = simulatedStats.mean - activeStats.mean;
  const meanPctDelta =
    Math.abs(activeStats.mean) > 1e-6
      ? (meanDelta / Math.abs(activeStats.mean)) * 100
      : 0;

  return (
    <section
      aria-label="Discount Factor and Reward Scale Sensitivity Analysis"
      className="bg-white border border-slate-200 rounded-lg overflow-hidden"
    >
      {/* Header */}
      <div className="px-6 py-4 border-b border-slate-200 flex flex-col xl:flex-row xl:items-center xl:justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <SlidersHorizontal className="w-4 h-4 text-blue-700 shrink-0 mt-0.5" />
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              Policy Return Sensitivity Simulator (γ &amp; Reward Scaling)
            </h2>
            <p className="text-xs text-slate-500 mt-0.5 font-mono tabular-nums">
              Simulating {report.trajectoryCount} trajectories · Active: γ=
              {config.gamma.toFixed(2)}, {config.rewardScale} vs. Simulated: γ=
              {simGamma.toFixed(2)}, {simRewardScale}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 self-start">
          <button
            type="button"
            disabled={!hasPendingChanges}
            onClick={() => {
              setSimGamma(config.gamma);
              setSimRewardScale(config.rewardScale);
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-45 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset to Active</span>
          </button>

          <button
            type="button"
            disabled={!hasPendingChanges}
            onClick={() =>
              onApplyConfig({
                ...config,
                gamma: Math.round(simGamma * 100) / 100,
                rewardScale: simRewardScale,
              })
            }
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-blue-700 text-white hover:bg-blue-800 disabled:bg-slate-200 disabled:text-slate-500 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
          >
            <span>Apply to Replay Dataset</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Interactive Simulation Controls */}
      <div className="px-6 py-3.5 border-b border-slate-200 bg-white grid grid-cols-1 xl:grid-cols-12 gap-4 items-center">
        {/* Gamma Slider + Presets */}
        <div className="xl:col-span-6 flex flex-col sm:flex-row sm:items-center gap-3 min-w-0">
          <div className="flex items-center gap-2 shrink-0">
            <label
              htmlFor="mdp-sim-gamma"
              className="text-xs font-medium text-slate-700 whitespace-nowrap"
            >
              Simulate γ
            </label>
            <span className="text-xs font-mono font-semibold text-blue-700 tabular-nums whitespace-nowrap">
              {simGamma.toFixed(2)}
            </span>
          </div>

          <input
            id="mdp-sim-gamma"
            type="range"
            min={0.5}
            max={0.99}
            step={0.01}
            value={simGamma}
            onChange={(e) => setSimGamma(Number(e.target.value))}
            className="w-full sm:max-w-44 accent-blue-700"
          />

          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-md shrink-0">
            {GAMMA_PRESETS.map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => setSimGamma(g)}
                className={`px-2 py-0.5 text-[11px] font-mono rounded transition-colors ${
                  Math.abs(simGamma - g) < 0.005
                    ? 'bg-white text-blue-700 font-semibold shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {g.toFixed(2)}
              </button>
            ))}
          </div>
        </div>

        {/* Reward Scale + Shape Mode */}
        <div className="xl:col-span-6 flex flex-wrap items-center justify-between xl:justify-end gap-3">
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-md">
            {(
              [
                { id: 'raw', label: 'Raw' },
                { id: 'clipped_10', label: 'Clipped ±10' },
                { id: 'standardized', label: 'Z-Score' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setSimRewardScale(opt.id)}
                className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                  simRewardScale === opt.id
                    ? 'bg-white text-slate-900 font-semibold shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-md">
            <button
              type="button"
              onClick={() => setShapeMode('native')}
              className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                shapeMode === 'native'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Native Units
            </button>
            <button
              type="button"
              onClick={() => setShapeMode('normalized_z')}
              className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                shapeMode === 'normalized_z'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Z-Shape Overlay
            </button>
          </div>
        </div>
      </div>

      {/* 4-Column Metric Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 divide-y lg:divide-y-0 lg:divide-x divide-slate-200 border-b border-slate-200 bg-slate-50/50">
        <div className="p-4">
          <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">
            Simulated Mean Return G₀
          </div>
          <div className="text-lg font-bold font-mono tabular-nums text-blue-700 mt-1">
            {simulatedStats.mean.toFixed(2)}
          </div>
          <div className="text-[11px] font-mono tabular-nums text-slate-500 mt-0.5">
            {report.sameScale
              ? `${meanDelta >= 0 ? '+' : ''}${meanDelta.toFixed(2)} (${meanPctDelta >= 0 ? '+' : ''}${meanPctDelta.toFixed(1)}% vs active)`
              : `Median P50 = ${simulatedStats.median.toFixed(2)}`}
          </div>
        </div>

        <div className="p-4">
          <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">
            Return Dispersion (σ / IQR)
          </div>
          <div className="text-lg font-bold font-mono tabular-nums text-slate-900 mt-1">
            σ={simulatedStats.std.toFixed(2)} · IQR={simulatedStats.iqr.toFixed(2)}
          </div>
          <div className="text-[11px] font-mono tabular-nums text-slate-500 mt-0.5">
            P10={simulatedStats.p10.toFixed(1)} to P90={simulatedStats.p90.toFixed(1)}
          </div>
        </div>

        <div className="p-4">
          <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">
            Effective Horizon 1/(1−γ)
          </div>
          <div className="text-lg font-bold font-mono tabular-nums text-slate-900 mt-1">
            {simulatedStats.effectiveHorizon.toFixed(1)} steps
          </div>
          <div className="text-[11px] font-mono tabular-nums text-slate-500 mt-0.5">
            Bellman gain |G₀|/|r₀| = {simulatedStats.bellmanAmplification.toFixed(2)}×
          </div>
        </div>

        <div className="p-4">
          <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">
            Skewness &amp; Tail Saturation
          </div>
          <div
            className={`text-lg font-bold font-mono tabular-nums mt-1 ${
              simulatedStats.saturationRatePct >= 25
                ? 'text-amber-700'
                : 'text-slate-900'
            }`}
          >
            skew={simulatedStats.skewness.toFixed(2)}
          </div>
          <div className="text-[11px] font-mono tabular-nums text-slate-500 mt-0.5">
            {simRewardScale === 'clipped_10'
              ? `${simulatedStats.saturationRatePct.toFixed(1)}% transitions clipped at ±10`
              : simRewardScale === 'standardized'
              ? `${simulatedStats.saturationRatePct.toFixed(1)}% tail steps (|z| > 3)`
              : 'Unclipped margin rewards'}
          </div>
        </div>
      </div>

      {/* Dual Charts: Cumulative Return Histogram + Gamma Sweep Curve */}
      {report.trajectoryCount > 0 ? (
        <div className="grid grid-cols-1 xl:grid-cols-12 divide-y xl:divide-y-0 xl:divide-x divide-slate-200">
          {/* Left: Cumulative Return Distribution Histogram */}
          <div className="xl:col-span-6 p-5">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <div>
                <h3 className="text-xs font-semibold text-slate-900">
                  Cumulative Discounted Return G₀ Distribution
                </h3>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  {showActiveOverlay
                    ? `Comparing Simulated (γ=${simGamma.toFixed(2)}, ${simRewardScale}) vs. Active (γ=${config.gamma.toFixed(2)}, ${config.rewardScale}).`
                    : `Simulated G₀ distribution in native ${simRewardScale} units (switch to Z-Shape Overlay to compare across scales).`}
                </p>
              </div>
              <div className="flex items-center gap-3 text-[11px] font-medium text-slate-600">
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-xs bg-blue-700 inline-block" />
                  <span>Simulated</span>
                </span>
                {showActiveOverlay && (
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-xs bg-slate-300 inline-block" />
                    <span>Active</span>
                  </span>
                )}
              </div>
            </div>

            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={report.distributionBins}
                  margin={{ top: 10, right: 10, left: 0, bottom: 16 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                  <XAxis
                    dataKey="binLabel"
                    tick={{ fontSize: 10, fill: '#475569' }}
                    stroke="#cbd5e1"
                    interval={1}
                    angle={-15}
                    textAnchor="end"
                    height={40}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fontSize: 11, fill: '#475569' }}
                    stroke="#cbd5e1"
                    width={38}
                  />
                  <Tooltip
                    content={
                      <DistTooltip
                        showActiveOverlay={showActiveOverlay}
                        simLabel={`γ=${simGamma.toFixed(2)}`}
                        activeLabel={`γ=${config.gamma.toFixed(2)}`}
                        shapeMode={shapeMode}
                      />
                    }
                  />
                  {showActiveOverlay && (
                    <Bar
                      dataKey="activeCount"
                      name="Active"
                      fill="#cbd5e1"
                      radius={[2, 2, 0, 0]}
                    />
                  )}
                  <Bar
                    dataKey="simulatedCount"
                    name="Simulated"
                    fill="#1d4ed8"
                    radius={[2, 2, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Right: Discount Factor Gamma Sweep */}
          <div className="xl:col-span-6 p-5">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <div>
                <h3 className="text-xs font-semibold text-slate-900">
                  γ Discount Sweep ({simRewardScale} scale)
                </h3>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Shows Mean, Median (P50), and P10–P90 envelope as γ increases from 0.50 to 0.99.
                </p>
              </div>
              <div className="flex items-center gap-3 text-[11px] font-medium text-slate-600">
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-3.5 h-0.5 bg-blue-700 inline-block" />
                  <span>Mean</span>
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-3.5 h-0.5 bg-slate-900 inline-block" />
                  <span>P50</span>
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-3.5 border-t border-dashed border-slate-500 inline-block" />
                  <span>P10 / P90</span>
                </span>
              </div>
            </div>

            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={report.gammaSweep}
                  margin={{ top: 10, right: 14, left: 4, bottom: 10 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis
                    dataKey="gammaLabel"
                    tick={{ fontSize: 11, fill: '#475569' }}
                    stroke="#cbd5e1"
                    label={{
                      value: 'Discount Factor (γ)',
                      position: 'insideBottom',
                      offset: -6,
                      style: { fontSize: 11, fill: '#64748b' },
                    }}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: '#475569' }}
                    stroke="#cbd5e1"
                    width={46}
                  />
                  <Tooltip content={<SweepTooltip />} />
                  <ReferenceLine
                    x={simGamma.toFixed(2)}
                    stroke="#1d4ed8"
                    strokeDasharray="4 3"
                    strokeWidth={1.75}
                  />
                  <Line
                    type="monotone"
                    dataKey="p90G0"
                    name="P90"
                    stroke="#60a5fa"
                    strokeWidth={1.5}
                    strokeDasharray="4 3"
                    dot={false}
                    isAnimationActive={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="meanG0"
                    name="Mean G₀"
                    stroke="#1d4ed8"
                    strokeWidth={2.5}
                    dot={{ r: 3, fill: '#1d4ed8' }}
                    isAnimationActive={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="medianG0"
                    name="Median G₀"
                    stroke="#0f172a"
                    strokeWidth={2}
                    dot={{ r: 2.5, fill: '#0f172a' }}
                    isAnimationActive={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="p10G0"
                    name="P10"
                    stroke="#94a3b8"
                    strokeWidth={1.5}
                    strokeDasharray="4 3"
                    dot={false}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      ) : (
        <div className="py-10 text-center text-xs text-slate-500">
          No trajectories match the active split and minimum step criteria.
        </div>
      )}

      {/* Side-by-Side Comparison Tables: Reward Scaling Matrix & Action Return Ranking */}
      {report.trajectoryCount > 0 && (
        <div className="grid grid-cols-1 xl:grid-cols-12 divide-y xl:divide-y-0 xl:divide-x divide-slate-200 border-t border-slate-200">
          {/* Reward Scale Matrix */}
          <div className="xl:col-span-6 overflow-x-auto">
            <div className="px-5 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-900">
                Reward Scale Conditioning at γ={simGamma.toFixed(2)}
              </span>
              <span className="text-[11px] text-slate-500">
                Click a row to simulate
              </span>
            </div>
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-[11px] font-semibold text-slate-600 bg-slate-50/40">
                  <th className="py-2 px-4">Scale Mode</th>
                  <th className="py-2 px-2.5 text-right">Mean G₀</th>
                  <th className="py-2 px-2.5 text-right">Std (σ)</th>
                  <th className="py-2 px-2.5 text-right">Skew</th>
                  <th className="py-2 px-4 text-right">CQL Stability</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-xs">
                {report.scaleComparison.map((row) => {
                  const isSim = row.mode === simRewardScale;
                  return (
                    <tr
                      key={row.mode}
                      onClick={() => setSimRewardScale(row.mode)}
                      className={`h-9 cursor-pointer transition-colors ${
                        isSim ? 'bg-blue-50/70' : 'hover:bg-slate-50'
                      }`}
                    >
                      <td className="py-2 px-4 font-medium text-slate-900 whitespace-nowrap">
                        {row.label}
                        {isSim && (
                          <span className="ml-2 text-[10px] font-mono font-semibold text-blue-700">
                            (Simulated)
                          </span>
                        )}
                      </td>
                      <td className="py-2 px-2.5 text-right font-mono tabular-nums text-slate-900">
                        {row.meanG0.toFixed(2)}
                      </td>
                      <td className="py-2 px-2.5 text-right font-mono tabular-nums text-slate-700">
                        {row.stdG0.toFixed(2)}
                      </td>
                      <td className="py-2 px-2.5 text-right font-mono tabular-nums text-slate-700">
                        {row.skewness.toFixed(2)}
                      </td>
                      <td
                        className={`py-2 px-4 text-right text-[11px] font-medium whitespace-nowrap ${
                          row.cqlStability === 'clipped_saturation' ||
                          row.cqlStability === 'high_dispersion'
                            ? 'text-amber-700'
                            : row.cqlStability === 'optimal'
                            ? 'text-emerald-700'
                            : 'text-slate-600'
                        }`}
                      >
                        {row.stabilityLabel}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Action Return Sensitivity */}
          <div className="xl:col-span-6 overflow-x-auto">
            <div className="px-5 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-900">
                Action Value Ranking Sensitivity (Mean G_t)
              </span>
              <span className="text-[11px] font-mono text-slate-500">
                Active vs Simulated
              </span>
            </div>
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-[11px] font-semibold text-slate-600 bg-slate-50/40">
                  <th className="py-2 px-4">Action</th>
                  <th className="py-2 px-2.5 text-right">Active G_t</th>
                  <th className="py-2 px-2.5 text-right">Sim G_t</th>
                  <th className="py-2 px-2.5 text-right">Sim Rank</th>
                  <th className="py-2 px-4 text-right">Rank Shift</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-xs">
                {report.actionSensitivity.map((act) => (
                  <tr key={act.actionId} className="h-9">
                    <td className="py-2 px-4 text-slate-900 whitespace-nowrap">
                      <span className="font-mono text-slate-500 mr-1.5">
                        a={act.actionId}
                      </span>
                      <span className="font-medium">{act.actionLabel}</span>
                    </td>
                    <td className="py-2 px-2.5 text-right font-mono tabular-nums text-slate-600">
                      {act.activeMeanReturn.toFixed(2)}
                    </td>
                    <td className="py-2 px-2.5 text-right font-mono tabular-nums font-semibold text-blue-700">
                      {act.simulatedMeanReturn.toFixed(2)}
                    </td>
                    <td className="py-2 px-2.5 text-right font-mono tabular-nums text-slate-800">
                      #{act.simulatedRank}
                    </td>
                    <td
                      className={`py-2 px-4 text-right font-mono tabular-nums text-[11px] font-semibold whitespace-nowrap ${
                        act.rankShift > 0
                          ? 'text-emerald-700'
                          : act.rankShift < 0
                          ? 'text-amber-700'
                          : 'text-slate-400'
                      }`}
                    >
                      {act.rankShift > 0
                        ? `↑ +${act.rankShift} (was #${act.activeRank})`
                        : act.rankShift < 0
                        ? `↓ ${act.rankShift} (was #${act.activeRank})`
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Insight Summary Footer */}
      <div className="px-6 py-3 bg-slate-50/70 border-t border-slate-200 text-xs text-slate-600">
        {report.insightSummary}
      </div>
    </section>
  );
};
