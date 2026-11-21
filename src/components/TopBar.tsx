import React from 'react';
import { Upload, Download, MessageSquare, Terminal, Loader2, CheckCircle2 } from 'lucide-react';
import { GlobalSearchResultItem, WorkspaceTab } from '../types/curation';
import { WorkspaceSearchInput } from '../engine/curationEngine';
import { GlobalSearchBar } from './GlobalSearchBar';

export interface ExportProgressState {
  status: 'exporting' | 'complete';
  format: 'CSV' | 'JSON' | 'MDP' | 'SQL';
  label: string;
  progress: number;
}

interface TopBarProps {
  datasetName: string;
  activeTab: WorkspaceTab;
  searchInput: WorkspaceSearchInput;
  onSelectSearchResult: (item: GlobalSearchResultItem) => void;
  onOpenCsvModal: () => void;
  onExportCurrent: () => void;
  exportLabel: string;
  isChatOpen: boolean;
  onToggleChat: () => void;
  isTerminalOpen: boolean;
  onToggleTerminal: () => void;
  exportProgress?: ExportProgressState | null;
}

const TAB_TITLES: Record<WorkspaceTab, string> = {
  overview: 'Overview & Lineage',
  regression: 'Regression (LTV)',
  feature_engineering: 'Feature Engineering Assistant',
  model_comparison: 'Model Comparison Dashboard',
  sequence: 'Deep Learning (Sequential Tensors)',
  rul_timeseries: 'Time-Series & RUL Preparation',
  hyperparameter_optimizer: 'Hyperparameter Optimizer',
  offline_rl: 'Offline RL (CQL / MDP)',
  retention_cohorts: 'Retention Cohort Analysis (D3)',
  snapshot_comparison: 'Snapshot Comparison',
  data_explorer: 'Data Explorer',
  dataset_search: 'Search & Metadata Catalog',
  governance_repository: 'Governance, VCS & Archive',
  nl_query: 'Natural Language Query',
  auto_docs: 'Auto Documentation Generator',
  ai_curator: 'AI Data Quality & Curator',
  audit_export: 'Validation & Export',
};

export const TopBar: React.FC<TopBarProps> = ({
  datasetName,
  activeTab,
  searchInput,
  onSelectSearchResult,
  onOpenCsvModal,
  onExportCurrent,
  exportLabel,
  isChatOpen,
  onToggleChat,
  isTerminalOpen,
  onToggleTerminal,
  exportProgress,
}) => {
  const isExporting = exportProgress?.status === 'exporting';
  const isComplete = exportProgress?.status === 'complete';

  return (
    <header className="relative h-14 px-6 bg-white border-b border-slate-200 flex items-center justify-between gap-4 shrink-0">
      <div className="flex items-center gap-2 text-sm min-w-0">
        <span className="text-slate-500 whitespace-nowrap shrink-0 hidden xl:inline">Workspace</span>
        <span className="text-slate-300 hidden xl:inline" aria-hidden="true">/</span>
        <span className="text-slate-600 truncate max-w-[160px]">{datasetName}</span>
        <span className="text-slate-300" aria-hidden="true">/</span>
        <span className="font-semibold text-slate-900 whitespace-nowrap shrink-0 truncate max-w-[200px]">
          {TAB_TITLES[activeTab]}
        </span>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <GlobalSearchBar
          searchInput={searchInput}
          onSelectResult={onSelectSearchResult}
        />

        {exportProgress && (
          <div
            role="status"
            aria-live="polite"
            className={`hidden 2xl:flex items-center gap-2.5 px-3 py-1.5 rounded-md border text-xs whitespace-nowrap ${
              isComplete
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : 'bg-slate-50 border-slate-200 text-slate-700'
            }`}
          >
            {isExporting ? (
              <Loader2 className="w-3.5 h-3.5 text-blue-700 animate-spin shrink-0" />
            ) : (
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
            )}
            <span className="font-medium">{exportProgress.label}</span>
            <div className="w-20 h-1.5 bg-slate-200 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all duration-150 ${
                  isComplete ? 'bg-emerald-600' : 'bg-blue-700'
                }`}
                style={{ width: `${Math.min(100, Math.max(0, exportProgress.progress))}%` }}
              />
            </div>
            <span className="font-mono tabular-nums text-[11px] font-semibold w-8 text-right">
              {Math.round(exportProgress.progress)}%
            </span>
          </div>
        )}

        <button
          type="button"
          onClick={onToggleTerminal}
          aria-expanded={isTerminalOpen}
          title="Toggle Workbench Terminal (Ctrl+`)"
          className={`px-3 py-2 text-xs font-medium rounded-md transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 border ${
            isTerminalOpen
              ? 'bg-slate-900 text-white border-slate-900'
              : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50 hover:text-slate-900'
          }`}
        >
          <Terminal className="w-3.5 h-3.5" />
          <span>Terminal</span>
        </button>

        <button
          type="button"
          onClick={onToggleChat}
          className={`px-3 py-2 text-xs font-medium rounded-md transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 border ${
            isChatOpen
              ? 'bg-blue-50 text-blue-700 border-blue-200'
              : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50 hover:text-slate-900'
          }`}
        >
          <MessageSquare className="w-3.5 h-3.5" />
          <span>Assistant</span>
        </button>

        <button
          type="button"
          onClick={onOpenCsvModal}
          className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 hover:text-slate-900 transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
        >
          <Upload className="w-3.5 h-3.5 text-slate-500" />
          <span>Import CSV / MAT</span>
        </button>

        <button
          type="button"
          onClick={onExportCurrent}
          disabled={isExporting}
          className="px-4 py-2 text-xs font-medium text-white bg-blue-700 rounded-md hover:bg-blue-800 disabled:opacity-75 disabled:cursor-wait transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
        >
          {isExporting ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span className="font-mono tabular-nums">
                Exporting {Math.round(exportProgress.progress)}%
              </span>
            </>
          ) : (
            <>
              <Download className="w-3.5 h-3.5" />
              <span>{exportLabel}</span>
            </>
          )}
        </button>
      </div>

      {/* TopBar bottom-edge progress indicator */}
      {exportProgress && (
        <div
          aria-hidden="true"
          className="absolute inset-x-0 bottom-0 h-[3px] bg-slate-100 overflow-hidden pointer-events-none"
        >
          <div
            className={`h-full transition-all duration-150 ${
              isComplete ? 'bg-emerald-600' : 'bg-blue-700'
            }`}
            style={{ width: `${Math.min(100, Math.max(0, exportProgress.progress))}%` }}
          />
        </div>
      )}
    </header>
  );
};
