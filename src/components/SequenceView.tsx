import React, { useEffect, useState } from 'react';
import { Cpu, Layers, Sparkles } from 'lucide-react';
import {
  NormalizationMode,
  PaddingStrategy,
  SequenceConfig,
  SequenceResult,
  SplitName,
  TransformerArchitectureId,
  TransformerPoolingMode,
  TransformerPositionalEncoding,
  TruncationStrategy,
} from '../types/curation';
import { TRANSFORMER_ARCHITECTURE_CATALOG } from '../engine/curationEngine';
import { TransformerLossChart } from './TransformerLossChart';
import { BatchTrainingSimulator } from './BatchTrainingSimulator';
import { SequenceLengthHistogram } from './SequenceLengthHistogram';

interface SequenceViewProps {
  config: SequenceConfig;
  onUpdateConfig: (next: SequenceConfig) => void;
  result: SequenceResult;
  maxDay: number;
}

function formatParamCount(params: number): string {
  if (params >= 1_000_000) return `${(params / 1_000_000).toFixed(2)}M`;
  if (params >= 1_000) return `${(params / 1_000).toFixed(1)}K`;
  return String(params);
}

export const SequenceView: React.FC<SequenceViewProps> = ({
  config,
  onUpdateConfig,
  result,
  maxDay,
}) => {
  const [selectedEntityId, setSelectedEntityId] = useState<string>('');
  const [showNormalized, setShowNormalized] = useState<boolean>(true);

  useEffect(() => {
    if (
      result.samples.length > 0 &&
      !result.samples.some((s) => s.entityId === selectedEntityId)
    ) {
      setSelectedEntityId(result.samples[0].entityId);
    }
  }, [result.samples, selectedEntityId]);

  const activeSample =
    result.samples.find((s) => s.entityId === selectedEntityId) ?? result.samples[0];

  const tEval = result.transformerEval;
  const activeArchMeta =
    TRANSFORMER_ARCHITECTURE_CATALOG.find((a) => a.id === tEval.architecture) ??
    TRANSFORMER_ARCHITECTURE_CATALOG[0];

  const activeEntityPred = activeSample
    ? tEval.predictionsByEntity[activeSample.entityId]
    : undefined;

  const hasHoldout = tEval.holdoutMetrics.sampleSize >= 2;
  const primaryMetrics = hasHoldout ? tEval.holdoutMetrics : tEval.allMetrics;

  const splitRows = [
    tEval.trainMetrics,
    tEval.valMetrics,
    tEval.testMetrics,
    tEval.allMetrics,
  ];

  return (
    <div className="space-y-6">
      {/* Control Surface */}
      <section className="bg-white border border-slate-200 rounded-lg p-5">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 pb-4 border-b border-slate-200">
          <div>
            <h1 className="text-lg font-bold text-slate-900">
              02. Deep Learning (Transformers &amp; Sequential Tensors)
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Constructs masked rank-3 tensors X in R^[B, L, D] with M in &#123;0, 1&#125;^[B, L] and evaluates Transformer self-attention architectures.
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

        <div className="pt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
          <div>
            <div className="flex items-center justify-between text-xs mb-1.5">
              <span className="font-medium text-slate-700">Max Sequence Len (L)</span>
              <span className="font-mono text-[11px] font-semibold text-blue-700 tabular-nums">
                L = {config.maxSeqLen}
              </span>
            </div>
            <div className="grid grid-cols-4 gap-1 p-1 bg-slate-100 rounded-md">
              {[6, 8, 12, 16].map((len) => (
                <button
                  key={len}
                  type="button"
                  onClick={() => onUpdateConfig({ ...config, maxSeqLen: len })}
                  className={`py-1 text-xs font-mono rounded transition-colors ${
                    config.maxSeqLen === len
                      ? 'bg-white text-slate-900 font-semibold shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {len}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="text-xs font-medium text-slate-700 mb-1.5">
              Padding Alignment
            </div>
            <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-md">
              {(['pre', 'post'] as PaddingStrategy[]).map((pad) => (
                <button
                  key={pad}
                  type="button"
                  onClick={() => onUpdateConfig({ ...config, padding: pad })}
                  className={`py-1 text-xs font-medium rounded transition-colors ${
                    config.padding === pad
                      ? 'bg-white text-slate-900 font-semibold shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {pad === 'pre' ? 'Pre-pad' : 'Post-pad'}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="text-xs font-medium text-slate-700 mb-1.5">
              Truncation Policy
            </div>
            <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-md">
              {(['recent', 'early'] as TruncationStrategy[]).map((tr) => (
                <button
                  key={tr}
                  type="button"
                  onClick={() => onUpdateConfig({ ...config, truncation: tr })}
                  className={`py-1 text-xs font-medium rounded transition-colors ${
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

          <div>
            <label htmlFor="seq-norm-select" className="block text-xs font-medium text-slate-700 mb-1.5">
              Scaler (Train-Fit)
            </label>
            <select
              id="seq-norm-select"
              value={config.normalization}
              onChange={(e) =>
                onUpdateConfig({
                  ...config,
                  normalization: e.target.value as NormalizationMode,
                })
              }
              className="w-full px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
            >
              <option value="zscore">StandardScaler (Z-Score)</option>
              <option value="log1p_zscore">Log1p + Z-Score</option>
              <option value="minmax">MinMax [0, 1]</option>
            </select>
          </div>

          <div>
            <div className="flex items-center justify-between text-xs mb-1.5">
              <label htmlFor="seq-cutoff-range" className="font-medium text-slate-700">
                Obs Cutoff
              </label>
              <span className="font-mono font-semibold text-slate-900 tabular-nums">
                Day {config.obsCutoffDay}
              </span>
            </div>
            <input
              id="seq-cutoff-range"
              type="range"
              min={90}
              max={maxDay}
              step={15}
              value={config.obsCutoffDay}
              onChange={(e) =>
                onUpdateConfig({ ...config, obsCutoffDay: Number(e.target.value) })
              }
              className="w-full accent-blue-700"
            />
          </div>

          <div>
            <div className="flex items-center justify-between text-xs mb-1.5">
              <span className="font-medium text-slate-700">Batch Size (Chunk)</span>
              <span className="font-mono text-[11px] text-slate-500 tabular-nums">
                {result.batchCount} {result.batchCount === 1 ? 'batch' : 'batches'}
              </span>
            </div>
            <div className="grid grid-cols-4 gap-1 p-1 bg-slate-100 rounded-md">
              {[16, 32, 64, 128].map((bs) => (
                <button
                  key={bs}
                  type="button"
                  onClick={() => onUpdateConfig({ ...config, batchSize: bs })}
                  className={`py-1 text-xs font-mono rounded transition-colors ${
                    config.batchSize === bs
                      ? 'bg-white text-slate-900 font-semibold shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {bs}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Transformer Architecture & Attention Controls */}
        <div className="mt-5 pt-4 border-t border-slate-200 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div className="flex items-center gap-2">
              <Cpu className="w-4 h-4 text-blue-700" />
              <h2 className="text-xs font-semibold text-slate-900 uppercase tracking-wide">
                Transformer Model Architecture &amp; Attention Hyperparameters
              </h2>
            </div>
            <div className="text-[11px] font-mono text-slate-500 tabular-nums">
              {activeArchMeta.attentionType} · d_head={tEval.headDim} ·{' '}
              {formatParamCount(tEval.estimatedParams)} params
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            {TRANSFORMER_ARCHITECTURE_CATALOG.map((arch) => {
              const selected = tEval.architecture === arch.id;
              return (
                <button
                  key={arch.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() =>
                    onUpdateConfig({
                      ...config,
                      transformerArch: arch.id,
                    })
                  }
                  className={`p-3 rounded-md border text-left transition-colors ${
                    selected
                      ? 'bg-blue-50/70 border-blue-300 text-slate-900'
                      : 'bg-slate-50/60 border-slate-200 text-slate-700 hover:bg-slate-100/70'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-900">
                      {arch.shortLabel}
                    </span>
                    <span
                      className={`text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded ${
                        selected
                          ? 'bg-blue-700 text-white'
                          : 'bg-slate-200 text-slate-600'
                      }`}
                    >
                      {selected ? 'Active' : 'Select'}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-500 mt-1 leading-snug">
                    {arch.description}
                  </div>
                </button>
              );
            })}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
            <div>
              <div className="text-xs font-medium text-slate-700 mb-1.5">
                Model Width (d_model)
              </div>
              <div className="grid grid-cols-3 gap-1 p-1 bg-slate-100 rounded-md">
                {([64, 128, 256] as const).map((dm) => (
                  <button
                    key={dm}
                    type="button"
                    onClick={() => onUpdateConfig({ ...config, dModel: dm })}
                    className={`py-1 text-xs font-mono rounded transition-colors ${
                      tEval.dModel === dm
                        ? 'bg-white text-slate-900 font-semibold shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {dm}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="text-xs font-medium text-slate-700 mb-1.5">
                Attention Heads (h)
              </div>
              <div className="grid grid-cols-3 gap-1 p-1 bg-slate-100 rounded-md">
                {([2, 4, 8] as const).map((nh) => (
                  <button
                    key={nh}
                    type="button"
                    onClick={() => onUpdateConfig({ ...config, numHeads: nh })}
                    className={`py-1 text-xs font-mono rounded transition-colors ${
                      tEval.numHeads === nh
                        ? 'bg-white text-slate-900 font-semibold shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {nh} heads
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="text-xs font-medium text-slate-700 mb-1.5">
                Encoder/Decoder Layers
              </div>
              <div className="grid grid-cols-3 gap-1 p-1 bg-slate-100 rounded-md">
                {([1, 2, 4] as const).map((nl) => (
                  <button
                    key={nl}
                    type="button"
                    onClick={() => onUpdateConfig({ ...config, numLayers: nl })}
                    className={`py-1 text-xs font-mono rounded transition-colors ${
                      tEval.numLayers === nl
                        ? 'bg-white text-slate-900 font-semibold shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {nl}L
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="text-xs font-medium text-slate-700 mb-1.5">
                Dropout Regularization
              </div>
              <div className="grid grid-cols-4 gap-1 p-1 bg-slate-100 rounded-md">
                {([0, 0.1, 0.2, 0.3] as const).map((dr) => (
                  <button
                    key={dr}
                    type="button"
                    onClick={() => onUpdateConfig({ ...config, dropoutRate: dr })}
                    className={`py-1 text-xs font-mono rounded transition-colors ${
                      Math.abs(tEval.dropoutRate - dr) < 0.001
                        ? 'bg-white text-slate-900 font-semibold shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {dr.toFixed(1)}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label htmlFor="seq-pos-enc" className="block text-xs font-medium text-slate-700 mb-1.5">
                Positional Encoding
              </label>
              <select
                id="seq-pos-enc"
                value={tEval.positionalEncoding}
                onChange={(e) =>
                  onUpdateConfig({
                    ...config,
                    positionalEncoding: e.target.value as TransformerPositionalEncoding,
                  })
                }
                className="w-full px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
              >
                <option value="time_delta">Time-Delta Kernel (Δt)</option>
                <option value="rotary_rope">Rotary Embedding (RoPE)</option>
                <option value="sinusoidal">Sinusoidal PE</option>
              </select>
            </div>

            <div>
              <label htmlFor="seq-pool-mode" className="block text-xs font-medium text-slate-700 mb-1.5">
                Sequence Readout Pool
              </label>
              <select
                id="seq-pool-mode"
                value={tEval.poolingMode}
                onChange={(e) =>
                  onUpdateConfig({
                    ...config,
                    poolingMode: e.target.value as TransformerPoolingMode,
                  })
                }
                className="w-full px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
              >
                <option value="attention_pool">Learned Attention Pool</option>
                <option value="cls_mean">Masked Mean / CLS Pool</option>
                <option value="last_token">Final Active Token</option>
              </select>
            </div>
          </div>
        </div>
      </section>

      {/* Tensor Shape & Sparsity KPIs */}
      <section className="bg-white border border-slate-200 rounded-lg grid grid-cols-2 lg:grid-cols-4 divide-y lg:divide-y-0 lg:divide-x divide-slate-200">
        <div className="p-5">
          <div className="text-xs text-slate-500">Tensor Shape [B, L, D]</div>
          <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 mt-1">
            [{result.tensorShape.join(', ')}]
          </div>
          <div className="text-xs text-slate-500 mt-1 font-mono tabular-nums">
            {result.batchCount} chunks @ bs={result.batchSize} · {tEval.tokensPerBatch} tok/batch
          </div>
        </div>
        <div className="p-5">
          <div className="text-xs text-slate-500">Padding Sparsity</div>
          <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 mt-1">
            {(result.paddingSparsity * 100).toFixed(1)}%
          </div>
          <div className="text-xs text-slate-500 mt-1 font-mono tabular-nums">
            {(tEval.attentionMaskCoverage * 100).toFixed(1)}% active mask M=1 coverage
          </div>
        </div>
        <div className="p-5">
          <div className="text-xs text-slate-500">Mean Active Sequence</div>
          <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 mt-1">
            {result.meanActualLength.toFixed(2)}
          </div>
          <div className="text-xs text-slate-500 mt-1">
            events per entity before T_obs
          </div>
        </div>
        <div className="p-5">
          <div className="text-xs text-slate-500">Truncated Entities</div>
          <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 mt-1">
            {result.truncatedEntitiesCount}
          </div>
          <div className="text-xs text-slate-500 mt-1">
            exceeded max length L = {config.maxSeqLen}
          </div>
        </div>
      </section>

      {/* Transformer Model Evaluation & Benchmark Matrix */}
      <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <Sparkles className="w-4 h-4 text-blue-700 shrink-0 mt-0.5" />
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                Transformer Model Evaluation &amp; Multi-Architecture Benchmark
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Active:{' '}
                <span className="font-mono font-medium text-slate-700">
                  {tEval.architectureLabel} · d_model={tEval.dModel} · {tEval.numHeads}h ·{' '}
                  {tEval.numLayers}L · {tEval.positionalEncoding}
                </span>{' '}
                · Readout fit strictly on Train split and evaluated out-of-sample.
              </p>
            </div>
          </div>

          <div className="text-xs font-mono text-slate-600 tabular-nums">
            Params:{' '}
            <strong className="text-slate-900">
              {tEval.estimatedParams.toLocaleString()}
            </strong>
            <span className="mx-2 text-slate-300" aria-hidden="true">|</span>
            Attn Entropy H(α):{' '}
            <strong className="text-slate-900">
              {tEval.meanAttentionEntropy.toFixed(3)} nats
            </strong>
          </div>
        </div>

        {/* 4-Metric Active Transformer KPI Strip */}
        <div className="grid grid-cols-2 lg:grid-cols-4 divide-y lg:divide-y-0 lg:divide-x divide-slate-200 border-b border-slate-200 bg-slate-50/50">
          <div className="p-4">
            <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">
              {hasHoldout ? 'Holdout R² (Val+Test)' : 'Active Split R²'}
            </div>
            <div className="text-xl font-bold font-mono tabular-nums text-blue-700 mt-1">
              {primaryMetrics.rSquared !== null ? primaryMetrics.rSquared.toFixed(3) : '—'}
            </div>
            <div className="text-[11px] font-mono tabular-nums text-slate-500 mt-1">
              Train: {tEval.trainMetrics.rSquared !== null ? tEval.trainMetrics.rSquared.toFixed(3) : '—'} · All:{' '}
              {tEval.allMetrics.rSquared !== null ? tEval.allMetrics.rSquared.toFixed(3) : '—'}
            </div>
          </div>

          <div className="p-4">
            <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">
              {hasHoldout ? 'Holdout RMSE / MAE' : 'Active RMSE / MAE'}
            </div>
            <div className="text-xl font-bold font-mono tabular-nums text-slate-900 mt-1">
              ${primaryMetrics.rmse.toFixed(2)}
              <span className="text-xs font-medium text-slate-500 ml-1.5">
                (${primaryMetrics.mae.toFixed(2)} MAE)
              </span>
            </div>
            <div className="text-[11px] font-mono tabular-nums text-slate-500 mt-1">
              Val RMSE: ${tEval.valMetrics.rmse.toFixed(2)} · Test: ${tEval.testMetrics.rmse.toFixed(2)}
            </div>
          </div>

          <div className="p-4">
            <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">
              Mean LTV Projection &amp; 95% CI
            </div>
            <div className="text-xl font-bold font-mono tabular-nums text-slate-900 mt-1">
              ${primaryMetrics.meanPredicted.toFixed(2)}
              <span className="text-xs font-semibold text-slate-500 ml-1.5">
                ±${primaryMetrics.standardError.toFixed(2)} SE
              </span>
            </div>
            <div className="text-[11px] font-mono tabular-nums text-slate-600 mt-1">
              95% CI: [${primaryMetrics.ci95Lower.toFixed(2)}, ${primaryMetrics.ci95Upper.toFixed(2)}]
            </div>
          </div>

          <div className="p-4">
            <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">
              Holdout MAPE &amp; Generalization
            </div>
            <div className="text-xl font-bold font-mono tabular-nums text-slate-900 mt-1">
              {primaryMetrics.mape !== null ? `${primaryMetrics.mape.toFixed(1)}%` : '—'}
            </div>
            <div className="text-[11px] font-mono tabular-nums text-slate-500 mt-1">
              Train→Val ΔR²:{' '}
              {tEval.overfitDeltaR2 !== null
                ? `${tEval.overfitDeltaR2 >= 0 ? '+' : ''}${tEval.overfitDeltaR2.toFixed(3)}`
                : '—'}{' '}
              · n={primaryMetrics.sampleSize}
            </div>
          </div>
        </div>

        {/* Benchmark Comparison Table across ML Model Families */}
        <div className="p-5 space-y-5">
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
              <h3 className="text-xs font-semibold text-slate-800 uppercase tracking-wide">
                Sequence &amp; Tabular ML Model Benchmark (Same [B, L, D] Split Cohort)
              </h3>
              <span className="text-[11px] text-slate-500">
                Click any Transformer row to activate its attention kernel &amp; inspect per-token weights below.
              </span>
            </div>
            <div className="overflow-x-auto border border-slate-200 rounded-md">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-600">
                    <th className="py-2 px-3">Model Architecture</th>
                    <th className="py-2 px-2">Family</th>
                    <th className="py-2 px-2 text-right">Params</th>
                    <th className="py-2 px-2 text-right">
                      {hasHoldout ? 'Holdout R²' : 'R²'}
                    </th>
                    <th className="py-2 px-2 text-right">
                      {hasHoldout ? 'Holdout RMSE' : 'RMSE'}
                    </th>
                    <th className="py-2 px-2 text-right">
                      {hasHoldout ? 'Holdout MAE' : 'MAE'}
                    </th>
                    <th className="py-2 px-2 text-right">SE (±$)</th>
                    <th className="py-2 px-2 text-right">95% CI (Mean ŷ)</th>
                    <th className="py-2 px-2 text-right">Attn H(α)</th>
                    <th className="py-2 px-3 text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-xs font-mono tabular-nums">
                  {tEval.benchmarks.map((row) => {
                    const isTransformer = row.family === 'Transformer';
                    const r2Val = hasHoldout ? row.rSquaredHoldout : row.rSquaredAll;
                    const rmseVal =
                      hasHoldout && row.rmseHoldout !== null
                        ? row.rmseHoldout
                        : row.rmseAll;
                    const maeVal =
                      hasHoldout && row.maeHoldout !== null
                        ? row.maeHoldout
                        : row.maeAll;

                    return (
                      <tr
                        key={row.modelId}
                        onClick={() => {
                          if (isTransformer) {
                            onUpdateConfig({
                              ...config,
                              transformerArch: row.modelId as TransformerArchitectureId,
                            });
                          }
                        }}
                        className={`${
                          row.isActive
                            ? 'bg-blue-50/70'
                            : isTransformer
                            ? 'bg-white hover:bg-slate-50 cursor-pointer'
                            : 'bg-slate-50/40 text-slate-600'
                        }`}
                      >
                        <td className="py-2.5 px-3 font-sans font-semibold text-slate-900 whitespace-nowrap">
                          {row.modelName}
                        </td>
                        <td className="py-2.5 px-2 font-sans text-[11px] text-slate-600 whitespace-nowrap">
                          {row.family}
                        </td>
                        <td className="py-2.5 px-2 text-right text-slate-700">
                          {formatParamCount(row.paramCount)}
                        </td>
                        <td
                          className={`py-2.5 px-2 text-right font-semibold ${
                            row.isActive ? 'text-blue-700' : 'text-slate-900'
                          }`}
                        >
                          {r2Val !== null ? r2Val.toFixed(3) : '—'}
                        </td>
                        <td className="py-2.5 px-2 text-right text-slate-800">
                          ${rmseVal.toFixed(2)}
                        </td>
                        <td className="py-2.5 px-2 text-right text-slate-700">
                          ${maeVal.toFixed(2)}
                        </td>
                        <td className="py-2.5 px-2 text-right text-slate-700">
                          ±${row.standardError.toFixed(2)}
                        </td>
                        <td className="py-2.5 px-2 text-right text-slate-700 whitespace-nowrap">
                          ${row.ci95Lower.toFixed(0)}–${row.ci95Upper.toFixed(0)}
                        </td>
                        <td className="py-2.5 px-2 text-right text-slate-600">
                          {row.meanAttentionEntropy !== null
                            ? row.meanAttentionEntropy.toFixed(3)
                            : '—'}
                        </td>
                        <td className="py-2.5 px-3 text-right font-sans">
                          {row.isActive ? (
                            <span className="text-[11px] font-semibold text-blue-700">
                              Active Model
                            </span>
                          ) : isTransformer ? (
                            <span className="text-[11px] font-medium text-slate-500 hover:text-blue-700">
                              Activate
                            </span>
                          ) : (
                            <span className="text-[11px] text-slate-400">Baseline</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Active Transformer Split Breakdown */}
          <div className="overflow-x-auto border border-slate-200 rounded-md">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-600">
                  <th className="py-2 px-3">Active Transformer Split</th>
                  <th className="py-2 px-2 text-right">n</th>
                  <th className="py-2 px-2 text-right">R²</th>
                  <th className="py-2 px-2 text-right">RMSE</th>
                  <th className="py-2 px-2 text-right">MAE</th>
                  <th className="py-2 px-2 text-right">MAPE</th>
                  <th className="py-2 px-2 text-right">SE (±$)</th>
                  <th className="py-2 px-2 text-right">95% CI (Mean ŷ)</th>
                  <th className="py-2 px-3 text-right">Calibration Σŷ/Σy</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-xs font-mono tabular-nums">
                {splitRows.map((sr) => (
                  <tr
                    key={sr.split}
                    className={sr.split === 'all' ? 'bg-slate-50/70 font-semibold' : 'bg-white'}
                  >
                    <td className="py-2 px-3 font-sans font-medium text-slate-900">
                      {sr.label}
                    </td>
                    <td className="py-2 px-2 text-right text-slate-600">{sr.sampleSize}</td>
                    <td className="py-2 px-2 text-right text-slate-900">
                      {sr.rSquared !== null ? sr.rSquared.toFixed(3) : '—'}
                    </td>
                    <td className="py-2 px-2 text-right text-slate-800">${sr.rmse.toFixed(2)}</td>
                    <td className="py-2 px-2 text-right text-slate-700">${sr.mae.toFixed(2)}</td>
                    <td className="py-2 px-2 text-right text-slate-700">
                      {sr.mape !== null ? `${sr.mape.toFixed(1)}%` : '—'}
                    </td>
                    <td className="py-2 px-2 text-right text-slate-700">
                      ±${sr.standardError.toFixed(2)}
                    </td>
                    <td className="py-2 px-2 text-right text-blue-700 whitespace-nowrap">
                      ${sr.ci95Lower.toFixed(0)}–${sr.ci95Upper.toFixed(0)}
                    </td>
                    <td className="py-2 px-3 text-right text-slate-700">
                      {sr.calibrationRatio !== null ? `${sr.calibrationRatio.toFixed(2)}×` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Training & Validation Loss-Over-Time Trend Chart */}
      <TransformerLossChart
        transformerEval={tEval}
        batchSize={config.batchSize}
        maxSeqLen={config.maxSeqLen}
      />

      {/* Theoretical Batch Processing & Training Time Simulator */}
      <BatchTrainingSimulator
        seqConfig={config}
        onUpdateSeqConfig={onUpdateConfig}
        result={result}
      />

      {/* Interactive Sequence Length Distribution & Truncation Tuner */}
      <SequenceLengthHistogram
        config={config}
        onUpdateConfig={onUpdateConfig}
        result={result}
      />

      {/* Train-Split Feature Scaler Parameters */}
      <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200">
          <h2 className="text-sm font-semibold text-slate-900">
            Train-Split Feature Scaler Parameters
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Statistics computed strictly from train entities to prevent distribution leakage.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-600">
                <th className="py-2 px-6">Tensor Channel</th>
                <th className="py-2 px-4 text-right">Train Mean</th>
                <th className="py-2 px-4 text-right">Train Std</th>
                <th className="py-2 px-4 text-right">Min</th>
                <th className="py-2 px-6 text-right">Max</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-xs">
              {result.featureStats.map((fs, i) => (
                <tr key={fs.name} className="h-9">
                  <td className="py-2 px-6 font-mono text-slate-900">
                    X[..., {i}] · {fs.name}
                  </td>
                  <td className="py-2 px-4 text-right font-mono tabular-nums text-slate-700">
                    {fs.mean.toFixed(3)}
                  </td>
                  <td className="py-2 px-4 text-right font-mono tabular-nums text-slate-700">
                    {fs.std.toFixed(3)}
                  </td>
                  <td className="py-2 px-4 text-right font-mono tabular-nums text-slate-500">
                    {fs.min.toFixed(3)}
                  </td>
                  <td className="py-2 px-6 text-right font-mono tabular-nums text-slate-500">
                    {fs.max.toFixed(3)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Interactive Tensor Sequence & Attention Weight Inspector */}
      <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <Layers className="w-4 h-4 text-blue-700 shrink-0 mt-0.5" />
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                Entity Tensor Slice &amp; Self-Attention Inspector X[b, 0..{config.maxSeqLen - 1}, 0..3]
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Inspect padded positions, binary mask bits, and {tEval.architectureLabel} attention weights α_t per step.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-md self-start">
            <button
              type="button"
              onClick={() => setShowNormalized(true)}
              className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
                showNormalized
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Normalized Float32
            </button>
            <button
              type="button"
              onClick={() => setShowNormalized(false)}
              className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
                !showNormalized
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Raw Unscaled
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12">
          {/* Entity Selector List */}
          <div className="lg:col-span-3 border-b lg:border-b-0 lg:border-r border-slate-200 max-h-96 overflow-y-auto divide-y divide-slate-200">
            {result.samples.slice(0, 60).map((sample) => {
              const isSelected = activeSample?.entityId === sample.entityId;
              const pred = tEval.predictionsByEntity[sample.entityId];
              return (
                <button
                  key={sample.entityId}
                  type="button"
                  onClick={() => setSelectedEntityId(sample.entityId)}
                  className={`w-full px-4 py-2.5 text-left transition-colors flex items-center justify-between ${
                    isSelected
                      ? 'bg-blue-50/90 text-blue-800'
                      : 'hover:bg-slate-50 text-slate-800'
                  }`}
                >
                  <div>
                    <div className="text-xs font-mono font-semibold">{sample.entityId}</div>
                    <div className="text-[11px] text-slate-500 font-mono">
                      {sample.split} · y=${sample.horizonTargetLtv.toFixed(0)}
                      {pred ? ` · ŷ=$${pred.predictedLtv.toFixed(0)}` : ''}
                    </div>
                  </div>
                  <div className="text-xs font-mono tabular-nums text-slate-600">
                    {sample.actualLen}/{config.maxSeqLen}
                  </div>
                </button>
              );
            })}
          </div>

          {/* 2D Step Matrix */}
          <div className="lg:col-span-9 overflow-x-auto">
            {activeSample ? (
              <div>
                <div className="px-5 py-3 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center gap-4 text-xs text-slate-600 font-mono tabular-nums">
                  <span className="font-semibold text-slate-900">{activeSample.entityId}</span>
                  <span>split={activeSample.split}</span>
                  <span>batch=B{activeSample.batchId}</span>
                  <span>active={activeSample.actualLen}/{config.maxSeqLen}</span>
                  <span>target=${activeSample.horizonTargetLtv.toFixed(2)}</span>
                  {activeEntityPred && (
                    <>
                      <span className="text-blue-700 font-semibold">
                        transformer_ŷ=${activeEntityPred.predictedLtv.toFixed(2)}
                      </span>
                      <span>
                        peak_step=t{activeEntityPred.peakAttentionStep}
                      </span>
                      <span>H(α)={activeEntityPred.attentionEntropy.toFixed(3)}</span>
                    </>
                  )}
                </div>
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 text-[11px] font-semibold text-slate-600 bg-slate-50/60">
                      <th className="py-2 px-3">t_idx</th>
                      <th className="py-2 px-3 text-right">Mask M</th>
                      <th className="py-2 px-3">Attn α_t</th>
                      <th className="py-2 px-3 text-right">Day</th>
                      <th className="py-2 px-3 text-right">Δt</th>
                      <th className="py-2 px-3">Action Token</th>
                      <th className="py-2 px-3 text-right">Ch0: Spend</th>
                      <th className="py-2 px-3 text-right">Ch1: Engage</th>
                      <th className="py-2 px-3 text-right">Ch2: Freq</th>
                      <th className="py-2 px-3 text-right">Ch3: Recency</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 text-xs font-mono tabular-nums">
                    {activeSample.steps.map((st) => {
                      const vals = showNormalized
                        ? st.normalizedFeatures
                        : st.rawFeatures;
                      const isPad = st.mask === 0;
                      const attnWeight =
                        activeEntityPred?.stepWeights[st.stepIndex] ?? 0;
                      const isPeak =
                        !isPad &&
                        activeEntityPred?.peakAttentionStep === st.stepIndex;

                      return (
                        <tr
                          key={st.stepIndex}
                          className={
                            isPad
                              ? 'bg-slate-50/80 text-slate-400'
                              : isPeak
                              ? 'bg-blue-50/40 text-slate-900'
                              : 'text-slate-900'
                          }
                        >
                          <td className="py-2 px-3">{st.stepIndex}</td>
                          <td className="py-2 px-3 text-right font-semibold">
                            {st.mask}
                          </td>
                          <td className="py-2 px-3 w-32">
                            {isPad ? (
                              <span className="text-slate-300">—</span>
                            ) : (
                              <div className="flex items-center gap-2">
                                <div className="w-14 h-2 bg-slate-100 rounded overflow-hidden shrink-0">
                                  <div
                                    className="h-full bg-blue-700 rounded"
                                    style={{
                                      width: `${Math.min(100, Math.round(attnWeight * 100))}%`,
                                    }}
                                  />
                                </div>
                                <span
                                  className={`text-[11px] ${
                                    isPeak
                                      ? 'font-semibold text-blue-700'
                                      : 'text-slate-600'
                                  }`}
                                >
                                  {(attnWeight * 100).toFixed(1)}%
                                </span>
                              </div>
                            )}
                          </td>
                          <td className="py-2 px-3 text-right">
                            {st.timestampDay !== null ? st.timestampDay : '—'}
                          </td>
                          <td className="py-2 px-3 text-right">{st.deltaDays}</td>
                          <td className="py-2 px-3 font-sans text-xs">
                            {isPad ? 'PAD (0)' : `${st.actionId} · ${st.actionLabel}`}
                          </td>
                          <td className="py-2 px-3 text-right">{vals[0].toFixed(3)}</td>
                          <td className="py-2 px-3 text-right">{vals[1].toFixed(3)}</td>
                          <td className="py-2 px-3 text-right">{vals[2].toFixed(3)}</td>
                          <td className="py-2 px-3 text-right">{vals[3].toFixed(3)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-10 text-center text-xs text-slate-500">
                No sequence samples available for the selected filters.
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
};

