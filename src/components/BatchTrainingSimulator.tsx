import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Cpu,
  Pause,
  Play,
  RotateCcw,
  Timer,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  AttentionExecutionMode,
  BatchSimulationConfig,
  HardwareProfileId,
  SequenceConfig,
  SequenceResult,
  TrainingPrecision,
} from '../types/curation';
import {
  HARDWARE_ACCELERATOR_PROFILES,
  simulateBatchTrainingJob,
} from '../engine/curationEngine';

interface BatchTrainingSimulatorProps {
  seqConfig: SequenceConfig;
  onUpdateSeqConfig: (next: SequenceConfig) => void;
  result: SequenceResult;
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0.00 s';
  if (seconds < 0.001) return `${(seconds * 1_000_000).toFixed(0)} µs`;
  if (seconds < 1) return `${(seconds * 1000).toFixed(1)} ms`;
  if (seconds < 60) return `${seconds.toFixed(2)} s`;
  const mins = Math.floor(seconds / 60);
  const remSec = seconds - mins * 60;
  if (mins < 60) return `${mins}m ${remSec.toFixed(1)}s`;
  const hrs = Math.floor(mins / 60);
  const remMin = mins % 60;
  return `${hrs}h ${remMin}m`;
}

function formatFlops(flops: number): string {
  if (!Number.isFinite(flops) || flops <= 0) return '0 FLOPs';
  if (flops >= 1e15) return `${(flops / 1e15).toFixed(2)} PFLOPs`;
  if (flops >= 1e12) return `${(flops / 1e12).toFixed(2)} TFLOPs`;
  if (flops >= 1e9) return `${(flops / 1e9).toFixed(2)} GFLOPs`;
  if (flops >= 1e6) return `${(flops / 1e6).toFixed(2)} MFLOPs`;
  if (flops >= 1e3) return `${(flops / 1e3).toFixed(1)} KFLOPs`;
  return `${Math.round(flops)} FLOPs`;
}

function formatMemoryMb(mb: number): string {
  if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`;
  return `${mb.toFixed(1)} MB`;
}

export const BatchTrainingSimulator: React.FC<BatchTrainingSimulatorProps> = ({
  seqConfig,
  onUpdateSeqConfig,
  result,
}) => {
  const [simConfig, setSimConfig] = useState<BatchSimulationConfig>({
    hardwareId: 'nvidia_a10g',
    precision: 'bf16_amp',
    attentionMode: 'dense_padded',
    epochs: 30,
    datasetScaleFactor: 100,
    gradAccumSteps: 1,
  });

  const [chartMetric, setChartMetric] = useState<'ttc' | 'throughput'>('ttc');
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<1 | 10 | 100>(10);
  const [simProgress, setSimProgress] = useState(0); // 0 to 1
  const rafRef = useRef<number | null>(null);
  const lastFrameRef = useRef<number | null>(null);

  const report = useMemo(
    () => simulateBatchTrainingJob(result, seqConfig, simConfig),
    [result, seqConfig, simConfig]
  );

  // Reset playback whenever fundamental job geometry changes
  useEffect(() => {
    setIsPlaying(false);
    setSimProgress(0);
    lastFrameRef.current = null;
  }, [
    report.sequenceCount,
    report.batchSize,
    report.maxSeqLen,
    report.architecture,
    report.dModel,
    report.numLayers,
    report.numHeads,
    report.hardware.id,
    report.precision,
    report.attentionMode,
    report.epochs,
    report.gradAccumSteps,
  ]);

  useEffect(() => {
    if (!isPlaying || report.totalTtcSec <= 0) {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      lastFrameRef.current = null;
      return;
    }

    const tick = (now: number) => {
      if (lastFrameRef.current === null) {
        lastFrameRef.current = now;
      }
      const dtSec = Math.max(0, (now - lastFrameRef.current) / 1000);
      lastFrameRef.current = now;

      // Calibrated visual sweep: ensures ultra-fast <2s jobs still animate smoothly over ~2.5s at 1x,
      // while multi-minute jobs scale cleanly with playbackSpeed (1x / 10x / 100x).
      const effectiveVisualDuration = Math.max(
        1.8,
        Math.min(18, report.totalTtcSec / playbackSpeed)
      );
      const deltaProgress = dtSec / effectiveVisualDuration;

      setSimProgress((prev) => {
        const next = prev + deltaProgress;
        if (next >= 1) {
          setIsPlaying(false);
          return 1;
        }
        return next;
      });

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      lastFrameRef.current = null;
    };
  }, [isPlaying, playbackSpeed, report.totalTtcSec]);

  const totalBatchesAllEpochs = Math.max(
    1,
    report.batchesPerEpoch * report.epochs
  );
  const completedTotalBatches = Math.min(
    totalBatchesAllEpochs,
    Math.floor(simProgress * totalBatchesAllEpochs)
  );
  const currentEpoch =
    simProgress >= 1
      ? report.epochs
      : Math.min(
          report.epochs,
          Math.floor(completedTotalBatches / Math.max(1, report.batchesPerEpoch)) + 1
        );
  const currentBatchInEpoch =
    simProgress >= 1
      ? report.batchesPerEpoch
      : (completedTotalBatches % Math.max(1, report.batchesPerEpoch)) + 1;
  const elapsedSimSec = simProgress * report.totalTtcSec;
  const remainingSimSec = Math.max(0, report.totalTtcSec - elapsedSimSec);

  // Determine active pipeline phase during playback
  const withinBatchPhase = (simProgress * totalBatchesAllEpochs) % 1;
  const activeStageLabel =
    simProgress === 0
      ? 'Ready'
      : simProgress >= 1
      ? 'Training Complete'
      : withinBatchPhase < report.dataLoadPct / 100
      ? 'H2D DataLoader'
      : withinBatchPhase < (report.dataLoadPct + report.forwardPct) / 100
      ? 'Forward Attention'
      : withinBatchPhase <
        (report.dataLoadPct + report.forwardPct + report.backwardPct) / 100
      ? 'Backward Gradients'
      : 'AdamW Optimizer Step';

  const handleTogglePlay = () => {
    if (report.sequenceCount === 0) return;
    if (simProgress >= 1) {
      setSimProgress(0);
      setIsPlaying(true);
    } else {
      setIsPlaying((p) => !p);
    }
  };

  const handleResetSim = () => {
    setIsPlaying(false);
    setSimProgress(0);
  };

  const canApplyBatchFromSweep = (bs: number): boolean =>
    bs === 16 || bs === 32 || bs === 64 || bs === 128;

  return (
    <section
      aria-label="Batch Processing Training Time Simulator"
      className="bg-white border border-slate-200 rounded-lg overflow-hidden"
    >
      {/* Header & Live Playback Controls */}
      <div className="px-6 py-4 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div className="flex items-start gap-2.5">
          <Timer className="w-4 h-4 text-blue-700 shrink-0 mt-0.5" />
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              Batch Processing &amp; Theoretical Time-to-Completion Simulator
            </h2>
            <p className="text-xs text-slate-500 mt-0.5 font-mono tabular-nums">
              Tensor [{report.sequenceCount.toLocaleString()}, {report.maxSeqLen},{' '}
              {report.featureDim}] · B={report.batchSize} (eff={report.effectiveBatchSize}
              ) · {report.architectureLabel} ({report.numLayers}L · d={report.dModel} ·{' '}
              {report.numHeads}h · {report.estimatedParams.toLocaleString()} params)
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-md">
            {([1, 10, 100] as const).map((spd) => (
              <button
                key={spd}
                type="button"
                onClick={() => setPlaybackSpeed(spd)}
                className={`px-2 py-1 text-[11px] font-mono font-medium rounded transition-colors whitespace-nowrap ${
                  playbackSpeed === spd
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {spd}×
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={handleTogglePlay}
            disabled={report.sequenceCount === 0}
            className="px-3.5 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-50 rounded-md transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
          >
            {isPlaying ? (
              <>
                <Pause className="w-3.5 h-3.5" />
                <span>Pause</span>
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5" />
                <span>
                  {simProgress >= 1
                    ? 'Replay Simulation'
                    : simProgress > 0
                    ? 'Resume Simulation'
                    : 'Run Simulation'}
                </span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={handleResetSim}
            disabled={simProgress === 0 && !isPlaying}
            aria-label="Reset batch simulation"
            className="px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 disabled:opacity-50 transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset</span>
          </button>
        </div>
      </div>

      {/* Accelerator & Job Parameter Controls */}
      <div className="px-6 py-4 border-b border-slate-200 bg-slate-50/40 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4">
        <div className="lg:col-span-2">
          <label
            htmlFor="sim-hardware-select"
            className="block text-xs font-medium text-slate-700 mb-1.5"
          >
            Compute Accelerator
          </label>
          <select
            id="sim-hardware-select"
            value={simConfig.hardwareId}
            onChange={(e) =>
              setSimConfig((prev) => ({
                ...prev,
                hardwareId: e.target.value as HardwareProfileId,
              }))
            }
            className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
          >
            {HARDWARE_ACCELERATOR_PROFILES.map((hw) => (
              <option key={hw.id} value={hw.id}>
                {hw.label} · {hw.memoryGb}GB
              </option>
            ))}
          </select>
        </div>

        <div>
          <div className="text-xs font-medium text-slate-700 mb-1.5">Precision</div>
          <div className="grid grid-cols-3 gap-1 p-1 bg-slate-100 rounded-md">
            {(
              [
                { id: 'fp32', label: 'FP32' },
                { id: 'bf16_amp', label: 'BF16' },
                { id: 'fp16_mixed', label: 'FP16' },
              ] as { id: TrainingPrecision; label: string }[]
            ).map((pr) => (
              <button
                key={pr.id}
                type="button"
                onClick={() =>
                  setSimConfig((prev) => ({ ...prev, precision: pr.id }))
                }
                className={`py-1 text-xs font-mono rounded transition-colors ${
                  simConfig.precision === pr.id
                    ? 'bg-white text-slate-900 font-semibold shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {pr.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="text-xs font-medium text-slate-700 mb-1.5">
            Attention Kernel
          </div>
          <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-md">
            {(
              [
                { id: 'dense_padded', label: 'Dense [L]' },
                { id: 'flash_unpadded', label: 'Unpadded' },
              ] as { id: AttentionExecutionMode; label: string }[]
            ).map((am) => (
              <button
                key={am.id}
                type="button"
                onClick={() =>
                  setSimConfig((prev) => ({ ...prev, attentionMode: am.id }))
                }
                className={`py-1 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                  simConfig.attentionMode === am.id
                    ? 'bg-white text-slate-900 font-semibold shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {am.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="text-xs font-medium text-slate-700 mb-1.5">
            Epochs / Accum
          </div>
          <div className="flex items-center gap-1.5">
            <select
              aria-label="Training epochs"
              value={simConfig.epochs}
              onChange={(e) =>
                setSimConfig((prev) => ({
                  ...prev,
                  epochs: Number(e.target.value),
                }))
              }
              className="flex-1 px-2 py-1.5 text-xs font-mono bg-white border border-slate-200 rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
            >
              {[10, 30, 50, 100].map((ep) => (
                <option key={ep} value={ep}>
                  {ep} ep
                </option>
              ))}
            </select>
            <select
              aria-label="Gradient accumulation steps"
              value={simConfig.gradAccumSteps}
              onChange={(e) =>
                setSimConfig((prev) => ({
                  ...prev,
                  gradAccumSteps: Number(e.target.value),
                }))
              }
              className="w-20 px-2 py-1.5 text-xs font-mono bg-white border border-slate-200 rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
            >
              {[1, 2, 4].map((ga) => (
                <option key={ga} value={ga}>
                  {ga}× acc
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <div className="text-xs font-medium text-slate-700 mb-1.5">
            Cohort Scale Factor
          </div>
          <div className="grid grid-cols-4 gap-1 p-1 bg-slate-100 rounded-md">
            {[1, 10, 100, 1000].map((sf) => (
              <button
                key={sf}
                type="button"
                onClick={() =>
                  setSimConfig((prev) => ({ ...prev, datasetScaleFactor: sf }))
                }
                className={`py-1 text-[11px] font-mono rounded transition-colors ${
                  simConfig.datasetScaleFactor === sf
                    ? 'bg-white text-slate-900 font-semibold shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {sf === 1000 ? '1k×' : `${sf}×`}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 4-Column Theoretical Compute & Time KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 divide-y lg:divide-y-0 lg:divide-x divide-slate-200 border-b border-slate-200">
        <div className="p-5">
          <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">
            Theoretical Time-to-Completion
          </div>
          <div className="text-2xl font-bold font-mono tabular-nums text-blue-700 mt-1">
            {formatDuration(report.totalTtcSec)}
          </div>
          <div className="text-[11px] font-mono tabular-nums text-slate-500 mt-1">
            {formatDuration(report.epochDurationMs / 1000)}/epoch ·{' '}
            {report.batchesPerEpoch.toLocaleString()} batches/ep
          </div>
        </div>

        <div className="p-5">
          <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">
            Batch Throughput &amp; MFU
          </div>
          <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 mt-1">
            {report.samplesPerSec.toLocaleString()}
            <span className="text-xs font-medium text-slate-500 ml-1">seq/s</span>
          </div>
          <div className="text-[11px] font-mono tabular-nums text-slate-500 mt-1">
            {report.tokensPerSec.toLocaleString()} tok/s · {report.achievedTflops.toFixed(2)}{' '}
            TFLOP/s ({report.achievedMfuPct.toFixed(1)}% MFU)
          </div>
        </div>

        <div className="p-5">
          <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">
            Workload Complexity (3× Fwd+Bwd)
          </div>
          <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 mt-1">
            {formatFlops(report.totalJobFlops)}
          </div>
          <div className="text-[11px] font-mono tabular-nums text-slate-500 mt-1">
            {formatFlops(report.forwardFlopsPerSample)}/seq · AI{' '}
            {report.arithmeticIntensity.toFixed(1)} FLOP/B
          </div>
        </div>

        <div className="p-5">
          <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">
            Peak Memory Footprint
          </div>
          <div
            className={`text-2xl font-bold font-mono tabular-nums mt-1 ${
              report.fitsInMemory ? 'text-slate-900' : 'text-rose-700'
            }`}
          >
            {formatMemoryMb(report.peakVramMb)}
          </div>
          <div className="text-[11px] font-mono tabular-nums text-slate-500 mt-1">
            {report.vramUtilizationPct.toFixed(2)}% of {report.hardware.memoryGb} GB{' '}
            {report.fitsInMemory ? '(Fits)' : '(OOM Exceeded)'}
          </div>
        </div>
      </div>

      {/* Live Batch Simulation Progress & Per-Step Phase Breakdown */}
      <div className="px-6 py-4 border-b border-slate-200 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 text-xs">
          <div className="flex flex-wrap items-center gap-3 font-mono tabular-nums">
            <span className="font-semibold text-slate-900">
              Epoch {currentEpoch} / {report.epochs}
            </span>
            <span className="text-slate-300" aria-hidden="true">·</span>
            <span className="text-slate-700">
              Batch {currentBatchInEpoch.toLocaleString()} /{' '}
              {report.batchesPerEpoch.toLocaleString()}
            </span>
            <span className="text-slate-300" aria-hidden="true">·</span>
            <span className="text-blue-700 font-semibold">{activeStageLabel}</span>
          </div>
          <div className="flex flex-wrap items-center gap-4 font-mono tabular-nums text-slate-600">
            <span>
              Elapsed: <strong className="text-slate-900">{formatDuration(elapsedSimSec)}</strong>
            </span>
            <span>
              ETA: <strong className="text-slate-900">{formatDuration(remainingSimSec)}</strong>
            </span>
            <span>
              Bottleneck:{' '}
              <strong
                className={
                  report.bottleneck === 'launch_io_bound'
                    ? 'text-amber-700'
                    : report.bottleneck === 'memory_bw_bound'
                    ? 'text-slate-900'
                    : 'text-emerald-700'
                }
              >
                {report.bottleneckLabel}
              </strong>
            </span>
          </div>
        </div>

        <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
          <div
            className={`h-full transition-all duration-75 ${
              simProgress >= 1 ? 'bg-emerald-600' : 'bg-blue-700'
            }`}
            style={{ width: `${Math.round(simProgress * 1000) / 10}%` }}
          />
        </div>

        {/* Stacked Per-Step Phase Latency Breakdown */}
        <div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-600 mb-1.5">
            <span className="font-medium text-slate-700">
              Mean Batch Step Latency Composition ({report.meanBatchMs.toFixed(3)} ms / step)
            </span>
            <div className="flex flex-wrap items-center gap-4 font-mono tabular-nums">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-xs bg-slate-400 inline-block" />
                H2D Load {report.dataLoadPct.toFixed(1)}%
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-xs bg-blue-700 inline-block" />
                Forward {report.forwardPct.toFixed(1)}%
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-xs bg-indigo-500 inline-block" />
                Backward {report.backwardPct.toFixed(1)}%
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-xs bg-amber-600 inline-block" />
                AdamW Opt {report.optimizerPct.toFixed(1)}%
              </span>
            </div>
          </div>
          <div className="w-full h-3 bg-slate-100 rounded overflow-hidden flex">
            <div
              className="h-full bg-slate-400"
              style={{ width: `${report.dataLoadPct}%` }}
              title={`H2D DataLoader: ${report.dataLoadPct}%`}
            />
            <div
              className="h-full bg-blue-700"
              style={{ width: `${report.forwardPct}%` }}
              title={`Forward Pass: ${report.forwardPct}%`}
            />
            <div
              className="h-full bg-indigo-500"
              style={{ width: `${report.backwardPct}%` }}
              title={`Backward Pass: ${report.backwardPct}%`}
            />
            <div
              className="h-full bg-amber-600"
              style={{ width: `${report.optimizerPct}%` }}
              title={`Optimizer Step: ${report.optimizerPct}%`}
            />
          </div>
        </div>
      </div>

      {/* Scaling Chart & Batch Step Execution Trace */}
      <div className="grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-slate-200">
        {/* Batch Size Scaling Curve */}
        <div className="lg:col-span-7 p-5">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3">
            <div>
              <h3 className="text-xs font-semibold text-slate-900 uppercase tracking-wide">
                Batch Size Scaling Profile (Active B = {report.batchSize})
              </h3>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Click any bar (16–128) to update the active Sequence tensor batch size.
              </p>
            </div>
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-md self-start shrink-0">
              <button
                type="button"
                onClick={() => setChartMetric('ttc')}
                className={`px-2.5 py-1 text-[11px] font-medium rounded transition-colors ${
                  chartMetric === 'ttc'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Total TTC (s)
              </button>
              <button
                type="button"
                onClick={() => setChartMetric('throughput')}
                className={`px-2.5 py-1 text-[11px] font-medium rounded transition-colors ${
                  chartMetric === 'throughput'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Throughput (seq/s)
              </button>
            </div>
          </div>

          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={report.batchSizeSweep}
                margin={{ top: 8, right: 16, left: 4, bottom: 8 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis
                  dataKey="batchSize"
                  tick={{ fontSize: 11, fill: '#475569' }}
                  tickLine={false}
                  axisLine={{ stroke: '#cbd5e1' }}
                  tickFormatter={(v: number) => `bs=${v}`}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: '#475569' }}
                  tickLine={false}
                  axisLine={{ stroke: '#cbd5e1' }}
                  width={54}
                  tickFormatter={(v: number) =>
                    chartMetric === 'ttc'
                      ? v < 1
                        ? `${(v * 1000).toFixed(0)}ms`
                        : `${v.toFixed(1)}s`
                      : v >= 1000
                      ? `${(v / 1000).toFixed(1)}k`
                      : `${Math.round(v)}`
                  }
                />
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload || payload.length === 0) return null;
                    const row = payload[0].payload as (typeof report.batchSizeSweep)[number];
                    return (
                      <div className="bg-white border border-slate-200 rounded-md px-3 py-2 shadow-sm text-xs font-mono tabular-nums space-y-1">
                        <div className="font-semibold text-slate-900 border-b border-slate-100 pb-1">
                          Batch Size B = {row.batchSize}{' '}
                          {row.isActive ? '(Active)' : ''}
                        </div>
                        <div className="flex justify-between gap-4 text-blue-700">
                          <span>Total TTC:</span>
                          <span className="font-semibold">
                            {formatDuration(row.totalTtcSec)}
                          </span>
                        </div>
                        <div className="flex justify-between gap-4 text-slate-700">
                          <span>Throughput:</span>
                          <span>{row.samplesPerSec.toLocaleString()} seq/s</span>
                        </div>
                        <div className="flex justify-between gap-4 text-slate-600">
                          <span>Achieved MFU:</span>
                          <span>{row.achievedMfuPct.toFixed(1)}%</span>
                        </div>
                        <div className="flex justify-between gap-4 text-slate-600">
                          <span>Peak VRAM:</span>
                          <span>{formatMemoryMb(row.peakVramMb)}</span>
                        </div>
                      </div>
                    );
                  }}
                />
                <Bar
                  dataKey={chartMetric === 'ttc' ? 'totalTtcSec' : 'samplesPerSec'}
                  radius={[4, 4, 0, 0]}
                  isAnimationActive={false}
                  onClick={(_entry, index) => {
                    const target = report.batchSizeSweep[index];
                    if (target && canApplyBatchFromSweep(target.batchSize)) {
                      onUpdateSeqConfig({ ...seqConfig, batchSize: target.batchSize });
                    }
                  }}
                >
                  {report.batchSizeSweep.map((entry) => (
                    <Cell
                      key={entry.batchSize}
                      fill={entry.isActive ? '#1d4ed8' : '#94a3b8'}
                      className={
                        canApplyBatchFromSweep(entry.batchSize)
                          ? 'cursor-pointer'
                          : 'cursor-default'
                      }
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Per-Batch Execution Trace */}
        <div className="lg:col-span-5 flex flex-col">
          <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between gap-2">
            <div>
              <h3 className="text-xs font-semibold text-slate-900 uppercase tracking-wide">
                Epoch Batch Execution Trace
              </h3>
              <p className="text-[11px] text-slate-500 mt-0.5">
                First {report.sampleBatchTrace.length} of{' '}
                {report.batchesPerEpoch.toLocaleString()} batches per epoch
              </p>
            </div>
            <Cpu className="w-4 h-4 text-slate-400 shrink-0" />
          </div>

          <div className="overflow-x-auto max-h-64 overflow-y-auto">
            <table className="w-full text-left border-collapse">
              <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-600">
                <tr>
                  <th className="py-2 px-3">Batch</th>
                  <th className="py-2 px-2 text-right">Seqs</th>
                  <th className="py-2 px-2 text-right">H2D</th>
                  <th className="py-2 px-2 text-right">Fwd</th>
                  <th className="py-2 px-2 text-right">Bwd</th>
                  <th className="py-2 px-2 text-right">Opt</th>
                  <th className="py-2 px-3 text-right">Step ms</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-[11px] font-mono tabular-nums">
                {report.sampleBatchTrace.map((st) => {
                  const isCurrentTraceRow =
                    isPlaying && st.batchIndex + 1 === currentBatchInEpoch;
                  return (
                    <tr
                      key={st.batchIndex}
                      className={
                        isCurrentTraceRow ? 'bg-blue-50 text-blue-900 font-semibold' : 'bg-white'
                      }
                    >
                      <td className="py-2 px-3">B{st.batchIndex}</td>
                      <td className="py-2 px-2 text-right text-slate-600">
                        {st.sampleCount}
                      </td>
                      <td className="py-2 px-2 text-right text-slate-600">
                        {st.dataLoadMs.toFixed(2)}
                      </td>
                      <td className="py-2 px-2 text-right text-slate-700">
                        {st.forwardMs.toFixed(2)}
                      </td>
                      <td className="py-2 px-2 text-right text-slate-700">
                        {st.backwardMs.toFixed(2)}
                      </td>
                      <td className="py-2 px-2 text-right text-amber-700">
                        {st.isOptimizerStep ? st.optimizerMs.toFixed(2) : '—'}
                      </td>
                      <td className="py-2 px-3 text-right font-semibold text-slate-900">
                        {st.totalStepMs.toFixed(2)}
                      </td>
                    </tr>
                  );
                })}
                {report.sampleBatchTrace.length === 0 && (
                  <tr>
                    <td
                      colSpan={7}
                      className="py-8 text-center font-sans text-xs text-slate-500"
                    >
                      No sequences match the active filter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Warning footer when OOM or heavy launch overhead */}
      {(!report.fitsInMemory || report.bottleneck === 'launch_io_bound') && (
        <div
          role="alert"
          className={`px-6 py-3 border-t text-xs flex items-start gap-2.5 ${
            !report.fitsInMemory
              ? 'bg-rose-50 border-rose-200 text-rose-900'
              : 'bg-amber-50/70 border-amber-200 text-amber-900'
          }`}
        >
          <AlertTriangle
            className={`w-4 h-4 shrink-0 mt-0.5 ${
              !report.fitsInMemory ? 'text-rose-700' : 'text-amber-700'
            }`}
          />
          <div>
            {!report.fitsInMemory ? (
              <span>
                <strong>Memory Overflow:</strong> Peak VRAM ({formatMemoryMb(report.peakVramMb)}) exceeds {report.hardware.label} ({report.hardware.memoryGb} GB). Switch to Unpadded Flash Attention, BF16/FP16 precision, or reduce batch size B with gradient accumulation.
              </span>
            ) : (
              <span>
                <strong>Overhead-Dominated Execution:</strong>{' '}
                {report.dataLoadPct.toFixed(0)}% H2D + {report.optimizerPct.toFixed(0)}% optimizer step latency dominates kernel compute at B={report.batchSize} on {report.hardware.shortLabel}. Increase batch size or enable gradient accumulation to improve MFU ({report.achievedMfuPct.toFixed(1)}%).
              </span>
            )}
          </div>
        </div>
      )}
    </section>
  );
};
