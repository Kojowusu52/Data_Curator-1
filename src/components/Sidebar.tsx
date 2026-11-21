import React from 'react';
import {
  Database,
  GitBranch,
  Layers,
  Table2,
  Waypoints,
  ShieldCheck,
  Bookmark,
  LogIn,
  LogOut,
  FileSpreadsheet,
  GitCompareArrows,
  Sliders,
  SlidersHorizontal,
  Users,
  History,
  Search,
  BookOpen,
  Wand2,
  MessageSquareText,
  Activity,
  FlaskConical,
  Archive,
} from 'lucide-react';
import { DatasetPreset, GlobalCurationConfig, WorkspaceTab } from '../types/curation';
import { useAuth } from '../contexts/AuthContext';

interface SidebarProps {
  activeTab: WorkspaceTab;
  onSelectTab: (tab: WorkspaceTab) => void;
  presets: DatasetPreset[];
  activePresetId: string;
  customDatasetName: string | null;
  onSelectPreset: (id: string) => void;
  globalConfig: GlobalCurationConfig;
  onUpdateGlobalConfig: (next: GlobalCurationConfig) => void;
  totalEventsCount: number;
  totalEntitiesCount: number;
  syncDriftCount: number;
  onOpenGlobalSync: () => void;
  onOpenWorkspaces: () => void;
}

const NAV_ITEMS: { id: WorkspaceTab; label: string; subtitle: string; icon: React.ComponentType<{ className?: string }> }[] = [
  {
    id: 'overview',
    label: 'Overview & Lineage',
    subtitle: 'Canonical stream & parity',
    icon: GitBranch,
  },
  {
    id: 'regression',
    label: 'Regression (LTV)',
    subtitle: 'Point-in-time feature matrix',
    icon: Table2,
  },
  {
    id: 'feature_engineering',
    label: 'Feature Engineering',
    subtitle: 'Derived signals & AI advisor',
    icon: FlaskConical,
  },
  {
    id: 'model_comparison',
    label: 'Model Comparison',
    subtitle: 'Leaderboard, A/B & cross-paradigm',
    icon: GitCompareArrows,
  },
  {
    id: 'sequence',
    label: 'Deep Learning (Transformers)',
    subtitle: 'Transformers & [B, L, D] tensors',
    icon: Layers,
  },
  {
    id: 'rul_timeseries',
    label: 'Time-Series & RUL',
    subtitle: 'Sensor telemetry & RUL windows',
    icon: Activity,
  },
  {
    id: 'hyperparameter_optimizer',
    label: 'Hyperparameter Optimizer',
    subtitle: 'Batch, LR & depth search',
    icon: Sliders,
  },
  {
    id: 'offline_rl',
    label: 'Offline RL (CQL/MDP)',
    subtitle: 'Transition tuples & support',
    icon: Waypoints,
  },
  {
    id: 'retention_cohorts',
    label: 'Retention Cohorts',
    subtitle: 'D3 survival & lifecycle matrix',
    icon: Users,
  },
  {
    id: 'snapshot_comparison',
    label: 'Snapshot Compare',
    subtitle: 'Multi-snapshot metrics & drift',
    icon: History,
  },
  {
    id: 'data_explorer',
    label: 'Data Explorer',
    subtitle: 'Inspect, filter & sort events',
    icon: FileSpreadsheet,
  },
  {
    id: 'dataset_search',
    label: 'Search & Metadata Catalog',
    subtitle: 'Query datasets, schemas & PII',
    icon: Search,
  },
  {
    id: 'governance_repository',
    label: 'Governance, VCS & Archive',
    subtitle: 'Metadata, catalog, commits & vault',
    icon: Archive,
  },
  {
    id: 'nl_query',
    label: 'Natural Language Query',
    subtitle: 'Plain-English SQL & analytics',
    icon: MessageSquareText,
  },
  {
    id: 'auto_docs',
    label: 'Auto Documentation',
    subtitle: 'Model card & data dictionary',
    icon: BookOpen,
  },
  {
    id: 'ai_curator',
    label: 'AI Quality & Curator',
    subtitle: 'Anomaly scan & auto-curation',
    icon: Wand2,
  },
  {
    id: 'audit_export',
    label: 'Validation & Export',
    subtitle: 'Audit checks & codegen',
    icon: ShieldCheck,
  },
];

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  onSelectTab,
  presets,
  activePresetId,
  customDatasetName,
  onSelectPreset,
  globalConfig,
  onUpdateGlobalConfig,
  totalEventsCount,
  totalEntitiesCount,
  syncDriftCount,
  onOpenGlobalSync,
  onOpenWorkspaces,
}) => {
  const { user, authReady, isSigningIn, authError, signInWithGoogle, signOutUser } = useAuth();

  const splitPresets: { label: string; train: number; val: number; test: number }[] = [
    { label: '70 / 15 / 15', train: 0.7, val: 0.15, test: 0.15 },
    { label: '80 / 10 / 10', train: 0.8, val: 0.1, test: 0.1 },
    { label: '60 / 20 / 20', train: 0.6, val: 0.2, test: 0.2 },
  ];

  return (
    <aside className="w-64 shrink-0 bg-white border-r border-slate-200 flex flex-col justify-between min-h-screen select-none">
      <div>
        {/* Brand Wordmark */}
        <div className="h-14 px-5 flex items-center border-b border-slate-200">
          <span className="font-display text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0">
            Stratum
          </span>
        </div>

        {/* Source Dataset Selector */}
        <div className="px-4 py-5 border-b border-slate-200">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-500 mb-2.5">
            <Database className="w-3.5 h-3.5 text-slate-400" />
            <span>Canonical Event Source</span>
          </div>
          <label htmlFor="dataset-source-select" className="sr-only">
            Select Event Source
          </label>
          <select
            id="dataset-source-select"
            value={customDatasetName ? 'custom_csv' : activePresetId}
            onChange={(e) => {
              if (e.target.value !== 'custom_csv') {
                onSelectPreset(e.target.value);
              }
            }}
            className="w-full px-2.5 py-2 text-xs font-medium text-slate-800 bg-slate-50 border border-slate-200 rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
          >
            {presets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
            {customDatasetName && (
              <option value="custom_csv">CSV: {customDatasetName}</option>
            )}
          </select>
          <div className="mt-2.5 text-xs text-slate-500 font-mono tabular-nums">
            {totalEntitiesCount} entities · {totalEventsCount.toLocaleString()} events
          </div>
        </div>

        {/* Paradigm Navigation */}
        <nav aria-label="Curation views" className="px-3 py-4 space-y-1">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectTab(item.id)}
                className={`w-full text-left px-3 py-2.5 rounded-md transition-colors flex items-start gap-2.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${
                  isActive
                    ? 'bg-blue-50/80 text-blue-700'
                    : 'text-slate-700 hover:bg-slate-100/80 hover:text-slate-900'
                }`}
              >
                <Icon
                  className={`w-4 h-4 mt-0.5 shrink-0 ${
                    isActive ? 'text-blue-700' : 'text-slate-400'
                  }`}
                />
                <div className="min-w-0">
                  <div className="text-xs font-semibold whitespace-nowrap truncate">
                    {item.label}
                  </div>
                  <div
                    className={`text-[11px] truncate ${
                      isActive ? 'text-blue-600/90' : 'text-slate-500'
                    }`}
                  >
                    {item.subtitle}
                  </div>
                </div>
              </button>
            );
          })}
        </nav>
      </div>

      <div>
        {/* Deterministic Cohort Split Control */}
        <div className="p-4 border-t border-slate-200 bg-slate-50/60">
          <div className="text-xs font-semibold text-slate-700 mb-2">
            Shared Entity-Hash Split
          </div>
          <div className="grid grid-cols-3 gap-1 p-1 bg-slate-200/70 rounded-md">
            {splitPresets.map((sp) => {
              const active =
                Math.abs(globalConfig.trainRatio - sp.train) < 0.01 &&
                Math.abs(globalConfig.valRatio - sp.val) < 0.01;
              return (
                <button
                  key={sp.label}
                  type="button"
                  onClick={() =>
                    onUpdateGlobalConfig({
                      ...globalConfig,
                      trainRatio: sp.train,
                      valRatio: sp.val,
                      testRatio: sp.test,
                    })
                  }
                  className={`py-1.5 text-[11px] font-mono font-medium rounded transition-colors whitespace-nowrap ${
                    active
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {sp.label}
                </button>
              );
            })}
          </div>
          <div className="mt-2.5 flex items-center justify-between text-[11px] text-slate-500">
            <span>Hash Salt</span>
            <input
              type="text"
              aria-label="Entity hash salt"
              value={globalConfig.seedSalt}
              onChange={(e) =>
                onUpdateGlobalConfig({ ...globalConfig, seedSalt: e.target.value })
              }
              className="w-24 px-1.5 py-0.5 text-right font-mono text-[11px] bg-white border border-slate-200 rounded text-slate-800 focus:outline-none focus-visible:ring-1 focus-visible:ring-blue-600"
            />
          </div>
          <button
            type="button"
            onClick={onOpenGlobalSync}
            className="mt-3 w-full py-1.5 px-2.5 text-[11px] font-medium text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 rounded-md transition-colors flex items-center justify-between"
          >
            <span className="inline-flex items-center gap-1.5">
              <SlidersHorizontal className="w-3.5 h-3.5 text-blue-700" />
              <span>Global Parameter Sync</span>
            </span>
            <span
              className={`font-mono tabular-nums font-semibold ${
                syncDriftCount === 0 ? 'text-emerald-700' : 'text-amber-700'
              }`}
            >
              {syncDriftCount === 0 ? 'Aligned' : `${syncDriftCount} drift`}
            </span>
          </button>
        </div>

        {/* Account & Firestore Snapshots */}
        <div className="p-4 border-t border-slate-200 bg-white space-y-2.5">
          <button
            type="button"
            onClick={onOpenWorkspaces}
            className="w-full py-2 px-3 text-xs font-medium text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-md transition-colors flex items-center justify-between"
          >
            <span className="inline-flex items-center gap-2">
              <Bookmark className="w-3.5 h-3.5 text-slate-500" />
              <span>Saved Snapshots</span>
            </span>
          </button>

          {!authReady ? (
            <div className="text-[11px] text-slate-400 py-1">Checking session...</div>
          ) : user ? (
            <div className="flex items-center justify-between gap-2 pt-1">
              <div className="flex items-center gap-2 min-w-0">
                {user.photoURL ? (
                  <img
                    src={user.photoURL}
                    alt={user.displayName || 'User avatar'}
                    referrerPolicy="no-referrer"
                    className="w-7 h-7 rounded-full border border-slate-200 object-cover shrink-0"
                  />
                ) : (
                  <div className="w-7 h-7 rounded-full bg-blue-100 text-blue-700 text-xs font-semibold flex items-center justify-center shrink-0">
                    {(user.displayName || user.email || 'U').charAt(0).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0">
                  <div className="text-xs font-medium text-slate-900 truncate">
                    {user.displayName || 'Google User'}
                  </div>
                  <div className="text-[11px] text-slate-500 truncate">
                    {user.email}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={signOutUser}
                title="Sign out"
                aria-label="Sign out"
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded hover:bg-slate-100 shrink-0"
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={signInWithGoogle}
              disabled={isSigningIn}
              className="w-full py-2 px-3 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-md transition-colors flex items-center justify-center gap-2 disabled:opacity-60"
            >
              <LogIn className="w-3.5 h-3.5" />
              <span>{isSigningIn ? 'Signing in...' : 'Sign in with Google'}</span>
            </button>
          )}

          {authError && (
            <div className="text-[11px] text-red-600 leading-snug">{authError}</div>
          )}
        </div>
      </div>
    </aside>
  );
};
