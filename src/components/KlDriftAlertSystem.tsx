import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  Bell,
  BellOff,
  BellRing,
  Check,
  CheckCircle2,
  ShieldAlert,
  Trash2,
  X,
} from 'lucide-react';
import {
  KlDriftAlertItem,
  ModelDriftReport,
  RegressionConfig,
  RegressionFeatureKey,
} from '../types/curation';
import {
  DEFAULT_KL_DRIFT_THRESHOLD,
  REGRESSION_FEATURE_CATALOG,
  evaluateKlDriftAlerts,
} from '../engine/curationEngine';

interface KlDriftAlertSystemProps {
  datasetName: string;
  config: RegressionConfig;
  driftReport: ModelDriftReport;
  onUpdateConfig: (next: RegressionConfig) => void;
}

interface DriftNotificationEntry {
  id: string;
  signature: string;
  timestamp: string;
  severity: 'warning' | 'critical';
  title: string;
  detail: string;
  klThreshold: number;
  maxKl: number;
  breachedColumns: string[];
  acknowledged: boolean;
  resolved: boolean;
}

const KL_PRESET_THRESHOLDS = [0.05, 0.1, 0.15, 0.25, 0.5];

function makeAlertId(): string {
  return `kl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export const KlDriftAlertSystem: React.FC<KlDriftAlertSystemProps> = ({
  datasetName,
  config,
  driftReport,
  onUpdateConfig,
}) => {
  const [autoNotifyEnabled, setAutoNotifyEnabled] = useState<boolean>(true);
  const [desktopAlerts, setDesktopAlerts] = useState<boolean>(false);
  const [notifications, setNotifications] = useState<DriftNotificationEntry[]>([]);
  const [activeToast, setActiveToast] = useState<DriftNotificationEntry | null>(
    null
  );
  const [showHistory, setShowHistory] = useState<boolean>(false);

  const lastSignatureRef = useRef<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  const activeThreshold =
    config.klDriftThreshold ?? DEFAULT_KL_DRIFT_THRESHOLD;

  const alertReport = useMemo(
    () => evaluateKlDriftAlerts(driftReport),
    [driftReport]
  );

  const activeFeatureKeys = useMemo<RegressionFeatureKey[]>(() => {
    const valid = REGRESSION_FEATURE_CATALOG.filter((f) =>
      config.selectedFeatures.includes(f.key)
    ).map((f) => f.key);
    return valid.length > 0
      ? valid
      : REGRESSION_FEATURE_CATALOG.map((f) => f.key);
  }, [config.selectedFeatures]);

  const canExcludeAllBreached = useMemo(() => {
    if (alertReport.alerts.length === 0) return false;
    const breachedSet = new Set(alertReport.alerts.map((a) => a.feature));
    const remaining = activeFeatureKeys.filter((k) => !breachedSet.has(k));
    return remaining.length >= 1;
  }, [alertReport.alerts, activeFeatureKeys]);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current !== null) {
        window.clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  // Automatically emit alert notifications whenever KL threshold is breached
  useEffect(() => {
    if (
      alertReport.status === 'nominal' ||
      alertReport.status === 'insufficient_data'
    ) {
      lastSignatureRef.current = null;
      setNotifications((prev) =>
        prev.some((n) => !n.resolved)
          ? prev.map((n) => (n.resolved ? n : { ...n, resolved: true }))
          : prev
      );
      return;
    }

    if (!autoNotifyEnabled || alertReport.alerts.length === 0) return;

    const signature = [
      datasetName,
      config.obsCutoffDay,
      config.featureNormalization,
      alertReport.klThreshold.toFixed(2),
      ...alertReport.alerts.map(
        (a) => `${a.feature}:${a.klDivergence.toFixed(3)}`
      ),
    ].join('|');

    if (lastSignatureRef.current === signature) return;
    lastSignatureRef.current = signature;

    const severity: 'warning' | 'critical' =
      alertReport.status === 'critical' ? 'critical' : 'warning';
    const breachedCols = alertReport.alerts.map((a) => a.csvColumn);
    const title =
      alertReport.alerts.length === 1
        ? `KL Drift Alert: ${alertReport.alerts[0].csvColumn} (${alertReport.alerts[0].klDivergence.toFixed(3)} > ${alertReport.klThreshold.toFixed(2)} nats)`
        : `KL Drift Alert: ${alertReport.alerts.length} Features Exceeded ${alertReport.klThreshold.toFixed(2)} nats`;

    const entry: DriftNotificationEntry = {
      id: makeAlertId(),
      signature,
      timestamp: new Date().toLocaleTimeString(),
      severity,
      title,
      detail: alertReport.summaryMessage,
      klThreshold: alertReport.klThreshold,
      maxKl: alertReport.maxKlDivergence,
      breachedColumns: breachedCols,
      acknowledged: false,
      resolved: false,
    };

    setNotifications((prev) => [
      entry,
      ...prev.map((n) => ({ ...n, resolved: true })).slice(0, 11),
    ]);
    setActiveToast(entry);

    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => {
      setActiveToast(null);
      toastTimerRef.current = null;
    }, 8000);

    if (
      desktopAlerts &&
      typeof window !== 'undefined' &&
      'Notification' in window &&
      Notification.permission === 'granted'
    ) {
      try {
        new Notification(entry.title, {
          body: `${entry.detail} (${datasetName})`,
        });
      } catch {
        // Ignore sandboxed browser notification restrictions
      }
    }
  }, [
    alertReport,
    autoNotifyEnabled,
    desktopAlerts,
    datasetName,
    config.obsCutoffDay,
    config.featureNormalization,
  ]);

  const handleToggleDesktopAlerts = async () => {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    if (desktopAlerts) {
      setDesktopAlerts(false);
      return;
    }
    if (Notification.permission === 'granted') {
      setDesktopAlerts(true);
      return;
    }
    if (Notification.permission !== 'denied') {
      const permission = await Notification.requestPermission();
      if (permission === 'granted') {
        setDesktopAlerts(true);
      }
    }
  };

  const handleUpdateThreshold = (nextThreshold: number) => {
    const rounded = Math.round(Math.max(0.05, Math.min(1.0, nextThreshold)) * 100) / 100;
    onUpdateConfig({ ...config, klDriftThreshold: rounded });
  };

  const handleExcludeFeature = (feature: RegressionFeatureKey) => {
    if (activeFeatureKeys.length <= 1) return;
    const next = activeFeatureKeys.filter((k) => k !== feature);
    if (next.length >= 1) {
      onUpdateConfig({ ...config, selectedFeatures: next });
    }
  };

  const handleExcludeAllBreached = () => {
    if (!canExcludeAllBreached) return;
    const breachedSet = new Set(alertReport.alerts.map((a) => a.feature));
    const next = activeFeatureKeys.filter((k) => !breachedSet.has(k));
    if (next.length >= 1) {
      onUpdateConfig({ ...config, selectedFeatures: next });
    }
  };

  const acknowledgeOne = (id: string) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, acknowledged: true } : n))
    );
  };

  const acknowledgeAll = () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, acknowledged: true })));
  };

  const clearNotifications = () => {
    setNotifications([]);
    setActiveToast(null);
  };

  const unacknowledgedCount = notifications.filter((n) => !n.acknowledged).length;

  const statusMeta =
    alertReport.status === 'critical'
      ? {
          icon: ShieldAlert,
          title: `KL Drift Threshold Breached (${alertReport.breachedCount} feature${alertReport.breachedCount === 1 ? '' : 's'})`,
          iconClass: 'text-rose-700',
          statusTextClass: 'text-rose-700',
          bannerBg: 'bg-rose-50/75 border-rose-200 text-rose-950',
        }
      : alertReport.status === 'warning'
      ? {
          icon: AlertTriangle,
          title: `KL Drift Threshold Exceeded (${alertReport.alerts[0]?.csvColumn ?? '1 feature'})`,
          iconClass: 'text-amber-700',
          statusTextClass: 'text-amber-700',
          bannerBg: 'bg-amber-50/75 border-amber-200 text-amber-950',
        }
      : alertReport.status === 'insufficient_data'
      ? {
          icon: Bell,
          title: 'Insufficient Split Sample Size for KL Check',
          iconClass: 'text-slate-500',
          statusTextClass: 'text-slate-600',
          bannerBg: 'bg-slate-50 border-slate-200 text-slate-700',
        }
      : {
          icon: CheckCircle2,
          title: 'Nominal — All Features Within KL Threshold',
          iconClass: 'text-emerald-700',
          statusTextClass: 'text-emerald-700',
          bannerBg: 'bg-emerald-50/60 border-emerald-200 text-emerald-950',
        };

  const StatusIcon = statusMeta.icon;

  return (
    <>
      <section
        aria-label="Automated KL-Divergence Drift Alert System"
        className="bg-white border border-slate-200 rounded-lg overflow-hidden"
      >
        {/* Top Bar */}
        <div className="px-6 py-4 border-b border-slate-200 flex flex-col xl:flex-row xl:items-center xl:justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <StatusIcon className={`w-4 h-4 shrink-0 mt-0.5 ${statusMeta.iconClass}`} />
            <div>
              <div className="flex flex-wrap items-center gap-2.5">
                <h2 className="text-sm font-semibold text-slate-900">
                  Automated Train/Validation KL-Divergence Alert System
                </h2>
                <span className={`text-xs font-semibold ${statusMeta.statusTextClass}`}>
                  {statusMeta.title}
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5 font-mono tabular-nums">
                D_KL(Train n={alertReport.trainCount} || Val n={alertReport.valCount}) ·{' '}
                max={alertReport.maxKlDivergence.toFixed(3)} nats · limit=
                {activeThreshold.toFixed(2)} nats ·{' '}
                {unacknowledgedCount > 0
                  ? `${unacknowledgedCount} unread alert${unacknowledgedCount === 1 ? '' : 's'}`
                  : `${notifications.length} logged event${notifications.length === 1 ? '' : 's'}`}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 self-start">
            <button
              type="button"
              aria-pressed={autoNotifyEnabled}
              onClick={() => setAutoNotifyEnabled((prev) => !prev)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border transition-colors whitespace-nowrap ${
                autoNotifyEnabled
                  ? 'bg-slate-900 border-slate-900 text-white'
                  : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
              }`}
            >
              {autoNotifyEnabled ? (
                <BellRing className="w-3.5 h-3.5" />
              ) : (
                <BellOff className="w-3.5 h-3.5" />
              )}
              <span>Auto-Alerts {autoNotifyEnabled ? 'Active' : 'Paused'}</span>
            </button>

            <button
              type="button"
              aria-pressed={desktopAlerts}
              onClick={handleToggleDesktopAlerts}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border transition-colors whitespace-nowrap ${
                desktopAlerts
                  ? 'bg-blue-700 border-blue-700 text-white'
                  : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
              }`}
            >
              <Bell className="w-3.5 h-3.5" />
              <span>Desktop {desktopAlerts ? 'On' : 'Off'}</span>
            </button>

            <button
              type="button"
              onClick={() => setShowHistory((prev) => !prev)}
              className="px-3 py-1.5 text-xs font-medium rounded-md border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap font-mono tabular-nums"
            >
              Alert Log ({notifications.length})
            </button>
          </div>
        </div>

        {/* Configured KL Threshold Tuning Strip */}
        <div className="px-6 py-3 border-b border-slate-200 bg-slate-50/50 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 flex-1 min-w-0">
            <div className="flex items-center gap-2 shrink-0">
              <label
                htmlFor="kl-alert-threshold-slider"
                className="text-xs font-medium text-slate-700 whitespace-nowrap"
              >
                Configured KL Divergence Threshold
              </label>
              <span className="text-xs font-mono font-semibold text-slate-900 tabular-nums whitespace-nowrap">
                {activeThreshold.toFixed(2)} nats
              </span>
            </div>

            <input
              id="kl-alert-threshold-slider"
              type="range"
              min={0.05}
              max={0.6}
              step={0.05}
              value={Math.min(0.6, Math.max(0.05, activeThreshold))}
              onChange={(e) => handleUpdateThreshold(Number(e.target.value))}
              className="w-full sm:max-w-44 accent-blue-700"
            />

            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-md self-start">
              {KL_PRESET_THRESHOLDS.map((th) => {
                const isSelected = Math.abs(activeThreshold - th) < 0.005;
                return (
                  <button
                    key={th}
                    type="button"
                    onClick={() => handleUpdateThreshold(th)}
                    className={`px-2 py-0.5 text-[11px] font-mono rounded transition-colors ${
                      isSelected
                        ? 'bg-white text-slate-900 font-semibold shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {th.toFixed(2)}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 text-xs">
            <a
              href="#model-drift-monitor"
              className="inline-flex items-center gap-1 font-medium text-blue-700 hover:text-blue-800 whitespace-nowrap"
            >
              <span>Inspect Drift Bins</span>
              <ArrowDown className="w-3.5 h-3.5" />
            </a>
            {canExcludeAllBreached && (
              <button
                type="button"
                onClick={handleExcludeAllBreached}
                className="px-2.5 py-1 text-xs font-medium rounded-md border border-rose-200 bg-rose-50 text-rose-800 hover:bg-rose-100 transition-colors whitespace-nowrap"
              >
                Exclude Breached ({alertReport.breachedCount})
              </button>
            )}
          </div>
        </div>

        {/* Active Alert Banner + Breached Feature List */}
        <div
          role={alertReport.breachedCount > 0 ? 'alert' : undefined}
          className={`px-6 py-3.5 border-b text-xs ${statusMeta.bannerBg}`}
        >
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <span className="leading-relaxed">{alertReport.summaryMessage}</span>
            {alertReport.breachedCount > 0 && unacknowledgedCount > 0 && (
              <button
                type="button"
                onClick={acknowledgeAll}
                className="inline-flex items-center gap-1 text-xs font-medium underline underline-offset-2 whitespace-nowrap self-start sm:self-auto"
              >
                <Check className="w-3.5 h-3.5" />
                <span>Acknowledge</span>
              </button>
            )}
          </div>

          {alertReport.alerts.length > 0 && (
            <div className="mt-3 divide-y divide-rose-200/70 border border-rose-200/80 rounded-md bg-white/85">
              {alertReport.alerts.map((item: KlDriftAlertItem) => {
                const canDropSingle = activeFeatureKeys.length > 1;
                return (
                  <div
                    key={item.feature}
                    className="px-3.5 py-2.5 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-2 text-slate-800"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="font-mono font-semibold text-slate-900">
                          {item.csvColumn}
                        </span>
                        <span className="text-slate-500">·</span>
                        <span
                          className={`font-mono font-semibold tabular-nums ${
                            item.severity === 'critical'
                              ? 'text-rose-700'
                              : 'text-amber-700'
                          }`}
                        >
                          D_KL = {item.klDivergence.toFixed(3)} nats
                        </span>
                        <span className="text-slate-500 font-mono text-[11px] tabular-nums">
                          (+{item.excessNats.toFixed(3)} above {item.klThreshold.toFixed(2)} ·{' '}
                          {item.ratioToThreshold.toFixed(2)}× limit)
                        </span>
                      </div>
                      <div className="text-[11px] font-mono tabular-nums text-slate-500 mt-0.5">
                        Train μ = {item.trainMean.toFixed(2)} vs Val μ ={' '}
                        {item.valMean.toFixed(2)} · JS = {item.jsDivergence.toFixed(3)}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {canDropSingle && (
                        <button
                          type="button"
                          onClick={() => handleExcludeFeature(item.feature)}
                          className="px-2.5 py-1 text-[11px] font-medium rounded border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap"
                        >
                          Exclude Feature
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Collapsible Notification Event Log */}
        {showHistory && (
          <div className="px-6 py-4 bg-white">
            <div className="flex items-center justify-between gap-2 mb-2.5">
              <h3 className="text-xs font-semibold text-slate-900">
                Dispatched KL Drift Alert History
              </h3>
              {notifications.length > 0 && (
                <div className="flex items-center gap-3 text-xs">
                  {unacknowledgedCount > 0 && (
                    <button
                      type="button"
                      onClick={acknowledgeAll}
                      className="text-blue-700 hover:text-blue-800 font-medium"
                    >
                      Mark All Read
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={clearNotifications}
                    className="inline-flex items-center gap-1 text-slate-500 hover:text-slate-800"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Clear</span>
                  </button>
                </div>
              )}
            </div>

            {notifications.length === 0 ? (
              <div className="py-4 text-xs text-slate-500">
                No KL-divergence threshold breaches recorded in this session.
              </div>
            ) : (
              <div className="divide-y divide-slate-200 border border-slate-200 rounded-md overflow-hidden">
                {notifications.map((n) => (
                  <div
                    key={n.id}
                    className={`px-3.5 py-2.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-xs ${
                      n.acknowledged ? 'bg-slate-50/60 text-slate-500' : 'bg-white text-slate-800'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-[11px] text-slate-500 tabular-nums">
                          {n.timestamp}
                        </span>
                        <span
                          className={`font-semibold ${
                            n.resolved
                              ? 'text-emerald-700'
                              : n.severity === 'critical'
                              ? 'text-rose-700'
                              : 'text-amber-700'
                          }`}
                        >
                          {n.resolved ? 'Resolved' : n.severity === 'critical' ? 'Critical' : 'Warning'}
                        </span>
                        <span className="font-medium text-slate-900 truncate">
                          {n.title}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-500 mt-0.5 truncate">
                        {n.detail}
                      </div>
                    </div>
                    {!n.acknowledged && (
                      <button
                        type="button"
                        onClick={() => acknowledgeOne(n.id)}
                        className="text-[11px] font-medium text-blue-700 hover:text-blue-800 whitespace-nowrap self-start sm:self-auto"
                      >
                        Acknowledge
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      {/* Automated Floating Breach Toast Notification */}
      {activeToast && (
        <div
          role="alert"
          aria-live="assertive"
          className="fixed bottom-5 right-5 z-50 max-w-md w-[calc(100vw-2.5rem)] bg-white border border-slate-300 rounded-lg shadow-lg p-4"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2.5 min-w-0">
              {activeToast.severity === 'critical' ? (
                <ShieldAlert className="w-4 h-4 text-rose-700 shrink-0 mt-0.5" />
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
                <div className="mt-2.5 flex flex-wrap items-center gap-3 text-xs">
                  <a
                    href="#model-drift-monitor"
                    onClick={() => setActiveToast(null)}
                    className="font-medium text-blue-700 hover:text-blue-800"
                  >
                    Inspect Drift Bins →
                  </a>
                  {canExcludeAllBreached && (
                    <button
                      type="button"
                      onClick={() => {
                        handleExcludeAllBreached();
                        setActiveToast(null);
                      }}
                      className="font-medium text-rose-700 hover:text-rose-800"
                    >
                      Exclude Breached
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      acknowledgeOne(activeToast.id);
                      setActiveToast(null);
                    }}
                    className="text-slate-500 hover:text-slate-800"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            </div>
            <button
              type="button"
              aria-label="Dismiss KL drift notification"
              onClick={() => setActiveToast(null)}
              className="text-slate-400 hover:text-slate-700 p-0.5"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </>
  );
};
