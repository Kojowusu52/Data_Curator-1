import React, { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ShieldAlert,
  TrendingDown,
} from 'lucide-react';
import {
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
  TransformerEvaluationSummary,
  TransformerLossEpochPoint,
} from '../types/curation';

interface TransformerLossChartProps {
  transformerEval: TransformerEvaluationSummary;
  batchSize: number;
  maxSeqLen: number;
}

type LossScaleMode = 'normalized_mse' | 'rmse_usd';

export const TransformerLossChart: React.FC<TransformerLossChartProps> = ({
  transformerEval,
  batchSize,
  maxSeqLen,
}) => {
  const [scaleMode, setScaleMode] = useState<LossScaleMode>('normalized_mse');
  const lossCurve = transformerEval.lossCurve;
  const hasValidation =
    lossCurve.evalSampleCount >= 2 && lossCurve.finalValLoss !== null;

  const statusMeta =
    lossCurve.diagnosis === 'good_fit'
      ? {
          icon: CheckCircle2,
          textClass: 'text-emerald-700',
          bannerClass: 'bg-emerald-50/70 border-emerald-200 text-emerald-900',
          iconClass: 'text-emerald-700',
        }
      : lossCurve.diagnosis === 'overfitting'
      ? {
          icon: ShieldAlert,
          textClass: 'text-rose-700',
          bannerClass: 'bg-rose-50/80 border-rose-200 text-rose-900',
          iconClass: 'text-rose-700',
        }
      : lossCurve.diagnosis === 'underfitting'
      ? {
          icon: AlertTriangle,
          textClass: 'text-amber-700',
          bannerClass: 'bg-amber-50/80 border-amber-200 text-amber-900',
          iconClass: 'text-amber-700',
        }
      : {
          icon: AlertTriangle,
          textClass: 'text-slate-600',
          bannerClass: 'bg-slate-50 border-slate-200 text-slate-700',
          iconClass: 'text-slate-500',
        };

  const StatusIcon = statusMeta.icon;

  const trainDataKey =
    scaleMode === 'normalized_mse' ? 'trainLoss' : 'trainRmse';
  const valDataKey = scaleMode === 'normalized_mse' ? 'valLoss' : 'valRmse';

  return (
    <section
      aria-label="Transformer Training and Validation Loss Curve"
      className="bg-white border border-slate-200 rounded-lg overflow-hidden"
    >
      {/* Header */}
      <div className="px-6 py-4 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <TrendingDown className="w-4 h-4 text-blue-700 shrink-0 mt-0.5" />
          <div>
            <div className="flex flex-wrap items-center gap-2.5">
              <h2 className="text-sm font-semibold text-slate-900">
                Training vs. {lossCurve.evalSplitLabel} Loss Trajectory
              </h2>
              <span
                className={`inline-flex items-center gap-1 text-xs font-semibold ${statusMeta.textClass}`}
              >
                <StatusIcon className="w-3.5 h-3.5" />
                <span>{lossCurve.diagnosisLabel}</span>
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5 font-mono tabular-nums">
              {transformerEval.architectureLabel} · d_model={transformerEval.dModel} ·{' '}
              {transformerEval.numHeads}h · {transformerEval.numLayers}L · dropout=
              {(transformerEval.dropoutRate * 100).toFixed(0)}% · lr=
              {transformerEval.learningRate.toExponential(1)} · bs={batchSize} · L={maxSeqLen} ·
              Train n={lossCurve.trainSampleCount} vs {lossCurve.evalSplitLabel} n=
              {lossCurve.evalSampleCount}
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

      {/* 4-Metric Trajectory Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 divide-y lg:divide-y-0 lg:divide-x divide-slate-200 border-b border-slate-200 bg-slate-50/50">
        <div className="p-4">
          <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">
            Final Train Loss (Ep {lossCurve.epochs})
          </div>
          <div className="text-lg font-bold font-mono tabular-nums text-blue-700 mt-1">
            {lossCurve.points.length > 0
              ? scaleMode === 'normalized_mse'
                ? lossCurve.finalTrainLoss.toFixed(3)
                : `$${lossCurve.finalTrainRmse.toFixed(2)}`
              : '—'}
          </div>
          <div className="text-[11px] font-mono tabular-nums text-slate-500 mt-0.5">
            {lossCurve.points.length > 0
              ? scaleMode === 'normalized_mse'
                ? `$${lossCurve.finalTrainRmse.toFixed(2)} Train RMSE`
                : `${lossCurve.finalTrainLoss.toFixed(3)} Norm MSE`
              : 'No training curve'}
          </div>
        </div>

        <div className="p-4">
          <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">
            Final {lossCurve.evalSplitLabel} Loss
          </div>
          <div className="text-lg font-bold font-mono tabular-nums text-orange-700 mt-1">
            {hasValidation && lossCurve.finalValLoss !== null
              ? scaleMode === 'normalized_mse'
                ? lossCurve.finalValLoss.toFixed(3)
                : `$${(lossCurve.finalValRmse ?? 0).toFixed(2)}`
              : '—'}
          </div>
          <div className="text-[11px] font-mono tabular-nums text-slate-500 mt-0.5">
            {hasValidation && lossCurve.bestValLoss !== null
              ? `Best: ${lossCurve.bestValLoss.toFixed(3)} @ Ep ${lossCurve.bestEpoch}`
              : 'Validation split required'}
          </div>
        </div>

        <div className="p-4">
          <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">
            Generalization Gap (Val − Train)
          </div>
          <div
            className={`text-lg font-bold font-mono tabular-nums mt-1 ${
              lossCurve.diagnosis === 'overfitting'
                ? 'text-rose-700'
                : lossCurve.diagnosis === 'underfitting'
                ? 'text-amber-700'
                : 'text-slate-900'
            }`}
          >
            {lossCurve.generalizationGap !== null
              ? `${lossCurve.generalizationGap >= 0 ? '+' : ''}${lossCurve.generalizationGap.toFixed(3)}`
              : '—'}
          </div>
          <div className="text-[11px] font-mono tabular-nums text-slate-500 mt-0.5">
            {lossCurve.valReboundDelta !== null
              ? `Val rebound: +${lossCurve.valReboundDelta.toFixed(3)}`
              : 'Normalized MSE delta'}
          </div>
        </div>

        <div className="p-4">
          <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">
            Capacity Pressure (Params / n)
          </div>
          <div className="text-lg font-bold font-mono tabular-nums text-slate-900 mt-1">
            {lossCurve.paramToSampleRatio.toLocaleString()}×
          </div>
          <div className="text-[11px] font-mono tabular-nums text-slate-500 mt-0.5">
            {transformerEval.estimatedParams.toLocaleString()} params /{' '}
            {lossCurve.trainSampleCount} train seqs
          </div>
        </div>
      </div>

      {/* Loss-Over-Time Line Chart */}
      <div className="p-5">
        {lossCurve.points.length > 0 ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 mb-3 text-xs text-slate-600">
              <div className="flex flex-wrap items-center gap-5">
                <span className="inline-flex items-center gap-2 font-medium text-slate-700">
                  <span
                    className="inline-block w-4 h-0.5 bg-blue-700"
                    aria-hidden="true"
                  />
                  <span>Train Loss</span>
                </span>
                {hasValidation && (
                  <span className="inline-flex items-center gap-2 font-medium text-slate-700">
                    <span
                      className="inline-block w-4 border-t-2 border-dashed border-orange-600"
                      aria-hidden="true"
                    />
                    <span>{lossCurve.evalSplitLabel} Loss</span>
                  </span>
                )}
              </div>
              <span className="text-[11px] font-mono tabular-nums text-slate-500">
                {scaleMode === 'normalized_mse'
                  ? '1.000 = Mean Predictor Baseline (SSE / SST)'
                  : 'Dollar Error Scale (RMSE in USD)'}
              </span>
            </div>

            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={lossCurve.points}
                  margin={{ top: 10, right: 20, left: 6, bottom: 8 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis
                    dataKey="epoch"
                    tick={{ fontSize: 11, fill: '#475569' }}
                    tickLine={false}
                    axisLine={{ stroke: '#cbd5e1' }}
                    label={{
                      value: 'Optimization Epoch',
                      position: 'insideBottom',
                      offset: -4,
                      fontSize: 11,
                      fill: '#64748b',
                    }}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: '#475569' }}
                    tickLine={false}
                    axisLine={{ stroke: '#cbd5e1' }}
                    width={58}
                    domain={['auto', 'auto']}
                    tickFormatter={(v: number) =>
                      scaleMode === 'normalized_mse'
                        ? v.toFixed(2)
                        : `$${Math.round(v)}`
                    }
                  />
                  {scaleMode === 'normalized_mse' && (
                    <ReferenceLine
                      y={1}
                      stroke="#94a3b8"
                      strokeDasharray="4 4"
                      label={{
                        value: 'Baseline (1.0)',
                        position: 'insideTopRight',
                        fontSize: 10,
                        fill: '#64748b',
                      }}
                    />
                  )}
                  {hasValidation && lossCurve.bestEpoch > 0 && (
                    <ReferenceLine
                      x={lossCurve.bestEpoch}
                      stroke="#0f766e"
                      strokeDasharray="3 3"
                      label={{
                        value: `Best Ep ${lossCurve.bestEpoch}`,
                        position: 'top',
                        fontSize: 10,
                        fill: '#0f766e',
                      }}
                    />
                  )}
                  <Tooltip
                    content={({ active, payload }) => {
                      if (!active || !payload || payload.length === 0) return null;
                      const pt = payload[0].payload as TransformerLossEpochPoint;
                      return (
                        <div className="bg-white border border-slate-200 rounded-md px-3 py-2 shadow-sm text-xs font-mono tabular-nums space-y-1">
                          <div className="font-semibold text-slate-900 border-b border-slate-100 pb-1">
                            Epoch {pt.epoch} / {lossCurve.epochs}
                          </div>
                          <div className="flex items-center justify-between gap-4 text-blue-700">
                            <span>Train Loss:</span>
                            <span className="font-semibold">
                              {pt.trainLoss.toFixed(4)} (${pt.trainRmse.toFixed(2)})
                            </span>
                          </div>
                          {pt.valLoss !== null && (
                            <div className="flex items-center justify-between gap-4 text-orange-700">
                              <span>{lossCurve.evalSplitLabel}:</span>
                              <span className="font-semibold">
                                {pt.valLoss.toFixed(4)} ($
                                {(pt.valRmse ?? 0).toFixed(2)})
                              </span>
                            </div>
                          )}
                          {pt.generalizationGap !== null && (
                            <div className="flex items-center justify-between gap-4 text-slate-600 pt-0.5 border-t border-slate-100">
                              <span>Gap (Val − Train):</span>
                              <span>
                                {pt.generalizationGap >= 0 ? '+' : ''}
                                {pt.generalizationGap.toFixed(4)}
                              </span>
                            </div>
                          )}
                        </div>
                      );
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey={trainDataKey}
                    name="Train Loss"
                    stroke="#1d4ed8"
                    strokeWidth={2.25}
                    dot={false}
                    activeDot={{ r: 4, fill: '#1d4ed8' }}
                    isAnimationActive={false}
                  />
                  {hasValidation && (
                    <Line
                      type="monotone"
                      dataKey={valDataKey}
                      name={`${lossCurve.evalSplitLabel} Loss`}
                      stroke="#ea580c"
                      strokeWidth={2.25}
                      strokeDasharray="6 3"
                      dot={false}
                      activeDot={{ r: 4, fill: '#ea580c' }}
                      isAnimationActive={false}
                    />
                  )}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </>
        ) : (
          <div className="py-12 text-center text-xs text-slate-500">
            At least 3 training sequences with non-zero target variance are required to plot the Transformer loss trajectory.
          </div>
        )}
      </div>

      {/* Diagnostic Guidance Footer */}
      <div
        role={lossCurve.diagnosis === 'overfitting' ? 'alert' : undefined}
        className={`px-6 py-3 border-t text-xs flex items-start gap-2.5 ${statusMeta.bannerClass}`}
      >
        <StatusIcon className={`w-4 h-4 shrink-0 mt-0.5 ${statusMeta.iconClass}`} />
        <div>
          <span className="font-semibold">{lossCurve.diagnosisLabel}: </span>
          <span>{lossCurve.diagnosisDetail}</span>
        </div>
      </div>
    </section>
  );
};
