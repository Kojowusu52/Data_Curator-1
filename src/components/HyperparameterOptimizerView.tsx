import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ShieldAlert,
  Sliders,
  Sparkles,
} from 'lucide-react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  GlobalCurationConfig,
  HyperparameterTrialResult,
  OptimizationObjective,
  RawEvent,
  SequenceConfig,
  TransformerArchitectureId,
} from '../types/curation';
import {
  TRANSFORMER_ARCHITECTURE_CATALOG,
  runHyperparameterSearch,
} from '../engine/curationEngine';

interface HyperparameterOptimizerViewProps {
  events: RawEvent[];
  globalConfig: GlobalCurationConfig;
  seqConfig: SequenceConfig;
  onUpdateSeqConfig: (next: SequenceConfig) => void;
  onNavigateSequence: () => void;
}

type TrialFilterMode = 'top_10' | 'good_fit' | 'all';

export const HyperparameterOptimizerView: React.FC<
  HyperparameterOptimizerViewProps
> = ({
  events,
  globalConfig,
  seqConfig,
  onUpdateSeqConfig,
  onNavigateSequence,
}) => {
  const [targetArch, setTargetArch] = useState<TransformerArchitectureId>(
    seqConfig.transformerArch ?? 'transformer_encoder'
  );
  const [objective, setObjective] = useState<OptimizationObjective>(
    'balanced_generalization'
  );
  const [dropoutPolicy, setDropoutPolicy] = useState<string>('auto');
  const [selectedTrialId, setSelectedTrialId] = useState<string | null>(null);
  const [trialFilter, setTrialFilter] = useState<TrialFilterMode>('top_10');
  const [scaleMode, setScaleMode] = useState<'normalized_mse' | 'rmse_usd'>(
    'normalized_mse'
  );

  const report = useMemo(
    () =>
      runHyperparameterSearch(events, seqConfig, globalConfig, {
        architectureOverride: targetArch,
        objective,
        dropoutOverride:
          dropoutPolicy === 'auto' ? 'auto' : Number(dropoutPolicy),
      }),
    [events, seqConfig, globalConfig, targetArch, objective, dropoutPolicy]
  );

  const inspectedTrial = useMemo<HyperparameterTrialResult>(() => {
    if (!selectedTrialId) return report.recommendedTrial;
    return (
      report.trials.find((t) => t.trialId === selectedTrialId) ??
      report.recommendedTrial
    );
  }, [report.trials, report.recommendedTrial, selectedTrialId]);

  const visibleTrials = useMemo(() => {
    if (trialFilter === 'good_fit') {
      return report.trials.filter((t) => t.diagnosis === 'good_fit');
    }
    if (trialFilter === 'top_10') {
      return report.trials.slice(0, 12);
    }
    return report.trials;
  }, [report.trials, trialFilter]);

  const chartData = useMemo(() => {
    const recPts = inspectedTrial.lossCurve.points;
    const curPts = report.currentTrial.lossCurve.points;
    return recPts.map((pt, idx) => {
      const cur = curPts[idx];
      return {
        epoch: pt.epoch,
        trialTrain:
          scaleMode === 'normalized_mse' ? pt.trainLoss : pt.trainRmse,
        trialVal:
          scaleMode === 'normalized_mse'
            ? pt.valLoss
            : pt.valRmse,
        currentVal:
          cur && cur.valLoss !== null
            ? scaleMode === 'normalized_mse'
              ? cur.valLoss
              : cur.valRmse
            : null,
        currentTrain: cur
          ? scaleMode === 'normalized_mse'
            ? cur.trainLoss
            : cur.trainRmse
          : null,
      };
    });
  }, [inspectedTrial, report.currentTrial, scaleMode]);

  const handleApplyTrial = (trial: HyperparameterTrialResult) => {
    onUpdateSeqConfig({
      ...seqConfig,
      transformerArch: trial.architecture,
      batchSize: trial.batchSize,
      learningRate: trial.learningRate,
      dModel: trial.dModel,
      numHeads: trial.numHeads,
      numLayers: trial.numLayers,
      dropoutRate: trial.dropoutRate,
    });
  };

  const isRecommendedApplied =
    report.recommendedTrial.isCurrentConfig &&
    (seqConfig.transformerArch ?? 'transformer_encoder') ===
      report.recommendedTrial.architecture;

  const finalValImprovement =
    report.currentTrial.finalValLoss !== null &&
    report.recommendedTrial.finalValLoss !== null
      ? report.currentTrial.finalValLoss - report.recommendedTrial.finalValLoss
      : null;

  const renderStatus = (diag: HyperparameterTrialResult['diagnosis'], label: string) => {
    if (diag === 'good_fit') {
      return (
        <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
          <span>{label}</span>
        </span>
      );
    }
    if (diag === 'overfitting') {
      return (
        <span className="inline-flex items-center gap-1 text-rose-700 font-medium">
          <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
          <span>{label}</span>
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 text-amber-700 font-medium">
        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
        <span>{label}</span>
      </span>
    );
  };

  return (
    <div className="space-y-6">
      {/* Header & Search Configuration */}
      <section className="bg-white border border-slate-200 rounded-lg p-5">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 pb-4 border-b border-slate-200">
          <div>
            <h1 className="text-lg font-bold text-slate-900">
              Hyperparameter Optimizer (Loss-History Search)
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Evaluates {report.trials.length} combinations of batch size, learning rate, and Transformer depth/width against the loaded dataset&apos;s Train (n={report.trainSampleCount}) vs. {report.evalSplitLabel} (n={report.evalSampleCount}) loss trajectories.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => handleApplyTrial(report.recommendedTrial)}
              disabled={isRecommendedApplied}
              className={`px-3.5 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 ${
                isRecommendedApplied
                  ? 'bg-emerald-50 text-emerald-800 border border-emerald-200 cursor-default'
                  : 'bg-blue-700 text-white hover:bg-blue-800'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>
                {isRecommendedApplied
                  ? 'Optimal Config Active'
                  : 'Apply Optimal Config'}
              </span>
            </button>
            <button
              type="button"
              onClick={onNavigateSequence}
              className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-slate-50 border border-slate-200 rounded-md hover:bg-slate-100 transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5"
            >
              <span>View Loss Curve</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <div className="pt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <div className="text-xs font-medium text-slate-700 mb-1.5">
              Target Transformer Architecture
            </div>
            <div className="grid grid-cols-3 gap-1 p-1 bg-slate-100 rounded-md">
              {TRANSFORMER_ARCHITECTURE_CATALOG.map((arch) => (
                <button
                  key={arch.id}
                  type="button"
                  onClick={() => {
                    setTargetArch(arch.id);
                    setSelectedTrialId(null);
                  }}
                  className={`py-1.5 px-2 text-xs font-medium rounded transition-colors truncate ${
                    targetArch === arch.id
                      ? 'bg-white text-slate-900 font-semibold shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {arch.id === 'transformer_encoder'
                    ? 'Encoder'
                    : arch.id === 'causal_gpt'
                    ? 'Causal GPT'
                    : 'TFT'}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="text-xs font-medium text-slate-700 mb-1.5">
              Optimization Objective
            </div>
            <div className="grid grid-cols-3 gap-1 p-1 bg-slate-100 rounded-md">
              {(
                [
                  { id: 'balanced_generalization', label: 'Balanced Fit' },
                  { id: 'min_val_loss', label: 'Min Loss' },
                  { id: 'fast_convergence', label: 'Fast Conv.' },
                ] as const
              ).map((obj) => (
                <button
                  key={obj.id}
                  type="button"
                  onClick={() => {
                    setObjective(obj.id);
                    setSelectedTrialId(null);
                  }}
                  className={`py-1.5 px-2 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                    objective === obj.id
                      ? 'bg-white text-slate-900 font-semibold shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {obj.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label
              htmlFor="opt-dropout-policy"
              className="block text-xs font-medium text-slate-700 mb-1.5"
            >
              Dropout Regularization Policy
            </label>
            <select
              id="opt-dropout-policy"
              value={dropoutPolicy}
              onChange={(e) => {
                setDropoutPolicy(e.target.value);
                setSelectedTrialId(null);
              }}
              className="w-full px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
            >
              <option value="auto">
                Auto-Matched to Depth (5% / 10% / 20%)
              </option>
              <option value="0">Fixed 0.0 (No Dropout)</option>
              <option value="0.1">Fixed 0.1 (Standard)</option>
              <option value="0.2">Fixed 0.2 (Moderate)</option>
              <option value="0.3">Fixed 0.3 (Strong)</option>
            </select>
          </div>
        </div>
      </section>

      {/* Recommended Hyperparameters Summary Strip */}
      <section className="bg-white border border-slate-200 rounded-lg grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-slate-200">
        <div className="p-5 flex flex-col justify-between">
          <div>
            <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">
              Optimal Batch Size
            </div>
            <div className="text-2xl font-bold font-mono tabular-nums text-blue-700 mt-1">
              bs = {report.recommendedTrial.batchSize}
            </div>
            <div className="text-[11px] font-mono tabular-nums text-slate-500 mt-0.5">
              Current: bs = {report.currentTrial.batchSize}
            </div>
          </div>
          <p className="text-xs text-slate-600 mt-3 leading-relaxed">
            {report.rationale.batchSizeReason}
          </p>
        </div>

        <div className="p-5 flex flex-col justify-between">
          <div>
            <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">
              Optimal Learning Rate
            </div>
            <div className="text-2xl font-bold font-mono tabular-nums text-blue-700 mt-1">
              {report.recommendedTrial.learningRate.toExponential(1)}
            </div>
            <div className="text-[11px] font-mono tabular-nums text-slate-500 mt-0.5">
              Current: {report.currentTrial.learningRate.toExponential(1)} (
              {report.recommendedTrial.learningRate.toFixed(4)})
            </div>
          </div>
          <p className="text-xs text-slate-600 mt-3 leading-relaxed">
            {report.rationale.learningRateReason}
          </p>
        </div>

        <div className="p-5 flex flex-col justify-between">
          <div>
            <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">
              Optimal Architecture Depth
            </div>
            <div className="text-xl font-bold font-mono tabular-nums text-slate-900 mt-1">
              {report.recommendedTrial.numLayers}L · d=
              {report.recommendedTrial.dModel} · {report.recommendedTrial.numHeads}h
            </div>
            <div className="text-[11px] font-mono tabular-nums text-slate-500 mt-0.5">
              {report.recommendedTrial.estimatedParams.toLocaleString()} params ·
              dropout {(report.recommendedTrial.dropoutRate * 100).toFixed(0)}%
            </div>
          </div>
          <p className="text-xs text-slate-600 mt-3 leading-relaxed">
            {report.rationale.depthReason}
          </p>
        </div>

        <div className="p-5 flex flex-col justify-between bg-slate-50/40">
          <div>
            <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">
              Loss Improvement vs. Current
            </div>
            <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 mt-1">
              {report.recommendedTrial.finalValLoss !== null
                ? report.recommendedTrial.finalValLoss.toFixed(3)
                : report.recommendedTrial.finalTrainLoss.toFixed(3)}
              <span className="text-xs font-medium text-slate-500 ml-1.5">
                {report.evalSplitLabel} MSE
              </span>
            </div>
            <div className="text-[11px] font-mono tabular-nums text-slate-600 mt-0.5">
              {finalValImprovement !== null
                ? finalValImprovement > 0.0005
                  ? `−${finalValImprovement.toFixed(4)} vs current (${report.currentTrial.finalValLoss?.toFixed(3)})`
                  : finalValImprovement < -0.0005
                  ? `+${Math.abs(finalValImprovement).toFixed(4)} delta (lower gap)`
                  : 'Matches current config'
                : 'Train loss basis'}
            </div>
          </div>
          <div className="mt-3 text-xs">
            {renderStatus(
              report.recommendedTrial.diagnosis,
              report.recommendedTrial.diagnosisLabel
            )}
            <div className="text-[11px] font-mono text-slate-500 mt-1 tabular-nums">
              Current Rank: #{report.currentTrial.rank} of {report.trials.length}
            </div>
          </div>
        </div>
      </section>

      {/* Loss History Comparison Chart */}
      <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <Sliders className="w-4 h-4 text-blue-700 shrink-0 mt-0.5" />
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                Loss Trajectory Comparison: Trial #{inspectedTrial.rank} vs. Current Configuration
              </h2>
              <p className="text-xs text-slate-500 mt-0.5 font-mono tabular-nums">
                Inspected: bs={inspectedTrial.batchSize} · lr=
                {inspectedTrial.learningRate.toExponential(1)} ·{' '}
                {inspectedTrial.numLayers}L/d{inspectedTrial.dModel} · dropout=
                {inspectedTrial.dropoutRate.toFixed(2)} vs. Current: bs=
                {report.currentTrial.batchSize} · lr=
                {report.currentTrial.learningRate.toExponential(1)} ·{' '}
                {report.currentTrial.numLayers}L/d{report.currentTrial.dModel}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-md self-start shrink-0">
            <button
              type="button"
              onClick={() => setScaleMode('normalized_mse')}
              className={`px-3 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                scaleMode === 'normalized_mse'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Normalized MSE
            </button>
            <button
              type="button"
              onClick={() => setScaleMode('rmse_usd')}
              className={`px-3 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                scaleMode === 'rmse_usd'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              RMSE ($)
            </button>
          </div>
        </div>

        <div className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3 text-xs text-slate-600">
            <div className="flex flex-wrap items-center gap-5">
              <span className="inline-flex items-center gap-2 font-medium text-slate-800">
                <span className="w-4 h-0.5 bg-blue-700 inline-block" aria-hidden="true" />
                <span>
                  Trial #{inspectedTrial.rank} {report.evalSplitLabel} Loss
                </span>
              </span>
              <span className="inline-flex items-center gap-2 font-medium text-slate-600">
                <span className="w-4 border-t-2 border-dotted border-slate-500 inline-block" aria-hidden="true" />
                <span>Trial #{inspectedTrial.rank} Train Loss</span>
              </span>
              <span className="inline-flex items-center gap-2 font-medium text-orange-700">
                <span className="w-4 border-t-2 border-dashed border-orange-600 inline-block" aria-hidden="true" />
                <span>Current Config {report.evalSplitLabel} Loss</span>
              </span>
            </div>
            <span className="text-[11px] font-mono text-slate-500">
              Click any row in the search grid below to compare its trajectory
            </span>
          </div>

          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={chartData}
                margin={{ top: 8, right: 20, left: 6, bottom: 10 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis
                  dataKey="epoch"
                  tick={{ fontSize: 11, fill: '#475569' }}
                  tickLine={false}
                  axisLine={{ stroke: '#cbd5e1' }}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: '#475569' }}
                  tickLine={false}
                  axisLine={{ stroke: '#cbd5e1' }}
                  width={56}
                  domain={['auto', 'auto']}
                  tickFormatter={(v: number) =>
                    scaleMode === 'normalized_mse'
                      ? v.toFixed(2)
                      : `$${Math.round(v)}`
                  }
                />
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload || payload.length === 0) return null;
                    const row = payload[0].payload as (typeof chartData)[number];
                    const fmt = (v: number | null) =>
                      v === null
                        ? '—'
                        : scaleMode === 'normalized_mse'
                        ? v.toFixed(4)
                        : `$${v.toFixed(2)}`;
                    return (
                      <div className="bg-white border border-slate-200 rounded-md px-3 py-2 shadow-sm text-xs font-mono tabular-nums space-y-1">
                        <div className="font-semibold text-slate-900 border-b border-slate-100 pb-1">
                          Epoch {row.epoch} / 30
                        </div>
                        <div className="flex justify-between gap-4 text-blue-700">
                          <span>Trial #{inspectedTrial.rank} Val:</span>
                          <span className="font-semibold">{fmt(row.trialVal)}</span>
                        </div>
                        <div className="flex justify-between gap-4 text-slate-600">
                          <span>Trial #{inspectedTrial.rank} Train:</span>
                          <span>{fmt(row.trialTrain)}</span>
                        </div>
                        <div className="flex justify-between gap-4 text-orange-700 pt-0.5 border-t border-slate-100">
                          <span>Current Val:</span>
                          <span className="font-semibold">{fmt(row.currentVal)}</span>
                        </div>
                      </div>
                    );
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="trialTrain"
                  stroke="#64748b"
                  strokeWidth={1.75}
                  strokeDasharray="2 3"
                  dot={false}
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="currentVal"
                  stroke="#ea580c"
                  strokeWidth={2}
                  strokeDasharray="6 3"
                  dot={false}
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="trialVal"
                  stroke="#1d4ed8"
                  strokeWidth={2.5}
                  dot={false}
                  activeDot={{ r: 4, fill: '#1d4ed8' }}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </section>

      {/* Hyperparameter Search Leaderboard */}
      <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              Hyperparameter Search Leaderboard ({report.architectureLabel})
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Ranked by {objective.replace(/_/g, ' ')} across {report.trials.length} evaluated configurations.
            </p>
          </div>

          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-md self-start shrink-0">
            {(
              [
                { id: 'top_10', label: 'Top 12' },
                { id: 'good_fit', label: 'Balanced Fit Only' },
                { id: 'all', label: `All (${report.trials.length})` },
              ] as const
            ).map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setTrialFilter(f.id)}
                className={`px-3 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                  trialFilter === f.id
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto max-h-[420px]">
          <table className="w-full text-left border-collapse">
            <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-600">
              <tr>
                <th className="py-2.5 px-4">Rank</th>
                <th className="py-2.5 px-3 text-right">Batch</th>
                <th className="py-2.5 px-3 text-right">Learn Rate</th>
                <th className="py-2.5 px-3">Architecture Depth</th>
                <th className="py-2.5 px-3 text-right">Dropout</th>
                <th className="py-2.5 px-3 text-right">Best Val</th>
                <th className="py-2.5 px-3 text-right">Final Val</th>
                <th className="py-2.5 px-3 text-right">Train Loss</th>
                <th className="py-2.5 px-3 text-right">Gap</th>
                <th className="py-2.5 px-3">Fit Diagnosis</th>
                <th className="py-2.5 px-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-xs font-mono tabular-nums">
              {visibleTrials.map((trial) => {
                const isInspected = inspectedTrial.trialId === trial.trialId;
                return (
                  <tr
                    key={trial.trialId}
                    onClick={() => setSelectedTrialId(trial.trialId)}
                    className={`cursor-pointer transition-colors ${
                      isInspected
                        ? 'bg-blue-50/70'
                        : trial.isCurrentConfig
                        ? 'bg-amber-50/40 hover:bg-amber-50/70'
                        : 'bg-white hover:bg-slate-50'
                    }`}
                  >
                    <td className="py-2.5 px-4 font-semibold text-slate-900 whitespace-nowrap">
                      #{trial.rank}
                      {trial.rank === 1 && (
                        <span className="ml-1.5 font-sans text-[11px] font-semibold text-blue-700">
                          Optimal
                        </span>
                      )}
                      {trial.isCurrentConfig && (
                        <span className="ml-1.5 font-sans text-[11px] font-semibold text-amber-700">
                          Current
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-right text-slate-800">
                      {trial.batchSize}
                    </td>
                    <td className="py-2.5 px-3 text-right text-slate-800">
                      {trial.learningRate.toExponential(1)}
                    </td>
                    <td className="py-2.5 px-3 font-sans text-slate-700 whitespace-nowrap">
                      {trial.depthLabel}
                    </td>
                    <td className="py-2.5 px-3 text-right text-slate-600">
                      {(trial.dropoutRate * 100).toFixed(0)}%
                    </td>
                    <td className="py-2.5 px-3 text-right font-semibold text-slate-900">
                      {trial.bestValLoss !== null
                        ? trial.bestValLoss.toFixed(3)
                        : '—'}
                    </td>
                    <td className="py-2.5 px-3 text-right text-slate-800">
                      {trial.finalValLoss !== null
                        ? trial.finalValLoss.toFixed(3)
                        : '—'}
                    </td>
                    <td className="py-2.5 px-3 text-right text-slate-600">
                      {trial.finalTrainLoss.toFixed(3)}
                    </td>
                    <td className="py-2.5 px-3 text-right text-slate-700">
                      {trial.generalizationGap !== null
                        ? `${trial.generalizationGap >= 0 ? '+' : ''}${trial.generalizationGap.toFixed(3)}`
                        : '—'}
                    </td>
                    <td className="py-2.5 px-3 font-sans whitespace-nowrap">
                      {renderStatus(trial.diagnosis, trial.diagnosisLabel)}
                    </td>
                    <td className="py-2.5 px-4 text-right font-sans whitespace-nowrap">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleApplyTrial(trial);
                        }}
                        className="px-2.5 py-1 text-xs font-medium text-blue-700 bg-white border border-slate-200 rounded hover:bg-blue-50 transition-colors"
                      >
                        {trial.isCurrentConfig ? 'Active' : 'Apply'}
                      </button>
                    </td>
                  </tr>
                );
              })}
              {visibleTrials.length === 0 && (
                <tr>
                  <td
                    colSpan={11}
                    className="py-8 text-center font-sans text-xs text-slate-500"
                  >
                    No trials match the selected filter. Switch to &ldquo;All&rdquo; to inspect every configuration.
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
