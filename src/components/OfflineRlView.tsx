import React, { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Search } from 'lucide-react';
import {
  MdpConfig,
  MdpResult,
  RewardScaleMode,
  SplitName,
} from '../types/curation';
import { MdpTrajectorySummaryPanel } from './MdpTrajectorySummaryPanel';
import { MdpRewardDensityPlot } from './MdpRewardDensityPlot';
import { MdpSensitivityAnalyzer } from './MdpSensitivityAnalyzer';

interface OfflineRlViewProps {
  config: MdpConfig;
  onUpdateConfig: (next: MdpConfig) => void;
  result: MdpResult;
}

export const OfflineRlView: React.FC<OfflineRlViewProps> = ({
  config,
  onUpdateConfig,
  result,
}) => {
  const [search, setSearch] = useState('');
  const [onlyOod, setOnlyOod] = useState(false);
  const [onlyTerminal, setOnlyTerminal] = useState(false);

  const visibleTransitions = useMemo(() => {
    const q = search.trim().toLowerCase();
    return result.transitions
      .filter((t) => {
        if (onlyOod && !t.isLowSupportOod) return false;
        if (onlyTerminal && t.done !== 1) return false;
        if (!q) return true;
        return (
          t.entityId.toLowerCase().includes(q) ||
          t.actionLabel.toLowerCase().includes(q)
        );
      })
      .slice(0, 100);
  }, [result.transitions, search, onlyOod, onlyTerminal]);

  return (
    <div className="space-y-6">
      {/* Control Surface */}
      <section className="bg-white border border-slate-200 rounded-lg p-5">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 pb-4 border-b border-slate-200">
          <div>
            <h1 className="text-lg font-bold text-slate-900">
              03. Offline RL (CQL / MDP Replay Dataset)
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Constructs Markov transitions (s_t, a_t, r_t, s_t+1, done) with discounted return-to-go G_t and empirical OOD support audits.
            </p>
          </div>

          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-md self-start">
            {(['all', 'train', 'val', 'test'] as const).map((sp) => (
              <button
                key={sp}
                type="button"
                onClick={() => onUpdateConfig({ ...config, splitFilter: sp })}
                className={`px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                  config.splitFilter === sp
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {sp === 'all'
                  ? 'All Splits'
                  : `${sp.charAt(0).toUpperCase() + sp.slice(1)} (${
                      result.splitCounts[sp as SplitName]
                    })`}
              </button>
            ))}
          </div>
        </div>

        <div className="pt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          <div>
            <div className="flex items-center justify-between text-xs mb-1.5">
              <span className="font-medium text-slate-700">Discount Factor (γ)</span>
              <span className="font-mono text-[11px] font-semibold text-blue-700 tabular-nums">
                γ = {config.gamma.toFixed(2)}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-1 p-1 bg-slate-100 rounded-md">
              {[0.9, 0.95, 0.99].map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => onUpdateConfig({ ...config, gamma: g })}
                  className={`py-1 text-xs font-mono rounded transition-colors ${
                    Math.abs(config.gamma - g) < 0.001
                      ? 'bg-white text-slate-900 font-semibold shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {g.toFixed(2)}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="text-xs font-medium text-slate-700 mb-1.5">
              Terminal Inactivity Gap
            </div>
            <div className="grid grid-cols-4 gap-1 p-1 bg-slate-100 rounded-md">
              {[30, 45, 60, 90].map((gap) => (
                <button
                  key={gap}
                  type="button"
                  onClick={() =>
                    onUpdateConfig({ ...config, terminalInactivityGapDays: gap })
                  }
                  className={`py-1 text-xs font-mono rounded transition-colors ${
                    config.terminalInactivityGapDays === gap
                      ? 'bg-white text-slate-900 font-semibold shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {gap}d
                </button>
              ))}
            </div>
          </div>

          <div>
            <label htmlFor="mdp-reward-scale" className="block text-xs font-medium text-slate-700 mb-1.5">
              Reward Scaling (CQL Stability)
            </label>
            <select
              id="mdp-reward-scale"
              value={config.rewardScale}
              onChange={(e) =>
                onUpdateConfig({
                  ...config,
                  rewardScale: e.target.value as RewardScaleMode,
                })
              }
              className="w-full px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
            >
              <option value="raw">Raw Margin Reward</option>
              <option value="clipped_10">Clipped [-10, +10]</option>
              <option value="standardized">Standardized (Train Z-Score)</option>
            </select>
          </div>

          <div>
            <div className="text-xs font-medium text-slate-700 mb-1.5">
              Min Trajectory Length
            </div>
            <div className="grid grid-cols-3 gap-1 p-1 bg-slate-100 rounded-md">
              {[2, 4, 6].map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() =>
                    onUpdateConfig({ ...config, minTrajectorySteps: m })
                  }
                  className={`py-1 text-xs font-mono rounded transition-colors ${
                    config.minTrajectorySteps === m
                      ? 'bg-white text-slate-900 font-semibold shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  ≥ {m} steps
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* KPI Strip */}
      <section className="bg-white border border-slate-200 rounded-lg grid grid-cols-2 lg:grid-cols-4 divide-y lg:divide-y-0 lg:divide-x divide-slate-200">
        <div className="p-5">
          <div className="text-xs text-slate-500">MDP Transitions (N)</div>
          <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 mt-1">
            {result.transitions.length.toLocaleString()}
          </div>
          <div className="text-xs text-slate-500 mt-1 font-mono tabular-nums">
            {result.trajectoryCount} trajectories · {result.meanTrajectoryLength.toFixed(1)} avg steps
          </div>
        </div>
        <div className="p-5">
          <div className="text-xs text-slate-500">Terminal Transitions (done=1)</div>
          <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 mt-1">
            {result.terminalCount}
          </div>
          <div className="text-xs text-slate-500 mt-1">
            Inactivity &gt; {config.terminalInactivityGapDays}d or horizon end
          </div>
        </div>
        <div className="p-5">
          <div className="text-xs text-slate-500">Mean Initial Return G₀</div>
          <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 mt-1">
            {result.meanInitialReturn.toFixed(2)}
          </div>
          <div className="text-xs text-slate-500 mt-1 font-mono tabular-nums">
            r_raw μ={result.rewardMean.toFixed(1)}, σ={result.rewardStd.toFixed(1)}
          </div>
        </div>
        <div className="p-5">
          <div className="text-xs text-slate-500">Low-Support (s, a) Rate</div>
          <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 mt-1">
            {(result.lowSupportOodRate * 100).toFixed(1)}%
          </div>
          <div className="text-xs text-slate-500 mt-1">
            Cells with train count &lt; 8 or μ &lt; 0.20
          </div>
        </div>
      </section>

      {/* Trajectory Length & Reward Diversity Summary Panel */}
      <MdpTrajectorySummaryPanel config={config} result={result} />

      {/* Cumulative Reward per Trajectory Density Plot */}
      <MdpRewardDensityPlot
        config={config}
        result={result}
        onChangeRewardScale={(mode) =>
          onUpdateConfig({ ...config, rewardScale: mode })
        }
      />

      {/* Gamma & Reward Scale Sensitivity Simulator */}
      <MdpSensitivityAnalyzer
        config={config}
        result={result}
        onApplyConfig={onUpdateConfig}
      />

      {/* Behavior Policy Action Breakdown */}
      <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200">
          <h2 className="text-sm font-semibold text-slate-900">
            Behavior Policy Action Support & Return Breakdown
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Empirical action distribution μ_β(a) and low-support transition counts requiring conservative Q-learning regularization.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-600">
                <th className="py-2.5 px-4">Action</th>
                <th className="py-2.5 px-4 text-right">Transitions</th>
                <th className="py-2.5 px-4">Empirical Policy Share</th>
                <th className="py-2.5 px-4 text-right">Mean Scaled r_t</th>
                <th className="py-2.5 px-4 text-right">Mean Return G_t</th>
                <th className="py-2.5 px-4 text-right">Low-Support OOD</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-xs">
              {result.actionBreakdown.map((act) => (
                <tr key={act.actionId} className="h-10 hover:bg-slate-50/70">
                  <td className="py-2 px-4 font-medium text-slate-900">
                    <span className="font-mono text-slate-500 mr-1.5">a={act.actionId}</span>
                    <span>{act.actionLabel}</span>
                  </td>
                  <td className="py-2 px-4 text-right font-mono tabular-nums text-slate-800">
                    {act.count.toLocaleString()}
                  </td>
                  <td className="py-2 px-4 w-56">
                    <div className="flex items-center gap-2.5">
                      <div className="flex-1 h-2 bg-slate-100 rounded overflow-hidden">
                        <div
                          className="h-full bg-blue-700 rounded"
                          style={{ width: `${Math.round(act.share * 100)}%` }}
                        />
                      </div>
                      <span className="font-mono tabular-nums text-slate-700 w-12 text-right">
                        {(act.share * 100).toFixed(1)}%
                      </span>
                    </div>
                  </td>
                  <td className="py-2 px-4 text-right font-mono tabular-nums text-slate-900">
                    {act.meanReward.toFixed(2)}
                  </td>
                  <td className="py-2 px-4 text-right font-mono tabular-nums font-semibold text-slate-900">
                    {act.meanReturnToGo.toFixed(2)}
                  </td>
                  <td className="py-2 px-4 text-right font-mono tabular-nums text-slate-700">
                    {act.lowSupportCount} ({((act.lowSupportCount / (act.count || 1)) * 100).toFixed(0)}%)
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* MDP Replay Transitions Table */}
      <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              Materialized MDP Transition Tuples (s_t, a_t, r_t, s_t+1, done)
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Showing {visibleTransitions.length} of {result.transitions.length.toLocaleString()} transitions.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={onlyOod}
                onChange={(e) => setOnlyOod(e.target.checked)}
                className="w-3.5 h-3.5 rounded border-slate-300 text-blue-700"
              />
              <span>Low-support OOD only</span>
            </label>
            <label className="flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={onlyTerminal}
                onChange={(e) => setOnlyTerminal(e.target.checked)}
                className="w-3.5 h-3.5 rounded border-slate-300 text-blue-700"
              />
              <span>Terminal (done=1) only</span>
            </label>
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Filter entity or action..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-md w-48 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
              />
            </div>
          </div>
        </div>

        <div className="overflow-x-auto max-h-[420px]">
          <table className="w-full text-left border-collapse">
            <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-600">
              <tr>
                <th className="py-2.5 px-4">Transition</th>
                <th className="py-2.5 px-4">Split</th>
                <th className="py-2.5 px-4">State s_t [rec, freq, eng]</th>
                <th className="py-2.5 px-4">Action a_t</th>
                <th className="py-2.5 px-4 text-right">r_t (scaled)</th>
                <th className="py-2.5 px-4">Next s_t+1 [rec, freq, eng]</th>
                <th className="py-2.5 px-4 text-right">Done</th>
                <th className="py-2.5 px-4 text-right">Return G_t</th>
                <th className="py-2.5 px-4 text-right">μ(a|s)</th>
                <th className="py-2.5 px-4">Support Coverage</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-xs">
              {visibleTransitions.map((t) => (
                <tr key={t.transitionId} className="hover:bg-slate-50/80 h-9">
                  <td className="py-2 px-4 font-mono font-medium text-slate-900 whitespace-nowrap">
                    {t.transitionId}
                  </td>
                  <td className="py-2 px-4 font-mono text-slate-500">{t.split}</td>
                  <td className="py-2 px-4 font-mono tabular-nums text-slate-700 whitespace-nowrap">
                    [{t.state.recencyDays}d, {t.state.frequencyCount}, {t.state.engagementScore.toFixed(2)}]
                  </td>
                  <td className="py-2 px-4 text-slate-800 whitespace-nowrap">
                    <span className="font-mono text-slate-500 mr-1">{t.actionId}:</span>
                    {t.actionLabel}
                  </td>
                  <td className="py-2 px-4 text-right font-mono tabular-nums text-slate-900">
                    {t.rewardScaled.toFixed(2)}
                  </td>
                  <td className="py-2 px-4 font-mono tabular-nums text-slate-700 whitespace-nowrap">
                    [{t.nextState.recencyDays}d, {t.nextState.frequencyCount}, {t.nextState.engagementScore.toFixed(2)}]
                  </td>
                  <td className="py-2 px-4 text-right font-mono tabular-nums">
                    {t.done === 1 ? (
                      <span className="font-semibold text-amber-700">1 ({t.terminalReason === 'inactivity_gap' ? 'gap' : 'end'})</span>
                    ) : (
                      <span className="text-slate-500">0</span>
                    )}
                  </td>
                  <td className="py-2 px-4 text-right font-mono tabular-nums font-semibold text-slate-900">
                    {t.returnToGo.toFixed(2)}
                  </td>
                  <td className="py-2 px-4 text-right font-mono tabular-nums text-slate-600">
                    {t.behaviorPropensity.toFixed(2)}
                  </td>
                  <td className="py-2 px-4 whitespace-nowrap">
                    {t.isLowSupportOod ? (
                      <span className="inline-flex items-center gap-1 text-amber-700 font-medium">
                        <AlertTriangle className="w-3.5 h-3.5" />
                        <span>Low Support (n={t.supportCount})</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-emerald-700">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Nominal (n={t.supportCount})</span>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              {visibleTransitions.length === 0 && (
                <tr>
                  <td colSpan={10} className="py-10 text-center text-slate-500">
                    No transitions match the active filter criteria.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
