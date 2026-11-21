import React, { useMemo, useState } from 'react';
import { GitFork } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { MdpConfig, MdpResult, MdpTransition } from '../types/curation';

interface MdpTrajectorySummaryPanelProps {
  config: MdpConfig;
  result: MdpResult;
}

type RewardPanelMode = 'hist_avg_step' | 'hist_traj_total' | 'by_length';

interface TrajectoryStat {
  entityId: string;
  steps: number;
  totalRewardScaled: number;
  avgRewardScaled: number;
  totalRewardRaw: number;
  avgRewardRaw: number;
  uniqueActions: number;
}

interface LengthBucket {
  label: string;
  minSteps: number;
  maxSteps: number;
  count: number;
  sharePct: number;
  meanTotalReward: number;
  meanAvgStepReward: number;
}

interface RewardBin {
  label: string;
  min: number;
  max: number;
  count: number;
  sharePct: number;
  meanSteps: number;
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

function computeStd(values: number[], mean: number): number {
  if (values.length < 2) return 0;
  const v =
    values.reduce((acc, x) => acc + (x - mean) ** 2, 0) / values.length;
  return Math.sqrt(v);
}

function buildRewardHistogram(
  trajectories: TrajectoryStat[],
  accessor: (t: TrajectoryStat) => number,
  binCount = 8
): RewardBin[] {
  if (trajectories.length === 0) return [];
  const vals = trajectories.map(accessor);
  const minVal = Math.min(...vals);
  const maxVal = Math.max(...vals);
  const span = maxVal - minVal || 1;
  const step = span / binCount;

  const buckets: {
    min: number;
    max: number;
    count: number;
    sumSteps: number;
  }[] = Array.from({ length: binCount }, (_, i) => ({
    min: minVal + i * step,
    max: i === binCount - 1 ? maxVal : minVal + (i + 1) * step,
    count: 0,
    sumSteps: 0,
  }));

  for (const t of trajectories) {
    const v = accessor(t);
    let idx = Math.floor((v - minVal) / step);
    if (idx >= binCount) idx = binCount - 1;
    if (idx < 0) idx = 0;
    buckets[idx].count += 1;
    buckets[idx].sumSteps += t.steps;
  }

  const total = trajectories.length || 1;
  return buckets.map((b) => ({
    label:
      Math.abs(b.max - b.min) < 2
        ? `${b.min.toFixed(1)}`
        : `${Math.round(b.min)}–${Math.round(b.max)}`,
    min: b.min,
    max: b.max,
    count: b.count,
    sharePct: Math.round((b.count / total) * 1000) / 10,
    meanSteps: b.count > 0 ? Math.round((b.sumSteps / b.count) * 10) / 10 : 0,
  }));
}

export const MdpTrajectorySummaryPanel: React.FC<
  MdpTrajectorySummaryPanelProps
> = ({ config, result }) => {
  const [rewardMode, setRewardMode] = useState<RewardPanelMode>('hist_avg_step');

  const { trajectories, totalActionTypes } = useMemo(() => {
    const byEntity = new Map<string, MdpTransition[]>();
    const actionIds = new Set<number>();

    for (const t of result.transitions) {
      actionIds.add(t.actionId);
      const list = byEntity.get(t.entityId);
      if (list) list.push(t);
      else byEntity.set(t.entityId, [t]);
    }

    const list: TrajectoryStat[] = [];
    for (const [entityId, trs] of byEntity.entries()) {
      const steps = trs.length;
      const totalRewardScaled = trs.reduce((acc, t) => acc + t.rewardScaled, 0);
      const totalRewardRaw = trs.reduce((acc, t) => acc + t.rewardRaw, 0);
      const uniqueActions = new Set(trs.map((t) => t.actionId)).size;
      list.push({
        entityId,
        steps,
        totalRewardScaled: Math.round(totalRewardScaled * 100) / 100,
        avgRewardScaled: Math.round((totalRewardScaled / steps) * 100) / 100,
        totalRewardRaw: Math.round(totalRewardRaw * 100) / 100,
        avgRewardRaw: Math.round((totalRewardRaw / steps) * 100) / 100,
        uniqueActions,
      });
    }

    return {
      trajectories: list,
      totalActionTypes: Math.max(1, actionIds.size),
    };
  }, [result.transitions]);

  const metrics = useMemo(() => {
    if (trajectories.length === 0) {
      return {
        minSteps: 0,
        maxSteps: 0,
        medianSteps: 0,
        p25Steps: 0,
        p75Steps: 0,
        stdSteps: 0,
        uniqueLengths: 0,
        meanTotalReward: 0,
        medianTotalReward: 0,
        stdTotalReward: 0,
        meanAvgStepReward: 0,
        p10AvgStep: 0,
        p90AvgStep: 0,
        meanUniqueActions: 0,
        multiActionPct: 0,
      };
    }

    const stepArr = trajectories.map((t) => t.steps).sort((a, b) => a - b);
    const totalRewArr = trajectories
      .map((t) => t.totalRewardScaled)
      .sort((a, b) => a - b);
    const avgStepArr = trajectories
      .map((t) => t.avgRewardScaled)
      .sort((a, b) => a - b);

    const n = trajectories.length;
    const meanSteps = stepArr.reduce((a, b) => a + b, 0) / n;
    const meanTotalReward = totalRewArr.reduce((a, b) => a + b, 0) / n;
    const meanAvgStepReward = avgStepArr.reduce((a, b) => a + b, 0) / n;
    const meanUniqueActions =
      trajectories.reduce((a, t) => a + t.uniqueActions, 0) / n;
    const multiActionCount = trajectories.filter(
      (t) => t.uniqueActions > 1
    ).length;

    return {
      minSteps: stepArr[0],
      maxSteps: stepArr[n - 1],
      medianSteps: quantileSorted(stepArr, 0.5),
      p25Steps: quantileSorted(stepArr, 0.25),
      p75Steps: quantileSorted(stepArr, 0.75),
      stdSteps: computeStd(stepArr, meanSteps),
      uniqueLengths: new Set(stepArr).size,
      meanTotalReward,
      medianTotalReward: quantileSorted(totalRewArr, 0.5),
      stdTotalReward: computeStd(totalRewArr, meanTotalReward),
      meanAvgStepReward,
      p10AvgStep: quantileSorted(avgStepArr, 0.1),
      p90AvgStep: quantileSorted(avgStepArr, 0.9),
      meanUniqueActions,
      multiActionPct: (multiActionCount / n) * 100,
    };
  }, [trajectories]);

  const lengthBuckets = useMemo<LengthBucket[]>(() => {
    if (trajectories.length === 0) return [];
    const minS = metrics.minSteps;
    const maxS = metrics.maxSteps;
    const span = maxS - minS;
    const binWidth = span <= 12 ? 1 : span <= 24 ? 2 : Math.ceil(span / 10);

    const bucketsMap = new Map<number, TrajectoryStat[]>();
    for (const t of trajectories) {
      const idx = Math.floor((t.steps - minS) / binWidth);
      const arr = bucketsMap.get(idx);
      if (arr) arr.push(t);
      else bucketsMap.set(idx, [t]);
    }

    const numBuckets = Math.floor(span / binWidth) + 1;
    const total = trajectories.length || 1;
    const out: LengthBucket[] = [];

    for (let idx = 0; idx < numBuckets; idx++) {
      const bMin = minS + idx * binWidth;
      const bMax = bMin + binWidth - 1;
      const items = bucketsMap.get(idx) ?? [];
      const cnt = items.length;
      const sumTotal = items.reduce((a, t) => a + t.totalRewardScaled, 0);
      const sumAvgStep = items.reduce((a, t) => a + t.avgRewardScaled, 0);

      out.push({
        label: binWidth === 1 ? `${bMin}` : `${bMin}–${bMax}`,
        minSteps: bMin,
        maxSteps: bMax,
        count: cnt,
        sharePct: Math.round((cnt / total) * 1000) / 10,
        meanTotalReward: cnt > 0 ? Math.round((sumTotal / cnt) * 100) / 100 : 0,
        meanAvgStepReward:
          cnt > 0 ? Math.round((sumAvgStep / cnt) * 100) / 100 : 0,
      });
    }

    return out;
  }, [trajectories, metrics.minSteps, metrics.maxSteps]);

  const avgStepHistogram = useMemo(
    () => buildRewardHistogram(trajectories, (t) => t.avgRewardScaled, 8),
    [trajectories]
  );

  const trajTotalHistogram = useMemo(
    () => buildRewardHistogram(trajectories, (t) => t.totalRewardScaled, 8),
    [trajectories]
  );

  const rewardHistogramData =
    rewardMode === 'hist_avg_step' ? avgStepHistogram : trajTotalHistogram;

  return (
    <section
      aria-label="Offline RL Trajectory Diversity Summary"
      className="bg-white border border-slate-200 rounded-lg overflow-hidden"
    >
      {/* Header */}
      <div className="px-6 py-4 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <GitFork className="w-4 h-4 text-blue-700 shrink-0" />
            <h2 className="text-sm font-semibold text-slate-900">
              Trajectory Length &amp; Reward Diversity Summary
            </h2>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Distributes {trajectories.length} entity trajectories (≥ {config.minTrajectorySteps} steps, reward scale: {config.rewardScale}) across step lengths and per-trajectory rewards to verify replay sequence diversity.
          </p>
        </div>

        <div className="text-xs font-mono text-slate-600 tabular-nums shrink-0">
          {metrics.uniqueLengths} distinct lengths · {metrics.multiActionPct.toFixed(0)}% multi-action
        </div>
      </div>

      {/* Diversity KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 divide-y lg:divide-y-0 lg:divide-x divide-slate-200 border-b border-slate-200 bg-slate-50/40">
        <div className="px-5 py-3.5">
          <div className="text-[11px] font-medium text-slate-500">
            Trajectory Length Spread
          </div>
          <div className="text-lg font-bold font-mono tabular-nums text-slate-900 mt-0.5">
            {metrics.minSteps}–{metrics.maxSteps} steps
          </div>
          <div className="text-[11px] font-mono text-slate-500 tabular-nums mt-0.5">
            Med {metrics.medianSteps.toFixed(1)} · IQR {metrics.p25Steps.toFixed(0)}–{metrics.p75Steps.toFixed(0)} · σ={metrics.stdSteps.toFixed(1)}
          </div>
        </div>

        <div className="px-5 py-3.5">
          <div className="text-[11px] font-medium text-slate-500">
            Avg Cumulative Reward / Traj
          </div>
          <div className="text-lg font-bold font-mono tabular-nums text-slate-900 mt-0.5">
            {metrics.meanTotalReward.toFixed(2)}
          </div>
          <div className="text-[11px] font-mono text-slate-500 tabular-nums mt-0.5">
            Med {metrics.medianTotalReward.toFixed(2)} · σ={metrics.stdTotalReward.toFixed(2)}
          </div>
        </div>

        <div className="px-5 py-3.5">
          <div className="text-[11px] font-medium text-slate-500">
            Mean Step Reward / Traj
          </div>
          <div className="text-lg font-bold font-mono tabular-nums text-blue-700 mt-0.5">
            {metrics.meanAvgStepReward.toFixed(2)} / step
          </div>
          <div className="text-[11px] font-mono text-slate-500 tabular-nums mt-0.5">
            P10 {metrics.p10AvgStep.toFixed(2)} · P90 {metrics.p90AvgStep.toFixed(2)}
          </div>
        </div>

        <div className="px-5 py-3.5">
          <div className="text-[11px] font-medium text-slate-500">
            Action Exploration Diversity
          </div>
          <div className="text-lg font-bold font-mono tabular-nums text-slate-900 mt-0.5">
            {metrics.meanUniqueActions.toFixed(2)} / {totalActionTypes}
          </div>
          <div className="text-[11px] font-mono text-slate-500 tabular-nums mt-0.5">
            distinct actions per trajectory
          </div>
        </div>
      </div>

      {trajectories.length === 0 ? (
        <div className="py-12 text-center text-xs text-slate-500">
          No trajectories meet the minimum step threshold (≥ {config.minTrajectorySteps} steps).
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-12 divide-y xl:divide-y-0 xl:divide-x divide-slate-200">
          {/* Left: Trajectory Length Distribution */}
          <div className="xl:col-span-6 p-5">
            <div className="flex items-center justify-between gap-2 mb-3">
              <div>
                <h3 className="text-xs font-semibold text-slate-900">
                  Trajectory Length Distribution (Steps per Entity)
                </h3>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Entity trajectory count grouped by number of transition steps.
                </p>
              </div>
              <span className="text-[11px] font-mono text-slate-500 tabular-nums">
                Mean {result.meanTrajectoryLength.toFixed(1)} steps
              </span>
            </div>

            <div style={{ width: '100%', height: 245 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={lengthBuckets}
                  margin={{ top: 8, right: 12, bottom: 18, left: 0 }}
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
                      fontFamily: 'JetBrains Mono, monospace',
                    }}
                    axisLine={{ stroke: '#cbd5e1' }}
                    tickLine={false}
                    label={{
                      value: 'Trajectory Length (Steps)',
                      position: 'insideBottom',
                      offset: -10,
                      fontSize: 11,
                      fill: '#64748b',
                    }}
                  />
                  <YAxis
                    allowDecimals={false}
                    width={40}
                    tick={{
                      fontSize: 11,
                      fill: '#475569',
                      fontFamily: 'JetBrains Mono, monospace',
                    }}
                    axisLine={{ stroke: '#cbd5e1' }}
                    tickLine={false}
                  />
                  <Tooltip
                    cursor={{ fill: '#f8fafc' }}
                    content={({ active, payload }) => {
                      if (!active || !payload || payload.length === 0) return null;
                      const b = payload[0]?.payload as LengthBucket | undefined;
                      if (!b) return null;
                      return (
                        <div className="bg-white border border-slate-200 rounded-md shadow-md px-3 py-2 text-xs space-y-1">
                          <div className="font-mono font-semibold text-slate-900">
                            {b.minSteps === b.maxSteps
                              ? `${b.minSteps} steps`
                              : `${b.minSteps}–${b.maxSteps} steps`}
                          </div>
                          <div className="font-mono text-blue-700 font-semibold tabular-nums">
                            Trajectories: {b.count} ({b.sharePct.toFixed(1)}%)
                          </div>
                          <div className="font-mono text-slate-600 tabular-nums pt-0.5 border-t border-slate-100">
                            Avg Step Reward: {b.meanAvgStepReward.toFixed(2)} · Total: {b.meanTotalReward.toFixed(2)}
                          </div>
                        </div>
                      );
                    }}
                  />
                  <Bar
                    dataKey="count"
                    name="Trajectories"
                    fill="#1d4ed8"
                    radius={[3, 3, 0, 0]}
                    isAnimationActive={false}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Right: Average Reward per Trajectory */}
          <div className="xl:col-span-6 p-5">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <div>
                <h3 className="text-xs font-semibold text-slate-900">
                  {rewardMode === 'hist_avg_step'
                    ? 'Mean Step Reward per Trajectory Distribution'
                    : rewardMode === 'hist_traj_total'
                    ? 'Total Cumulative Reward per Trajectory Distribution'
                    : 'Average Reward by Trajectory Length'}
                </h3>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  {rewardMode === 'by_length'
                    ? 'Compares per-step and cumulative trajectory reward across step counts.'
                    : 'Distribution of trajectory-level rewards showing reward diversity.'}
                </p>
              </div>

              <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-md">
                <button
                  type="button"
                  onClick={() => setRewardMode('hist_avg_step')}
                  className={`px-2 py-1 text-[11px] font-medium rounded transition-colors whitespace-nowrap ${
                    rewardMode === 'hist_avg_step'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Step Avg
                </button>
                <button
                  type="button"
                  onClick={() => setRewardMode('hist_traj_total')}
                  className={`px-2 py-1 text-[11px] font-medium rounded transition-colors whitespace-nowrap ${
                    rewardMode === 'hist_traj_total'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Traj Total
                </button>
                <button
                  type="button"
                  onClick={() => setRewardMode('by_length')}
                  className={`px-2 py-1 text-[11px] font-medium rounded transition-colors whitespace-nowrap ${
                    rewardMode === 'by_length'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  By Length
                </button>
              </div>
            </div>

            <div style={{ width: '100%', height: 245 }}>
              <ResponsiveContainer width="100%" height="100%">
                {rewardMode === 'by_length' ? (
                  <BarChart
                    data={lengthBuckets}
                    margin={{ top: 8, right: 12, bottom: 18, left: 0 }}
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
                        fontFamily: 'JetBrains Mono, monospace',
                      }}
                      axisLine={{ stroke: '#cbd5e1' }}
                      tickLine={false}
                      label={{
                        value: 'Trajectory Length (Steps)',
                        position: 'insideBottom',
                        offset: -10,
                        fontSize: 11,
                        fill: '#64748b',
                      }}
                    />
                    <YAxis
                      width={48}
                      tick={{
                        fontSize: 11,
                        fill: '#475569',
                        fontFamily: 'JetBrains Mono, monospace',
                      }}
                      axisLine={{ stroke: '#cbd5e1' }}
                      tickLine={false}
                    />
                    <Tooltip
                      cursor={{ fill: '#f8fafc' }}
                      content={({ active, payload }) => {
                        if (!active || !payload || payload.length === 0) return null;
                        const b = payload[0]?.payload as LengthBucket | undefined;
                        if (!b) return null;
                        return (
                          <div className="bg-white border border-slate-200 rounded-md shadow-md px-3 py-2 text-xs space-y-1">
                            <div className="font-mono font-semibold text-slate-900">
                              Length: {b.label} steps (n = {b.count})
                            </div>
                            <div className="font-mono text-emerald-700 font-semibold tabular-nums">
                              Avg Step Reward: {b.meanAvgStepReward.toFixed(2)}
                            </div>
                            <div className="font-mono text-slate-700 tabular-nums">
                              Avg Traj Total Reward: {b.meanTotalReward.toFixed(2)}
                            </div>
                          </div>
                        );
                      }}
                    />
                    <Bar
                      dataKey="meanAvgStepReward"
                      name="Avg Step Reward"
                      fill="#059669"
                      radius={[3, 3, 0, 0]}
                      isAnimationActive={false}
                    />
                  </BarChart>
                ) : (
                  <BarChart
                    data={rewardHistogramData}
                    margin={{ top: 8, right: 12, bottom: 18, left: 0 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      vertical={false}
                      stroke="#e2e8f0"
                    />
                    <XAxis
                      dataKey="label"
                      tick={{
                        fontSize: 10,
                        fill: '#475569',
                        fontFamily: 'JetBrains Mono, monospace',
                      }}
                      axisLine={{ stroke: '#cbd5e1' }}
                      tickLine={false}
                      label={{
                        value:
                          rewardMode === 'hist_avg_step'
                            ? `Mean Step Reward (${config.rewardScale})`
                            : `Total Trajectory Reward (${config.rewardScale})`,
                        position: 'insideBottom',
                        offset: -10,
                        fontSize: 11,
                        fill: '#64748b',
                      }}
                    />
                    <YAxis
                      allowDecimals={false}
                      width={40}
                      tick={{
                        fontSize: 11,
                        fill: '#475569',
                        fontFamily: 'JetBrains Mono, monospace',
                      }}
                      axisLine={{ stroke: '#cbd5e1' }}
                      tickLine={false}
                    />
                    <Tooltip
                      cursor={{ fill: '#f8fafc' }}
                      content={({ active, payload }) => {
                        if (!active || !payload || payload.length === 0) return null;
                        const b = payload[0]?.payload as RewardBin | undefined;
                        if (!b) return null;
                        return (
                          <div className="bg-white border border-slate-200 rounded-md shadow-md px-3 py-2 text-xs space-y-1">
                            <div className="font-mono font-semibold text-slate-900">
                              Reward [{b.min.toFixed(2)}, {b.max.toFixed(2)}]
                            </div>
                            <div className="font-mono text-emerald-700 font-semibold tabular-nums">
                              Trajectories: {b.count} ({b.sharePct.toFixed(1)}%)
                            </div>
                            <div className="font-mono text-slate-600 tabular-nums pt-0.5 border-t border-slate-100">
                              Avg Length in Bin: {b.meanSteps.toFixed(1)} steps
                            </div>
                          </div>
                        );
                      }}
                    />
                    <Bar
                      dataKey="count"
                      name="Trajectories"
                      fill="#059669"
                      radius={[3, 3, 0, 0]}
                      isAnimationActive={false}
                    />
                  </BarChart>
                )}
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
