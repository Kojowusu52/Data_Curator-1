import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Download,
  MessageSquareText,
  RotateCcw,
  Search,
} from 'lucide-react';
import { assignEntitySplit } from '../engine/curationEngine';
import { GlobalCurationConfig, RawEvent, SplitName } from '../types/curation';

interface DataExplorerViewProps {
  datasetName: string;
  events: RawEvent[];
  globalConfig: GlobalCurationConfig;
  obsCutoffDay: number;
  externalSearchRequest?: { query: string; nonce: number } | null;
  onExportEventsCsv: (rows: EnrichedEventRow[]) => void;
  onAskNaturalLanguage?: (seedPrompt: string) => void;
}

export interface EnrichedEventRow extends RawEvent {
  split: SplitName;
  windowPhase: 'obs' | 'horizon';
}

type SortField =
  | 'eventId'
  | 'entityId'
  | 'split'
  | 'timestampDay'
  | 'windowPhase'
  | 'actionId'
  | 'channel'
  | 'recencyDays'
  | 'frequencyCount'
  | 'spendAmount'
  | 'engagementScore'
  | 'reward'
  | 'propensity';

export const DataExplorerView: React.FC<DataExplorerViewProps> = ({
  datasetName,
  events,
  globalConfig,
  obsCutoffDay,
  externalSearchRequest,
  onExportEventsCsv,
  onAskNaturalLanguage,
}) => {
  const [searchQuery, setSearchQuery] = useState(externalSearchRequest?.query ?? '');
  const [splitFilter, setSplitFilter] = useState<'all' | SplitName>('all');
  const [windowFilter, setWindowFilter] = useState<'all' | 'obs' | 'horizon'>('all');
  const [actionFilter, setActionFilter] = useState<number | 'all'>('all');
  const [channelFilter, setChannelFilter] = useState<string>('all');

  const [sortField, setSortField] = useState<SortField>('timestampDay');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const [pageSize, setPageSize] = useState<number>(25);
  const [currentPage, setCurrentPage] = useState<number>(1);

  useEffect(() => {
    if (!externalSearchRequest) return;
    setSearchQuery(externalSearchRequest.query);
    setSplitFilter('all');
    setWindowFilter('all');
    setActionFilter('all');
    setChannelFilter('all');
    setCurrentPage(1);
  }, [externalSearchRequest]);

  const enrichedEvents = useMemo<EnrichedEventRow[]>(() => {
    return events.map((ev) => ({
      ...ev,
      split: assignEntitySplit(ev.entityId, globalConfig),
      windowPhase: ev.timestampDay <= obsCutoffDay ? 'obs' : 'horizon',
    }));
  }, [events, globalConfig, obsCutoffDay]);

  const uniqueActions = useMemo(() => {
    const map = new Map<number, string>();
    for (const e of events) map.set(e.actionId, e.actionLabel);
    return Array.from(map.entries()).sort((a, b) => a[0] - b[0]);
  }, [events]);

  const uniqueChannels = useMemo(() => {
    return Array.from(new Set(events.map((e) => e.channel))).sort((a, b) =>
      a.localeCompare(b)
    );
  }, [events]);

  const splitCounts = useMemo(() => {
    const counts: Record<SplitName, number> = { train: 0, val: 0, test: 0 };
    for (const ev of enrichedEvents) counts[ev.split] += 1;
    return counts;
  }, [enrichedEvents]);

  const filteredEvents = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return enrichedEvents.filter((ev) => {
      if (splitFilter !== 'all' && ev.split !== splitFilter) return false;
      if (windowFilter !== 'all' && ev.windowPhase !== windowFilter) return false;
      if (actionFilter !== 'all' && ev.actionId !== actionFilter) return false;
      if (channelFilter !== 'all' && ev.channel !== channelFilter) return false;
      if (!q) return true;
      return (
        ev.eventId.toLowerCase().includes(q) ||
        ev.entityId.toLowerCase().includes(q) ||
        ev.actionLabel.toLowerCase().includes(q) ||
        ev.channel.toLowerCase().includes(q)
      );
    });
  }, [
    enrichedEvents,
    searchQuery,
    splitFilter,
    windowFilter,
    actionFilter,
    channelFilter,
  ]);

  const sortedEvents = useMemo(() => {
    return [...filteredEvents].sort((a, b) => {
      const va = a[sortField];
      const vb = b[sortField];
      if (typeof va === 'number' && typeof vb === 'number') {
        return sortDir === 'asc' ? va - vb : vb - va;
      }
      const sa = String(va);
      const sb = String(vb);
      return sortDir === 'asc' ? sa.localeCompare(sb) : sb.localeCompare(sa);
    });
  }, [filteredEvents, sortField, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sortedEvents.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const startIdx = (safePage - 1) * pageSize;
  const pageRows = sortedEvents.slice(startIdx, startIdx + pageSize);

  const summaryStats = useMemo(() => {
    const entitySet = new Set<string>();
    let totalSpend = 0;
    let totalReward = 0;
    for (const ev of filteredEvents) {
      entitySet.add(ev.entityId);
      totalSpend += ev.spendAmount;
      totalReward += ev.reward;
    }
    const count = filteredEvents.length || 1;
    return {
      distinctEntities: entitySet.size,
      totalSpend,
      meanSpend: totalSpend / count,
      meanReward: totalReward / count,
    };
  }, [filteredEvents]);

  const hasActiveFilters =
    searchQuery.trim() !== '' ||
    splitFilter !== 'all' ||
    windowFilter !== 'all' ||
    actionFilter !== 'all' ||
    channelFilter !== 'all';

  const resetFilters = () => {
    setSearchQuery('');
    setSplitFilter('all');
    setWindowFilter('all');
    setActionFilter('all');
    setChannelFilter('all');
    setCurrentPage(1);
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir(field === 'spendAmount' || field === 'reward' ? 'desc' : 'asc');
    }
    setCurrentPage(1);
  };

  const renderSortIcon = (field: SortField) => {
    if (sortField !== field) {
      return <ArrowUpDown className="w-3 h-3 text-slate-400" />;
    }
    return sortDir === 'asc' ? (
      <ArrowUp className="w-3 h-3 text-blue-700" />
    ) : (
      <ArrowDown className="w-3 h-3 text-blue-700" />
    );
  };

  const visiblePageNumbers = useMemo(() => {
    const pages: number[] = [];
    const maxButtons = 5;
    let start = Math.max(1, safePage - Math.floor(maxButtons / 2));
    const end = Math.min(totalPages, start + maxButtons - 1);
    start = Math.max(1, end - maxButtons + 1);
    for (let p = start; p <= end; p++) pages.push(p);
    return pages;
  }, [safePage, totalPages]);

  return (
    <div className="space-y-6">
      {/* Filter & Summary Control Surface */}
      <section className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 pb-4 border-b border-slate-200">
          <div>
            <h1 className="text-lg font-bold text-slate-900">
              Processed Canonical Event Explorer
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Inspect deterministic entity-hash splits, observation boundaries (T_obs = Day {obsCutoffDay}), and per-event scalars in {datasetName} before pipeline export.
            </p>
          </div>

          <div className="flex items-center gap-3 self-start lg:self-auto">
            {hasActiveFilters && (
              <button
                type="button"
                onClick={resetFilters}
                className="px-3 py-1.5 text-xs font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors inline-flex items-center gap-1.5 whitespace-nowrap"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reset Filters</span>
              </button>
            )}
            {onAskNaturalLanguage && (
              <button
                type="button"
                onClick={() => onAskNaturalLanguage(searchQuery.trim())}
                className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-md transition-colors inline-flex items-center gap-1.5 whitespace-nowrap"
              >
                <MessageSquareText className="w-3.5 h-3.5 text-blue-700" />
                <span>Ask NL Query</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => onExportEventsCsv(sortedEvents)}
              disabled={sortedEvents.length === 0}
              className="px-3.5 py-1.5 text-xs font-medium text-blue-700 bg-white border border-slate-200 hover:bg-blue-50 rounded-md transition-colors inline-flex items-center gap-1.5 whitespace-nowrap disabled:opacity-50"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export Filtered CSV ({sortedEvents.length.toLocaleString()})</span>
            </button>
          </div>
        </div>

        {/* Filter Controls */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-12 gap-3 items-end">
          <div className="xl:col-span-3">
            <label htmlFor="explorer-search" className="block text-[11px] font-medium text-slate-600 mb-1">
              Search Event, Entity, or Channel
            </label>
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                id="explorer-search"
                type="text"
                placeholder="e.g. ENT-0014, Email..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setCurrentPage(1);
                }}
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
              />
            </div>
          </div>

          <div className="xl:col-span-4">
            <div className="text-[11px] font-medium text-slate-600 mb-1">
              Cohort Split Filter
            </div>
            <div className="grid grid-cols-4 gap-1 p-1 bg-slate-100 rounded-md">
              {(['all', 'train', 'val', 'test'] as const).map((sp) => (
                <button
                  key={sp}
                  type="button"
                  onClick={() => {
                    setSplitFilter(sp);
                    setCurrentPage(1);
                  }}
                  className={`py-1 px-2 text-[11px] font-medium rounded transition-colors whitespace-nowrap truncate ${
                    splitFilter === sp
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {sp === 'all'
                    ? `All (${events.length})`
                    : `${sp.charAt(0).toUpperCase() + sp.slice(1)} (${splitCounts[sp]})`}
                </button>
              ))}
            </div>
          </div>

          <div className="xl:col-span-2">
            <label htmlFor="explorer-window" className="block text-[11px] font-medium text-slate-600 mb-1">
              Temporal Window
            </label>
            <select
              id="explorer-window"
              value={windowFilter}
              onChange={(e) => {
                setWindowFilter(e.target.value as 'all' | 'obs' | 'horizon');
                setCurrentPage(1);
              }}
              className="w-full px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
            >
              <option value="all">All Windows</option>
              <option value="obs">Obs (t ≤ {obsCutoffDay})</option>
              <option value="horizon">Horizon (t &gt; {obsCutoffDay})</option>
            </select>
          </div>

          <div className="xl:col-span-3 grid grid-cols-2 gap-2">
            <div>
              <label htmlFor="explorer-action" className="block text-[11px] font-medium text-slate-600 mb-1">
                Action
              </label>
              <select
                id="explorer-action"
                value={actionFilter}
                onChange={(e) => {
                  setActionFilter(
                    e.target.value === 'all' ? 'all' : Number(e.target.value)
                  );
                  setCurrentPage(1);
                }}
                className="w-full px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
              >
                <option value="all">All Actions</option>
                {uniqueActions.map(([id, label]) => (
                  <option key={id} value={id}>
                    {id}: {label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="explorer-channel" className="block text-[11px] font-medium text-slate-600 mb-1">
                Channel
              </label>
              <select
                id="explorer-channel"
                value={channelFilter}
                onChange={(e) => {
                  setChannelFilter(e.target.value);
                  setCurrentPage(1);
                }}
                className="w-full px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
              >
                <option value="all">All Channels</option>
                {uniqueChannels.map((ch) => (
                  <option key={ch} value={ch}>
                    {ch}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </section>

      {/* Filtered Slice KPI Strip */}
      <section className="bg-white border border-slate-200 rounded-lg grid grid-cols-2 lg:grid-cols-4 divide-y lg:divide-y-0 lg:divide-x divide-slate-200">
        <div className="p-4">
          <div className="text-xs text-slate-500">Filtered Events</div>
          <div className="text-xl font-bold font-mono tabular-nums text-slate-900 mt-0.5">
            {filteredEvents.length.toLocaleString()}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5 font-mono tabular-nums">
            of {events.length.toLocaleString()} total events
          </div>
        </div>
        <div className="p-4">
          <div className="text-xs text-slate-500">Distinct Entities</div>
          <div className="text-xl font-bold font-mono tabular-nums text-slate-900 mt-0.5">
            {summaryStats.distinctEntities.toLocaleString()}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5 font-mono tabular-nums">
            {(
              filteredEvents.length / Math.max(1, summaryStats.distinctEntities)
            ).toFixed(2)}{' '}
            events / entity
          </div>
        </div>
        <div className="p-4">
          <div className="text-xs text-slate-500">Cumulative Slice Spend</div>
          <div className="text-xl font-bold font-mono tabular-nums text-slate-900 mt-0.5">
            ${summaryStats.totalSpend.toLocaleString(undefined, { maximumFractionDigits: 2 })}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5 font-mono tabular-nums">
            Mean ${summaryStats.meanSpend.toFixed(2)} / event
          </div>
        </div>
        <div className="p-4">
          <div className="text-xs text-slate-500">Mean Event Reward</div>
          <div className="text-xl font-bold font-mono tabular-nums text-slate-900 mt-0.5">
            {summaryStats.meanReward.toFixed(2)}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            Margin-adjusted scalar
          </div>
        </div>
      </section>

      {/* Paginated & Sortable Event Data Table */}
      <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-600">
              <tr>
                <th className="py-2.5 px-3 whitespace-nowrap">
                  <button
                    type="button"
                    onClick={() => handleSort('eventId')}
                    className="inline-flex items-center gap-1 hover:text-slate-900"
                  >
                    <span>Event ID</span>
                    {renderSortIcon('eventId')}
                  </button>
                </th>
                <th className="py-2.5 px-3 whitespace-nowrap">
                  <button
                    type="button"
                    onClick={() => handleSort('entityId')}
                    className="inline-flex items-center gap-1 hover:text-slate-900"
                  >
                    <span>Entity ID</span>
                    {renderSortIcon('entityId')}
                  </button>
                </th>
                <th className="py-2.5 px-3 whitespace-nowrap">
                  <button
                    type="button"
                    onClick={() => handleSort('split')}
                    className="inline-flex items-center gap-1 hover:text-slate-900"
                  >
                    <span>Split</span>
                    {renderSortIcon('split')}
                  </button>
                </th>
                <th className="py-2.5 px-3 text-right whitespace-nowrap">
                  <button
                    type="button"
                    onClick={() => handleSort('timestampDay')}
                    className="inline-flex items-center gap-1 hover:text-slate-900"
                  >
                    <span>Day (t)</span>
                    {renderSortIcon('timestampDay')}
                  </button>
                </th>
                <th className="py-2.5 px-3 whitespace-nowrap">
                  <button
                    type="button"
                    onClick={() => handleSort('windowPhase')}
                    className="inline-flex items-center gap-1 hover:text-slate-900"
                  >
                    <span>Window</span>
                    {renderSortIcon('windowPhase')}
                  </button>
                </th>
                <th className="py-2.5 px-3 whitespace-nowrap">
                  <button
                    type="button"
                    onClick={() => handleSort('actionId')}
                    className="inline-flex items-center gap-1 hover:text-slate-900"
                  >
                    <span>Action</span>
                    {renderSortIcon('actionId')}
                  </button>
                </th>
                <th className="py-2.5 px-3 whitespace-nowrap">
                  <button
                    type="button"
                    onClick={() => handleSort('channel')}
                    className="inline-flex items-center gap-1 hover:text-slate-900"
                  >
                    <span>Channel</span>
                    {renderSortIcon('channel')}
                  </button>
                </th>
                <th className="py-2.5 px-3 text-right whitespace-nowrap">
                  <button
                    type="button"
                    onClick={() => handleSort('recencyDays')}
                    className="inline-flex items-center gap-1 hover:text-slate-900"
                  >
                    <span>Δt Days</span>
                    {renderSortIcon('recencyDays')}
                  </button>
                </th>
                <th className="py-2.5 px-3 text-right whitespace-nowrap">
                  <button
                    type="button"
                    onClick={() => handleSort('frequencyCount')}
                    className="inline-flex items-center gap-1 hover:text-slate-900"
                  >
                    <span>Freq #</span>
                    {renderSortIcon('frequencyCount')}
                  </button>
                </th>
                <th className="py-2.5 px-3 text-right whitespace-nowrap">
                  <button
                    type="button"
                    onClick={() => handleSort('spendAmount')}
                    className="inline-flex items-center gap-1 hover:text-slate-900"
                  >
                    <span>Spend</span>
                    {renderSortIcon('spendAmount')}
                  </button>
                </th>
                <th className="py-2.5 px-3 text-right whitespace-nowrap">
                  <button
                    type="button"
                    onClick={() => handleSort('engagementScore')}
                    className="inline-flex items-center gap-1 hover:text-slate-900"
                  >
                    <span>Engage</span>
                    {renderSortIcon('engagementScore')}
                  </button>
                </th>
                <th className="py-2.5 px-3 text-right whitespace-nowrap">
                  <button
                    type="button"
                    onClick={() => handleSort('reward')}
                    className="inline-flex items-center gap-1 hover:text-slate-900"
                  >
                    <span>Reward</span>
                    {renderSortIcon('reward')}
                  </button>
                </th>
                <th className="py-2.5 px-3 text-right whitespace-nowrap">
                  <button
                    type="button"
                    onClick={() => handleSort('propensity')}
                    className="inline-flex items-center gap-1 hover:text-slate-900"
                  >
                    <span>Propensity μ</span>
                    {renderSortIcon('propensity')}
                  </button>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-xs">
              {pageRows.map((ev) => (
                <tr key={ev.eventId} className="hover:bg-slate-50/80 h-9">
                  <td className="py-2 px-3 font-mono text-slate-500 whitespace-nowrap">
                    {ev.eventId}
                  </td>
                  <td className="py-2 px-3 font-mono font-medium text-slate-900 whitespace-nowrap">
                    {ev.entityId}
                  </td>
                  <td className="py-2 px-3 font-mono text-slate-600 whitespace-nowrap">
                    {ev.split}
                  </td>
                  <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-800 whitespace-nowrap">
                    {ev.timestampDay}
                  </td>
                  <td className="py-2 px-3 whitespace-nowrap">
                    <span
                      className={`text-[11px] font-mono ${
                        ev.windowPhase === 'obs'
                          ? 'text-blue-700 font-medium'
                          : 'text-amber-700 font-medium'
                      }`}
                    >
                      {ev.windowPhase === 'obs' ? 'Obs ≤ T' : 'Horizon > T'}
                    </span>
                  </td>
                  <td className="py-2 px-3 text-slate-700 whitespace-nowrap">
                    {ev.actionId} · {ev.actionLabel}
                  </td>
                  <td className="py-2 px-3 text-slate-600 whitespace-nowrap">
                    {ev.channel}
                  </td>
                  <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-600 whitespace-nowrap">
                    {ev.recencyDays}
                  </td>
                  <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-600 whitespace-nowrap">
                    {ev.frequencyCount}
                  </td>
                  <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-900 whitespace-nowrap">
                    ${ev.spendAmount.toFixed(2)}
                  </td>
                  <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-700 whitespace-nowrap">
                    {ev.engagementScore.toFixed(3)}
                  </td>
                  <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-900 whitespace-nowrap">
                    {ev.reward.toFixed(2)}
                  </td>
                  <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-600 whitespace-nowrap">
                    {ev.propensity.toFixed(2)}
                  </td>
                </tr>
              ))}
              {pageRows.length === 0 && (
                <tr>
                  <td colSpan={13} className="py-12 text-center text-slate-500">
                    <div>No processed events match the current filter criteria.</div>
                    {hasActiveFilters && (
                      <button
                        type="button"
                        onClick={resetFilters}
                        className="mt-3 px-3 py-1.5 text-xs font-medium text-blue-700 bg-white border border-slate-200 rounded hover:bg-blue-50"
                      >
                        Reset All Filters
                      </button>
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Bar */}
        <div className="px-5 py-3.5 border-t border-slate-200 bg-slate-50/70 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs">
          <div className="flex items-center gap-3 text-slate-600">
            <span className="font-mono tabular-nums">
              {sortedEvents.length === 0
                ? '0 rows'
                : `Showing ${startIdx + 1}–${Math.min(
                    startIdx + pageSize,
                    sortedEvents.length
                  )} of ${sortedEvents.length.toLocaleString()}`}
            </span>
            <div className="flex items-center gap-1.5">
              <label htmlFor="explorer-page-size" className="text-slate-500">
                Rows:
              </label>
              <select
                id="explorer-page-size"
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setCurrentPage(1);
                }}
                className="px-2 py-1 text-xs font-mono bg-white border border-slate-200 rounded text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
              >
                {[25, 50, 100, 250].map((sz) => (
                  <option key={sz} value={sz}>
                    {sz}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setCurrentPage(1)}
              disabled={safePage <= 1}
              className="px-2 py-1 text-xs font-medium text-slate-600 bg-white border border-slate-200 rounded hover:bg-slate-100 disabled:opacity-40"
            >
              First
            </button>
            <button
              type="button"
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={safePage <= 1}
              aria-label="Previous page"
              className="p-1 text-slate-600 bg-white border border-slate-200 rounded hover:bg-slate-100 disabled:opacity-40"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>

            {visiblePageNumbers.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setCurrentPage(p)}
                className={`min-w-[28px] px-2 py-1 text-xs font-mono rounded border transition-colors ${
                  p === safePage
                    ? 'bg-blue-700 text-white border-blue-700 font-semibold'
                    : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                }`}
              >
                {p}
              </button>
            ))}

            <button
              type="button"
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={safePage >= totalPages}
              aria-label="Next page"
              className="p-1 text-slate-600 bg-white border border-slate-200 rounded hover:bg-slate-100 disabled:opacity-40"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setCurrentPage(totalPages)}
              disabled={safePage >= totalPages}
              className="px-2 py-1 text-xs font-medium text-slate-600 bg-white border border-slate-200 rounded hover:bg-slate-100 disabled:opacity-40"
            >
              Last ({totalPages})
            </button>
          </div>
        </div>
      </section>
    </div>
  );
};
