import React, { useState } from 'react';
import { CheckCircle2, AlertTriangle, Grid3X3 } from 'lucide-react';
import {
  LinearFitSummary,
  ModelEvaluationMatrixData,
  RegressionConfig,
} from '../types/curation';

interface ModelEvaluationMatrixProps {
  evaluationMatrix: ModelEvaluationMatrixData;
  linearFit: LinearFitSummary;
  config: RegressionConfig;
}

export const ModelEvaluationMatrix: React.FC<ModelEvaluationMatrixProps> = ({
  evaluationMatrix,
  linearFit,
  config,
}) => {
  const [tierScope, setTierScope] = useState<'holdout' | 'all'>(
    evaluationMatrix.holdoutCount > 0 ? 'holdout' : 'all'
  );

  const effectiveScope =
    tierScope === 'holdout' && evaluationMatrix.holdoutCount > 0
      ? 'holdout'
      : 'all';

  const activeMatrix =
    effectiveScope === 'holdout'
      ? evaluationMatrix.tierMatrixHoldout
      : evaluationMatrix.tierMatrixAll;

  const exactHit =
    effectiveScope === 'holdout' &&
    evaluationMatrix.exactTierAccuracyHoldout !== null
      ? evaluationMatrix.exactTierAccuracyHoldout
      : evaluationMatrix.exactTierAccuracyAll;

  const withinOneHit =
    effectiveScope === 'holdout' &&
    evaluationMatrix.withinOneTierAccuracyHoldout !== null
      ? evaluationMatrix.withinOneTierAccuracyHoldout
      : evaluationMatrix.withinOneTierAccuracyAll;

  const valRow = evaluationMatrix.splitMetrics.find((s) => s.split === 'val');
  const testRow = evaluationMatrix.splitMetrics.find((s) => s.split === 'test');
  const overfitDelta = evaluationMatrix.overfitDeltaR2;
  const hasOverfitWarn = overfitDelta !== null && overfitDelta > 0.15;

  const getCellStyle = (isDiag: boolean, share: number, count: number) => {
    if (count === 0) {
      return 'bg-slate-50/70 text-slate-400 border-slate-200';
    }
    if (isDiag) {
      if (share >= 0.5) return 'bg-blue-700 text-white border-blue-800';
      if (share >= 0.3) return 'bg-blue-600 text-white border-blue-700';
      return 'bg-blue-100 text-blue-900 border-blue-200';
    }
    if (share >= 0.35) return 'bg-amber-100 text-amber-950 border-amber-300';
    if (share >= 0.15) return 'bg-slate-200/80 text-slate-900 border-slate-300';
    return 'bg-slate-100 text-slate-700 border-slate-200';
  };

  const [q25, q50, q75] = evaluationMatrix.tierThresholds;
  const featureCount =
    config.selectedFeatures.length > 0 ? config.selectedFeatures.length : 7;

  return (
    <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div className="flex items-start gap-2.5">
          <Grid3X3 className="w-4 h-4 text-blue-700 shrink-0 mt-0.5" />
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              Model Evaluation Matrix (MAE, RMSE, MAPE, R² &amp; Tier Calibration)
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Config:{' '}
              <span className="font-mono font-medium text-slate-700">
                T_obs={config.obsCutoffDay}d · H={config.horizonDays}d ·{' '}
                {config.featureNormalization === 'none'
                  ? 'Raw'
                  : config.featureNormalization}{' '}
                · {config.winsorizePercentile === 0 ? 'No Win' : `P${config.winsorizePercentile}`}{' '}
                · {featureCount} features
              </span>{' '}
              · Out-of-sample fit on{' '}
              <span className="font-mono font-medium text-slate-700">
                {evaluationMatrix.trainedOnSplit === 'train'
                  ? `Train (n=${evaluationMatrix.trainSampleCount})`
                  : `Active (n=${evaluationMatrix.trainSampleCount})`}
              </span>
              .
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-4 text-xs">
          {overfitDelta !== null && (
            <div
              className={`inline-flex items-center gap-1.5 font-mono tabular-nums ${
                hasOverfitWarn ? 'text-amber-700' : 'text-emerald-700'
              }`}
            >
              {hasOverfitWarn ? (
                <AlertTriangle className="w-3.5 h-3.5" />
              ) : (
                <CheckCircle2 className="w-3.5 h-3.5" />
              )}
              <span>
                Train→Val ΔR²:{' '}
                {overfitDelta >= 0
                  ? `+${overfitDelta.toFixed(3)}`
                  : overfitDelta.toFixed(3)}
              </span>
            </div>
          )}

          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-md">
            <button
              type="button"
              disabled={evaluationMatrix.holdoutCount === 0}
              onClick={() => setTierScope('holdout')}
              className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap disabled:opacity-40 ${
                effectiveScope === 'holdout'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Holdout Val+Test ({evaluationMatrix.holdoutCount})
            </button>
            <button
              type="button"
              onClick={() => setTierScope('all')}
              className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                effectiveScope === 'all'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              All Splits
            </button>
          </div>
        </div>
      </div>

      {/* 4-Metric Active Model Evaluation Strip: R², RMSE, MAE, MAPE */}
      <div className="grid grid-cols-2 lg:grid-cols-4 divide-y lg:divide-y-0 lg:divide-x divide-slate-200 border-b border-slate-200 bg-slate-50/50">
        <div className="p-4">
          <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">
            R-Squared (R²)
          </div>
          <div className="text-xl font-bold font-mono tabular-nums text-slate-900 mt-1">
            {linearFit.rSquared.toFixed(3)}
          </div>
          <div className="text-[11px] font-mono tabular-nums text-slate-500 mt-1">
            Val: {valRow?.rSquared !== null && valRow?.rSquared !== undefined ? valRow.rSquared.toFixed(3) : '—'}{' '}
            · Test: {testRow?.rSquared !== null && testRow?.rSquared !== undefined ? testRow.rSquared.toFixed(3) : '—'}
          </div>
        </div>

        <div className="p-4">
          <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">
            RMSE (Root Mean Sq Err)
          </div>
          <div className="text-xl font-bold font-mono tabular-nums text-slate-900 mt-1">
            ${linearFit.rmse.toFixed(2)}
          </div>
          <div className="text-[11px] font-mono tabular-nums text-slate-500 mt-1">
            Val: ${valRow ? valRow.rmse.toFixed(2) : '—'} · Test: $
            {testRow ? testRow.rmse.toFixed(2) : '—'}
          </div>
        </div>

        <div className="p-4">
          <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">
            MAE (Mean Abs Err)
          </div>
          <div className="text-xl font-bold font-mono tabular-nums text-slate-900 mt-1">
            ${linearFit.mae.toFixed(2)}
          </div>
          <div className="text-[11px] font-mono tabular-nums text-slate-500 mt-1">
            Val: ${valRow ? valRow.mae.toFixed(2) : '—'} · Test: $
            {testRow ? testRow.mae.toFixed(2) : '—'}
          </div>
        </div>

        <div className="p-4">
          <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">
            MAPE (Non-Zero LTV)
          </div>
          <div className="text-xl font-bold font-mono tabular-nums text-slate-900 mt-1">
            {linearFit.mape !== null ? `${linearFit.mape.toFixed(1)}%` : '—'}
          </div>
          <div
            className="text-[11px] font-mono tabular-nums text-slate-500 mt-1"
            title="Computed over entities with positive target LTV (y > $0)"
          >
            Val:{' '}
            {valRow?.mape !== null && valRow?.mape !== undefined
              ? `${valRow.mape.toFixed(1)}%`
              : '—'}{' '}
            · n={linearFit.mapeSampleCount}
          </div>
        </div>
      </div>

      {/* LTV Projection Uncertainty Strip: Standard Error & 95% Confidence Intervals */}
      <div className="grid grid-cols-2 lg:grid-cols-4 divide-y lg:divide-y-0 lg:divide-x divide-slate-200 border-b border-slate-200 bg-white">
        <div className="p-4">
          <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">
            Forward Projection (+{config.horizonDays}d)
          </div>
          <div className="text-lg font-bold font-mono tabular-nums text-blue-700 mt-1">
            ${evaluationMatrix.forwardProjectionMean.toFixed(2)}
            <span className="text-xs font-semibold text-slate-500 ml-1.5">
              ±${evaluationMatrix.forwardProjectionSe.toFixed(2)} SE
            </span>
          </div>
          <div className="text-[11px] font-mono tabular-nums text-slate-600 mt-1">
            95% CI: [${evaluationMatrix.forwardProjectionCi95Lower.toFixed(2)}, $
            {evaluationMatrix.forwardProjectionCi95Upper.toFixed(2)}]
          </div>
        </div>

        <div className="p-4">
          <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">
            Mean Horizon Fit &amp; 95% CI
          </div>
          <div className="text-lg font-bold font-mono tabular-nums text-slate-900 mt-1">
            ${linearFit.meanProjectedLtv.toFixed(2)}
            <span className="text-xs font-semibold text-slate-500 ml-1.5">
              ±${linearFit.meanLtvSe.toFixed(2)} SE
            </span>
          </div>
          <div className="text-[11px] font-mono tabular-nums text-slate-600 mt-1">
            95% CI: [${linearFit.ci95Lower.toFixed(2)}, ${linearFit.ci95Upper.toFixed(2)}]
          </div>
        </div>

        <div className="p-4">
          <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">
            Residual Std Error (RSE)
          </div>
          <div className="text-lg font-bold font-mono tabular-nums text-slate-900 mt-1">
            ±${linearFit.standardError.toFixed(2)}
          </div>
          <div className="text-[11px] font-mono tabular-nums text-slate-500 mt-1">
            df-adjusted ({Math.max(1, linearFit.sampleSize - featureCount - 1)} df)
          </div>
        </div>

        <div className="p-4">
          <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">
            95% Entity Pred Margin
          </div>
          <div className="text-lg font-bold font-mono tabular-nums text-slate-900 mt-1">
            ±${linearFit.pi95HalfWidth.toFixed(2)}
          </div>
          <div className="text-[11px] font-mono tabular-nums text-slate-500 mt-1">
            Student-t 95% interval around ŷᵢ
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 divide-y xl:divide-y-0 xl:divide-x divide-slate-200">
        {/* Left: Split Generalization Metrics Table */}
        <div className="xl:col-span-7 p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-semibold text-slate-800 uppercase tracking-wide">
                Split Evaluation Matrix
              </h3>
              <span className="text-[11px] font-mono text-slate-500">
                Train-fit → Holdout scoring (SE &amp; 95% CI)
              </span>
            </div>

            <div className="overflow-x-auto border border-slate-200 rounded-md">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-600">
                    <th className="py-2 px-3">Split</th>
                    <th className="py-2 px-2 text-right">n</th>
                    <th className="py-2 px-2 text-right">R²</th>
                    <th className="py-2 px-2 text-right">RMSE</th>
                    <th className="py-2 px-2 text-right">MAE</th>
                    <th className="py-2 px-2 text-right">MAPE</th>
                    <th className="py-2 px-2 text-right">SE (±$)</th>
                    <th className="py-2 px-2 text-right">95% CI (Mean ŷ)</th>
                    <th className="py-2 px-2 text-right">Bias</th>
                    <th className="py-2 px-2 text-right">Σŷ/Σy</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-xs font-mono tabular-nums">
                  {evaluationMatrix.splitMetrics.map((row) => {
                    const isAll = row.split === 'all';
                    return (
                      <tr
                        key={row.split}
                        className={
                          isAll ? 'bg-slate-50/70 font-semibold' : 'bg-white'
                        }
                      >
                        <td className="py-2.5 px-3 font-sans font-medium text-slate-900 whitespace-nowrap">
                          {row.label}
                        </td>
                        <td className="py-2.5 px-2 text-right text-slate-600">
                          {row.sampleSize}
                        </td>
                        <td
                          className={`py-2.5 px-2 text-right font-semibold ${
                            row.rSquared === null
                              ? 'text-slate-400'
                              : row.rSquared < 0
                              ? 'text-rose-700'
                              : 'text-slate-900'
                          }`}
                        >
                          {row.rSquared !== null ? row.rSquared.toFixed(3) : '—'}
                        </td>
                        <td className="py-2.5 px-2 text-right text-slate-800">
                          ${row.rmse.toFixed(2)}
                        </td>
                        <td className="py-2.5 px-2 text-right text-slate-700">
                          ${row.mae.toFixed(2)}
                        </td>
                        <td
                          className="py-2.5 px-2 text-right text-slate-700"
                          title={`MAPE over ${row.mapeSampleCount} non-zero LTV entities`}
                        >
                          {row.mape !== null ? `${row.mape.toFixed(1)}%` : '—'}
                        </td>
                        <td
                          className="py-2.5 px-2 text-right text-slate-800"
                          title={`Mean projection SE: ±$${row.standardError.toFixed(2)} | Residual SE: ±$${row.residualStdError.toFixed(2)}`}
                        >
                          ±${row.standardError.toFixed(2)}
                        </td>
                        <td
                          className="py-2.5 px-2 text-right text-blue-700 whitespace-nowrap"
                          title={`Entity 95% PI margin: ±$${row.pi95HalfWidth.toFixed(2)} | Mean ŷ: $${row.meanPredicted.toFixed(2)}`}
                        >
                          ${row.ci95Lower.toFixed(0)}–${row.ci95Upper.toFixed(0)}
                        </td>
                        <td
                          className={`py-2.5 px-2 text-right ${
                            Math.abs(row.bias) > row.mae * 0.5
                              ? 'text-amber-700'
                              : 'text-slate-600'
                          }`}
                        >
                          {row.bias >= 0
                            ? `+$${row.bias.toFixed(0)}`
                            : `-$${Math.abs(row.bias).toFixed(0)}`}
                        </td>
                        <td className="py-2.5 px-2 text-right text-slate-700">
                          {row.calibrationRatio !== null
                            ? `${row.calibrationRatio.toFixed(2)}×`
                            : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
            <span>
              MAPE excludes $0 horizon targets; 95% CI uses Student-t critical values on projection SE.
            </span>
            <span className="font-mono tabular-nums">
              Tier cutoffs: ${q25.toFixed(0)} / ${q50.toFixed(0)} / ${q75.toFixed(0)}
            </span>
          </div>
        </div>

        {/* Right: 4x4 Predicted vs Actual Value Tier Matrix */}
        <div className="xl:col-span-5 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <div>
              <h3 className="text-xs font-semibold text-slate-800 uppercase tracking-wide">
                Predicted vs. Actual LTV Tier Matrix (4×4)
              </h3>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Rows = Actual quartile · Columns = Predicted quartile
              </p>
            </div>
            <div className="flex items-center gap-3 text-xs font-mono tabular-nums">
              <span className="text-slate-700">
                Exact Hit:{' '}
                <strong className="text-blue-700">
                  {(exactHit * 100).toFixed(1)}%
                </strong>
              </span>
              <span className="text-slate-300" aria-hidden="true">
                |
              </span>
              <span className="text-slate-700">
                ±1 Tier:{' '}
                <strong className="text-slate-900">
                  {(withinOneHit * 100).toFixed(1)}%
                </strong>
              </span>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full border-separate border-spacing-1 text-xs">
              <thead>
                <tr>
                  <th className="py-1.5 px-2 text-left text-[11px] font-medium text-slate-500">
                    Actual \ Pred
                  </th>
                  {evaluationMatrix.tierLabels.map((lbl) => (
                    <th
                      key={lbl}
                      className="py-1.5 px-2 text-center text-[11px] font-semibold text-slate-700"
                    >
                      {lbl}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {activeMatrix.map((row, rIdx) => (
                  <tr key={rIdx}>
                    <td className="py-2 px-2 text-[11px] font-semibold text-slate-700 whitespace-nowrap">
                      {evaluationMatrix.tierLabels[rIdx]}
                    </td>
                    {row.map((cell) => {
                      const isDiag = cell.actualTier === cell.predictedTier;
                      return (
                        <td
                          key={cell.predictedTier}
                          title={`Actual ${evaluationMatrix.tierLabels[cell.actualTier]} → Predicted ${evaluationMatrix.tierLabels[cell.predictedTier]}: ${cell.count} entities (${(cell.rowShare * 100).toFixed(1)}% of row)`}
                          className={`py-2 px-2 text-center rounded border transition-colors ${getCellStyle(
                            isDiag,
                            cell.rowShare,
                            cell.count
                          )}`}
                        >
                          <div className="font-mono font-bold tabular-nums text-xs">
                            {cell.count}
                          </div>
                          <div className="font-mono tabular-nums text-[10px] opacity-85">
                            {(cell.rowShare * 100).toFixed(0)}%
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
};
