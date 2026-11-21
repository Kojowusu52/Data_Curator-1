import React, { useMemo, useState } from 'react';
import { BarChart3 } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  LinearFeatureImportance,
  LinearFitSummary,
  RegressionNormalizationMode,
} from '../types/curation';

interface FeatureImportanceChartProps {
  linearFit: LinearFitSummary;
  selectedFeaturesCount: number;
  normalizationMode: RegressionNormalizationMode;
}

type ImportanceChartMode = 'signed_beta' | 'abs_beta' | 'univariate_r2';

interface ChartDatum extends LinearFeatureImportance {
  metricValue: number;
  shortName: string;
}

export const FeatureImportanceChart: React.FC<FeatureImportanceChartProps> = ({
  linearFit,
  selectedFeaturesCount,
  normalizationMode,
}) => {
  const [mode, setMode] = useState<ImportanceChartMode>('signed_beta');

  const sortedItems = useMemo(() => {
    const items = [...linearFit.features];
    if (mode === 'univariate_r2') {
      items.sort((a, b) => b.univariateR2 - a.univariateR2);
    } else {
      items.sort(
        (a, b) => Math.abs(b.standardizedBeta) - Math.abs(a.standardizedBeta)
      );
    }
    return items;
  }, [linearFit.features, mode]);

  const chartData = useMemo<ChartDatum[]>(() => {
    return sortedItems.map((item) => ({
      ...item,
      shortName: item.label.replace(' (Obs)', ''),
      metricValue:
        mode === 'signed_beta'
          ? item.standardizedBeta
          : mode === 'abs_beta'
          ? Math.abs(item.standardizedBeta)
          : item.univariateR2,
    }));
  }, [sortedItems, mode]);

  const topPositive = useMemo(
    () =>
      [...linearFit.features]
        .filter((f) => f.standardizedBeta > 0.005)
        .sort((a, b) => b.standardizedBeta - a.standardizedBeta)[0] ?? null,
    [linearFit.features]
  );

  const topNegative = useMemo(
    () =>
      [...linearFit.features]
        .filter((f) => f.standardizedBeta < -0.005)
        .sort((a, b) => a.standardizedBeta - b.standardizedBeta)[0] ?? null,
    [linearFit.features]
  );

  const xDomain = useMemo<[number, number]>(() => {
    if (chartData.length === 0) return [-0.5, 0.5];
    if (mode === 'signed_beta') {
      const maxAbs = Math.max(
        0.1,
        ...chartData.map((d) => Math.abs(d.metricValue))
      );
      const pad = Math.ceil(maxAbs * 11.5) / 10;
      return [-pad, pad];
    }
    const maxPos = Math.max(0.1, ...chartData.map((d) => d.metricValue));
    return [0, Math.ceil(maxPos * 11.5) / 10];
  }, [chartData, mode]);

  const chartHeight = Math.max(230, chartData.length * 40 + 44);

  return (
    <section
      aria-label="LTV Model Feature Importance Chart"
      className="bg-white border border-slate-200 rounded-lg overflow-hidden"
    >
      {/* Header */}
      <div className="px-6 py-4 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div className="flex items-start gap-2.5">
          <BarChart3 className="w-4 h-4 text-blue-700 shrink-0 mt-0.5" />
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              LTV Feature Importance &amp; Coefficient Impact
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {mode === 'signed_beta'
                ? 'Signed standardized OLS coefficients (β) showing positive and negative LTV driver impact across selected predictors.'
                : mode === 'abs_beta'
                ? 'Absolute standardized coefficient magnitude (|β|) and relative driver share across selected predictors.'
                : 'Single-predictor univariate R² measuring standalone target LTV variance explained per feature.'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-md self-start shrink-0">
          <button
            type="button"
            onClick={() => setMode('signed_beta')}
            className={`px-3 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
              mode === 'signed_beta'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Signed Impact (β)
          </button>
          <button
            type="button"
            onClick={() => setMode('abs_beta')}
            className={`px-3 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
              mode === 'abs_beta'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Magnitude |β|
          </button>
          <button
            type="button"
            onClick={() => setMode('univariate_r2')}
            className={`px-3 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
              mode === 'univariate_r2'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Univariate R²
          </button>
        </div>
      </div>

      {/* Key Driver Summary Strip */}
      <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-slate-200 border-b border-slate-200 bg-slate-50/50">
        <div className="px-5 py-3.5">
          <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">
            Strongest Positive Driver (+β)
          </div>
          <div className="text-sm font-semibold text-slate-900 mt-1 truncate">
            {topPositive ? topPositive.label : 'None active'}
          </div>
          <div className="text-xs font-mono tabular-nums text-blue-700 mt-0.5">
            {topPositive
              ? `+${topPositive.standardizedBeta.toFixed(3)} β · ${(
                  topPositive.importanceShare * 100
                ).toFixed(1)}% share`
              : 'No positive coefficient > 0.005'}
          </div>
        </div>

        <div className="px-5 py-3.5">
          <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">
            Strongest Negative Driver (−β)
          </div>
          <div className="text-sm font-semibold text-slate-900 mt-1 truncate">
            {topNegative ? topNegative.label : 'None active'}
          </div>
          <div className="text-xs font-mono tabular-nums text-rose-700 mt-0.5">
            {topNegative
              ? `${topNegative.standardizedBeta.toFixed(3)} β · ${(
                  topNegative.importanceShare * 100
                ).toFixed(1)}% share`
              : 'No negative coefficient < -0.005'}
          </div>
        </div>

        <div className="px-5 py-3.5">
          <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">
            Active OLS Configuration
          </div>
          <div className="text-sm font-semibold font-mono tabular-nums text-slate-900 mt-1">
            R² = {linearFit.rSquared.toFixed(3)} · RMSE = $
            {linearFit.rmse.toFixed(2)}
          </div>
          <div className="text-xs font-mono tabular-nums text-slate-500 mt-0.5">
            {selectedFeaturesCount} selected features · b₀ = $
            {linearFit.intercept.toFixed(2)} · norm={normalizationMode}
          </div>
        </div>
      </div>

      {linearFit.sampleSize < 3 || chartData.length === 0 ? (
        <div className="py-12 px-6 text-center text-xs text-slate-500">
          At least 3 materialized entities are required to fit OLS coefficients and render the feature importance bar chart. Adjust T_obs or split filters.
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-12 divide-y xl:divide-y-0 xl:divide-x divide-slate-200">
          {/* Recharts Bar Graph */}
          <div className="xl:col-span-7 p-5">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3 text-xs text-slate-600">
              <div className="flex items-center gap-4">
                <span className="inline-flex items-center gap-1.5">
                  <span
                    className="w-2.5 h-2.5 rounded-xs bg-blue-700 inline-block"
                    aria-hidden="true"
                  />
                  <span>
                    {mode === 'univariate_r2'
                      ? 'Variance Explained (R²)'
                      : 'Positive LTV Lift (+β)'}
                  </span>
                </span>
                {mode !== 'univariate_r2' && (
                  <span className="inline-flex items-center gap-1.5">
                    <span
                      className="w-2.5 h-2.5 rounded-xs bg-rose-600 inline-block"
                      aria-hidden="true"
                    />
                    <span>Negative LTV Effect (−β)</span>
                  </span>
                )}
              </div>
              <span className="font-mono text-[11px] text-slate-500 tabular-nums">
                n = {linearFit.sampleSize} entities
              </span>
            </div>

            <div style={{ height: chartHeight }} className="w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={chartData}
                  layout="vertical"
                  margin={{ top: 6, right: 20, left: 6, bottom: 16 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    horizontal={false}
                    stroke="#e2e8f0"
                  />
                  <XAxis
                    type="number"
                    domain={xDomain}
                    tick={{ fontSize: 11, fill: '#475569' }}
                    tickLine={false}
                    axisLine={{ stroke: '#cbd5e1' }}
                    tickFormatter={(v: number) =>
                      mode === 'signed_beta' && v > 0
                        ? `+${v.toFixed(2)}`
                        : v.toFixed(2)
                    }
                    label={{
                      value:
                        mode === 'signed_beta'
                          ? 'Standardized Coefficient (β)'
                          : mode === 'abs_beta'
                          ? 'Coefficient Magnitude |β|'
                          : 'Univariate R²',
                      position: 'insideBottom',
                      offset: -8,
                      fontSize: 11,
                      fill: '#64748b',
                    }}
                  />
                  <YAxis
                    type="category"
                    dataKey="shortName"
                    width={148}
                    tick={{ fontSize: 11, fill: '#334155', fontWeight: 500 }}
                    tickLine={false}
                    axisLine={{ stroke: '#cbd5e1' }}
                  />
                  {mode === 'signed_beta' && (
                    <ReferenceLine x={0} stroke="#64748b" strokeWidth={1.25} />
                  )}
                  <Tooltip
                    cursor={{ fill: '#f8fafc' }}
                    content={({ active, payload }) => {
                      if (!active || !payload || payload.length === 0)
                        return null;
                      const d = payload[0].payload as ChartDatum;
                      return (
                        <div className="bg-white border border-slate-200 rounded-md px-3 py-2 shadow-sm text-xs font-mono tabular-nums space-y-1">
                          <div className="font-sans font-semibold text-slate-900 border-b border-slate-100 pb-1">
                            {d.label}
                          </div>
                          <div className="flex items-center justify-between gap-4">
                            <span className="text-slate-500">Std. Beta (β):</span>
                            <span
                              className={`font-semibold ${
                                d.direction === 'negative'
                                  ? 'text-rose-700'
                                  : d.direction === 'positive'
                                  ? 'text-blue-700'
                                  : 'text-slate-700'
                              }`}
                            >
                              {d.standardizedBeta >= 0 ? '+' : ''}
                              {d.standardizedBeta.toFixed(3)}
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-4">
                            <span className="text-slate-500">Raw OLS Slope:</span>
                            <span className="text-slate-900">
                              {d.rawCoefficient >= 0 ? '+' : ''}
                              {d.rawCoefficient.toFixed(3)}
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-4">
                            <span className="text-slate-500">Impact Share:</span>
                            <span className="text-slate-900">
                              {(d.importanceShare * 100).toFixed(1)}%
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-4">
                            <span className="text-slate-500">Univariate R²:</span>
                            <span className="text-slate-900">
                              {d.univariateR2.toFixed(3)}
                            </span>
                          </div>
                        </div>
                      );
                    }}
                  />
                  <Bar
                    dataKey="metricValue"
                    barSize={22}
                    radius={[3, 3, 3, 3]}
                    isAnimationActive={false}
                  >
                    {chartData.map((entry) => {
                      const fill =
                        mode === 'univariate_r2'
                          ? '#1d4ed8'
                          : entry.direction === 'negative'
                          ? '#e11d48'
                          : entry.direction === 'positive'
                          ? '#1d4ed8'
                          : '#64748b';
                      return <Cell key={entry.feature} fill={fill} />;
                    })}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Ranked Coefficient Breakdown Table */}
          <div className="xl:col-span-5 overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-600">
                  <th className="py-2.5 px-4">Rank · Predictor</th>
                  <th className="py-2.5 px-2 text-right">Std. β</th>
                  <th className="py-2.5 px-2 text-right">Raw Slope</th>
                  <th className="py-2.5 px-2 text-right">Share</th>
                  <th className="py-2.5 px-4 text-right">Univ. R²</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-xs font-mono tabular-nums">
                {sortedItems.map((item, idx) => (
                  <tr key={item.feature} className="hover:bg-slate-50/80">
                    <td className="py-2.5 px-4 font-sans text-slate-900">
                      <span className="font-mono text-[11px] text-slate-400 mr-1.5">
                        {idx + 1}.
                      </span>
                      <span className="font-medium">
                        {item.label.replace(' (Obs)', '')}
                      </span>
                    </td>
                    <td
                      className={`py-2.5 px-2 text-right font-semibold ${
                        item.direction === 'negative'
                          ? 'text-rose-700'
                          : item.direction === 'positive'
                          ? 'text-blue-700'
                          : 'text-slate-600'
                      }`}
                    >
                      {item.standardizedBeta >= 0
                        ? `+${item.standardizedBeta.toFixed(3)}`
                        : item.standardizedBeta.toFixed(3)}
                    </td>
                    <td className="py-2.5 px-2 text-right text-slate-700">
                      {item.rawCoefficient >= 0
                        ? `+${item.rawCoefficient.toFixed(2)}`
                        : item.rawCoefficient.toFixed(2)}
                    </td>
                    <td className="py-2.5 px-2 text-right text-slate-700">
                      {(item.importanceShare * 100).toFixed(1)}%
                    </td>
                    <td className="py-2.5 px-4 text-right text-slate-600">
                      {item.univariateR2.toFixed(3)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
};
