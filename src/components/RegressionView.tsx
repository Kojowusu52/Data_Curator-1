import React, { useMemo, useState } from 'react';
import { ArrowUpDown, Check, CheckCircle2, AlertTriangle, Search } from 'lucide-react';
import {
  GlobalCurationConfig,
  RawEvent,
  RegressionConfig,
  RegressionFeatureKey,
  RegressionFeatureValues,
  RegressionNormalizationMode,
  RegressionResult,
  RegressionRow,
  SplitName,
} from '../types/curation';
import {
  DEFAULT_KL_DRIFT_THRESHOLD,
  REGRESSION_FEATURE_CATALOG,
} from '../engine/curationEngine';
import { RegressionCorrelationHeatmap } from './RegressionCorrelationHeatmap';
import { LtvProjectionVisualizer } from './LtvProjectionVisualizer';
import { CutoffSensitivityChart } from './CutoffSensitivityChart';
import { TargetQualityIndicator } from './TargetQualityIndicator';
import { ModelDriftIndicator } from './ModelDriftIndicator';
import { KlDriftAlertSystem } from './KlDriftAlertSystem';
import { SegmentVarianceVisualizer } from './SegmentVarianceVisualizer';
import { ModelEvaluationMatrix } from './ModelEvaluationMatrix';
import { FeatureImportanceChart } from './FeatureImportanceChart';
import { LtvAnomalyDetector } from './LtvAnomalyDetector';
import { TrendProjectionChart } from './TrendProjectionChart';
import { ExplainableAiPanel } from './ExplainableAiPanel';

interface RegressionViewProps {
  datasetName?: string;
  datasetDomain?: string;
  events: RawEvent[];
  globalConfig: GlobalCurationConfig;
  config: RegressionConfig;
  onUpdateConfig: (next: RegressionConfig) => void;
  result: RegressionResult;
  maxDay: number;
}

type SortKey =
  | 'entityId'
  | RegressionFeatureKey
  | 'targetLtvRaw'
  | 'targetLtvWinsorized';

export const RegressionView: React.FC<RegressionViewProps> = ({
  datasetName = 'Active LTV Cohort',
  datasetDomain = 'Customer Analytics',
  events,
  globalConfig,
  config,
  onUpdateConfig,
  result,
  maxDay,
}) => {
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('targetLtvWinsorized');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  const isScaled = config.featureNormalization !== 'none';

  const selectedFeatureDefs = useMemo(() => {
    const selectedSet = new Set(config.selectedFeatures);
    const active = REGRESSION_FEATURE_CATALOG.filter((f) => selectedSet.has(f.key));
    return active.length > 0 ? active : REGRESSION_FEATURE_CATALOG;
  }, [config.selectedFeatures]);

  const activeFeatureKeys = useMemo(
    () => selectedFeatureDefs.map((f) => f.key),
    [selectedFeatureDefs]
  );

  const toggleFeature = (key: RegressionFeatureKey) => {
    const currentlySelected = activeFeatureKeys.includes(key);
    if (currentlySelected) {
      if (activeFeatureKeys.length <= 1) return;
      const next = activeFeatureKeys.filter((k) => k !== key);
      onUpdateConfig({ ...config, selectedFeatures: next });
      if (sortKey === key) {
        setSortKey('targetLtvWinsorized');
      }
    } else {
      const nextSet = new Set([...activeFeatureKeys, key]);
      const ordered = REGRESSION_FEATURE_CATALOG.filter((f) => nextSet.has(f.key)).map(
        (f) => f.key
      );
      onUpdateConfig({ ...config, selectedFeatures: ordered });
    }
  };

  const selectAllFeatures = () => {
    onUpdateConfig({
      ...config,
      selectedFeatures: REGRESSION_FEATURE_CATALOG.map((f) => f.key),
    });
  };

  const selectCoreRfmFeatures = () => {
    onUpdateConfig({
      ...config,
      selectedFeatures: ['monetarySumObs', 'txCountObs', 'recencyAtCutoff'],
    });
    if (
      sortKey !== 'entityId' &&
      sortKey !== 'targetLtvRaw' &&
      sortKey !== 'targetLtvWinsorized' &&
      sortKey !== 'monetarySumObs' &&
      sortKey !== 'txCountObs' &&
      sortKey !== 'recencyAtCutoff'
    ) {
      setSortKey('targetLtvWinsorized');
    }
  };

  const getActiveFeatureValue = (
    row: RegressionRow,
    key: keyof RegressionFeatureValues
  ): number => (isScaled ? row.scaledFeatures[key] : row[key]);

  const formatFeatureCell = (key: RegressionFeatureKey, val: number): string => {
    if (isScaled) return val.toFixed(3);
    if (key === 'monetarySumObs' || key === 'avgOrderValueObs') return `$${val.toFixed(2)}`;
    if (key === 'meanEngagementObs' || key === 'promoShareObs') return val.toFixed(3);
    return String(val);
  };

  const getRawFeatureTitle = (row: RegressionRow, key: RegressionFeatureKey): string | undefined => {
    if (!isScaled) return undefined;
    const raw = row[key];
    if (key === 'monetarySumObs' || key === 'avgOrderValueObs') return `Raw: $${raw.toFixed(2)}`;
    if (key === 'recencyAtCutoff' || key === 'tenureDaysObs') return `Raw: ${raw}d`;
    if (key === 'meanEngagementObs' || key === 'promoShareObs') return `Raw: ${raw.toFixed(3)}`;
    return `Raw: ${raw}`;
  };

  const displayRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q
      ? result.rows.filter((r) => r.entityId.toLowerCase().includes(q))
      : result.rows;

    return [...filtered]
      .sort((a: RegressionRow, b: RegressionRow) => {
        const readVal = (row: RegressionRow) => {
          if (
            sortKey !== 'entityId' &&
            sortKey !== 'targetLtvRaw' &&
            sortKey !== 'targetLtvWinsorized'
          ) {
            return isScaled ? row.scaledFeatures[sortKey] : row[sortKey];
          }
          return row[sortKey];
        };
        const va = readVal(a);
        const vb = readVal(b);
        if (typeof va === 'string' && typeof vb === 'string') {
          return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
        }
        return sortDir === 'asc' ? Number(va) - Number(vb) : Number(vb) - Number(va);
      })
      .slice(0, 100);
  }, [result.rows, search, sortKey, sortDir, isScaled]);

  const maxHistCount = Math.max(1, ...result.targetHistogram.map((b) => b.count));

  return (
    <div className="space-y-6">
      {/* Control Surface */}
      <section className="bg-white border border-slate-200 rounded-lg p-5">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 pb-4 border-b border-slate-200">
          <div>
            <h1 className="text-lg font-bold text-slate-900">
              01. Traditional Regression (LTV Feature Matrix)
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Point-in-time feature aggregation across [0, T_obs] predicting cumulative spend over (T_obs, T_obs + H].
            </p>
          </div>

          {/* Split Filter Segmented Control */}
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

        <div className="pt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-5">
          <div>
            <div className="flex items-center justify-between text-xs mb-1.5">
              <label htmlFor="reg-obs-cutoff" className="font-medium text-slate-700">
                Observation Cutoff (T_obs)
              </label>
              <span className="font-mono font-semibold text-slate-900 tabular-nums">
                Day {config.obsCutoffDay}
              </span>
            </div>
            <input
              id="reg-obs-cutoff"
              type="range"
              min={60}
              max={Math.max(90, maxDay - 60)}
              step={15}
              value={config.obsCutoffDay}
              onChange={(e) =>
                onUpdateConfig({ ...config, obsCutoffDay: Number(e.target.value) })
              }
              className="w-full accent-blue-700"
            />
          </div>

          <div>
            <div className="text-xs font-medium text-slate-700 mb-1.5">
              Prediction Horizon (H)
            </div>
            <div className="grid grid-cols-4 gap-1 p-1 bg-slate-100 rounded-md">
              {[60, 90, 120, 180].map((h) => (
                <button
                  key={h}
                  type="button"
                  onClick={() => onUpdateConfig({ ...config, horizonDays: h })}
                  className={`py-1 text-xs font-mono rounded transition-colors ${
                    config.horizonDays === h
                      ? 'bg-white text-slate-900 font-semibold shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {h}d
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="text-xs font-medium text-slate-700 mb-1.5">
              Target Winsorization (Train-Fit)
            </div>
            <div className="grid grid-cols-3 gap-1 p-1 bg-slate-100 rounded-md">
              {([0, 95, 99] as const).map((pct) => (
                <button
                  key={pct}
                  type="button"
                  onClick={() =>
                    onUpdateConfig({ ...config, winsorizePercentile: pct })
                  }
                  className={`py-1 text-xs font-mono rounded transition-colors ${
                    config.winsorizePercentile === pct
                      ? 'bg-white text-slate-900 font-semibold shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {pct === 0 ? 'None' : `P${pct}`}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="text-xs font-medium text-slate-700 mb-1.5">
              Feature Normalization (Train-Fit)
            </div>
            <div className="grid grid-cols-3 gap-1 p-1 bg-slate-100 rounded-md">
              {(
                [
                  { id: 'none', label: 'None' },
                  { id: 'zscore', label: 'Z-Score' },
                  { id: 'minmax', label: 'Min-Max' },
                ] as { id: RegressionNormalizationMode; label: string }[]
              ).map((mode) => (
                <button
                  key={mode.id}
                  type="button"
                  onClick={() =>
                    onUpdateConfig({ ...config, featureNormalization: mode.id })
                  }
                  className={`py-1 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                    config.featureNormalization === mode.id
                      ? 'bg-white text-slate-900 font-semibold shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {mode.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between text-xs mb-1.5">
              <span className="font-medium text-slate-700">Batch Size (Chunk)</span>
              <span className="font-mono text-[11px] text-slate-500 tabular-nums">
                {result.batchCount} {result.batchCount === 1 ? 'chunk' : 'chunks'}
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

          <div className="flex flex-col justify-end">
            <label className="flex items-center gap-2.5 text-xs text-slate-700 cursor-pointer select-none py-2">
              <input
                type="checkbox"
                checked={config.excludeZeroObsEntities}
                onChange={(e) =>
                  onUpdateConfig({
                    ...config,
                    excludeZeroObsEntities: e.target.checked,
                  })
                }
                className="w-4 h-4 rounded border-slate-300 text-blue-700 focus:ring-blue-600"
              />
              <span>Exclude cold-start (0 obs)</span>
            </label>
          </div>
        </div>

        {/* Model Input Feature Selection */}
        <div className="mt-4 pt-4 border-t border-slate-200">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-2.5">
            <div className="flex items-center gap-2.5">
              <span className="text-xs font-medium text-slate-700">
                Model Input Features (X_obs)
              </span>
              <span className="text-[11px] font-mono text-slate-500 tabular-nums">
                {activeFeatureKeys.length} / {REGRESSION_FEATURE_CATALOG.length} selected
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-3 text-xs">
              <div className="flex items-center gap-1.5">
                <label
                  htmlFor="reg-kl-threshold-select"
                  className="text-slate-600 font-medium whitespace-nowrap"
                >
                  KL Alert Limit:
                </label>
                <select
                  id="reg-kl-threshold-select"
                  value={(config.klDriftThreshold ?? DEFAULT_KL_DRIFT_THRESHOLD).toFixed(2)}
                  onChange={(e) =>
                    onUpdateConfig({
                      ...config,
                      klDriftThreshold: Number(e.target.value),
                    })
                  }
                  className="px-2 py-1 text-xs font-mono bg-slate-50 border border-slate-200 rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                >
                  {[0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6].map(
                    (th) => (
                      <option key={th} value={th.toFixed(2)}>
                        {th.toFixed(2)} nats
                      </option>
                    )
                  )}
                </select>
              </div>
              <span className="text-slate-300" aria-hidden="true">|</span>
              <button
                type="button"
                onClick={selectCoreRfmFeatures}
                className="font-medium text-slate-600 hover:text-slate-900 transition-colors whitespace-nowrap"
              >
                Core RFM (3)
              </button>
              <span className="text-slate-300" aria-hidden="true">|</span>
              <button
                type="button"
                onClick={selectAllFeatures}
                disabled={activeFeatureKeys.length === REGRESSION_FEATURE_CATALOG.length}
                className="font-medium text-blue-700 hover:text-blue-800 disabled:text-slate-400 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
              >
                Select All ({REGRESSION_FEATURE_CATALOG.length})
              </button>
            </div>
          </div>

          <div
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7 gap-2"
            role="group"
            aria-label="Regression input features"
          >
            {REGRESSION_FEATURE_CATALOG.map((feat) => {
              const isSelected = activeFeatureKeys.includes(feat.key);
              const isLastRemaining = isSelected && activeFeatureKeys.length <= 1;
              return (
                <button
                  key={feat.key}
                  type="button"
                  aria-pressed={isSelected}
                  disabled={isLastRemaining}
                  onClick={() => toggleFeature(feat.key)}
                  title={
                    isLastRemaining
                      ? 'At least one predictor is required for regression training'
                      : isSelected
                      ? `Exclude ${feat.csvColumn} from regression training`
                      : `Include ${feat.csvColumn} in regression training`
                  }
                  className={`px-2.5 py-2 rounded-md border text-left transition-colors flex items-start justify-between gap-2 ${
                    isSelected
                      ? 'bg-blue-50/60 border-blue-200 text-slate-900 hover:bg-blue-50'
                      : 'bg-slate-50/70 border-slate-200 text-slate-500 hover:text-slate-800 hover:bg-slate-100/70'
                  } ${isLastRemaining ? 'cursor-not-allowed' : 'cursor-pointer'}`}
                >
                  <div className="min-w-0">
                    <div className="text-xs font-medium truncate">{feat.shortLabel}</div>
                    <div className="text-[10px] font-mono text-slate-500 truncate mt-0.5">
                      {feat.csvColumn}
                    </div>
                  </div>
                  <span
                    className={`w-4 h-4 rounded-xs border flex items-center justify-center shrink-0 mt-0.5 transition-colors ${
                      isSelected
                        ? 'bg-blue-700 border-blue-700 text-white'
                        : 'bg-white border-slate-300 text-transparent'
                    }`}
                    aria-hidden="true"
                  >
                    <Check className="w-3 h-3 stroke-[2.5]" />
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* KPI Strip */}
      <section className="bg-white border border-slate-200 rounded-lg grid grid-cols-2 lg:grid-cols-4 divide-y lg:divide-y-0 lg:divide-x divide-slate-200">
        <div className="p-5">
          <div className="text-xs text-slate-500">Materialized Cohort</div>
          <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 mt-1">
            {result.rows.length}
          </div>
          <div className="text-xs text-slate-500 mt-1 font-mono tabular-nums">
            of {result.totalEntitiesBeforeFilter} canonical entities
          </div>
        </div>
        <div className="p-5">
          <div className="text-xs text-slate-500">Mean Target LTV (Curated)</div>
          <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 mt-1">
            ${result.meanTargetWinsorized.toFixed(2)}
          </div>
          <div className="text-xs text-slate-500 mt-1 font-mono tabular-nums">
            Raw mean: ${result.meanTargetRaw.toFixed(2)}
          </div>
        </div>
        <div className="p-5">
          <div className="text-xs text-slate-500">Winsorization Cap / Zero Rate</div>
          <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 mt-1">
            ${result.winsorCapValue.toFixed(0)}
          </div>
          <div className="text-xs text-slate-500 mt-1 font-mono tabular-nums">
            {(result.zeroTargetRate * 100).toFixed(1)}% zero-spend horizon
          </div>
        </div>
        <div className="p-5">
          <div className="text-xs text-slate-500">Linear Baseline R² Proxy</div>
          <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 mt-1">
            {result.baselineR2Estimate.toFixed(3)}
          </div>
          <div className="text-xs text-emerald-700 mt-1 flex items-center gap-1">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>0 temporal leakage violations</span>
          </div>
        </div>
      </section>

      {/* Automated KL-Divergence Feature Drift Alert System */}
      <KlDriftAlertSystem
        datasetName={datasetName}
        config={config}
        driftReport={result.driftReport}
        onUpdateConfig={onUpdateConfig}
      />

      {/* Target Distribution Data Quality Score & Convergence Alerts */}
      <TargetQualityIndicator
        quality={result.targetQuality}
        config={config}
        maxDay={maxDay}
        onUpdateConfig={onUpdateConfig}
      />

      {/* Model Drift Monitor (Train vs Validation KL-Divergence & K-S Test) */}
      <ModelDriftIndicator
        driftReport={result.driftReport}
        onUpdateKlThreshold={(klDriftThreshold) =>
          onUpdateConfig({ ...config, klDriftThreshold })
        }
      />

      {/* Automated LTV Anomaly Detection & Trend Line Outliers */}
      <LtvAnomalyDetector
        anomalyReport={result.anomalyReport}
        horizonDays={config.horizonDays}
        obsCutoffDay={config.obsCutoffDay}
        maxObservedDay={result.maxObservedDay}
        rows={result.rows}
        onUpdateThreshold={(outlierStdThreshold) =>
          onUpdateConfig({ ...config, outlierStdThreshold })
        }
        onToggleExcludeOutliers={(excludeDetectedOutliers) =>
          onUpdateConfig({ ...config, excludeDetectedOutliers })
        }
      />

      {/* Diagnostics: Histogram & Correlations */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <section className="lg:col-span-6 bg-white border border-slate-200 rounded-lg p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                Horizon Target LTV Distribution
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Entity count across winsorized target spend buckets ($).
              </p>
            </div>
            <span className="text-xs font-mono text-slate-500 tabular-nums">
              n = {result.rows.length}
            </span>
          </div>

          <div className="h-48 flex items-end gap-2 pt-4">
            {result.targetHistogram.map((bin, idx) => {
              const heightPct = Math.round((bin.count / maxHistCount) * 100);
              return (
                <div
                  key={idx}
                  className="flex-1 flex flex-col items-center justify-end h-full min-w-0"
                >
                  <div className="text-[11px] font-mono tabular-nums text-slate-600 mb-1">
                    {bin.count}
                  </div>
                  <div
                    className="w-full bg-blue-700/85 rounded-t transition-all duration-200"
                    style={{ height: `${Math.max(4, heightPct)}%` }}
                    title={`${bin.label}: ${bin.count} entities`}
                  />
                  <div className="text-[10px] font-mono text-slate-500 mt-2 truncate w-full text-center">
                    ${Math.round(bin.min)}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="lg:col-span-6 bg-white border border-slate-200 rounded-lg p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                Feature-to-Target Pearson Correlation
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Linear correlation r between observation features and target LTV.
              </p>
            </div>
            <span className="text-xs font-mono text-slate-500">r in [-1, 1]</span>
          </div>

          <div className="space-y-2.5">
            {result.correlations.map((corr) => {
              const absPct = Math.min(100, Math.round(Math.abs(corr.pearsonR) * 100));
              const isNeg = corr.pearsonR < 0;
              return (
                <div key={corr.feature} className="grid grid-cols-12 items-center gap-3 text-xs">
                  <div className="col-span-5 text-slate-700 truncate" title={corr.label}>
                    {corr.label}
                  </div>
                  <div className="col-span-5 h-2.5 bg-slate-100 rounded overflow-hidden">
                    <div
                      className={`h-full rounded transition-all duration-200 ${
                        isNeg ? 'bg-amber-600' : 'bg-blue-700'
                      }`}
                      style={{ width: `${Math.max(2, absPct)}%` }}
                    />
                  </div>
                  <div className="col-span-2 text-right font-mono tabular-nums font-medium text-slate-900">
                    {corr.pearsonR >= 0 ? `+${corr.pearsonR.toFixed(3)}` : corr.pearsonR.toFixed(3)}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>

      {/* D3 Input Feature Correlation & Redundancy Heatmap */}
      <RegressionCorrelationHeatmap
        result={result}
        selectedFeatures={activeFeatureKeys}
        onToggleFeature={toggleFeature}
      />

      {/* Segment Variance & Volatility Analysis */}
      <SegmentVarianceVisualizer
        events={events}
        config={config}
        result={result}
      />

      {/* Linear Regression Feature Importance Bar Graph */}
      <FeatureImportanceChart
        linearFit={result.linearFit}
        selectedFeaturesCount={selectedFeatureDefs.length}
        normalizationMode={config.featureNormalization}
      />

      {/* Explainable AI Stakeholder Decision Brief (Gemini API) */}
      <ExplainableAiPanel
        datasetName={datasetName}
        datasetDomain={datasetDomain}
        config={config}
        result={result}
      />

      {/* Model Evaluation Matrix (MAE, RMSE, MAPE, R² & 4x4 LTV Tier Calibration) */}
      <ModelEvaluationMatrix
        evaluationMatrix={result.evaluationMatrix}
        linearFit={result.linearFit}
        config={config}
      />

      {/* Observation Cutoff Sensitivity (T_obs vs. Model R^2) */}
      <CutoffSensitivityChart
        events={events}
        globalConfig={globalConfig}
        config={config}
        maxDay={maxDay}
        onSelectCutoffDay={(day) => onUpdateConfig({ ...config, obsCutoffDay: day })}
      />

      {/* 90-Day Linear Extrapolation Trend Projection with Toggleable Confidence Intervals */}
      <TrendProjectionChart
        events={events}
        rows={result.rows}
        maxObservedDay={result.maxObservedDay}
        splitFilter={config.splitFilter}
      />

      {/* OLS LTV Projections vs Observed Historical Values */}
      <LtvProjectionVisualizer config={config} result={result} />

      {/* Tabular Feature Matrix Grid */}
      <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              Curated Feature Matrix (X_obs, y_ltv)
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Showing {displayRows.length} of {result.rows.length} rows · Scaling:{' '}
              <span className="font-mono font-medium text-slate-700">
                {config.featureNormalization === 'zscore'
                  ? 'Z-Score (Train-Fit)'
                  : config.featureNormalization === 'minmax'
                  ? 'Min-Max [0, 1] (Train-Fit)'
                  : 'None (Raw Units)'}
              </span>{' '}
              · Chunking:{' '}
              <span className="font-mono font-medium text-slate-700 tabular-nums">
                bs={result.batchSize} ({result.batchCount} batches)
              </span>
            </p>
          </div>
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search Entity ID..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-md w-52 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
            />
          </div>
        </div>

        <div className="overflow-x-auto max-h-[420px]">
          <table className="w-full text-left border-collapse">
            <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-600">
              <tr>
                <th className="py-2.5 px-4">
                  <button
                    type="button"
                    onClick={() => toggleSort('entityId')}
                    className="inline-flex items-center gap-1 hover:text-slate-900"
                  >
                    <span>Entity ID</span>
                    <ArrowUpDown className="w-3 h-3" />
                  </button>
                </th>
                <th className="py-2.5 px-4">Split</th>
                <th className="py-2.5 px-4 whitespace-nowrap">Batch</th>
                {selectedFeatureDefs.map((feat) => (
                  <th key={feat.key} className="py-2.5 px-4 text-right whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => toggleSort(feat.key)}
                      className="inline-flex items-center gap-1 hover:text-slate-900"
                      title={feat.label}
                    >
                      <span>{feat.shortLabel}</span>
                      <ArrowUpDown className="w-3 h-3" />
                    </button>
                  </th>
                ))}
                <th className="py-2.5 px-4 text-right whitespace-nowrap">
                  <button
                    type="button"
                    onClick={() => toggleSort('targetLtvRaw')}
                    className="inline-flex items-center gap-1 hover:text-slate-900"
                  >
                    <span>Raw LTV</span>
                    <ArrowUpDown className="w-3 h-3" />
                  </button>
                </th>
                <th className="py-2.5 px-4 text-right whitespace-nowrap">
                  <button
                    type="button"
                    onClick={() => toggleSort('targetLtvWinsorized')}
                    className="inline-flex items-center gap-1 hover:text-slate-900"
                  >
                    <span>Target LTV</span>
                    <ArrowUpDown className="w-3 h-3" />
                  </button>
                </th>
                <th className="py-2.5 px-4 whitespace-nowrap">Leakage Guard</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-xs">
              {displayRows.map((row) => (
                <tr key={row.entityId} className="hover:bg-slate-50/80 h-9">
                  <td className="py-2 px-4 font-mono font-medium text-slate-900">
                    {row.entityId}
                  </td>
                  <td className="py-2 px-4 font-mono text-slate-500">{row.split}</td>
                  <td className="py-2 px-4 font-mono tabular-nums text-slate-500">
                    B{row.batchId}
                  </td>
                  {selectedFeatureDefs.map((feat) => {
                    const val = getActiveFeatureValue(row, feat.key);
                    const isPrimaryMoney = feat.key === 'monetarySumObs';
                    return (
                      <td
                        key={feat.key}
                        className={`py-2 px-4 text-right font-mono tabular-nums ${
                          isPrimaryMoney ? 'text-slate-900' : 'text-slate-700'
                        }`}
                        title={getRawFeatureTitle(row, feat.key)}
                      >
                        {formatFeatureCell(feat.key, val)}
                      </td>
                    );
                  })}
                  <td className="py-2 px-4 text-right font-mono tabular-nums text-slate-500">
                    ${row.targetLtvRaw.toFixed(2)}
                  </td>
                  <td className="py-2 px-4 text-right font-mono tabular-nums font-semibold text-slate-900">
                    ${row.targetLtvWinsorized.toFixed(2)}
                  </td>
                  <td className="py-2 px-4">
                    {row.leakageVerified ? (
                      <span className="inline-flex items-center gap-1 text-emerald-700">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Verified</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-red-700">
                        <AlertTriangle className="w-3.5 h-3.5" />
                        <span>Leakage</span>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              {displayRows.length === 0 && (
                <tr>
                  <td
                    colSpan={6 + selectedFeatureDefs.length}
                    className="py-10 text-center text-slate-500"
                  >
                    No entities match the current filter criteria. Adjust T_obs or search query.
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
