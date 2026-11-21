import React, { useEffect, useMemo, useState } from 'react';
import {
  BookmarkPlus,
  Camera,
  CheckCircle2,
  Clock,
  CopyPlus,
  LogIn,
  RotateCcw,
  Trash2,
  X,
} from 'lucide-react';
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore';
import { useAuth } from '../contexts/AuthContext';
import { OperationType, db, handleFirestoreError } from '../lib/firebase';
import {
  cloneExperimentConfigs,
  formatTimestampedSnapshotName,
  summarizeSnapshotConfigDiff,
} from '../engine/curationEngine';
import {
  GlobalCurationConfig,
  MdpConfig,
  RegressionConfig,
  SequenceConfig,
} from '../types/curation';

export interface SavedWorkspaceRecord {
  workspaceId: string;
  ownerId: string;
  name: string;
  presetId: string;
  datasetName: string;
  notes?: string;
  globalConfig: GlobalCurationConfig;
  regConfig: RegressionConfig;
  seqConfig: SequenceConfig;
  mdpConfig: MdpConfig;
  summaryStats: {
    regRows: number;
    tensorShape: [number, number, number];
    transitions: number;
    highCollinearityCount: number;
    regRSquared?: number;
    seqRSquared?: number | null;
    valLoss?: number | null;
    trainLoss?: number;
    regRmse?: number;
    versionTag?: string;
    datasetFingerprint?: string;
    eventCount?: number;
    entityCount?: number;
    appliedCurationRules?: string[];
    enabledEngineeredFeatures?: string[];
  };
  createdAt?: { toDate?: () => Date } | null;
  updatedAt?: { toDate?: () => Date } | null;
  localTimestampIso?: string;
}

interface WorkspacesModalProps {
  isOpen: boolean;
  onClose: () => void;
  activePresetId: string;
  customDatasetName: string | null;
  datasetName: string;
  globalConfig: GlobalCurationConfig;
  regConfig: RegressionConfig;
  seqConfig: SequenceConfig;
  mdpConfig: MdpConfig;
  summaryStats: {
    regRows: number;
    tensorShape: [number, number, number];
    transitions: number;
    highCollinearityCount: number;
    regRSquared?: number;
    seqRSquared?: number | null;
    valLoss?: number | null;
    trainLoss?: number;
    regRmse?: number;
    versionTag?: string;
    datasetFingerprint?: string;
    eventCount?: number;
    entityCount?: number;
    appliedCurationRules?: string[];
    enabledEngineeredFeatures?: string[];
  };
  onLoadWorkspace: (ws: SavedWorkspaceRecord) => void;
}

const LOCAL_SNAPSHOTS_KEY = 'stratum_local_experiment_snapshots_v1';

function makeSafeId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${Date.now().toString(36)}-${rand}`.replace(/[^a-zA-Z0-9_-]/g, '');
}

function sanitizeSummaryStats(
  stats: WorkspacesModalProps['summaryStats']
): WorkspacesModalProps['summaryStats'] {
  const clean: WorkspacesModalProps['summaryStats'] = {
    regRows: stats.regRows,
    tensorShape: [...stats.tensorShape] as [number, number, number],
    transitions: stats.transitions,
    highCollinearityCount: stats.highCollinearityCount,
  };
  if (stats.regRSquared !== undefined) clean.regRSquared = stats.regRSquared;
  if (stats.seqRSquared !== undefined) clean.seqRSquared = stats.seqRSquared;
  if (stats.valLoss !== undefined) clean.valLoss = stats.valLoss;
  if (stats.trainLoss !== undefined) clean.trainLoss = stats.trainLoss;
  if (stats.regRmse !== undefined) clean.regRmse = stats.regRmse;
  if (stats.versionTag !== undefined) clean.versionTag = stats.versionTag;
  if (stats.datasetFingerprint !== undefined) clean.datasetFingerprint = stats.datasetFingerprint;
  if (stats.eventCount !== undefined) clean.eventCount = stats.eventCount;
  if (stats.entityCount !== undefined) clean.entityCount = stats.entityCount;
  if (stats.appliedCurationRules !== undefined) clean.appliedCurationRules = [...stats.appliedCurationRules];
  if (stats.enabledEngineeredFeatures !== undefined) {
    clean.enabledEngineeredFeatures = [...stats.enabledEngineeredFeatures];
  }
  return clean;
}

function formatSnapshotTimestamp(
  ts: { toDate?: () => Date } | string | null | undefined
): string {
  if (!ts) return 'Just now';
  let d: Date | null = null;
  if (typeof ts === 'string') {
    const parsed = new Date(ts);
    if (!Number.isNaN(parsed.getTime())) d = parsed;
  } else if (typeof ts === 'object' && typeof ts.toDate === 'function') {
    d = ts.toDate();
  }
  if (!d) return 'Just now';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function loadLocalSnapshots(): SavedWorkspaceRecord[] {
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

function persistLocalSnapshots(list: SavedWorkspaceRecord[]) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LOCAL_SNAPSHOTS_KEY, JSON.stringify(list.slice(0, 30)));
  } catch {
    // ignore storage quota errors
  }
}

export const WorkspacesModal: React.FC<WorkspacesModalProps> = ({
  isOpen,
  onClose,
  activePresetId,
  customDatasetName,
  datasetName,
  globalConfig,
  regConfig,
  seqConfig,
  mdpConfig,
  summaryStats,
  onLoadWorkspace,
}) => {
  const { user, authReady, profileSynced, signInWithGoogle, isSigningIn } = useAuth();
  const [cloudWorkspaces, setCloudWorkspaces] = useState<SavedWorkspaceRecord[]>([]);
  const [localSnapshots, setLocalSnapshots] = useState<SavedWorkspaceRecord[]>(() =>
    loadLocalSnapshots()
  );
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [statusFeedback, setStatusFeedback] = useState<string | null>(null);
  const [nameInput, setNameInput] = useState('');
  const [notesInput, setNotesInput] = useState('');

  useEffect(() => {
    if (!isOpen) {
      setStatusFeedback(null);
      setErrorMsg(null);
      return;
    }
    setLocalSnapshots(loadLocalSnapshots());
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !authReady || !user || !profileSynced) {
      setCloudWorkspaces([]);
      return;
    }

    setLoading(true);
    setErrorMsg(null);
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
        setCloudWorkspaces(list);
        setLoading(false);
      },
      (err) => {
        setLoading(false);
        setErrorMsg('Unable to load saved Firestore snapshots.');
        handleFirestoreError(err, OperationType.LIST, colPath);
      }
    );

    return () => unsubscribe();
  }, [isOpen, authReady, user, profileSynced]);

  const currentBundle = useMemo(
    () =>
      cloneExperimentConfigs({
        globalConfig,
        regConfig,
        seqConfig,
        mdpConfig,
      }),
    [globalConfig, regConfig, seqConfig, mdpConfig]
  );

  if (!isOpen) return null;

  const isCloudReady = Boolean(user && profileSynced);
  const displayedSnapshots = isCloudReady ? cloudWorkspaces : localSnapshots;

  const buildAutoNotes = (bundle: ReturnType<typeof cloneExperimentConfigs>): string => {
    const r2Part =
      summaryStats.regRSquared !== undefined
        ? ` · R²=${summaryStats.regRSquared.toFixed(3)}`
        : '';
    return `Splits ${Math.round(bundle.globalConfig.trainRatio * 100)}/${Math.round(
      bundle.globalConfig.valRatio * 100
    )}/${Math.round(bundle.globalConfig.testRatio * 100)} · T_obs=${
      bundle.regConfig.obsCutoffDay
    }d · H=${bundle.regConfig.horizonDays}d · L=${bundle.seqConfig.maxSeqLen} · γ=${
      bundle.mdpConfig.gamma
    }${r2Part}`.slice(0, 500);
  };

  const persistSnapshotRecord = async (params: {
    name: string;
    notes?: string;
    presetId: string;
    dsName: string;
    bundle: ReturnType<typeof cloneExperimentConfigs>;
    stats: WorkspacesModalProps['summaryStats'];
  }) => {
    const cleanName = params.name.trim().slice(0, 120);
    if (!cleanName) {
      setErrorMsg('Please enter a snapshot name.');
      return;
    }
    const cleanNotes = (params.notes ?? '').trim().slice(0, 500);
    const workspaceId = makeSafeId('snap');
    const clonedConfigs = cloneExperimentConfigs(params.bundle);
    const existingCount = displayedSnapshots.filter((s) => s.datasetName === params.dsName).length;
    const computedVersionTag = params.stats.versionTag || `v1.${existingCount}.0`;
    const cleanStats = sanitizeSummaryStats({
      ...params.stats,
      versionTag: computedVersionTag,
    });

    setSaving(true);
    setErrorMsg(null);
    setStatusFeedback(null);

    if (isCloudReady && user) {
      const docPath = `users/${user.uid}/workspaces/${workspaceId}`;
      try {
        await setDoc(doc(db, 'users', user.uid, 'workspaces', workspaceId), {
          workspaceId,
          ownerId: user.uid,
          name: cleanName,
          presetId: params.presetId.slice(0, 64),
          datasetName: params.dsName.slice(0, 120),
          ...(cleanNotes ? { notes: cleanNotes } : {}),
          globalConfig: clonedConfigs.globalConfig,
          regConfig: clonedConfigs.regConfig,
          seqConfig: clonedConfigs.seqConfig,
          mdpConfig: clonedConfigs.mdpConfig,
          summaryStats: cleanStats,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        setStatusFeedback(`Created Firestore snapshot "${cleanName}"`);
      } catch (err) {
        setErrorMsg('Failed to save snapshot to Firestore.');
        handleFirestoreError(err, OperationType.CREATE, docPath);
      } finally {
        setSaving(false);
      }
      return;
    }

    // Local browser fallback when not signed in to Google
    const nowIso = new Date().toISOString();
    const localRecord: SavedWorkspaceRecord = {
      workspaceId,
      ownerId: 'local_session',
      name: cleanName,
      presetId: params.presetId.slice(0, 64),
      datasetName: params.dsName.slice(0, 120),
      ...(cleanNotes ? { notes: cleanNotes } : {}),
      globalConfig: clonedConfigs.globalConfig,
      regConfig: clonedConfigs.regConfig,
      seqConfig: clonedConfigs.seqConfig,
      mdpConfig: clonedConfigs.mdpConfig,
      summaryStats: cleanStats,
      localTimestampIso: nowIso,
    };
    const nextList = [localRecord, ...localSnapshots];
    setLocalSnapshots(nextList);
    persistLocalSnapshots(nextList);
    setSaving(false);
    setStatusFeedback(`Captured local snapshot "${cleanName}"`);
  };

  const handleQuickTimestampSnapshot = async () => {
    const autoName = formatTimestampedSnapshotName(datasetName, new Date());
    await persistSnapshotRecord({
      name: autoName,
      notes: buildAutoNotes(currentBundle),
      presetId: customDatasetName ? 'custom_csv' : activePresetId,
      dsName: datasetName,
      bundle: currentBundle,
      stats: summaryStats,
    });
  };

  const handleNamedSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const effectiveName =
      nameInput.trim() || formatTimestampedSnapshotName(datasetName, new Date());
    await persistSnapshotRecord({
      name: effectiveName,
      notes: notesInput.trim() || buildAutoNotes(currentBundle),
      presetId: customDatasetName ? 'custom_csv' : activePresetId,
      dsName: datasetName,
      bundle: currentBundle,
      stats: summaryStats,
    });
    setNameInput('');
    setNotesInput('');
  };

  const handleCloneSnapshot = async (ws: SavedWorkspaceRecord) => {
    const clonedBundle = cloneExperimentConfigs({
      globalConfig: ws.globalConfig,
      regConfig: ws.regConfig,
      seqConfig: ws.seqConfig,
      mdpConfig: ws.mdpConfig,
    });
    const tsName = formatTimestampedSnapshotName(ws.name.replace(/^Snapshot ·\s*/, ''), new Date());
    await persistSnapshotRecord({
      name: tsName,
      notes: ws.notes
        ? `Cloned from "${ws.name}": ${ws.notes}`.slice(0, 500)
        : `Cloned from "${ws.name}" · ${buildAutoNotes(clonedBundle)}`.slice(0, 500),
      presetId: ws.presetId,
      dsName: ws.datasetName,
      bundle: clonedBundle,
      stats: ws.summaryStats,
    });
  };

  const handleDelete = async (workspaceId: string) => {
    if (isCloudReady && user) {
      const docPath = `users/${user.uid}/workspaces/${workspaceId}`;
      try {
        await deleteDoc(doc(db, 'users', user.uid, 'workspaces', workspaceId));
      } catch (err) {
        setErrorMsg('Failed to delete snapshot.');
        handleFirestoreError(err, OperationType.DELETE, docPath);
      }
      return;
    }

    const nextList = localSnapshots.filter((s) => s.workspaceId !== workspaceId);
    setLocalSnapshots(nextList);
    persistLocalSnapshots(nextList);
  };

  const handleRevert = (ws: SavedWorkspaceRecord) => {
    const restoredConfigs = cloneExperimentConfigs({
      globalConfig: ws.globalConfig,
      regConfig: ws.regConfig,
      seqConfig: ws.seqConfig,
      mdpConfig: ws.mdpConfig,
    });
    onLoadWorkspace({
      ...ws,
      ...restoredConfigs,
    });
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="workspaces-modal-title"
    >
      <div className="bg-white border border-slate-200 rounded-lg w-full max-w-3xl max-h-[86vh] flex flex-col shadow-lg overflow-hidden">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-4">
          <div>
            <h2 id="workspaces-modal-title" className="text-base font-semibold text-slate-900">
              Dataset Versioning &amp; Experiment Snapshots
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Immutable semantic dataset versions (SHA fingerprint, curation rules, engineered features) &amp; pipeline checkpoints.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close snapshots dialog"
            className="p-1.5 text-slate-400 hover:text-slate-700 rounded-md"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto divide-y divide-slate-200">
          {/* Cloud Sync Banner when signed out */}
          {!user && (
            <div className="px-6 py-3 bg-blue-50/70 border-b border-blue-200/80 flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-slate-700">
                Snapshots are currently stored in this browser. Sign in with Google to sync experiment snapshots in Firestore across devices.
              </p>
              <button
                type="button"
                onClick={signInWithGoogle}
                disabled={isSigningIn}
                className="px-3 py-1.5 text-xs font-medium text-white bg-blue-700 rounded-md hover:bg-blue-800 transition-colors inline-flex items-center gap-1.5 disabled:opacity-60 shrink-0"
              >
                <LogIn className="w-3.5 h-3.5" />
                <span>{isSigningIn ? 'Signing in...' : 'Sign in for Cloud Sync'}</span>
              </button>
            </div>
          )}

          {/* One-Click Snapshot + Named Save Form */}
          <form onSubmit={handleNamedSave} className="p-6 bg-slate-50/70 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <div className="text-xs font-semibold text-slate-900">
                  Capture Active Pipeline State
                </div>
                <div className="text-[11px] font-mono text-slate-500 tabular-nums mt-0.5">
                  {datasetName} · Splits{' '}
                  {Math.round(globalConfig.trainRatio * 100)}/
                  {Math.round(globalConfig.valRatio * 100)}/
                  {Math.round(globalConfig.testRatio * 100)} · T_obs={regConfig.obsCutoffDay}d · L=
                  {seqConfig.maxSeqLen} · γ={mdpConfig.gamma}
                </div>
              </div>

              <button
                type="button"
                onClick={handleQuickTimestampSnapshot}
                disabled={saving || (Boolean(user) && !profileSynced)}
                className="px-3.5 py-2 text-xs font-semibold text-white bg-slate-900 rounded-md hover:bg-slate-800 transition-colors inline-flex items-center gap-1.5 disabled:opacity-60 shrink-0"
              >
                <Camera className="w-3.5 h-3.5" />
                <span>{saving ? 'Capturing...' : 'Create Timestamped Snapshot'}</span>
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
              <input
                type="text"
                maxLength={120}
                placeholder="Optional custom label (leave blank for auto timestamp)"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                className="sm:col-span-5 px-3 py-2 text-xs bg-white border border-slate-200 rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
              />
              <input
                type="text"
                maxLength={500}
                placeholder="Optional experiment notes (e.g., Sweep LR=0.001, winsor P99)"
                value={notesInput}
                onChange={(e) => setNotesInput(e.target.value)}
                className="sm:col-span-5 px-3 py-2 text-xs bg-white border border-slate-200 rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
              />
              <button
                type="submit"
                disabled={saving || (Boolean(user) && !profileSynced)}
                className="sm:col-span-2 px-3 py-2 text-xs font-medium text-blue-700 bg-white border border-blue-200 rounded-md hover:bg-blue-50 transition-colors inline-flex items-center justify-center gap-1.5 disabled:opacity-60"
              >
                <BookmarkPlus className="w-3.5 h-3.5" />
                <span>Save</span>
              </button>
            </div>

            {errorMsg && (
              <div className="text-xs text-red-700 font-medium">{errorMsg}</div>
            )}
            {statusFeedback && (
              <div className="text-xs text-emerald-700 font-medium inline-flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                <span>{statusFeedback}</span>
              </div>
            )}
          </form>

          {/* Saved Snapshots Timeline */}
          <div className="p-6 space-y-3">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-slate-800">
                Saved Experiment Snapshots ({displayedSnapshots.length})
              </span>
              <span className="font-mono text-[11px] text-slate-500">
                {isCloudReady ? 'Firestore Cloud Sync' : 'Local Browser Session'}
              </span>
            </div>

            {loading ? (
              <div className="py-6 text-center text-xs text-slate-500">
                Loading snapshots...
              </div>
            ) : displayedSnapshots.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-500 border border-dashed border-slate-200 rounded-md">
                No snapshots recorded yet. Click &ldquo;Create Timestamped Snapshot&rdquo; above before experimenting with parameters.
              </div>
            ) : (
              <div className="divide-y divide-slate-200 border border-slate-200 rounded-md">
                {displayedSnapshots.map((ws) => {
                  const diff = summarizeSnapshotConfigDiff(
                    {
                      globalConfig: ws.globalConfig,
                      regConfig: ws.regConfig,
                      seqConfig: ws.seqConfig,
                      mdpConfig: ws.mdpConfig,
                    },
                    currentBundle
                  );
                  const timestampStr = formatSnapshotTimestamp(
                    ws.localTimestampIso ?? ws.createdAt ?? ws.updatedAt
                  );

                  return (
                    <div
                      key={ws.workspaceId}
                      className="p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 hover:bg-slate-50/70"
                    >
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-[11px] font-semibold text-blue-700">
                            {ws.summaryStats?.versionTag ?? 'v1.0.0'}
                          </span>
                          <span className="text-slate-300" aria-hidden="true">·</span>
                          <span className="text-sm font-semibold text-slate-900 truncate max-w-[320px]">
                            {ws.name}
                          </span>
                          <span className="text-[11px] font-mono text-slate-400 inline-flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            <span>{timestampStr}</span>
                          </span>
                        </div>

                        <div className="text-xs text-slate-600 font-mono tabular-nums">
                          {ws.datasetName}
                          {ws.summaryStats?.datasetFingerprint
                            ? ` · sha:${ws.summaryStats.datasetFingerprint}`
                            : ''}
                          {ws.summaryStats?.eventCount !== undefined
                            ? ` · ${ws.summaryStats.eventCount.toLocaleString()} events`
                            : ''}
                          {ws.summaryStats?.appliedCurationRules &&
                          ws.summaryStats.appliedCurationRules.length > 0
                            ? ` · ${ws.summaryStats.appliedCurationRules.length} curation rules`
                            : ''}
                          {ws.summaryStats?.enabledEngineeredFeatures &&
                          ws.summaryStats.enabledEngineeredFeatures.length > 0
                            ? ` · +${ws.summaryStats.enabledEngineeredFeatures.length} FE cols`
                            : ''}
                          {` · Splits ${Math.round(ws.globalConfig.trainRatio * 100)}/${Math.round(
                            ws.globalConfig.valRatio * 100
                          )}/${Math.round(ws.globalConfig.testRatio * 100)} · T_obs=${
                            ws.regConfig.obsCutoffDay
                          }d`}
                          {ws.summaryStats?.regRSquared !== undefined
                            ? ` · R²=${ws.summaryStats.regRSquared.toFixed(3)}`
                            : ''}
                        </div>

                        <div className="text-[11px] font-mono">
                          {diff.isIdentical ? (
                            <span className="text-emerald-700 font-medium">
                              Matches current active configuration
                            </span>
                          ) : (
                            <span className="text-amber-700">
                              Diff vs current: {diff.changedFields.slice(0, 5).join(' · ')}
                              {diff.changedFields.length > 5
                                ? ` (+${diff.changedFields.length - 5} more)`
                                : ''}
                            </span>
                          )}
                        </div>

                        {ws.notes && (
                          <div className="text-xs text-slate-500">{ws.notes}</div>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleRevert(ws)}
                          disabled={diff.isIdentical && ws.datasetName === datasetName}
                          title="Revert global, regression, sequence, and MDP configs to this snapshot"
                          className="px-3 py-1.5 text-xs font-medium text-blue-700 bg-white border border-slate-200 rounded hover:bg-blue-50 disabled:opacity-45 disabled:hover:bg-white inline-flex items-center gap-1.5 whitespace-nowrap"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          <span>Revert</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleCloneSnapshot(ws)}
                          disabled={saving}
                          title="Clone this snapshot with a new timestamp"
                          aria-label={`Clone snapshot ${ws.name}`}
                          className="p-1.5 text-slate-500 hover:text-slate-900 rounded border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-50"
                        >
                          <CopyPlus className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(ws.workspaceId)}
                          aria-label={`Delete snapshot ${ws.name}`}
                          className="p-1.5 text-slate-400 hover:text-red-600 rounded border border-transparent hover:border-slate-200"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
