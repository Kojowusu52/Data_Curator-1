import React, { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { RegressionResult, RegressionRow } from '../types/curation';

type OutlierMetricFilter = 'either' | 'monetary' | 'tx_count';

interface OutlierRow {
  row: RegressionRow;
  zMonetary: number;
  zTx: number;
  maxAbsZ: number;
  triggeredMonetary: boolean;
  triggeredTx: boolean;
  triggerLabel: string;
}

interface OutlierAnalysisSectionProps {
  regResult: RegressionResult;
}

const SIGMA_THRESHOLDS = [2.0, 2.5, 3.0, 3.5] as const;

export const OutlierAnalysisSection: React.FC<OutlierAnalysisSectionProps> = ({
  regResult,
}) => {
  const [sigmaThreshold, setSigmaThreshold] = useState<number>(2.5);
  const [metricFilter, setMetricFilter] = useState<OutlierMetricFilter>('either');

  const analysis = useMemo(() => {
    const rows = regResult.rows;
    const n = rows.length;
    if (n < 2) {
      return {
        monetaryMean: 0,
        monetaryStd: 0,
        txMean: 0,
        txStd: 0,
        outliers: [] as OutlierRow[],
      };
    }

    const monetaryMean =
      rows.reduce((acc, r) => acc + r.monetarySumObs, 0) / n;
    const txMean = rows.reduce((acc, r) => acc + r.txCountObs, 0) / n;

    const monetaryVar =
      rows.reduce((acc, r) => acc + (r.monetarySumObs - monetaryMean) ** 2, 0) / n;
    const txVar =
      rows.reduce((acc, r) => acc + (r.txCountObs - txMean) ** 2, 0) / n;

    const monetaryStd = Math.sqrt(monetaryVar);
    const txStd = Math.sqrt(txVar);

    const outliers: OutlierRow[] = [];

    for (const row of rows) {
      const zMonetary =
        monetaryStd > 1e-9 ? (row.monetarySumObs - monetaryMean) / monetaryStd : 0;
      const zTx = txStd > 1e-9 ? (row.txCountObs - txMean) / txStd : 0;

      const triggeredMonetary = Math.abs(zMonetary) >= sigmaThreshold;
      const triggeredTx = Math.abs(zTx) >= sigmaThreshold;

      const matchesFilter =
        metricFilter === 'either'
          ? triggeredMonetary || triggeredTx
          : metricFilter === 'monetary'
          ? triggeredMonetary
          : triggeredTx;

      if (!matchesFilter) continue;

      const triggerLabel =
        triggeredMonetary && triggeredTx
          ? 'Monetary & Tx Count'
          : triggeredMonetary
          ? 'monetary_sum_obs'
          : 'tx_count_obs';

      outliers.push({
        row,
        zMonetary,
        zTx,
        maxAbsZ: Math.max(Math.abs(zMonetary), Math.abs(zTx)),
        triggeredMonetary,
        triggeredTx,
        triggerLabel,
      });
    }

    outliers.sort((a, b) => b.maxAbsZ - a.maxAbsZ);

    return {
      monetaryMean,
      monetaryStd,
      txMean,
      txStd,
      outliers,
    };
  }, [regResult.rows, sigmaThreshold, metricFilter]);

  const totalRows = regResult.rows.length || 1;
  const outlierPct = (analysis.outliers.length / totalRows) * 100;

  return (
    <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">
            Outlier Analysis (Standard Deviation Thresholds)
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Identifies entity IDs exceeding ±{sigmaThreshold.toFixed(1)}σ from cohort mean in observation-window spend or transaction frequency.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Metric Filter */}
          <div
            className="flex items-center gap-1 p-1 bg-slate-100 rounded-md"
            role="group"
            aria-label="Outlier feature filter"
          >
            {(
              [
                { id: 'either', label: 'Either Feature' },
                { id: 'monetary', label: 'monetary_sum' },
                { id: 'tx_count', label: 'tx_count' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setMetricFilter(opt.id)}
                className={`px-2.5 py-1 text-[11px] font-medium rounded transition-colors whitespace-nowrap ${
                  metricFilter === opt.id
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* Sigma Threshold Selector */}
          <div
            className="flex items-center gap-1 p-1 bg-slate-100 rounded-md"
            role="group"
            aria-label="Standard deviation threshold"
          >
            {SIGMA_THRESHOLDS.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setSigmaThreshold(k)}
                className={`px-2.5 py-1 text-[11px] font-mono rounded transition-colors whitespace-nowrap ${
                  sigmaThreshold === k
                    ? 'bg-white text-slate-900 font-semibold shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                ±{k.toFixed(1)}σ
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Baseline Mean / Std Strip */}
      <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-slate-200 bg-slate-50/60 border-b border-slate-200 text-xs">
        <div className="px-6 py-3.5 flex items-center justify-between gap-4">
          <div>
            <div className="text-[11px] text-slate-500">monetary_sum_obs (μ ± σ)</div>
            <div className="font-mono font-semibold text-slate-900 mt-0.5 tabular-nums">
              ${analysis.monetaryMean.toFixed(2)} ± ${analysis.monetaryStd.toFixed(2)}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[11px] text-slate-500">Upper Cutoff</div>
            <div className="font-mono text-slate-700 mt-0.5 tabular-nums">
              ${(analysis.monetaryMean + sigmaThreshold * analysis.monetaryStd).toFixed(0)}
            </div>
          </div>
        </div>

        <div className="px-6 py-3.5 flex items-center justify-between gap-4">
          <div>
            <div className="text-[11px] text-slate-500">tx_count_obs (μ ± σ)</div>
            <div className="font-mono font-semibold text-slate-900 mt-0.5 tabular-nums">
              {analysis.txMean.toFixed(2)} ± {analysis.txStd.toFixed(2)}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[11px] text-slate-500">Upper Cutoff</div>
            <div className="font-mono text-slate-700 mt-0.5 tabular-nums">
              {(analysis.txMean + sigmaThreshold * analysis.txStd).toFixed(1)} tx
            </div>
          </div>
        </div>

        <div className="px-6 py-3.5 flex items-center justify-between gap-4">
          <div>
            <div className="text-[11px] text-slate-500">Flagged Entities</div>
            <div className="font-mono font-semibold text-slate-900 mt-0.5 tabular-nums">
              {analysis.outliers.length} of {regResult.rows.length} ({outlierPct.toFixed(1)}%)
            </div>
          </div>
          <div className="text-xs font-medium">
            {analysis.outliers.length > 0 ? (
              <span className="inline-flex items-center gap-1 text-amber-700">
                <AlertTriangle className="w-3.5 h-3.5" />
                <span>Extremes found</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-emerald-700">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Within ±{sigmaThreshold.toFixed(1)}σ</span>
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Outlier Entity List Table */}
      {regResult.rows.length < 2 ? (
        <div className="p-8 text-center text-xs text-slate-500">
          At least 2 materialized entities are required to compute standard deviation outlier bounds.
        </div>
      ) : analysis.outliers.length === 0 ? (
        <div className="p-8 text-center text-xs text-slate-500">
          No entity IDs exceed ±{sigmaThreshold.toFixed(1)}σ for the selected metric filter. Try lowering the threshold to ±2.0σ to inspect mild tail entities.
        </div>
      ) : (
        <div className="overflow-x-auto max-h-80">
          <table className="w-full text-left border-collapse">
            <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-600">
              <tr>
                <th className="py-2.5 px-4">Entity ID</th>
                <th className="py-2.5 px-4">Split</th>
                <th className="py-2.5 px-4">Exceeded Metric</th>
                <th className="py-2.5 px-4 text-right">monetary_sum_obs</th>
                <th className="py-2.5 px-4 text-right">Monetary z-score</th>
                <th className="py-2.5 px-4 text-right">tx_count_obs</th>
                <th className="py-2.5 px-4 text-right">Tx z-score</th>
                <th className="py-2.5 px-4 text-right">Raw LTV</th>
                <th className="py-2.5 px-4 text-right">Winsor LTV</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-xs">
              {analysis.outliers.map(
                ({ row, zMonetary, zTx, triggeredMonetary, triggeredTx, triggerLabel }) => (
                  <tr key={row.entityId} className="hover:bg-slate-50/80 h-9">
                    <td className="py-2 px-4 font-mono font-semibold text-slate-900 whitespace-nowrap">
                      {row.entityId}
                    </td>
                    <td className="py-2 px-4 font-mono text-slate-500 whitespace-nowrap">
                      {row.split}
                    </td>
                    <td className="py-2 px-4 text-slate-700 font-mono text-[11px] whitespace-nowrap">
                      {triggerLabel}
                    </td>
                    <td className="py-2 px-4 text-right font-mono tabular-nums text-slate-900 whitespace-nowrap">
                      ${row.monetarySumObs.toFixed(2)}
                    </td>
                    <td
                      className={`py-2 px-4 text-right font-mono tabular-nums whitespace-nowrap ${
                        triggeredMonetary
                          ? 'font-semibold text-amber-700'
                          : 'text-slate-500'
                      }`}
                    >
                      {zMonetary >= 0 ? `+${zMonetary.toFixed(2)}σ` : `${zMonetary.toFixed(2)}σ`}
                    </td>
                    <td className="py-2 px-4 text-right font-mono tabular-nums text-slate-900 whitespace-nowrap">
                      {row.txCountObs}
                    </td>
                    <td
                      className={`py-2 px-4 text-right font-mono tabular-nums whitespace-nowrap ${
                        triggeredTx
                          ? 'font-semibold text-amber-700'
                          : 'text-slate-500'
                      }`}
                    >
                      {zTx >= 0 ? `+${zTx.toFixed(2)}σ` : `${zTx.toFixed(2)}σ`}
                    </td>
                    <td className="py-2 px-4 text-right font-mono tabular-nums text-slate-600 whitespace-nowrap">
                      ${row.targetLtvRaw.toFixed(2)}
                    </td>
                    <td className="py-2 px-4 text-right font-mono tabular-nums font-medium text-slate-900 whitespace-nowrap">
                      ${row.targetLtvWinsorized.toFixed(2)}
                    </td>
                  </tr>
                )
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
};
