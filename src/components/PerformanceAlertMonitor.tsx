import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Bell,
  BellRing,
  BookmarkCheck,
  CheckCircle2,
  FolderOpen,
  LogIn,
  Pin,
  ShieldAlert,
  TrendingDown,
  TrendingUp,
  X,
} from 'lucide-react';
import {
  collection,
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
import { DATASET_PRESETS } from '../data/presets';
import {
  evaluatePerformanceAlerts,
  reconstructWorkspaceBaseline,
} from '../engine/curationEngine';
import {
  GlobalCurationConfig,
  MdpConfig,
  MdpResult,
  PerformanceBaselineMode,
  PerformanceDeviationAlert,
  RawEvent,
  RegressionConfig,
  RegressionResult,
  SequenceConfig,
  SequenceResult,
  WorkspaceBaselineSnapshot,
  WorkspaceTab,
} from '../types/curation';
import type { SavedWorkspaceRecord } from './WorkspacesModal';

interface PerformanceAlertMonitorProps {
  activePresetId: string;
  customDatasetName: string | null;
  datasetName: string;
  events: RawEvent[];
  globalConfig: GlobalCurationConfig;
  regConfig: RegressionConfig;
  seqConfig: SequenceConfig;
  mdpConfig: MdpConfig;
  regResult: RegressionResult;
  seqResult: SequenceResult;
  mdpResult: MdpResult;
  onNavigateTab: (tab: WorkspaceTab) => void;
  onOpenWorkspaces: () => void;
}

interface DispatchedNotification {
  notifId: string;
  timestamp: string;
  severity: 'warning' | 'critical';
  title: string;
  detail: string;
  baselineLabel: string;
  targetTab: 'regression' | 'sequence';
  acknowledged: boolean;
}

function makeSafeId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${Date.now().toString(36)}-${rand}`.replace(
    /[^a-zA-Z0-9_-]/g,
    ''
  );
}

export const PerformanceAlertMonitor: React.FC<PerformanceAlertMonitorProps> = ({
  activePresetId,
  customDatasetName,
  datasetName,
  events,
  globalConfig,
  regConfig,
  seqConfig,
  mdpConfig,
  regResult,
  seqResult,
  mdpResult,
  onNavigateTab,
  onOpenWorkspaces,
}) => {
  const { user, authReady, profileSynced, signInWithGoogle, isSigningIn } =
    useAuth();

  const [savedWorkspaces, setSavedWorkspaces] = useState<SavedWorkspaceRecord[]>(
    []
  );
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [localBaselines, setLocalBaselines] = useState<
    WorkspaceBaselineSnapshot[]
  >([]);
  const [baselineMode, setBaselineMode] =
    useState<PerformanceBaselineMode>('latest_matching');
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(
    null
  );
  const [rSquaredThreshold, setRSquaredThreshold] = useState<number>(0.05);
  const [lossIncreasePctThreshold, setLossIncreasePctThreshold] =
    useState<number>(15);
  const [isSavingBaseline, setIsSavingBaseline] = useState(false);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [desktopNotifications, setDesktopNotifications] = useState(false);
  const [notifications, setNotifications] = useState<DispatchedNotification[]>(
    []
  );
  const [activeToast, setActiveToast] = useState<DispatchedNotification | null>(
    null
  );

  const lastEmittedSignatureRef = useRef<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current !== null) {
        window.clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!authReady || !user || !profileSynced) {
      setSavedWorkspaces([]);
      setLoadingRuns(false);
      return;
    }

    setLoadingRuns(true);
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
        setSavedWorkspaces(list);
        setLoadingRuns(false);
      },
      (err) => {
        setLoadingRuns(false);
        handleFirestoreError(err, OperationType.LIST, colPath);
      }
    );

    return () => unsubscribe();
  }, [authReady, user, profileSynced]);

  const currentMetrics = useMemo(() => {
    const seqR2 =
      seqResult.transformerEval.holdoutMetrics.rSquared ??
      seqResult.transformerEval.allMetrics.rSquared ??
      null;
    const valLoss =
      seqResult.transformerEval.lossCurve.bestValLoss ??
      seqResult.transformerEval.lossCurve.finalValLoss ??
      null;
    return {
      regRSquared: regResult.linearFit.rSquared,
      seqRSquared: seqR2,
      valLoss,
      trainLoss: seqResult.transformerEval.lossCurve.finalTrainLoss,
    };
  }, [regResult.linearFit.rSquared, seqResult]);

  const targetPresetKey = customDatasetName ? 'custom_csv' : activePresetId;

  const firestoreBaselines = useMemo<WorkspaceBaselineSnapshot[]>(() => {
    const matching = savedWorkspaces.filter((ws) => {
      if (customDatasetName) {
        return ws.presetId === 'custom_csv' && ws.datasetName === datasetName;
      }
      return ws.presetId === targetPresetKey || ws.datasetName === datasetName;
    });

    return matching.map((ws) => {
      const presetEvents =
        ws.presetId === targetPresetKey
          ? events
          : (DATASET_PRESETS.find((p) => p.id === ws.presetId)?.events ?? events);
      const updatedDate = ws.updatedAt?.toDate?.();
      const updatedAtLabel = updatedDate
        ? updatedDate.toLocaleDateString()
        : 'Saved';

      return reconstructWorkspaceBaseline({
        workspaceId: ws.workspaceId,
        name: ws.name,
        presetId: ws.presetId,
        datasetName: ws.datasetName,
        updatedAtLabel,
        events: presetEvents,
        globalConfig: ws.globalConfig,
        regConfig: ws.regConfig,
        seqConfig: ws.seqConfig,
        summaryStats: ws.summaryStats,
      });
    });
  }, [
    savedWorkspaces,
    customDatasetName,
    targetPresetKey,
    datasetName,
    events,
  ]);

  const activeBaselines = useMemo(() => {
    const localForDataset = localBaselines.filter(
      (b) => b.presetId === targetPresetKey && b.datasetName === datasetName
    );
    return [...firestoreBaselines, ...localForDataset];
  }, [firestoreBaselines, localBaselines, targetPresetKey, datasetName]);

  const alertReport = useMemo(() => {
    return evaluatePerformanceAlerts({
      currentMetrics,
      baselines: activeBaselines,
      baselineMode,
      selectedWorkspaceId,
      rSquaredThreshold,
      lossIncreasePctThreshold,
    });
  }, [
    currentMetrics,
    activeBaselines,
    baselineMode,
    selectedWorkspaceId,
    rSquaredThreshold,
    lossIncreasePctThreshold,
  ]);

  // Automatically dispatch a live notification whenever alerts fire for a new signature
  useEffect(() => {
    if (
      alertReport.status !== 'warning' &&
      alertReport.status !== 'critical'
    ) {
      return;
    }
    if (alertReport.alerts.length === 0) return;

    const signature = [
      alertReport.baselineLabel,
      alertReport.rSquaredThreshold,
      alertReport.lossIncreasePctThreshold,
      ...alertReport.alerts.map(
        (a) => `${a.id}:${a.currentValue.toFixed(3)}:${a.baselineValue.toFixed(3)}`
      ),
    ].join('|');

    if (lastEmittedSignatureRef.current === signature) return;
    lastEmittedSignatureRef.current = signature;

    const topAlert: PerformanceDeviationAlert =
      alertReport.alerts.find((a) => a.severity === 'critical') ??
      alertReport.alerts[0];

    const newNotif: DispatchedNotification = {
      notifId: makeSafeId('perf-alert'),
      timestamp: new Date().toLocaleTimeString(),
      severity: alertReport.status,
      title:
        alertReport.alerts.length > 1
          ? `${alertReport.alerts.length} Model Performance Deviations Detected`
          : `Performance Alert: ${topAlert.metricLabel}`,
      detail: topAlert.message,
      baselineLabel: alertReport.baselineLabel,
      targetTab: topAlert.targetTab,
      acknowledged: false,
    };

    setNotifications((prev) => [newNotif, ...prev].slice(0, 12));
    setActiveToast(newNotif);

    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => {
      setActiveToast(null);
      toastTimerRef.current = null;
    }, 8000);

    if (
      desktopNotifications &&
      typeof window !== 'undefined' &&
      'Notification' in window &&
      Notification.permission === 'granted'
    ) {
      try {
        new Notification(newNotif.title, {
          body: `${newNotif.detail} (Baseline: ${newNotif.baselineLabel})`,
        });
      } catch {
        // Ignore browser notification sandbox errors
      }
    }
  }, [alertReport, desktopNotifications]);

  const handleToggleDesktopAlerts = async () => {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    if (desktopNotifications) {
      setDesktopNotifications(false);
      return;
    }
    if (Notification.permission === 'granted') {
      setDesktopNotifications(true);
      return;
    }
    if (Notification.permission !== 'denied') {
      const perm = await Notification.requestPermission();
      if (perm === 'granted') {
        setDesktopNotifications(true);
      }
    }
  };

  const handleSaveCurrentBaseline = async () => {
    if (!user || !profileSynced) {
      // Fallback: pin a local session baseline if not signed in
      const localId = makeSafeId('session-base');
      const localSnap: WorkspaceBaselineSnapshot = {
        workspaceId: localId,
        name: `Session Baseline (${new Date().toLocaleTimeString()})`,
        presetId: targetPresetKey,
        datasetName,
        updatedAtLabel: 'This session',
        regRSquared: Math.round(currentMetrics.regRSquared * 10000) / 10000,
        seqRSquared:
          currentMetrics.seqRSquared !== null
            ? Math.round(currentMetrics.seqRSquared * 10000) / 10000
            : null,
        valLoss:
          currentMetrics.valLoss !== null
            ? Math.round(currentMetrics.valLoss * 10000) / 10000
            : null,
        trainLoss: Math.round(currentMetrics.trainLoss * 10000) / 10000,
        regRmse: Math.round(regResult.linearFit.rmse * 100) / 100,
        isReconstructed: false,
      };
      setLocalBaselines((prev) => [localSnap, ...prev]);
      setSaveNotice('Session baseline pinned locally.');
      window.setTimeout(() => setSaveNotice(null), 3500);
      return;
    }

    const workspaceId = makeSafeId('ws');
    const docPath = `users/${user.uid}/workspaces/${workspaceId}`;
    const snapName = `${datasetName.slice(0, 48)} Baseline (${new Date().toLocaleTimeString()})`;

    setIsSavingBaseline(true);
    setSaveNotice(null);
    try {
      await setDoc(doc(db, 'users', user.uid, 'workspaces', workspaceId), {
        workspaceId,
        ownerId: user.uid,
        name: snapName.slice(0, 120),
        presetId: targetPresetKey.slice(0, 64),
        datasetName: datasetName.slice(0, 120),
        notes: `Automated baseline snapshot (OLS R²=${currentMetrics.regRSquared.toFixed(3)}, ValLoss=${currentMetrics.valLoss?.toFixed(4) ?? 'N/A'}).`,
        globalConfig,
        regConfig,
        seqConfig,
        mdpConfig,
        summaryStats: {
          regRows: regResult.rows.length,
          tensorShape: seqResult.tensorShape,
          transitions: mdpResult.transitions.length,
          highCollinearityCount:
            regResult.featureMatrix.highCollinearityPairs.length,
          regRSquared: Math.round(currentMetrics.regRSquared * 10000) / 10000,
          seqRSquared:
            currentMetrics.seqRSquared !== null
              ? Math.round(currentMetrics.seqRSquared * 10000) / 10000
              : null,
          valLoss:
            currentMetrics.valLoss !== null
              ? Math.round(currentMetrics.valLoss * 10000) / 10000
              : null,
          trainLoss: Math.round(currentMetrics.trainLoss * 10000) / 10000,
          regRmse: Math.round(regResult.linearFit.rmse * 100) / 100,
        },
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setSaveNotice('Baseline saved to Firestore workspaces.');
      window.setTimeout(() => setSaveNotice(null), 3500);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, docPath);
    } finally {
      setIsSavingBaseline(false);
    }
  };

  const unacknowledgedCount = notifications.filter(
    (n) => !n.acknowledged
  ).length;

  return (
    <>
      <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        {/* Header Bar */}
        <div className="px-6 py-4 border-b border-slate-200 flex flex-col xl:flex-row xl:items-center xl:justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              {alertReport.status === 'critical' ? (
                <ShieldAlert className="w-4 h-4 text-red-700 shrink-0" />
              ) : alertReport.status === 'warning' ? (
                <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
              ) : alertReport.status === 'nominal' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
              ) : (
                <Bell className="w-4 h-4 text-slate-600 shrink-0" />
              )}
              <h2 className="text-sm font-semibold text-slate-900">
                Automated Performance Alert Monitor (R² &amp; Loss Drift vs.
                Saved Baselines)
              </h2>
            </div>
            <p className="text-xs text-slate-500 mt-0.5 font-mono tabular-nums">
              {user
                ? `${firestoreBaselines.length} saved Firestore run${firestoreBaselines.length === 1 ? '' : 's'} for ${datasetName}`
                : `Not signed in · ${localBaselines.length} session baseline${localBaselines.length === 1 ? '' : 's'}`}
              {alertReport.matchingRunCount > 0 &&
                ` · Baseline: ${alertReport.baselineLabel}`}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Baseline Mode */}
            <div
              className="inline-flex rounded-md border border-slate-200 bg-slate-50 p-0.5"
              role="group"
              aria-label="Baseline aggregation mode"
            >
              {(
                [
                  { id: 'latest_matching', label: 'Latest Run' },
                  { id: 'mean_matching', label: 'Mean Baseline' },
                  { id: 'selected_run', label: 'Select Run' },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setBaselineMode(opt.id)}
                  className={`px-2.5 py-1 text-[11px] font-medium rounded transition-colors ${
                    baselineMode === opt.id
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {baselineMode === 'selected_run' && activeBaselines.length > 0 && (
              <select
                aria-label="Select baseline workspace run"
                value={selectedWorkspaceId ?? activeBaselines[0]?.workspaceId}
                onChange={(e) => setSelectedWorkspaceId(e.target.value)}
                className="px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-md text-slate-800 max-w-[200px]"
              >
                {activeBaselines.map((run) => (
                  <option key={run.workspaceId} value={run.workspaceId}>
                    {run.name}
                  </option>
                ))}
              </select>
            )}

            {/* R2 Threshold */}
            <label className="inline-flex items-center gap-1.5 text-[11px] text-slate-600 border border-slate-200 rounded-md px-2 py-1 bg-slate-50">
              <span>ΔR² Alert:</span>
              <select
                aria-label="R-squared drop threshold"
                value={rSquaredThreshold}
                onChange={(e) => setRSquaredThreshold(Number(e.target.value))}
                className="font-mono bg-transparent text-slate-900 font-semibold focus:outline-none"
              >
                <option value={0.03}>-0.03</option>
                <option value={0.05}>-0.05</option>
                <option value={0.1}>-0.10</option>
              </select>
            </label>

            {/* Loss Spike Threshold */}
            <label className="inline-flex items-center gap-1.5 text-[11px] text-slate-600 border border-slate-200 rounded-md px-2 py-1 bg-slate-50">
              <span>Loss Alert:</span>
              <select
                aria-label="Loss spike percentage threshold"
                value={lossIncreasePctThreshold}
                onChange={(e) =>
                  setLossIncreasePctThreshold(Number(e.target.value))
                }
                className="font-mono bg-transparent text-slate-900 font-semibold focus:outline-none"
              >
                <option value={10}>+10%</option>
                <option value={15}>+15%</option>
                <option value={25}>+25%</option>
              </select>
            </label>

            {/* Desktop Notification Opt-In */}
            <button
              type="button"
              onClick={handleToggleDesktopAlerts}
              aria-pressed={desktopNotifications}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md border transition-colors ${
                desktopNotifications
                  ? 'bg-blue-50 text-blue-800 border-blue-300'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
              }`}
              title="Enable browser desktop notifications when R² or Loss deviates"
            >
              <BellRing className="w-3.5 h-3.5" />
              <span>{desktopNotifications ? 'Desktop On' : 'Desktop Off'}</span>
            </button>

            <button
              type="button"
              disabled={isSavingBaseline}
              onClick={handleSaveCurrentBaseline}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-blue-700 rounded-md hover:bg-blue-800 disabled:opacity-60 transition-colors"
            >
              {user && profileSynced ? (
                <>
                  <BookmarkCheck className="w-3.5 h-3.5" />
                  <span>
                    {isSavingBaseline ? 'Saving...' : 'Save as Baseline'}
                  </span>
                </>
              ) : (
                <>
                  <Pin className="w-3.5 h-3.5" />
                  <span>Pin Session Baseline</span>
                </>
              )}
            </button>
          </div>
        </div>

        <div className="p-6 space-y-5">
          {saveNotice && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-md px-3.5 py-2 text-xs text-emerald-900 font-medium">
              {saveNotice}
            </div>
          )}

          {/* Unauthenticated / No Saved Runs Guidance */}
          {alertReport.status === 'no_baseline' && (
            <div className="bg-slate-50 border border-slate-200 rounded-md p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div className="space-y-1">
                <div className="text-xs font-semibold text-slate-900">
                  {loadingRuns
                    ? 'Loading saved workspace runs from Firestore...'
                    : user
                      ? `No saved workspace baseline found for "${datasetName}" yet`
                      : 'Connect your saved Firestore workspace runs to enable persistent baseline alerts'}
                </div>
                <p className="text-xs text-slate-600">
                  {user
                    ? 'Save the current configuration as a baseline run (or open Saved Snapshots) so Stratum automatically alerts you whenever R² drops or Loss spikes.'
                    : 'Sign in with Google to monitor deviations against your saved Firestore snapshots across sessions, or pin a temporary session baseline now.'}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                {!user && (
                  <button
                    type="button"
                    onClick={signInWithGoogle}
                    disabled={isSigningIn}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-slate-900 rounded-md hover:bg-slate-800 disabled:opacity-60"
                  >
                    <LogIn className="w-3.5 h-3.5" />
                    <span>
                      {isSigningIn ? 'Signing in...' : 'Sign in with Google'}
                    </span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={onOpenWorkspaces}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-100"
                >
                  <FolderOpen className="w-3.5 h-3.5" />
                  <span>Open Saved Snapshots</span>
                </button>
              </div>
            </div>
          )}

          {/* Active Alert Banner when Deviations Triggered */}
          {(alertReport.status === 'warning' ||
            alertReport.status === 'critical') && (
            <div
              role="alert"
              className={`rounded-md border p-4 space-y-2.5 ${
                alertReport.status === 'critical'
                  ? 'bg-red-50 border-red-200'
                  : 'bg-amber-50 border-amber-200'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  {alertReport.status === 'critical' ? (
                    <ShieldAlert className="w-4 h-4 text-red-700 shrink-0" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
                  )}
                  <span
                    className={`text-xs font-semibold ${
                      alertReport.status === 'critical'
                        ? 'text-red-950'
                        : 'text-amber-950'
                    }`}
                  >
                    {alertReport.alertCount} Automated Performance Alert
                    {alertReport.alertCount === 1 ? '' : 's'} Triggered vs.{' '}
                    {alertReport.baselineLabel}
                  </span>
                </div>
                <span
                  className={`text-[11px] font-mono uppercase font-semibold ${
                    alertReport.status === 'critical'
                      ? 'text-red-800'
                      : 'text-amber-800'
                  }`}
                >
                  {alertReport.status}
                </span>
              </div>

              <div className="space-y-1.5">
                {alertReport.alerts.map((al) => (
                  <div
                    key={al.id}
                    className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 bg-white/80 border border-slate-200/80 rounded px-3 py-2 text-xs"
                  >
                    <div className="text-slate-800">{al.message}</div>
                    <button
                      type="button"
                      onClick={() => onNavigateTab(al.targetTab)}
                      className="inline-flex items-center gap-1 text-blue-700 font-medium hover:underline shrink-0"
                    >
                      <span>
                        Inspect{' '}
                        {al.targetTab === 'regression'
                          ? 'Regression'
                          : 'Sequence'}
                      </span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Metric Comparison Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
            {alertReport.comparisons.map((comp) => {
              const isLoss = comp.unit === 'loss';
              const formatVal = (v: number | null) =>
                v === null ? '—' : isLoss ? v.toFixed(4) : v.toFixed(3);

              const borderClass =
                comp.status === 'critical'
                  ? 'border-red-300 bg-red-50/40'
                  : comp.status === 'warning'
                    ? 'border-amber-300 bg-amber-50/40'
                    : comp.status === 'improved'
                      ? 'border-emerald-200 bg-emerald-50/30'
                      : 'border-slate-200 bg-slate-50/50';

              const statusColor =
                comp.status === 'critical'
                  ? 'text-red-700'
                  : comp.status === 'warning'
                    ? 'text-amber-700'
                    : comp.status === 'improved'
                      ? 'text-emerald-700'
                      : 'text-slate-600';

              return (
                <div
                  key={comp.metricKey}
                  className={`border rounded-md p-3.5 flex flex-col justify-between ${borderClass}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-medium text-slate-600">
                      {comp.metricLabel}
                    </span>
                    <span
                      className={`text-[10px] font-mono uppercase font-semibold ${statusColor}`}
                    >
                      {comp.status === 'unavailable' ? 'no base' : comp.status}
                    </span>
                  </div>

                  <div className="mt-2 flex items-baseline justify-between gap-2 font-mono tabular-nums">
                    <div>
                      <div className="text-[10px] text-slate-400">Current</div>
                      <div className="text-base font-semibold text-slate-900">
                        {formatVal(comp.currentValue)}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-[10px] text-slate-400">Baseline</div>
                      <div className="text-xs font-medium text-slate-700">
                        {formatVal(comp.baselineValue)}
                      </div>
                    </div>
                  </div>

                  <div className="mt-2 pt-2 border-t border-slate-200/70 flex items-center justify-between text-[11px] font-mono tabular-nums">
                    {comp.delta !== null ? (
                      <span className={`inline-flex items-center gap-1 ${statusColor}`}>
                        {comp.delta > 0 ? (
                          <TrendingUp className="w-3 h-3" />
                        ) : comp.delta < 0 ? (
                          <TrendingDown className="w-3 h-3" />
                        ) : null}
                        {comp.pctChange !== null
                          ? `${comp.pctChange >= 0 ? '+' : ''}${comp.pctChange.toFixed(1)}%`
                          : `${comp.delta >= 0 ? '+' : ''}${comp.delta.toFixed(3)}`}
                      </span>
                    ) : (
                      <span className="text-slate-400">Awaiting baseline</span>
                    )}

                    <button
                      type="button"
                      onClick={() => onNavigateTab(comp.targetTab)}
                      className="text-blue-700 hover:underline font-sans font-medium"
                    >
                      View
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Dispatched Notifications Feed */}
          {notifications.length > 0 && (
            <div className="border border-slate-200 rounded-md overflow-hidden">
              <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-semibold text-slate-800">
                  <BellRing className="w-3.5 h-3.5 text-slate-600" />
                  <span>
                    Automated Alert Notifications ({notifications.length} logged ·{' '}
                    {unacknowledgedCount} unread)
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setNotifications((prev) =>
                      prev.map((n) => ({ ...n, acknowledged: true }))
                    )
                  }
                  className="text-[11px] font-medium text-blue-700 hover:underline"
                >
                  Mark all read
                </button>
              </div>
              <div className="divide-y divide-slate-100 max-h-52 overflow-y-auto">
                {notifications.map((n) => (
                  <div
                    key={n.notifId}
                    className={`px-4 py-2.5 flex items-start justify-between gap-3 text-xs ${
                      n.acknowledged ? 'bg-white text-slate-500' : 'bg-blue-50/30'
                    }`}
                  >
                    <div className="space-y-0.5 min-w-0">
                      <div className="flex items-center gap-2">
                        <span
                          className={`font-semibold ${
                            n.severity === 'critical'
                              ? 'text-red-700'
                              : 'text-amber-700'
                          }`}
                        >
                          [{n.severity.toUpperCase()}]
                        </span>
                        <span className="font-medium text-slate-900 truncate">
                          {n.title}
                        </span>
                        <span className="font-mono text-[10px] text-slate-400 tabular-nums shrink-0">
                          {n.timestamp}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-600">{n.detail}</p>
                    </div>
                    {!n.acknowledged && (
                      <button
                        type="button"
                        onClick={() =>
                          setNotifications((prev) =>
                            prev.map((item) =>
                              item.notifId === n.notifId
                                ? { ...item, acknowledged: true }
                                : item
                            )
                          )
                        }
                        className="text-[11px] font-medium text-slate-600 hover:text-slate-900 shrink-0"
                      >
                        Acknowledge
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Live Non-Blocking Automated Notification Toast */}
      {activeToast && (
        <div
          role="status"
          aria-live="polite"
          className={`fixed bottom-5 right-5 z-50 w-full max-w-sm bg-white border rounded-lg shadow-lg p-4 ${
            activeToast.severity === 'critical'
              ? 'border-red-300'
              : 'border-amber-300'
          }`}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2.5 min-w-0">
              {activeToast.severity === 'critical' ? (
                <ShieldAlert className="w-4 h-4 text-red-700 shrink-0 mt-0.5" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
              )}
              <div className="min-w-0">
                <div className="text-xs font-semibold text-slate-900">
                  {activeToast.title}
                </div>
                <p className="text-[11px] text-slate-600 mt-1 leading-relaxed">
                  {activeToast.detail}
                </p>
                <div className="mt-2 flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      onNavigateTab(activeToast.targetTab);
                      setActiveToast(null);
                    }}
                    className="text-[11px] font-medium text-blue-700 hover:underline inline-flex items-center gap-1"
                  >
                    <span>Inspect Pipeline</span>
                    <ArrowRight className="w-3 h-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveToast(null)}
                    className="text-[11px] text-slate-500 hover:text-slate-800"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setActiveToast(null)}
              aria-label="Dismiss notification"
              className="p-0.5 text-slate-400 hover:text-slate-700 rounded"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
    </>
  );
};
