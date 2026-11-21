import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  ArrowUpRight,
  BarChart2,
  Compass,
  Database,
  Search,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import {
  GlobalSearchCategory,
  GlobalSearchResultItem,
} from '../types/curation';
import {
  searchWorkspaceCatalog,
  WorkspaceSearchInput,
} from '../engine/curationEngine';

interface GlobalSearchBarProps {
  searchInput: WorkspaceSearchInput;
  onSelectResult: (item: GlobalSearchResultItem) => void;
}

const CATEGORY_TABS: { id: 'all' | GlobalSearchCategory; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'metric', label: 'Metrics' },
  { id: 'config', label: 'Configs' },
  { id: 'event', label: 'Events' },
  { id: 'dataset', label: 'Datasets' },
  { id: 'view', label: 'Views' },
];

const CATEGORY_META: Record<
  GlobalSearchCategory,
  { label: string; iconClass: string; Icon: React.FC<{ className?: string }> }
> = {
  metric: {
    label: 'Metric',
    iconClass: 'text-blue-700',
    Icon: BarChart2,
  },
  config: {
    label: 'Config',
    iconClass: 'text-indigo-700',
    Icon: SlidersHorizontal,
  },
  event: {
    label: 'Event',
    iconClass: 'text-emerald-700',
    Icon: Activity,
  },
  dataset: {
    label: 'Dataset',
    iconClass: 'text-amber-700',
    Icon: Database,
  },
  view: {
    label: 'View',
    iconClass: 'text-slate-700',
    Icon: Compass,
  },
};

export const GlobalSearchBar: React.FC<GlobalSearchBarProps> = ({
  searchInput,
  onSelectResult,
}) => {
  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<'all' | GlobalSearchCategory>('all');
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const report = useMemo(
    () => searchWorkspaceCatalog(query, searchInput, categoryFilter, 36),
    [query, searchInput, categoryFilter]
  );

  // Reset active highlight when filtered list changes
  useEffect(() => {
    setActiveIndex(0);
  }, [query, categoryFilter]);

  // Global keyboard shortcut: Cmd/Ctrl + K or "/" outside editable inputs
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        setIsOpen(true);
        return;
      }
      if (
        e.key === '/' &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey
      ) {
        const target = e.target as HTMLElement | null;
        const tag = target?.tagName?.toLowerCase();
        const isEditable =
          tag === 'input' ||
          tag === 'textarea' ||
          tag === 'select' ||
          Boolean(target?.isContentEditable);
        if (!isEditable) {
          e.preventDefault();
          inputRef.current?.focus();
          setIsOpen(true);
        }
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, []);

  // Close popover on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Keep active row scrolled into view on keyboard navigation
  useEffect(() => {
    if (!isOpen || !listRef.current) return;
    const activeEl = listRef.current.querySelector<HTMLElement>(
      `[data-search-idx="${activeIndex}"]`
    );
    activeEl?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, isOpen]);

  const handleChoose = (item: GlobalSearchResultItem) => {
    onSelectResult(item);
    setIsOpen(false);
    inputRef.current?.blur();
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      setIsOpen(false);
      inputRef.current?.blur();
      return;
    }

    if (!isOpen && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      setIsOpen(true);
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (report.items.length > 0) {
        setActiveIndex((prev) => (prev + 1) % report.items.length);
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (report.items.length > 0) {
        setActiveIndex((prev) =>
          (prev - 1 + report.items.length) % report.items.length
        );
      }
    } else if (e.key === 'Enter') {
      if (isOpen && report.items.length > 0) {
        e.preventDefault();
        const chosen = report.items[Math.min(activeIndex, report.items.length - 1)];
        if (chosen) handleChoose(chosen);
      }
    }
  };

  const getTabCount = (tabId: 'all' | GlobalSearchCategory): number => {
    if (tabId === 'all') return report.totalMatches;
    return report.countsByCategory[tabId];
  };

  return (
    <div ref={containerRef} className="relative w-56 md:w-64 lg:w-72 xl:w-80 shrink-0">
      <div className="relative flex items-center">
        <Search
          className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 pointer-events-none"
          aria-hidden="true"
        />
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={isOpen}
          aria-controls="global-workspace-search-listbox"
          aria-autocomplete="list"
          aria-label="Global search for events, dataset configs, or metrics"
          value={query}
          onFocus={() => setIsOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            if (!isOpen) setIsOpen(true);
          }}
          onKeyDown={handleInputKeyDown}
          placeholder="Search events, configs, metrics..."
          className="w-full h-9 pl-8 pr-14 bg-slate-50 border border-slate-200 rounded-md text-xs text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600 transition-colors"
        />
        {query ? (
          <button
            type="button"
            onClick={() => {
              setQuery('');
              setCategoryFilter('all');
              inputRef.current?.focus();
            }}
            aria-label="Clear search query"
            className="absolute right-2 p-1 text-slate-400 hover:text-slate-700 rounded"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        ) : (
          <span
            aria-hidden="true"
            className="absolute right-2.5 text-[10px] font-mono text-slate-400 pointer-events-none select-none"
          >
            ⌘K
          </span>
        )}
      </div>

      {isOpen && (
        <div
          id="global-workspace-search-listbox"
          role="listbox"
          aria-label="Workspace search results"
          className="absolute right-0 top-full mt-1.5 w-[min(560px,calc(100vw-2rem))] bg-white border border-slate-200 rounded-lg shadow-lg z-50 overflow-hidden"
        >
          {/* Category Filter Tabs */}
          <div className="px-3 py-2 border-b border-slate-200 bg-slate-50/70 flex flex-wrap items-center gap-1">
            {CATEGORY_TABS.map((tab) => {
              const count = getTabCount(tab.id);
              const isSelected = categoryFilter === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setCategoryFilter(tab.id)}
                  className={`px-2 py-1 text-[11px] font-medium rounded transition-colors inline-flex items-center gap-1 ${
                    isSelected
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
                  }`}
                >
                  <span>{tab.label}</span>
                  <span
                    className={`font-mono tabular-nums text-[10px] ${
                      isSelected ? 'text-slate-300' : 'text-slate-400'
                    }`}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Results List */}
          <div ref={listRef} className="max-h-[380px] overflow-y-auto divide-y divide-slate-100">
            {report.items.length === 0 ? (
              <div className="px-4 py-8 text-center space-y-2">
                <p className="text-xs font-medium text-slate-700">
                  No matches found for &ldquo;{query}&rdquo;
                  {categoryFilter !== 'all' ? ` in ${categoryFilter}` : ''}.
                </p>
                <p className="text-[11px] text-slate-500">
                  Try keywords like <code className="font-mono">R²</code>,{' '}
                  <code className="font-mono">gamma</code>,{' '}
                  <code className="font-mono">maxSeqLen</code>,{' '}
                  <code className="font-mono">kl</code>, or an event/entity ID.
                </p>
                {categoryFilter !== 'all' && (
                  <button
                    type="button"
                    onClick={() => setCategoryFilter('all')}
                    className="text-xs font-medium text-blue-700 hover:underline"
                  >
                    Show all categories
                  </button>
                )}
              </div>
            ) : (
              report.items.map((item, idx) => {
                const meta = CATEGORY_META[item.category];
                const Icon = meta.Icon;
                const isActive = idx === activeIndex;

                return (
                  <button
                    key={item.id}
                    type="button"
                    role="option"
                    aria-selected={isActive}
                    data-search-idx={idx}
                    onMouseEnter={() => setActiveIndex(idx)}
                    onClick={() => handleChoose(item)}
                    className={`w-full text-left px-3.5 py-2.5 flex items-center justify-between gap-3 transition-colors ${
                      isActive ? 'bg-blue-50/75' : 'bg-white hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-start gap-2.5 min-w-0">
                      <Icon className={`w-4 h-4 shrink-0 mt-0.5 ${meta.iconClass}`} />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold text-slate-900 truncate">
                            {item.title}
                          </span>
                          <span className="text-[10px] font-mono text-slate-400 shrink-0">
                            {meta.label}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-500 truncate mt-0.5">
                          {item.subtitle}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <div className="text-right">
                        {item.valueText && (
                          <div className="text-[11px] font-mono tabular-nums font-semibold text-slate-800">
                            {item.valueText}
                          </div>
                        )}
                        <div className="text-[10px] font-mono text-slate-400">
                          {item.targetLabel}
                        </div>
                      </div>
                      <ArrowUpRight
                        className={`w-3.5 h-3.5 transition-opacity ${
                          isActive ? 'text-blue-700 opacity-100' : 'text-slate-300 opacity-60'
                        }`}
                      />
                    </div>
                  </button>
                );
              })
            )}
          </div>

          {/* Keyboard Navigation Footer */}
          <div className="px-3.5 py-2 border-t border-slate-200 bg-slate-50 flex items-center justify-between text-[11px] font-mono text-slate-500">
            <span>↑↓ Navigate · ↵ Open · Esc Close</span>
            <span className="tabular-nums">
              {report.items.length} of {report.totalMatches} match
              {report.totalMatches === 1 ? '' : 'es'}
            </span>
          </div>
        </div>
      )}
    </div>
  );
};
