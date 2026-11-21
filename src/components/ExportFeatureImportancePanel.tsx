import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  Check,
  CheckCircle2,
  Copy,
  Download,
  RefreshCw,
} from 'lucide-react';
import {
  ExportFeatureImportanceRow,
  RegressionConfig,
  RegressionResult,
} from '../types/curation';
import {
  buildExportFeatureImportanceReport,
  formatFeatureImportanceCsv,
  formatFeatureImportanceMarkdown,
} from '../engine/curationEngine';

interface ExportFeatureImportancePanelProps {
  datasetName: string;
  regConfig: RegressionConfig;
  regResult: RegressionResult;
}

type SortField = 'importance' | 'univariate_r2' | 'pearson_r' | 'raw_slope';
type DirectionFilter = 'all' | 'positive' | 'negative';

export const ExportFeatureImportancePanel: React.FC<
  ExportFeatureImportancePanelProps
> = ({ datasetName, regConfig, regResult }) => {
  const [sortBy, setSortBy] = useState<SortField>('importance');
  const [directionFilter, setDirectionFilter] = useState<DirectionFilter>('all');
  const [copiedMd, setCopiedMd] = useState(false);
  const [generatedAt, setGeneratedAt] = useState<string>(() =>
    new Date().toLocaleTimeString()
  );

  const report = useMemo(
    () => buildExportFeatureImportanceReport(regConfig, regResult, datasetName),
    [regConfig, regResult, datasetName]
  );

  const displayedRows = useMemo<ExportFeatureImportanceRow[]>(() => {
    const filtered =
      directionFilter === 'all'
        ? report.rows
        : report.rows.filter((r) => r.direction === directionFilter);

    const sorted = [...filtered];
    sorted.sort((a, b) => {
      if (sortBy === 'univariate_r2') return b.univariateR2 - a.univariateR2;
      if (sortBy === 'pearson_r') return Math.abs(b.pearsonR) - Math.abs(a.pearsonR);
      if (sortBy === 'raw_slope') {
        return Math.abs(b.rawCoefficient) - Math.abs(a.rawCoefficient);
      }
      return b.absBeta - a.absBeta;
    });
    return sorted;
  }, [report.rows, directionFilter, sortBy]);

  const topRow = report.rows[0] ?? null;

  const handleRefreshSummary = () => {
    setGeneratedAt(new Date().toLocaleTimeString());
  };

  const handleCopyMarkdown = async () => {
    const md = formatFeatureImportanceMarkdown(report);
    try {
      await navigator.clipboard.writeText(md);
      setCopiedMd(true);
      window.setTimeout(() => setCopiedMd(false), 1800);
    } catch {
      setCopiedMd(false);
    }
  };

  const handleDownloadCsv = () => {
    const csv = formatFeatureImportanceCsv(report);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'stratum_feature_importance.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <section
      aria-label="Exported Dataset Feature Importance Summary Table"
      className="bg-white border border-slate-200 rounded-lg overflow-hidden"
    >
      {/* Header */}
      <div className="px-6 py-4 border-b border-slate-200 flex flex-col xl:flex-row xl:items-center xl:justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <BarChart3 className="w-4 h-4 text-blue-700 shrink-0 mt-0.5" />
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              Exported Dataset Feature Importance Summary Table
            </h2>
            <p className="text-xs text-slate-500 mt-0.5 font-mono tabular-nums">
              OLS LTV attribution across {report.featureCount} exported column
              {report.featureCount === 1 ? '' : 's'} · n={report.sampleSize} rows ·
              T_obs=Day {report.obsCutoffDay} · H={report.horizonDays}d
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 self-start">
          <button
            type="button"
            onClick={handleRefreshSummary}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap"
          >
            <RefreshCw className="w-3.5 h-3.5 text-slate-500" />
            <span>Generate Summary</span>
          </button>

          <button
            type="button"
            disabled={report.rows.length === 0}
            onClick={handleCopyMarkdown}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-45 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
          >
            {copiedMd ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-600" />
                <span>Copied Markdown</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5 text-slate-500" />
                <span>Copy Markdown</span>
              </>
            )}
          </button>

          <button
            type="button"
            disabled={report.rows.length === 0}
            onClick={handleDownloadCsv}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-blue-700 text-white hover:bg-blue-800 disabled:bg-slate-200 disabled:text-slate-500 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Download CSV</span>
          </button>
        </div>
      </div>

      {/* 4-Metric Driver Overview */}
      <div className="grid grid-cols-2 lg:grid-cols-4 divide-y lg:divide-y-0 lg:divide-x divide-slate-200 border-b border-slate-200 bg-slate-50/50">
        <div className="p-4">
          <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">
            Primary LTV Driver
          </div>
          <div className="text-base font-bold font-mono text-slate-900 mt-1 truncate">
            {topRow ? topRow.csvColumn : '—'}
          </div>
          <div className="text-[11px] font-mono tabular-nums text-blue-700 mt-0.5">
            {topRow
              ? `${topRow.importanceSharePct.toFixed(1)}% weight · β=${
                  topRow.standardizedBeta >= 0 ? '+' : ''
                }${topRow.standardizedBeta.toFixed(3)}`
              : 'No active features'}
          </div>
        </div>

        <div className="p-4">
          <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">
            Top-2 Attribution Share
          </div>
          <div className="text-lg font-bold font-mono tabular-nums text-slate-900 mt-1">
            {report.topTwoCumulativeSharePct.toFixed(1)}%
          </div>
          <div className="text-[11px] font-mono tabular-nums text-slate-500 mt-0.5">
            Cumulative |β| share across top 2 columns
          </div>
        </div>

        <div className="p-4">
          <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">
            OLS Fit on Exported Cohort
          </div>
          <div className="text-lg font-bold font-mono tabular-nums text-slate-900 mt-1">
            R² = {report.rSquared.toFixed(3)}
          </div>
          <div className="text-[11px] font-mono tabular-nums text-slate-500 mt-0.5">
            RMSE ${report.rmse.toFixed(2)} · MAE ${report.mae.toFixed(2)}
          </div>
        </div>

        <div className="p-4">
          <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">
            Model Intercept (b₀)
          </div>
          <div className="text-lg font-bold font-mono tabular-nums text-slate-900 mt-1">
            ${report.intercept.toFixed(2)}
          </div>
          <div className="text-[11px] font-mono tabular-nums text-slate-500 mt-0.5">
            Win P{report.winsorizePercentile} · norm={report.normalizationMode}
          </div>
        </div>
      </div>

      {/* Sort & Direction Filter Controls */}
      <div className="px-6 py-3 border-b border-slate-200 bg-white flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-slate-700 whitespace-nowrap">
            Rank By
          </span>
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-md">
            {(
              [
                { id: 'importance', label: 'Weight Share |β|' },
                { id: 'univariate_r2', label: 'Univariate R²' },
                { id: 'pearson_r', label: 'Pearson |r|' },
                { id: 'raw_slope', label: 'Raw Slope |w|' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setSortBy(opt.id)}
                className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                  sortBy === opt.id
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-slate-700 whitespace-nowrap">
            Effect
          </span>
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-md">
            {(
              [
                { id: 'all', label: 'All' },
                { id: 'positive', label: 'Positive (+β)' },
                { id: 'negative', label: 'Negative (−β)' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setDirectionFilter(opt.id)}
                className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                  directionFilter === opt.id
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Feature Importance Summary Table */}
      {report.sampleSize < 3 || report.rows.length === 0 ? (
        <div className="py-10 px-6 text-center text-xs text-slate-500">
          At least 3 materialized rows are required to compute OLS feature importance weights for the exported dataset.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-600">
                <th className="py-2.5 px-4">Rank</th>
                <th className="py-2.5 px-4">Exported Column</th>
                <th className="py-2.5 px-4">Weight Share</th>
                <th className="py-2.5 px-3 text-right whitespace-nowrap">
                  Std. β
                </th>
                <th className="py-2.5 px-3 text-right whitespace-nowrap">
                  Raw Slope ($/unit)
                </th>
                <th className="py-2.5 px-3 text-right whitespace-nowrap">
                  Univariate R²
                </th>
                <th className="py-2.5 px-3 text-right whitespace-nowrap">
                  Pearson r
                </th>
                <th className="py-2.5 px-3 whitespace-nowrap">LTV Effect</th>
                <th className="py-2.5 px-4 whitespace-nowrap">Audit Signal</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-xs">
              {displayedRows.map((row) => {
                const isPos = row.direction === 'positive';
                const isNeg = row.direction === 'negative';
                return (
                  <tr
                    key={row.featureKey}
                    className="h-11 hover:bg-slate-50/70 transition-colors"
                  >
                    <td className="py-2 px-4 font-mono font-semibold text-slate-700 tabular-nums">
                      #{row.rank}
                    </td>
                    <td className="py-2 px-4 min-w-48" title={row.description}>
                      <div className="font-mono font-semibold text-slate-900">
                        {row.csvColumn}
                      </div>
                      <div className="text-[11px] text-slate-500">{row.label}</div>
                    </td>
                    <td className="py-2 px-4 w-48">
                      <div className="flex items-center gap-2.5">
                        <div className="flex-1 h-2 bg-slate-100 rounded overflow-hidden">
                          <div
                            className={`h-full rounded ${
                              isNeg ? 'bg-rose-600' : 'bg-blue-700'
                            }`}
                            style={{
                              width: `${Math.min(
                                100,
                                Math.max(3, Math.round(row.importanceSharePct))
                              )}%`,
                            }}
                          />
                        </div>
                        <span className="font-mono tabular-nums font-semibold text-slate-900 w-12 text-right">
                          {row.importanceSharePct.toFixed(1)}%
                        </span>
                      </div>
                    </td>
                    <td
                      className={`py-2 px-3 text-right font-mono tabular-nums font-semibold ${
                        isPos
                          ? 'text-blue-700'
                          : isNeg
                          ? 'text-rose-700'
                          : 'text-slate-600'
                      }`}
                    >
                      {row.standardizedBeta >= 0 ? '+' : ''}
                      {row.standardizedBeta.toFixed(3)}
                    </td>
                    <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-800">
                      {row.rawCoefficient >= 0 ? '+' : '−'}$
                      {Math.abs(row.rawCoefficient).toFixed(3)}
                    </td>
                    <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-700">
                      {row.univariateR2.toFixed(3)}
                    </td>
                    <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-700">
                      {row.pearsonR >= 0 ? '+' : ''}
                      {row.pearsonR.toFixed(3)}
                    </td>
                    <td
                      className={`py-2 px-3 font-medium whitespace-nowrap ${
                        isPos
                          ? 'text-blue-700'
                          : isNeg
                          ? 'text-rose-700'
                          : 'text-slate-500'
                      }`}
                    >
                      {isPos
                        ? 'Positive Lift'
                        : isNeg
                        ? 'Negative Effect'
                        : 'Neutral'}
                    </td>
                    <td className="py-2 px-4 whitespace-nowrap text-[11px]">
                      {row.klExceedsThreshold ? (
                        <span className="inline-flex items-center gap-1 text-rose-700 font-medium">
                          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                          <span>
                            KL Drift ({row.klDivergence?.toFixed(2) ?? '—'})
                          </span>
                        </span>
                      ) : row.collinearPartners.length > 0 ? (
                        <span
                          className="inline-flex items-center gap-1 text-amber-700 font-medium"
                          title={`High collinearity with: ${row.collinearPartners.join(', ')}`}
                        >
                          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                          <span>Collinear ({row.collinearPartners.length})</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-emerald-700">
                          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                          <span>Verified</span>
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}

              {displayedRows.length === 0 && (
                <tr>
                  <td
                    colSpan={9}
                    className="py-8 text-center text-xs text-slate-500"
                  >
                    No exported features match the selected effect direction filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Footer Narrative */}
      <div className="px-6 py-3 bg-slate-50/70 border-t border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-xs text-slate-600">
        <span>{report.summaryNarrative}</span>
        <span className="text-[11px] font-mono tabular-nums text-slate-500 whitespace-nowrap">
          Snapshot: {generatedAt}
        </span>
      </div>
    </section>
  );
};
