import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Bookmark,
  Check,
  Clock,
  GitCompareArrows,
  LogIn,
  RotateCcw,
  TrendingUp,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  collection,
  onSnapshot,
  orderBy,
  query,
  where,
} from 'firebase/firestore';
import { useAuth } from '../contexts/AuthContext';
import { OperationType, db, handleFirestoreError } from '../lib/firebase';
import { DATASET_PRESETS } from '../data/presets';
import {
  cloneExperimentConfigs,
  evaluateSnapshotComparison,
  SnapshotComparisonInputRecord,
} from '../engine/curationEngine';
import {
  GlobalCurationConfig,
  MdpConfig,
  RawEvent,
  RegressionConfig,
  SequenceConfig,
  SnapshotComparisonMetricDef,
  SnapshotComparisonMetricDelta,
  SnapshotComparisonMetricKey,
} from '../types/curation';
import type { SavedWorkspaceRecord } from './WorkspacesModal';

interface SnapshotComparisonViewProps {
  activePresetId: string;
  customDatasetName: string | null;
  datasetName: string;
  events: RawEvent[];
  globalConfig: GlobalCurationConfig;
  regConfig: RegressionConfig;
  seqConfig: SequenceConfig;
  mdpConfig: MdpConfig;
  onLoadWorkspace: (ws: SavedWorkspaceRecord) => void;
  onOpenWorkspaces: () => void;
}

const LOCAL_SNAPSHOTS_KEY = 'stratum_local_experiment_snapshots_v1';
const LIVE_WORKSPACE_ID = '__live_active_workspace__';

type ChartMetricGroup = 'r2' | 'loss' | 'risk' | 'value';

function formatRecordTimestamp(
  ts: { toDate?: () => Date } | string | null | undefined
): string {
  if (!ts) return 'Current Session';
  let d: Date | null = null;
  if (typeof ts === 'string') {
    const parsed = new Date(ts);
    if (!Number.isNaN(parsed.getTime())) d = parsed;
  } else if (typeof ts === 'object' && typeof ts.toDate === 'function') {
    d = ts.toDate();
  }
  if (!d) return 'Saved';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

function formatMetricValue(
  val: number | null,
  unit: SnapshotComparisonMetricDef['unit']
): string {
  if (val === null) return 'N/A';
  if (unit === 'currency') return `$${val.toFixed(2)}`;
  if (unit === 'percent') return `${val.toFixed(1)}%`;
  if (unit === 'count') return Math.round(val).toLocaleString();
  if (unit === 'nats') return `${val.toFixed(3)}`;
  if (unit === 'reward') return val.toFixed(2);
  return val.toFixed(4);
}

function formatDeltaBadge(
  deltaInfo: SnapshotComparisonMetricDelta,
  unit: SnapshotComparisonMetricDef['unit']
): string | null {
  if (deltaInfo.delta === null || deltaInfo.delta === 0) return null;
  const d = deltaInfo.delta;
  const sign = d > 0 ? '+' : '';
  if (unit === 'currency') return `${sign}$${d.toFixed(2)}`;
  if (unit === 'percent') return `${sign}${d.toFixed(1)}%`;
  if (unit === 'count') return `${sign}${Math.round(d)}`;
  if (unit === 'nats') return `${sign}${d.toFixed(3)}`;
  if (unit === 'reward') return `${sign}${d.toFixed(2)}`;
  return `${sign}${d.toFixed(4)}`;
}

function readLocalSnapshots(): SavedWorkspaceRecord[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(LOCAL_SNAPSHOTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SavedWorkspaceRecord[]) : [];
  } catch {
    return [];
  }
}

export const SnapshotComparisonView: React.FC<SnapshotComparisonViewProps> = ({
  activePresetId,
  customDatasetName,
  datasetName,
  events,
  globalConfig,
  regConfig,
  seqConfig,
  mdpConfig,
  onLoadWorkspace,
  onOpenWorkspaces,
}) => {
  const { user, authReady, profileSynced, signInWithGoogle, isSigningIn } = useAuth();
  const [cloudSnapshots, setCloudSnapshots] = useState<SavedWorkspaceRecord[]>([]);
  const [localSnapshots, setLocalSnapshots] = useState<SavedWorkspaceRecord[]>(() =>
    readLocalSnapshots()
  );
  const [loadingCloud, setLoadingCloud] = useState(false);

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [baselineId, setBaselineId] = useState<string>('');
  const [chartGroup, setChartGroup] = useState<ChartMetricGroup>('r2');
  const [revertedId, setRevertedId] = useState<string | null>(null);

  // Sync local snapshots when mounted or window regains focus
  useEffect(() => {
    setLocalSnapshots(readLocalSnapshots());
    const onFocus = () => setLocalSnapshots(readLocalSnapshots());
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  // Load Firestore workspaces when signed in
  useEffect(() => {
    if (!authReady || !user || !profileSynced) {
      setCloudSnapshots([]);
      return;
    }

    setLoadingCloud(true);
    const colPath = `users/${user.uid}/workspaces`;
    const q = query(
      collection(db, 'users', user.uid, 'workspaces'),
      where('ownerId', '==', user.uid),
      orderBy('updatedAt', 'desc')
    );

    const unsubscribe = onSnapshot(
      q,
      (snap) => {
        const list: SavedWorkspaceRecord[] = snap.docs.map(
          (d) => d.data() as SavedWorkspaceRecord
        );
        setCloudSnapshots(list);
        setLoadingCloud(false);
      },
      (err) => {
        setLoadingCloud(false);
        handleFirestoreError(err, OperationType.LIST, colPath);
      }
    );

    return () => unsubscribe();
  }, [authReady, user, profileSynced]);

  const isCloudReady = Boolean(user && profileSynced);
  const savedSnapshots = isCloudReady ? cloudSnapshots : localSnapshots;

  const liveRecord = useMemo<SnapshotComparisonInputRecord>(() => {
    const cloned = cloneExperimentConfigs({
      globalConfig,
      regConfig,
      seqConfig,
      mdpConfig,
    });
    return {
      workspaceId: LIVE_WORKSPACE_ID,
      name: 'Current Live Workspace',
      presetId: customDatasetName ? 'custom_csv' : activePresetId,
      datasetName,
      timestampLabel: 'Active Unsaved State',
      isLiveActive: true,
      ...cloned,
    };
  }, [activePresetId, customDatasetName, datasetName, globalConfig, regConfig, seqConfig, mdpConfig]);

  const savedInputRecords = useMemo<SnapshotComparisonInputRecord[]>(() => {
    return savedSnapshots.map((ws) => ({
      workspaceId: ws.workspaceId,
      name: ws.name,
      presetId: ws.presetId,
      datasetName: ws.datasetName,
      timestampLabel: formatRecordTimestamp(
        ws.localTimestampIso ?? ws.createdAt ?? ws.updatedAt
      ),
      notes: ws.notes,
      isLiveActive: false,
      globalConfig: ws.globalConfig,
      regConfig: ws.regConfig,
      seqConfig: ws.seqConfig,
      mdpConfig: ws.mdpConfig,
    }));
  }, [savedSnapshots]);

  const allPoolRecords = useMemo(
    () => [liveRecord, ...savedInputRecords],
    [liveRecord, savedInputRecords]
  );

  // Initialize & keep selectedIds valid (up to 6 snapshots)
  useEffect(() => {
    const poolIds = new Set(allPoolRecords.map((r) => r.workspaceId));
    setSelectedIds((prev) => {
      const valid = prev.filter((id) => poolIds.has(id));
      if (valid.length >= 2) return valid;
      return allPoolRecords.slice(0, Math.min(4, allPoolRecords.length)).map((r) => r.workspaceId);
    });
  }, [allPoolRecords]);

  // Keep baselineId valid within selectedIds
  useEffect(() => {
    if (selectedIds.length === 0) return;
    if (!baselineId || !selectedIds.includes(baselineId)) {
      const savedSelected = selectedIds.filter((id) => id !== LIVE_WORKSPACE_ID);
      setBaselineId(
        savedSelected.length > 0
          ? savedSelected[savedSelected.length - 1]
          : selectedIds[0]
      );
    }
  }, [selectedIds, baselineId]);

  const selectedRecords = useMemo(
    () => allPoolRecords.filter((r) => selectedIds.includes(r.workspaceId)),
    [allPoolRecords, selectedIds]
  );

  const report = useMemo(
    () =>
      evaluateSnapshotComparison(
        selectedRecords,
        baselineId,
        DATASET_PRESETS,
        events
      ),
    [selectedRecords, baselineId, events]
  );

  const toggleSelectSnapshot = (id: string) => {
    setSelectedIds((prev) => {
      if (prev.includes(id)) {
        if (prev.length <= 1) return prev;
        return prev.filter((x) => x !== id);
      }
      if (prev.length >= 6) return prev;
      return [...prev, id];
    });
  };

  const handleRevertToSnapshot = (workspaceId: string) => {
    const match = savedSnapshots.find((s) => s.workspaceId === workspaceId);
    if (!match) return;
    onLoadWorkspace(match);
    setRevertedId(workspaceId);
    window.setTimeout(() => setRevertedId(null), 2000);
  };

  const chartData = useMemo(() => {
    return report.snapshots.map((s) => ({
      name: s.name.length > 22 ? `${s.name.slice(0, 20)}…` : s.name,
      fullName: s.name,
      regRSquared: s.metrics.regRSquared,
      seqHoldoutR2: s.metrics.seqHoldoutR2 ?? 0,
      valLoss: s.metrics.valLoss ?? 0,
      trainLoss: s.metrics.trainLoss,
      maxKlDivergence: s.metrics.maxKlDivergence,
      mdpOodRatePct: s.metrics.mdpOodRatePct,
      meanProjectedLtv: s.metrics.meanProjectedLtv,
      mdpInitialReturn: s.metrics.mdpInitialReturn,
    }));
  }, [report.snapshots]);

  const groupedMetricDefs = useMemo(() => {
    const groups: { group: SnapshotComparisonMetricDef['group']; defs: SnapshotComparisonMetricDef[] }[] = [
      { group: 'Regression', defs: [] },
      { group: 'Sequence', defs: [] },
      { group: 'Offline RL', defs: [] },
    ];
    for (const def of report.metricDefs) {
      groups.find((g) => g.group === def.group)?.defs.push(def);
    }
    return groups;
  }, [report.metricDefs]);

  return (
    <div className="space-y-6">
      {/* Top Control Surface */}
      <section className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 pb-4 border-b border-slate-200">
          <div>
            <div className="flex items-center gap-2">
              <GitCompareArrows className="w-4 h-4 text-blue-700 shrink-0" />
              <h1 className="text-lg font-bold text-slate-900">
                Multi-Snapshot Experiment Comparison
              </h1>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Compare cross-paradigm metrics, parameter drift, and config diffs across multiple saved workspace snapshots simultaneously.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <label className="text-xs text-slate-600 font-medium inline-flex items-center gap-2">
              <span>Baseline:</span>
              <select
                aria-label="Select reference baseline snapshot"
                value={report.baselineId}
                onChange={(e) => setBaselineId(e.target.value)}
                className="px-2.5 py-1.5 text-xs font-medium bg-white border border-slate-200 rounded-md text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 max-w-[240px]"
              >
                {selectedRecords.map((rec) => (
                  <option key={rec.workspaceId} value={rec.workspaceId}>
                    {rec.name}
                  </option>
                ))}
              </select>
            </label>

            <button
              type="button"
              onClick={onOpenWorkspaces}
              className="px-3.5 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-md hover:bg-blue-100 transition-colors inline-flex items-center gap-1.5"
            >
              <Bookmark className="w-3.5 h-3.5" />
              <span>Capture / Manage Snapshots</span>
            </button>
          </div>
        </div>

        {/* Cloud / Local Notice if no saved snapshots yet */}
        {savedSnapshots.length === 0 && !loadingCloud && (
          <div className="rounded-md border border-blue-200 bg-blue-50/70 px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="text-slate-700">
              {user
                ? 'No saved Firestore snapshots found yet. Capture a timestamped snapshot in Workspaces to compare multiple runs side by side.'
                : 'No saved snapshots found yet. Capture snapshots locally or sign in with Google to compare your saved Firestore experiment runs.'}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {!user && (
                <button
                  type="button"
                  onClick={signInWithGoogle}
                  disabled={isSigningIn}
                  className="px-3 py-1.5 text-xs font-medium text-white bg-slate-900 rounded-md hover:bg-slate-800 inline-flex items-center gap-1.5"
                >
                  <LogIn className="w-3.5 h-3.5" />
                  <span>{isSigningIn ? 'Signing in...' : 'Sign in with Google'}</span>
                </button>
              )}
              <button
                type="button"
                onClick={onOpenWorkspaces}
                className="px-3 py-1.5 text-xs font-medium text-blue-700 bg-white border border-blue-200 rounded-md hover:bg-blue-50"
              >
                Create Snapshot Now
              </button>
            </div>
          </div>
        )}

        {/* Snapshot Multi-Selector Strip */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>
              Select up to 6 states to compare simultaneously ({selectedIds.length} active)
            </span>
            <span className="font-mono text-[11px]">
              {isCloudReady ? 'Source: Firestore Workspaces' : 'Source: Local Browser Snapshots'}
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {allPoolRecords.map((rec) => {
              const isSelected = selectedIds.includes(rec.workspaceId);
              const isBaseline = report.baselineId === rec.workspaceId;
              return (
                <button
                  key={rec.workspaceId}
                  type="button"
                  onClick={() => toggleSelectSnapshot(rec.workspaceId)}
                  className={`px-3 py-1.5 text-xs rounded-md border transition-colors inline-flex items-center gap-2 ${
                    isSelected
                      ? isBaseline
                        ? 'bg-slate-900 text-white border-slate-900'
                        : 'bg-blue-50 text-blue-900 border-blue-300 font-medium'
                      : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <span
                    className={`w-3.5 h-3.5 rounded-xs border flex items-center justify-center ${
                      isSelected
                        ? isBaseline
                          ? 'bg-white text-slate-900 border-white'
                          : 'bg-blue-700 text-white border-blue-700'
                        : 'border-slate-300'
                    }`}
                  >
                    {isSelected && <Check className="w-2.5 h-2.5" />}
                  </span>
                  <span className="truncate max-w-[200px]">{rec.name}</span>
                  {isBaseline && (
                    <span className="text-[10px] font-mono text-slate-300">BASELINE</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Summary KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-1">
          <div className="bg-slate-50/70 border border-slate-200 rounded-md p-3.5">
            <div className="text-xs text-slate-500">Reference Baseline</div>
            <div className="text-sm font-semibold text-slate-900 truncate mt-1">
              {report.baselineName}
            </div>
            <div className="text-[11px] font-mono text-slate-500 mt-0.5 tabular-nums">
              Comparing {report.snapshots.length} snapshot{report.snapshots.length === 1 ? '' : 's'}
            </div>
          </div>

          <div className="bg-emerald-50/60 border border-emerald-200 rounded-md p-3.5">
            <div className="flex items-center justify-between text-xs text-emerald-800">
              <span>Largest Improvement</span>
              <TrendingUp className="w-3.5 h-3.5 text-emerald-700" />
            </div>
            {report.topImprovement ? (
              <>
                <div className="text-base font-bold font-mono tabular-nums text-emerald-800 mt-1">
                  {report.topImprovement.deltaText} {report.topImprovement.metricLabel}
                </div>
                <div className="text-[11px] text-emerald-700 truncate mt-0.5">
                  in {report.topImprovement.snapshotName}
                </div>
              </>
            ) : (
              <div className="text-xs text-slate-500 mt-1.5">
                No metric improvement detected vs baseline yet.
              </div>
            )}
          </div>

          <div className="bg-rose-50/60 border border-rose-200 rounded-md p-3.5">
            <div className="flex items-center justify-between text-xs text-rose-800">
              <span>Largest Drift / Regression</span>
              <AlertTriangle className="w-3.5 h-3.5 text-rose-700" />
            </div>
            {report.topDrift ? (
              <>
                <div className="text-base font-bold font-mono tabular-nums text-rose-800 mt-1">
                  {report.topDrift.deltaText} {report.topDrift.metricLabel}
                </div>
                <div className="text-[11px] text-rose-700 truncate mt-0.5">
                  in {report.topDrift.snapshotName}
                </div>
              </>
            ) : (
              <div className="text-xs text-slate-500 mt-1.5">
                No negative metric drift detected vs baseline.
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Visual Multi-Snapshot Chart */}
      <section className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              Cross-Snapshot Metric Chart
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Side-by-side comparison across selected snapshots for key accuracy, loss, drift, and economic value metrics.
            </p>
          </div>

          <div className="inline-flex rounded-md border border-slate-200 bg-slate-50 p-0.5">
            {(
              [
                { id: 'r2', label: 'Fit (R²)' },
                { id: 'loss', label: 'Seq Loss' },
                { id: 'risk', label: 'KL & OOD Risk' },
                { id: 'value', label: 'LTV & Return' },
              ] as { id: ChartMetricGroup; label: string }[]
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setChartGroup(tab.id)}
                className={`px-2.5 py-1 text-xs font-medium rounded transition-colors ${
                  chartGroup === tab.id
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <div className="h-[260px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#475569' }} />
              <YAxis tick={{ fontSize: 11, fill: '#475569' }} />
              <Tooltip
                contentStyle={{
                  fontSize: '12px',
                  borderRadius: '6px',
                  borderColor: '#cbd5e1',
                }}
              />
              <Legend wrapperStyle={{ fontSize: '12px' }} />
              {chartGroup === 'r2' && (
                <>
                  <Bar dataKey="regRSquared" name="Regression R²" fill="#1d4ed8" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="seqHoldoutR2" name="Transformer Holdout R²" fill="#059669" radius={[3, 3, 0, 0]} />
                </>
              )}
              {chartGroup === 'loss' && (
                <>
                  <Bar dataKey="valLoss" name="Validation Loss" fill="#dc2626" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="trainLoss" name="Train Loss" fill="#64748b" radius={[3, 3, 0, 0]} />
                </>
              )}
              {chartGroup === 'risk' && (
                <>
                  <Bar dataKey="maxKlDivergence" name="Max KL Drift (nats)" fill="#d97706" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="mdpOodRatePct" name="MDP OOD Rate (%)" fill="#be123c" radius={[3, 3, 0, 0]} />
                </>
              )}
              {chartGroup === 'value' && (
                <>
                  <Bar dataKey="meanProjectedLtv" name="Mean Projected LTV ($)" fill="#1d4ed8" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="mdpInitialReturn" name="MDP Initial Return" fill="#0d9488" radius={[3, 3, 0, 0]} />
                </>
              )}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      {/* Multi-Snapshot Metric Comparison Table */}
      <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              Simultaneous Metric &amp; Drift Matrix
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Deltas are computed relative to <strong className="text-slate-800">{report.baselineName}</strong> (green = improvement, rose = drift/degradation).
            </p>
          </div>
          {revertedId && (
            <span className="text-xs font-medium text-emerald-700 inline-flex items-center gap-1">
              <Check className="w-3.5 h-3.5" />
              Configuration reverted
            </span>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-xs text-slate-700">
                <th className="py-3 px-4 font-semibold min-w-[200px]">Metric</th>
                {report.snapshots.map((snap) => {
                  const isBase = snap.workspaceId === report.baselineId;
                  return (
                    <th key={snap.workspaceId} className="py-3 px-4 min-w-[185px] align-top">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="font-semibold text-slate-900 truncate max-w-[155px]">
                            {snap.name}
                          </div>
                          <div className="text-[10px] font-mono text-slate-500 mt-0.5 flex items-center gap-1">
                            <Clock className="w-2.5 h-2.5 shrink-0" />
                            <span className="truncate">{snap.timestampLabel}</span>
                          </div>
                          <div className="text-[10px] font-mono text-slate-400 mt-0.5">
                            {isBase ? 'BASELINE' : snap.isLiveActive ? 'LIVE ACTIVE' : snap.datasetName}
                          </div>
                        </div>
                        {!snap.isLiveActive && (
                          <button
                            type="button"
                            onClick={() => handleRevertToSnapshot(snap.workspaceId)}
                            title="Revert active workspace to this snapshot"
                            className="px-2 py-1 text-[10px] font-medium text-blue-700 bg-white border border-slate-200 rounded hover:bg-blue-50 inline-flex items-center gap-1 shrink-0"
                          >
                            <RotateCcw className="w-2.5 h-2.5" />
                            <span>Revert</span>
                          </button>
                        )}
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-xs">
              {groupedMetricDefs.map((grp) => (
                <React.Fragment key={grp.group}>
                  <tr className="bg-slate-50/70">
                    <td
                      colSpan={1 + report.snapshots.length}
                      className="py-1.5 px-4 text-[11px] font-semibold text-slate-600 uppercase tracking-wider"
                    >
                      {grp.group}
                    </td>
                  </tr>
                  {grp.defs.map((def: SnapshotComparisonMetricDef) => (
                    <tr key={def.key} className="bg-white hover:bg-slate-50/60">
                      <td className="py-2.5 px-4 font-medium text-slate-800">
                        {def.label}
                      </td>
                      {report.snapshots.map((snap) => {
                        const val = snap.metrics[def.key as SnapshotComparisonMetricKey];
                        const deltaInfo = snap.deltasFromBaseline[def.key];
                        const deltaStr = formatDeltaBadge(deltaInfo, def.unit);
                        const isBase = snap.workspaceId === report.baselineId;

                        return (
                          <td
                            key={`${snap.workspaceId}-${def.key}`}
                            className={`py-2.5 px-4 font-mono tabular-nums ${
                              isBase ? 'bg-slate-50/50' : ''
                            }`}
                          >
                            <div className="flex items-baseline justify-between gap-2">
                              <span className="font-semibold text-slate-900">
                                {formatMetricValue(val, def.unit)}
                              </span>
                              {!isBase && deltaStr && (
                                <span
                                  className={`text-[11px] font-semibold ${
                                    deltaInfo.polarity === 'improvement'
                                      ? 'text-emerald-700'
                                      : deltaInfo.polarity === 'drift'
                                      ? 'text-rose-700'
                                      : 'text-slate-400'
                                  }`}
                                >
                                  {deltaStr}
                                </span>
                              )}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Configuration Parameter Diff Matrix */}
      <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200">
          <h2 className="text-sm font-semibold text-slate-900">
            Configuration Diff Across Snapshots
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Parameter differences highlighted against the baseline snapshot to trace metric changes back to curation settings.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-600">
                <th className="py-2.5 px-4">Parameter</th>
                {report.snapshots.map((snap) => (
                  <th key={snap.workspaceId} className="py-2.5 px-4 truncate max-w-[180px]">
                    {snap.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-xs font-mono tabular-nums">
              {(
                [
                  {
                    label: 'Splits (Train/Val/Test)',
                    get: (s: typeof report.snapshots[number]) =>
                      `${Math.round(s.globalConfig.trainRatio * 100)}/${Math.round(
                        s.globalConfig.valRatio * 100
                      )}/${Math.round(s.globalConfig.testRatio * 100)}`,
                  },
                  {
                    label: 'Obs Cutoff / Horizon',
                    get: (s: typeof report.snapshots[number]) =>
                      `T=${s.regConfig.obsCutoffDay}d / H=${s.regConfig.horizonDays}d`,
                  },
                  {
                    label: 'Winsorize & Reg Scaling',
                    get: (s: typeof report.snapshots[number]) =>
                      `P${s.regConfig.winsorizePercentile} · ${s.regConfig.featureNormalization}`,
                  },
                  {
                    label: 'Sequence Shape & Trunc',
                    get: (s: typeof report.snapshots[number]) =>
                      `L=${s.seqConfig.maxSeqLen} (${s.seqConfig.padding}/${s.seqConfig.truncation})`,
                  },
                  {
                    label: 'Transformer Arch',
                    get: (s: typeof report.snapshots[number]) =>
                      `${s.seqConfig.transformerArch ?? 'transformer_encoder'} · d=${s.seqConfig.dModel ?? 128}`,
                  },
                  {
                    label: 'MDP Gamma & Reward',
                    get: (s: typeof report.snapshots[number]) =>
                      `γ=${s.mdpConfig.gamma} · ${s.mdpConfig.rewardScale}`,
                  },
                ] as const
              ).map((row) => {
                const baselineSnap = report.snapshots.find(
                  (s) => s.workspaceId === report.baselineId
                );
                const baseText = baselineSnap ? row.get(baselineSnap) : '';
                return (
                  <tr key={row.label} className="bg-white">
                    <td className="py-2 px-4 font-sans font-medium text-slate-700">
                      {row.label}
                    </td>
                    {report.snapshots.map((snap) => {
                      const val = row.get(snap);
                      const isDiff =
                        snap.workspaceId !== report.baselineId && val !== baseText;
                      return (
                        <td
                          key={`${snap.workspaceId}-${row.label}`}
                          className={`py-2 px-4 ${
                            isDiff
                              ? 'text-amber-800 bg-amber-50/70 font-semibold'
                              : 'text-slate-700'
                          }`}
                        >
                          {val}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
