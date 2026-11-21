import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  ArrowUpRight,
  BookOpen,
  CheckCircle2,
  Database,
  FileText,
  Filter,
  RotateCcw,
  Search,
  TableProperties,
  User,
  X,
} from 'lucide-react';
import {
  DatasetPreset,
  DatasetSearchFilters,
  DatasetSearchHit,
  DatasetSearchHitKind,
  GlobalCurationConfig,
  RawEvent,
  SplitName,
} from '../types/curation';
import {
  buildDatasetCatalog,
  CANONICAL_AND_MATERIALIZED_FIELDS,
  executeDatasetSearch,
} from '../engine/datasetSearchEngine';
import { ENGINEERED_FEATURE_CATALOG } from '../engine/featureEngineeringEngine';

interface DatasetSearchViewProps {
  presets: DatasetPreset[];
  activePresetId: string;
  customDatasetName: string | null;
  customEvents: RawEvent[] | null;
  globalConfig: GlobalCurationConfig;
  obsCutoffDay: number;
  onActivateDataset: (presetId: string) => void;
  onOpenAutoDocs: (datasetId: string) => void;
  onInspectInExplorer: (datasetId: string, query: string) => void;
}

const KIND_TABS: { id: 'all' | DatasetSearchHitKind; label: string }[] = [
  { id: 'all', label: 'All Results' },
  { id: 'dataset', label: 'Datasets' },
  { id: 'schema', label: 'Schema Fields' },
  { id: 'entity', label: 'Entities' },
  { id: 'event', label: 'Events' },
];

type MetadataParadigmFilter =
  | 'all'
  | 'Canonical'
  | 'Regression'
  | 'Sequence'
  | 'Offline RL'
  | 'RUL & Feature Eng';

interface ExtendedCatalogField {
  columnName: string;
  fieldKey: string;
  tableName: string;
  paradigm: Exclude<MetadataParadigmFilter, 'all'>;
  dataType: string;
  nullable: boolean;
  piiSensitive: boolean;
  description: string;
}

const RUL_AND_ENGINEERED_CATALOG_FIELDS: ExtendedCatalogField[] = [
  {
    columnName: 'unit_id',
    fieldKey: 'entityId',
    tableName: 'rul_timeseries',
    paradigm: 'RUL & Feature Eng',
    dataType: 'string',
    nullable: false,
    piiSensitive: true,
    description: 'Asset, turbofan unit, or device identifier mapped to canonical entity_id.',
  },
  {
    columnName: 'cycle',
    fieldKey: 'timestampDay',
    tableName: 'rul_timeseries',
    paradigm: 'RUL & Feature Eng',
    dataType: 'integer',
    nullable: false,
    piiSensitive: false,
    description: 'Operating cycle or discrete time-step index up to detected end-of-life (EOL).',
  },
  {
    columnName: 'rul_capped',
    fieldKey: 'rulCapped',
    tableName: 'rul_timeseries',
    paradigm: 'RUL & Feature Eng',
    dataType: 'integer',
    nullable: false,
    piiSensitive: false,
    description: 'Piecewise-linear Remaining Useful Life label min(EOL - cycle, rul_cap).',
  },
  {
    columnName: 'rolling_zscore',
    fieldKey: 'rollingZScore',
    tableName: 'rul_timeseries',
    paradigm: 'RUL & Feature Eng',
    dataType: 'float',
    nullable: false,
    piiSensitive: false,
    description: 'Local 4-step rolling Z-score used to flag transient telemetry spikes (|Z| >= 1.75).',
  },
  ...ENGINEERED_FEATURE_CATALOG.map((ef) => ({
    columnName: ef.columnName,
    fieldKey: ef.id,
    tableName: 'engineered_features',
    paradigm: 'RUL & Feature Eng' as const,
    dataType: 'float',
    nullable: false,
    piiSensitive: false,
    description: `${ef.label} (${ef.formula}): ${ef.targetUseCase}`,
  })),
];

const QUICK_QUERIES: { label: string; query: string }[] = [
  { label: 'High-spend (> $150)', query: 'spend>150' },
  { label: 'Negative reward', query: 'reward<0' },
  { label: 'SaaS domain', query: 'domain:saas' },
  { label: 'Validation split', query: 'split:val' },
  { label: 'LTV schema fields', query: 'ltv' },
  { label: 'Propensity & OOD', query: 'propensity' },
];

const KIND_META: Record<
  DatasetSearchHitKind,
  { label: string; Icon: React.ComponentType<{ className?: string }>; iconColor: string }
> = {
  dataset: { label: 'Dataset', Icon: Database, iconColor: 'text-blue-700' },
  schema: { label: 'Schema Field', Icon: TableProperties, iconColor: 'text-indigo-700' },
  entity: { label: 'Entity', Icon: User, iconColor: 'text-emerald-700' },
  event: { label: 'Event', Icon: Activity, iconColor: 'text-amber-700' },
};

function renderHighlightedText(text: string, terms: string[]): React.ReactNode {
  if (terms.length === 0) return text;
  const escaped = terms
    .filter((t) => t.length >= 2)
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (escaped.length === 0) return text;
  const regex = new RegExp(`(${escaped.join('|')})`, 'gi');
  const parts = text.split(regex);
  return parts.map((part, i) => {
    const isMatch = terms.some((t) => t.length >= 2 && part.toLowerCase() === t.toLowerCase());
    return isMatch ? (
      <mark key={i} className="bg-amber-100 text-slate-900 px-0.5 rounded-xs">
        {part}
      </mark>
    ) : (
      <React.Fragment key={i}>{part}</React.Fragment>
    );
  });
}

export const DatasetSearchView: React.FC<DatasetSearchViewProps> = ({
  presets,
  activePresetId,
  customDatasetName,
  customEvents,
  globalConfig,
  obsCutoffDay,
  onActivateDataset,
  onOpenAutoDocs,
  onInspectInExplorer,
}) => {
  const [viewMode, setViewMode] = useState<'search' | 'catalog'>('search');
  const [catalogParadigm, setCatalogParadigm] = useState<MetadataParadigmFilter>('all');
  const [catalogFieldFilter, setCatalogFieldFilter] = useState('');
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<DatasetSearchFilters>({
    kind: 'all',
    datasetId: 'all',
    channel: 'all',
    split: 'all',
    minSpend: null,
  });
  const [selectedHitId, setSelectedHitId] = useState<string | null>(null);

  const catalog = useMemo(
    () =>
      buildDatasetCatalog({
        presets,
        activePresetId,
        customDatasetName,
        customEvents,
      }),
    [presets, activePresetId, customDatasetName, customEvents]
  );

  const report = useMemo(
    () =>
      executeDatasetSearch({
        query,
        filters,
        catalog,
        globalConfig,
        obsCutoffDay,
        limit: 90,
      }),
    [query, filters, catalog, globalConfig, obsCutoffDay]
  );

  const selectedHit: DatasetSearchHit | null = useMemo(() => {
    if (report.hits.length === 0) return null;
    if (selectedHitId) {
      const found = report.hits.find((h) => h.id === selectedHitId);
      if (found) return found;
    }
    return report.hits[0];
  }, [report.hits, selectedHitId]);

  useEffect(() => {
    if (report.hits.length > 0 && (!selectedHitId || !report.hits.some((h) => h.id === selectedHitId))) {
      setSelectedHitId(report.hits[0].id);
    }
  }, [report.hits, selectedHitId]);

  const totalIndexedEvents = useMemo(
    () => catalog.reduce((acc, d) => acc + d.eventCount, 0),
    [catalog]
  );

  const totalIndexedEntities = useMemo(
    () => catalog.reduce((acc, d) => acc + d.entityCount, 0),
    [catalog]
  );

  const allMetadataFields = useMemo<ExtendedCatalogField[]>(
    () => [
      ...CANONICAL_AND_MATERIALIZED_FIELDS.map((f) => ({
        columnName: f.columnName,
        fieldKey: f.fieldKey,
        tableName: f.tableName,
        paradigm: f.paradigm,
        dataType: f.dataType,
        nullable: f.nullable,
        piiSensitive: f.piiSensitive,
        description: f.description,
      })),
      ...RUL_AND_ENGINEERED_CATALOG_FIELDS,
    ],
    []
  );

  const filteredMetadataFields = useMemo(() => {
    const q = catalogFieldFilter.trim().toLowerCase();
    return allMetadataFields.filter((f) => {
      if (catalogParadigm !== 'all' && f.paradigm !== catalogParadigm) return false;
      if (!q) return true;
      return (
        f.columnName.toLowerCase().includes(q) ||
        f.tableName.toLowerCase().includes(q) ||
        f.description.toLowerCase().includes(q) ||
        f.paradigm.toLowerCase().includes(q)
      );
    });
  }, [allMetadataFields, catalogParadigm, catalogFieldFilter]);

  const hasActiveFilters =
    query.trim().length > 0 ||
    filters.kind !== 'all' ||
    filters.datasetId !== 'all' ||
    filters.channel !== 'all' ||
    filters.split !== 'all' ||
    filters.minSpend !== null;

  const resetAll = () => {
    setQuery('');
    setFilters({
      kind: 'all',
      datasetId: 'all',
      channel: 'all',
      split: 'all',
      minSpend: null,
    });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900">
            Dataset Search &amp; Metadata Catalog
          </h1>
          <p className="text-sm text-slate-600 mt-1 max-w-2xl">
            Full-text operator search and field-level governance catalog across {catalog.length} indexed datasets,{' '}
            {totalIndexedEntities.toLocaleString()} entities, {totalIndexedEvents.toLocaleString()}{' '}
            events, and {allMetadataFields.length} documented schema columns.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 shrink-0">
          <div
            role="tablist"
            aria-label="Search or Metadata Catalog mode"
            className="inline-flex items-center p-1 bg-slate-100 border border-slate-200 rounded-lg"
          >
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === 'search'}
              onClick={() => setViewMode('search')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                viewMode === 'search'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Search Index
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === 'catalog'}
              onClick={() => setViewMode('catalog')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                viewMode === 'catalog'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Metadata Catalog
            </button>
          </div>

          <div className="flex items-center gap-2 text-xs text-slate-500 font-mono tabular-nums">
            <span>{catalog.length} datasets</span>
            <span aria-hidden="true">·</span>
            <span>
              {viewMode === 'catalog'
                ? `${allMetadataFields.length} schema fields`
                : `${report.totalHits} matching records`}
            </span>
          </div>
        </div>
      </div>

      {viewMode === 'catalog' ? (
        <div className="space-y-6">
          {/* Dataset Inventory Governance Table */}
          <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50/70 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">
                  Dataset Inventory &amp; Governance Registry
                </h2>
                <p className="text-xs text-slate-500">
                  Provenance, health scores, temporal span, and action spaces for all indexed datasets.
                </p>
              </div>
              <span className="text-xs font-mono tabular-nums text-slate-500">
                {catalog.length} registered sources
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
                  <tr>
                    <th className="text-left px-4 py-2.5 font-semibold">Dataset</th>
                    <th className="text-left px-3 py-2.5 font-semibold">Domain</th>
                    <th className="text-right px-3 py-2.5 font-semibold">Entities / Events</th>
                    <th className="text-right px-3 py-2.5 font-semibold">Span</th>
                    <th className="text-right px-3 py-2.5 font-semibold">Health</th>
                    <th className="text-left px-3 py-2.5 font-semibold">Channels &amp; Actions</th>
                    <th className="text-right px-4 py-2.5 font-semibold">Governance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {catalog.map((d) => (
                    <tr key={d.id} className={d.isActive ? 'bg-blue-50/40' : 'hover:bg-slate-50'}>
                      <td className="px-4 py-3 align-top">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-slate-900">{d.name}</span>
                          {d.isActive && (
                            <span className="font-mono text-[11px] font-semibold text-blue-700">
                              ACTIVE
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-slate-500 mt-0.5 max-w-xs line-clamp-2">
                          {d.description}
                        </div>
                      </td>
                      <td className="px-3 py-3 align-top text-slate-700 whitespace-nowrap">
                        {d.domain}
                      </td>
                      <td className="px-3 py-3 align-top text-right font-mono tabular-nums text-slate-900 whitespace-nowrap">
                        {d.entityCount.toLocaleString()} / {d.eventCount.toLocaleString()}
                      </td>
                      <td className="px-3 py-3 align-top text-right font-mono tabular-nums text-slate-700 whitespace-nowrap">
                        D{d.minDay}–{d.maxDay}
                      </td>
                      <td className="px-3 py-3 align-top text-right font-mono tabular-nums whitespace-nowrap">
                        <span
                          className={`font-semibold ${
                            d.healthScore >= 85
                              ? 'text-emerald-700'
                              : d.healthScore >= 70
                                ? 'text-amber-700'
                                : 'text-red-700'
                          }`}
                        >
                          {d.healthScore}/100
                        </span>
                        <span className="text-slate-400"> · {d.healthTier}</span>
                      </td>
                      <td className="px-3 py-3 align-top text-[11px] text-slate-600 max-w-xs">
                        <div className="truncate">{d.channels.join(' · ')}</div>
                        <div className="font-mono text-slate-400 mt-0.5">
                          {d.actionSpace.length} discrete actions
                        </div>
                      </td>
                      <td className="px-4 py-3 align-top text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-2">
                          {!d.isActive && !d.isCustom && (
                            <button
                              type="button"
                              onClick={() => onActivateDataset(d.presetId)}
                              className="px-2.5 py-1 text-[11px] font-medium text-white bg-blue-700 hover:bg-blue-800 rounded transition-colors"
                            >
                              Activate
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => onOpenAutoDocs(d.id)}
                            className="px-2.5 py-1 text-[11px] font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded transition-colors"
                          >
                            Auto-Docs
                          </button>
                          <button
                            type="button"
                            onClick={() => onInspectInExplorer(d.id, '')}
                            className="px-2.5 py-1 text-[11px] font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded transition-colors"
                          >
                            Explorer
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Field-Level Metadata & PII Catalog Table */}
          <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50/70 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">
                  Schema Lineage, Data Types &amp; PII Classification Catalog
                </h2>
                <p className="text-xs text-slate-500">
                  Unified column dictionary spanning Canonical Logs, Regression Matrix, Sequence Tensors, Offline RL MDP, RUL Windows, and Engineered Features.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  aria-label="Filter metadata catalog fields"
                  value={catalogFieldFilter}
                  onChange={(e) => setCatalogFieldFilter(e.target.value)}
                  placeholder="Filter column or table..."
                  className="h-8 px-2.5 text-xs bg-white border border-slate-200 rounded-md text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
                <div className="inline-flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-md">
                  {(
                    [
                      'all',
                      'Canonical',
                      'Regression',
                      'Sequence',
                      'Offline RL',
                      'RUL & Feature Eng',
                    ] as MetadataParadigmFilter[]
                  ).map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setCatalogParadigm(p)}
                      className={`px-2.5 py-1 text-[11px] font-medium rounded transition-colors whitespace-nowrap ${
                        catalogParadigm === p
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {p === 'all' ? 'All' : p}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="overflow-x-auto max-h-[540px] overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 text-slate-500 border-b border-slate-200 sticky top-0">
                  <tr>
                    <th className="text-left px-4 py-2.5 font-semibold">Column Name</th>
                    <th className="text-left px-3 py-2.5 font-semibold">Table</th>
                    <th className="text-left px-3 py-2.5 font-semibold">Paradigm</th>
                    <th className="text-left px-3 py-2.5 font-semibold">Type</th>
                    <th className="text-left px-3 py-2.5 font-semibold">Nullability</th>
                    <th className="text-left px-3 py-2.5 font-semibold">PII Sensitivity</th>
                    <th className="text-left px-4 py-2.5 font-semibold">Definition &amp; Semantics</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredMetadataFields.map((col) => (
                    <tr key={`${col.tableName}.${col.columnName}`} className="hover:bg-slate-50">
                      <td className="px-4 py-2.5 font-mono font-semibold text-slate-900 whitespace-nowrap">
                        {col.columnName}
                      </td>
                      <td className="px-3 py-2.5 font-mono text-slate-600 whitespace-nowrap">
                        {col.tableName}
                      </td>
                      <td className="px-3 py-2.5 text-slate-700 whitespace-nowrap">
                        {col.paradigm}
                      </td>
                      <td className="px-3 py-2.5 font-mono text-slate-700 whitespace-nowrap">
                        {col.dataType}
                      </td>
                      <td className="px-3 py-2.5 font-mono text-[11px] text-slate-600 whitespace-nowrap">
                        {col.nullable ? 'NULLABLE' : 'NOT NULL'}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <span
                          className={`font-mono text-[11px] font-semibold ${
                            col.piiSensitive ? 'text-amber-700' : 'text-emerald-700'
                          }`}
                        >
                          {col.piiSensitive ? 'PII Maskable' : 'ML Feature'}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-slate-600 max-w-md">
                        {col.description}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      ) : (
        <>

      {/* Search Query & Structured Facets Surface */}
      <section className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
        <div className="flex flex-col md:flex-row gap-3">
          <div className="relative flex-1">
            <Search
              className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
              aria-hidden="true"
            />
            <input
              type="text"
              aria-label="Search datasets, schema columns, entities, or events"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder='Search IDs, columns, or operators (e.g. spend>150, reward<0, domain:saas, channel:Web, split:val)...'
              className="w-full h-11 pl-10 pr-10 bg-slate-50 border border-slate-200 rounded-md text-sm text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600 transition-colors"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label="Clear search query"
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700 rounded"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {hasActiveFilters && (
            <button
              type="button"
              onClick={resetAll}
              className="h-11 px-4 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 transition-colors inline-flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0"
            >
              <RotateCcw className="w-3.5 h-3.5 text-slate-500" />
              <span>Reset Filters</span>
            </button>
          )}
        </div>

        {/* Quick Query Suggestions + Parsed Operator Preview */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-slate-500 font-medium">Sample queries:</span>
            {QUICK_QUERIES.map((sq) => (
              <button
                key={sq.query}
                type="button"
                onClick={() => setQuery(sq.query)}
                className={`px-2.5 py-1 rounded-md border text-xs transition-colors whitespace-nowrap ${
                  query.trim() === sq.query
                    ? 'bg-blue-50 border-blue-200 text-blue-700 font-medium'
                    : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                }`}
              >
                {sq.label}
              </button>
            ))}
          </div>

          {report.parsed.rawChips.length > 0 && (
            <div className="text-xs font-mono text-blue-700">
              Parsed operators: {report.parsed.rawChips.join(' · ')}
            </div>
          )}
        </div>

        {/* Faceted Filters Row */}
        <div className="pt-3 border-t border-slate-100 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          {/* Segmented Kind Tabs */}
          <div
            role="tablist"
            aria-label="Filter search results by record type"
            className="inline-flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg"
          >
            {KIND_TABS.map((tab) => {
              const count =
                tab.id === 'all'
                  ? Object.values(report.countsByKind).reduce((a, b) => a + b, 0)
                  : report.countsByKind[tab.id];
              const isSelected = filters.kind === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={isSelected}
                  onClick={() => setFilters((prev) => ({ ...prev, kind: tab.id }))}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors inline-flex items-center gap-1.5 whitespace-nowrap ${
                    isSelected
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <span>{tab.label}</span>
                  <span className="font-mono tabular-nums text-[11px] text-slate-500">
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Dropdown Facets */}
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="inline-flex items-center gap-1.5 text-xs text-slate-500">
              <Filter className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Scope:</span>
            </div>

            <select
              aria-label="Filter by dataset"
              value={filters.datasetId}
              onChange={(e) =>
                setFilters((prev) => ({ ...prev, datasetId: e.target.value }))
              }
              className="h-9 px-2.5 text-xs bg-slate-50 border border-slate-200 rounded-md text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-600"
            >
              <option value="all">All Datasets ({catalog.length})</option>
              {catalog.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} {d.isActive ? '(Active)' : ''}
                </option>
              ))}
            </select>

            <select
              aria-label="Filter by channel"
              value={filters.channel}
              onChange={(e) =>
                setFilters((prev) => ({ ...prev, channel: e.target.value }))
              }
              className="h-9 px-2.5 text-xs bg-slate-50 border border-slate-200 rounded-md text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-600"
            >
              <option value="all">All Channels</option>
              {report.availableChannels.map((ch) => (
                <option key={ch} value={ch}>
                  {ch}
                </option>
              ))}
            </select>

            <select
              aria-label="Filter by cohort split"
              value={filters.split}
              onChange={(e) =>
                setFilters((prev) => ({
                  ...prev,
                  split: e.target.value as 'all' | SplitName,
                }))
              }
              className="h-9 px-2.5 text-xs bg-slate-50 border border-slate-200 rounded-md text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-600"
            >
              <option value="all">All Splits</option>
              <option value="train">Train Split</option>
              <option value="val">Val Split</option>
              <option value="test">Test Split</option>
            </select>

            <div className="flex items-center gap-1.5">
              <label htmlFor="min-spend-facet" className="text-xs text-slate-500 whitespace-nowrap">
                Min Spend $
              </label>
              <input
                id="min-spend-facet"
                type="number"
                min={0}
                step={10}
                value={filters.minSpend ?? ''}
                onChange={(e) => {
                  const val = e.target.value.trim();
                  setFilters((prev) => ({
                    ...prev,
                    minSpend: val === '' ? null : Math.max(0, Number(val)),
                  }));
                }}
                placeholder="Any"
                className="w-20 h-9 px-2 text-xs font-mono tabular-nums bg-slate-50 border border-slate-200 rounded-md text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>
          </div>
        </div>
      </section>

      {/* Main Split Grid: Search Results + Sticky Inspector */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Ranked Search Results */}
        <section
          aria-label="Search results list"
          className="lg:col-span-7 bg-white border border-slate-200 rounded-lg overflow-hidden"
        >
          <div className="px-4 py-3 border-b border-slate-200 bg-slate-50/70 flex items-center justify-between text-xs">
            <span className="font-semibold text-slate-800">
              Indexed Matches
            </span>
            <span className="font-mono tabular-nums text-slate-500">
              Showing {report.hits.length} of {report.totalHits}
            </span>
          </div>

          {report.hits.length === 0 ? (
            <div className="px-6 py-14 text-center space-y-3">
              <p className="text-sm font-medium text-slate-800">
                No indexed records matched your search criteria.
              </p>
              <p className="text-xs text-slate-500 max-w-md mx-auto">
                Try broadening numeric bounds like <code className="font-mono">spend&gt;100</code>,
                removing a channel or split filter, or searching a column name such as{' '}
                <code className="font-mono">monetary_sum_obs</code>.
              </p>
              <button
                type="button"
                onClick={resetAll}
                className="px-4 py-2 text-xs font-medium text-white bg-blue-700 rounded-md hover:bg-blue-800 transition-colors"
              >
                Clear Search &amp; Filters
              </button>
            </div>
          ) : (
            <div className="divide-y divide-slate-100 max-h-[680px] overflow-y-auto">
              {report.hits.map((hit) => {
                const meta = KIND_META[hit.kind];
                const Icon = meta.Icon;
                const isSelected = selectedHit?.id === hit.id;
                return (
                  <button
                    key={hit.id}
                    type="button"
                    onClick={() => setSelectedHitId(hit.id)}
                    className={`w-full text-left px-4 py-3.5 transition-colors flex items-start justify-between gap-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-600 ${
                      isSelected ? 'bg-blue-50/70' : 'bg-white hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-start gap-3 min-w-0">
                      <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${meta.iconColor}`} />
                      <div className="min-w-0 space-y-1">
                        <div className="flex items-center gap-2 text-xs">
                          <span className="font-semibold text-slate-900 truncate">
                            {renderHighlightedText(hit.title, report.parsed.freeTerms)}
                          </span>
                          <span className="text-slate-400" aria-hidden="true">·</span>
                          <span className="font-mono text-[11px] text-slate-500 shrink-0">
                            {meta.label}
                          </span>
                          {hit.isActiveDataset && (
                            <>
                              <span className="text-slate-400" aria-hidden="true">·</span>
                              <span className="font-mono text-[11px] text-blue-700 font-medium shrink-0">
                                Active
                              </span>
                            </>
                          )}
                        </div>

                        <p className="text-xs text-slate-600 truncate">
                          {renderHighlightedText(hit.subtitle, report.parsed.freeTerms)}
                        </p>

                        <div className="text-[11px] text-slate-400 font-mono truncate">
                          {hit.matchReasons.join(' · ')}
                        </div>
                      </div>
                    </div>

                    <div className="text-right shrink-0 space-y-0.5">
                      {hit.primaryMetricValue && (
                        <div className="text-xs font-mono tabular-nums font-semibold text-slate-900">
                          {hit.primaryMetricValue}
                        </div>
                      )}
                      {hit.primaryMetricLabel && (
                        <div className="text-[11px] text-slate-500">
                          {hit.primaryMetricLabel}
                        </div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        {/* Sticky Detail Inspector */}
        <aside
          aria-label="Selected record inspector"
          className="lg:col-span-5 bg-white border border-slate-200 rounded-lg p-5 lg:sticky lg:top-6 space-y-5"
        >
          {!selectedHit ? (
            <div className="py-10 text-center text-xs text-slate-500">
              Select any result on the left to inspect its metadata, statistics, and actions.
            </div>
          ) : (
            <>
              <div className="flex items-start justify-between gap-3 pb-4 border-b border-slate-200">
                <div className="min-w-0">
                  <div className="text-xs text-slate-500 font-mono">
                    {KIND_META[selectedHit.kind].label} · {selectedHit.datasetDomain}
                  </div>
                  <h2 className="font-display text-lg font-bold text-slate-900 mt-0.5 break-words">
                    {selectedHit.title}
                  </h2>
                  <p className="text-xs text-slate-600 mt-1">
                    Dataset: {selectedHit.datasetName}
                  </p>
                </div>
                {selectedHit.isActiveDataset && (
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 shrink-0">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Active</span>
                  </span>
                )}
              </div>

              {/* Dataset Catalog Inspector */}
              {selectedHit.kind === 'dataset' && selectedHit.catalogEntry && (
                <div className="space-y-4">
                  <p className="text-xs text-slate-600 leading-relaxed">
                    {selectedHit.catalogEntry.description}
                  </p>

                  <div className="grid grid-cols-2 gap-3 text-xs border-t border-b border-slate-100 py-3">
                    <div>
                      <div className="text-slate-500">Entities / Events</div>
                      <div className="font-mono tabular-nums font-semibold text-slate-900 mt-0.5">
                        {selectedHit.catalogEntry.entityCount.toLocaleString()} /{' '}
                        {selectedHit.catalogEntry.eventCount.toLocaleString()}
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-500">Temporal Span</div>
                      <div className="font-mono tabular-nums font-semibold text-slate-900 mt-0.5">
                        Day {selectedHit.catalogEntry.minDay} – {selectedHit.catalogEntry.maxDay}
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-500">Mean Spend / Reward</div>
                      <div className="font-mono tabular-nums font-semibold text-slate-900 mt-0.5">
                        ${selectedHit.catalogEntry.meanSpend.toFixed(2)} /{' '}
                        {selectedHit.catalogEntry.meanReward.toFixed(2)}
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-500">Data Health Score</div>
                      <div className="font-mono tabular-nums font-semibold text-slate-900 mt-0.5">
                        {selectedHit.catalogEntry.healthScore}/100 ({selectedHit.catalogEntry.healthTier})
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2 text-xs">
                    <div>
                      <span className="font-semibold text-slate-700">Channels: </span>
                      <span className="text-slate-600">
                        {selectedHit.catalogEntry.channels.join(' · ')}
                      </span>
                    </div>
                    <div>
                      <span className="font-semibold text-slate-700">Action Space: </span>
                      <span className="text-slate-600">
                        {selectedHit.catalogEntry.actionSpace
                          .map((a) => `${a.id}: ${a.label}`)
                          .join(' · ')}
                      </span>
                    </div>
                  </div>

                  <div className="pt-2 flex flex-wrap gap-2">
                    {!selectedHit.catalogEntry.isActive && !selectedHit.catalogEntry.isCustom && (
                      <button
                        type="button"
                        onClick={() => onActivateDataset(selectedHit.catalogEntry!.presetId)}
                        className="px-3.5 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-md transition-colors inline-flex items-center gap-1.5"
                      >
                        <Database className="w-3.5 h-3.5" />
                        <span>Activate in Workspace</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => onOpenAutoDocs(selectedHit.datasetId)}
                      className="px-3.5 py-2 text-xs font-medium text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors inline-flex items-center gap-1.5"
                    >
                      <BookOpen className="w-3.5 h-3.5 text-blue-700" />
                      <span>Generate Auto-Docs</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onInspectInExplorer(selectedHit.datasetId, '')}
                      className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-md transition-colors inline-flex items-center gap-1.5"
                    >
                      <ArrowUpRight className="w-3.5 h-3.5" />
                      <span>Open Data Explorer</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Schema Field Inspector */}
              {selectedHit.kind === 'schema' && selectedHit.fieldSchema && (
                <div className="space-y-4">
                  <p className="text-xs text-slate-600 leading-relaxed">
                    {selectedHit.fieldSchema.description}
                  </p>

                  <div className="grid grid-cols-2 gap-3 text-xs border-t border-b border-slate-100 py-3">
                    <div>
                      <div className="text-slate-500">Materialized Table</div>
                      <div className="font-mono font-semibold text-slate-900 mt-0.5">
                        {selectedHit.fieldSchema.tableName}
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-500">Paradigm / Type</div>
                      <div className="font-mono font-semibold text-slate-900 mt-0.5">
                        {selectedHit.fieldSchema.paradigm} · {selectedHit.fieldSchema.dataType}
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-500">Min / Mean / Max</div>
                      <div className="font-mono tabular-nums font-semibold text-slate-900 mt-0.5">
                        {selectedHit.fieldSchema.minVal ?? '—'} /{' '}
                        {selectedHit.fieldSchema.meanVal ?? '—'} /{' '}
                        {selectedHit.fieldSchema.maxVal ?? '—'}
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-500">PII Classification</div>
                      <div className="font-semibold text-slate-900 mt-0.5">
                        {selectedHit.fieldSchema.piiSensitive ? 'Identifier (Maskable)' : 'Non-PII Feature'}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => onOpenAutoDocs(selectedHit.datasetId)}
                      className="px-3.5 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-md transition-colors inline-flex items-center gap-1.5"
                    >
                      <FileText className="w-3.5 h-3.5" />
                      <span>View Full Data Dictionary</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Entity Inspector */}
              {selectedHit.kind === 'entity' && selectedHit.entitySummary && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3 text-xs border-b border-slate-100 pb-3">
                    <div>
                      <div className="text-slate-500">Cohort Split</div>
                      <div className="font-mono uppercase font-semibold text-slate-900 mt-0.5">
                        {selectedHit.entitySummary.split}
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-500">Observed Events</div>
                      <div className="font-mono tabular-nums font-semibold text-slate-900 mt-0.5">
                        {selectedHit.entitySummary.eventCount} (Days{' '}
                        {selectedHit.entitySummary.firstDay}–{selectedHit.entitySummary.lastDay})
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-500">Cumulative Spend</div>
                      <div className="font-mono tabular-nums font-semibold text-slate-900 mt-0.5">
                        ${selectedHit.entitySummary.totalSpend.toFixed(2)}
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-500">Mean Reward / Eng.</div>
                      <div className="font-mono tabular-nums font-semibold text-slate-900 mt-0.5">
                        {selectedHit.entitySummary.meanReward.toFixed(2)} /{' '}
                        {selectedHit.entitySummary.meanEngagement.toFixed(3)}
                      </div>
                    </div>
                  </div>

                  <div>
                    <div className="text-xs font-semibold text-slate-700 mb-2">
                      Recent Event Trajectory
                    </div>
                    <div className="border border-slate-200 rounded-md overflow-hidden">
                      <table className="w-full text-[11px]">
                        <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
                          <tr>
                            <th className="text-left px-2.5 py-1.5 font-medium">Day</th>
                            <th className="text-left px-2.5 py-1.5 font-medium">Action</th>
                            <th className="text-right px-2.5 py-1.5 font-medium">Spend</th>
                            <th className="text-right px-2.5 py-1.5 font-medium">Reward</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 font-mono tabular-nums">
                          {selectedHit.entitySummary.recentEvents.map((ev) => (
                            <tr key={ev.eventId}>
                              <td className="px-2.5 py-1.5 text-slate-700">{ev.timestampDay}</td>
                              <td className="px-2.5 py-1.5 font-sans text-slate-800 truncate max-w-[120px]">
                                {ev.actionLabel}
                              </td>
                              <td className="px-2.5 py-1.5 text-right text-slate-900">
                                ${ev.spendAmount.toFixed(2)}
                              </td>
                              <td className="px-2.5 py-1.5 text-right text-slate-700">
                                {ev.reward.toFixed(2)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        onInspectInExplorer(
                          selectedHit.datasetId,
                          selectedHit.entitySummary!.entityId
                        )
                      }
                      className="px-3.5 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-md transition-colors inline-flex items-center gap-1.5"
                    >
                      <ArrowUpRight className="w-3.5 h-3.5" />
                      <span>Inspect Entity in Data Explorer</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Event Inspector */}
              {selectedHit.kind === 'event' && selectedHit.eventRecord && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3 text-xs border-b border-slate-100 pb-3">
                    <div>
                      <div className="text-slate-500">Event / Entity</div>
                      <div className="font-mono font-semibold text-slate-900 mt-0.5">
                        {selectedHit.eventRecord.eventId} · {selectedHit.eventRecord.entityId}
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-500">Split / Window</div>
                      <div className="font-mono uppercase font-semibold text-slate-900 mt-0.5">
                        {selectedHit.eventRecord.split} · {selectedHit.eventRecord.windowPhase}
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-500">Day / Recency / Freq</div>
                      <div className="font-mono tabular-nums font-semibold text-slate-900 mt-0.5">
                        D{selectedHit.eventRecord.timestampDay} · {selectedHit.eventRecord.recencyDays}d · #
                        {selectedHit.eventRecord.frequencyCount}
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-500">Channel / Action</div>
                      <div className="font-semibold text-slate-900 mt-0.5">
                        {selectedHit.eventRecord.channel} · {selectedHit.eventRecord.actionLabel}
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-500">Spend / Reward</div>
                      <div className="font-mono tabular-nums font-semibold text-slate-900 mt-0.5">
                        ${selectedHit.eventRecord.spendAmount.toFixed(2)} /{' '}
                        {selectedHit.eventRecord.reward.toFixed(2)}
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-500">Engagement / Propensity</div>
                      <div className="font-mono tabular-nums font-semibold text-slate-900 mt-0.5">
                        {selectedHit.eventRecord.engagementScore.toFixed(3)} /{' '}
                        {selectedHit.eventRecord.propensity.toFixed(3)}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        onInspectInExplorer(
                          selectedHit.datasetId,
                          selectedHit.eventRecord!.eventId
                        )
                      }
                      className="px-3.5 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-md transition-colors inline-flex items-center gap-1.5"
                    >
                      <ArrowUpRight className="w-3.5 h-3.5" />
                      <span>Inspect Event in Data Explorer</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onOpenAutoDocs(selectedHit.datasetId)}
                      className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-md transition-colors inline-flex items-center gap-1.5"
                    >
                      <BookOpen className="w-3.5 h-3.5 text-blue-700" />
                      <span>Dataset Auto-Docs</span>
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </aside>
      </div>
        </>
      )}
    </div>
  );
};
