import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { DATASET_PRESETS } from './data/presets';
import {
  buildMdpDataset,
  buildRegressionDataset,
  buildSequenceDataset,
  cloneExperimentConfigs,
  createPiiMasker,
  exportMdpDatasetBundle,
  exportRegressionDatasetCsv,
  exportRegressionDatasetSql,
  exportSequenceDatasetBundle,
  formatTimestampedSnapshotName,
  REGRESSION_FEATURE_CATALOG,
  runCrossParadigmAudit,
  WorkspaceSearchInput,
} from './engine/curationEngine';
import {
  BatchProcessingLogEntry,
  LocalSnapshotSummary,
  TerminalExecutionContext,
} from './engine/terminalEngine';
import { detectCrossParadigmSyncStatus } from './engine/globalSyncEngine';
import {
  CurationRuleId,
  EngineeredFeatureId,
  GlobalCurationConfig,
  GlobalSearchResultItem,
  MdpConfig,
  PiiMaskingConfig,
  RawEvent,
  RegressionConfig,
  RulConfig,
  SchemaValidationReport,
  SequenceConfig,
  WorkflowTemplate,
  WorkspaceTab,
} from './types/curation';
import { cloneWorkflowTemplateBundle } from './data/workflowTemplates';
import { Sidebar } from './components/Sidebar';
import { ExportProgressState, TopBar } from './components/TopBar';
import { OverviewView } from './components/OverviewView';
import { RegressionView } from './components/RegressionView';
import { SequenceView } from './components/SequenceView';
import { OfflineRlView } from './components/OfflineRlView';
import { ExportAuditView } from './components/ExportAuditView';
import { CsvImportModal } from './components/CsvImportModal';
import { SavedWorkspaceRecord, WorkspacesModal } from './components/WorkspacesModal';
import { GeminiChatDrawer } from './components/GeminiChatDrawer';
import { DataExplorerView, EnrichedEventRow } from './components/DataExplorerView';
import { ModelComparisonView } from './components/ModelComparisonView';
import { HyperparameterOptimizerView } from './components/HyperparameterOptimizerView';
import { RetentionCohortView } from './components/RetentionCohortView';
import { SnapshotComparisonView } from './components/SnapshotComparisonView';
import { StratumTerminalDrawer } from './components/StratumTerminalDrawer';
import { GlobalParameterSyncPanel } from './components/GlobalParameterSyncPanel';
import { DatasetSearchView } from './components/DatasetSearchView';
import { AutoDocumentationView } from './components/AutoDocumentationView';
import { AiCuratorView } from './components/AiCuratorView';
import { NlQueryView } from './components/NlQueryView';
import { PaperOrchestraView } from './components/PaperOrchestraView';
import { RulTimeSeriesView } from './components/RulTimeSeriesView';
import { FeatureEngineeringView } from './components/FeatureEngineeringView';
import {
  GovernanceRepositoryView,
  GovernanceRestorePayload,
} from './components/GovernanceRepositoryView';
import { applyCurationRulesToEvents } from './engine/curatorEngine';
import { buildRulDataset, exportRulDatasetCsv } from './engine/rulEngine';
import { exportAugmentedRegressionCsv } from './engine/featureEngineeringEngine';

function triggerDownload(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function App() {
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('overview');
  const [activePresetId, setActivePresetId] = useState<string>(DATASET_PRESETS[0].id);
  const [customEvents, setCustomEvents] = useState<RawEvent[] | null>(null);
  const [customDatasetName, setCustomDatasetName] = useState<string | null>(null);
  const [isCsvModalOpen, setIsCsvModalOpen] = useState(false);
  const [isWorkspacesOpen, setIsWorkspacesOpen] = useState(false);
  const [isGlobalSyncOpen, setIsGlobalSyncOpen] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [isTerminalOpen, setIsTerminalOpen] = useState(false);
  const [batchLogs, setBatchLogs] = useState<BatchProcessingLogEntry[]>([]);
  const [exportProgress, setExportProgress] = useState<ExportProgressState | null>(null);
  const [importSchemaWarning, setImportSchemaWarning] = useState<SchemaValidationReport | null>(null);
  const [explorerSearchRequest, setExplorerSearchRequest] = useState<{
    query: string;
    nonce: number;
  } | null>(null);
  const [nlQueryPromptRequest, setNlQueryPromptRequest] = useState<{
    prompt: string;
    nonce: number;
  } | null>(null);
  const [autoDocRequestedDatasetId, setAutoDocRequestedDatasetId] = useState<string | null>(null);
  const [appliedCurationRules, setAppliedCurationRules] = useState<CurationRuleId[]>([]);
  const [enabledEngineeredFeatures, setEnabledEngineeredFeatures] = useState<
    EngineeredFeatureId[]
  >([]);
  const [piiMaskingConfig, setPiiMaskingConfig] = useState<PiiMaskingConfig>({
    enabled: false,
    mode: 'hash',
    salt: 'stratum-pii-v1',
  });
  const exportLockRef = useRef(false);
  const clearTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const handleGlobalShortcut = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === '`') {
        e.preventDefault();
        setIsTerminalOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleGlobalShortcut);
    return () => {
      window.removeEventListener('keydown', handleGlobalShortcut);
      if (clearTimerRef.current !== null) {
        window.clearTimeout(clearTimerRef.current);
      }
    };
  }, []);

  const activePreset = useMemo(
    () => DATASET_PRESETS.find((p) => p.id === activePresetId) ?? DATASET_PRESETS[0],
    [activePresetId]
  );

  const rawSourceEvents = customEvents ?? activePreset.events;
  const curationTransform = useMemo(
    () => applyCurationRulesToEvents(rawSourceEvents, appliedCurationRules),
    [rawSourceEvents, appliedCurationRules]
  );
  const events = curationTransform.events;
  const datasetName = customDatasetName ?? activePreset.name;
  const datasetDomain = customDatasetName ? 'Custom File Import' : activePreset.domain;
  const datasetDescription = customDatasetName
    ? 'User-supplied canonical event log materialized across Regression, Sequential Tensor, and Offline RL pipelines.'
    : activePreset.description;

  const maxDay = useMemo(() => {
    const m = events.reduce((acc, e) => Math.max(acc, e.timestampDay), 0);
    return Math.max(180, m);
  }, [events]);

  const totalEntitiesCount = useMemo(
    () => new Set(events.map((e) => e.entityId)).size,
    [events]
  );

  const [globalConfig, setGlobalConfig] = useState<GlobalCurationConfig>({
    trainRatio: 0.7,
    valRatio: 0.15,
    testRatio: 0.15,
    seedSalt: 'stratum-v1',
  });

  const [regConfig, setRegConfig] = useState<RegressionConfig>({
    obsCutoffDay: 180,
    horizonDays: 180,
    winsorizePercentile: 99,
    excludeZeroObsEntities: true,
    featureNormalization: 'none',
    selectedFeatures: REGRESSION_FEATURE_CATALOG.map((f) => f.key),
    batchSize: 32,
    splitFilter: 'all',
    klDriftThreshold: 0.25,
    outlierStdThreshold: 2.5,
    excludeDetectedOutliers: false,
  });

  const [seqConfig, setSeqConfig] = useState<SequenceConfig>({
    maxSeqLen: 12,
    padding: 'pre',
    truncation: 'recent',
    normalization: 'zscore',
    minSeqLen: 1,
    obsCutoffDay: 180,
    batchSize: 32,
    learningRate: 0.001,
    splitFilter: 'all',
    transformerArch: 'transformer_encoder',
    dModel: 128,
    numHeads: 4,
    numLayers: 2,
    dropoutRate: 0.1,
    positionalEncoding: 'time_delta',
    poolingMode: 'attention_pool',
  });

  const [mdpConfig, setMdpConfig] = useState<MdpConfig>({
    gamma: 0.95,
    terminalInactivityGapDays: 60,
    rewardScale: 'raw',
    minTrajectorySteps: 2,
    includeAbsorbingStep: true,
    splitFilter: 'all',
  });

  const [rulConfig, setRulConfig] = useState<RulConfig>({
    rulCap: 125,
    windowLength: 8,
    stride: 1,
    eolInactivityGapDays: 60,
    normalization: 'zscore',
    splitFilter: 'all',
  });

  const datasetFingerprint = useMemo(() => {
    const seed = [
      datasetName,
      String(events.length),
      String(totalEntitiesCount),
      globalConfig.seedSalt,
      appliedCurationRules.join(','),
      enabledEngineeredFeatures.join(','),
    ].join('|');
    let h = 2166136261;
    for (let i = 0; i < seed.length; i++) {
      h ^= seed.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(16).padStart(8, '0');
  }, [
    datasetName,
    events.length,
    totalEntitiesCount,
    globalConfig.seedSalt,
    appliedCurationRules,
    enabledEngineeredFeatures,
  ]);

  const regResult = useMemo(
    () => buildRegressionDataset(events, regConfig, globalConfig),
    [events, regConfig, globalConfig]
  );

  const seqResult = useMemo(
    () => buildSequenceDataset(events, seqConfig, globalConfig),
    [events, seqConfig, globalConfig]
  );

  const mdpResult = useMemo(
    () => buildMdpDataset(events, mdpConfig, globalConfig),
    [events, mdpConfig, globalConfig]
  );

  const rulResult = useMemo(
    () => buildRulDataset(events, rulConfig, globalConfig),
    [events, rulConfig, globalConfig]
  );

  const audits = useMemo(
    () => runCrossParadigmAudit(events, regResult, seqResult, mdpResult, globalConfig),
    [events, regResult, seqResult, mdpResult, globalConfig]
  );

  const syncDriftCount = useMemo(
    () => detectCrossParadigmSyncStatus(regConfig, seqConfig, mdpConfig).driftCount,
    [regConfig, seqConfig, mdpConfig]
  );

  const appendBatchLog = (
    entry: Omit<BatchProcessingLogEntry, 'id' | 'timestamp'>
  ) => {
    const now = new Date();
    const pad = (n: number, len = 2) => String(n).padStart(len, '0');
    const timestamp = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(
      now.getSeconds()
    )}.${pad(now.getMilliseconds(), 3)}`;
    const full: BatchProcessingLogEntry = {
      ...entry,
      id: `blog-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp,
    };
    setBatchLogs((prev) => [full, ...prev].slice(0, 120));
  };

  useEffect(() => {
    const jobId = `mat-${datasetName.slice(0, 6).toLowerCase().replace(/[^a-z0-9]/g, '')}`;
    appendBatchLog({
      jobId,
      pipeline: 'Offline RL',
      stage: 'MDP Replay Graph',
      statusCode: 200,
      statusLabel: 'OK',
      progressPct: 100,
      batchDetail: `${mdpResult.transitions.length.toLocaleString()} transitions · ${mdpResult.trajectoryCount} trajectories`,
    });
    appendBatchLog({
      jobId,
      pipeline: 'Sequence',
      stage: 'Tensor Packing',
      statusCode: 200,
      statusLabel: 'OK',
      progressPct: 100,
      batchDetail: `shape [${seqResult.tensorShape.join(', ')}] · ${seqResult.batchCount} batches`,
    });
    appendBatchLog({
      jobId,
      pipeline: 'Regression',
      stage: 'LTV Feature Matrix',
      statusCode: 200,
      statusLabel: 'OK',
      progressPct: 100,
      batchDetail: `${regResult.rows.length} rows · ${regResult.batchCount} batches (bs=${regResult.batchSize})`,
    });
  }, [datasetName, regResult, seqResult, mdpResult]);

  const handleApplySyncedConfigs = (next: {
    globalConfig: GlobalCurationConfig;
    regConfig: RegressionConfig;
    seqConfig: SequenceConfig;
    mdpConfig: MdpConfig;
  }) => {
    setGlobalConfig(next.globalConfig);
    setRegConfig(next.regConfig);
    setSeqConfig(next.seqConfig);
    setMdpConfig(next.mdpConfig);
    appendBatchLog({
      jobId: `sync-${Date.now().toString(36).slice(-4)}`,
      pipeline: 'Sync',
      stage: 'Global Parameter Sync',
      statusCode: 200,
      statusLabel: 'OK',
      progressPct: 100,
      batchDetail: `Aligned T_obs=${next.regConfig.obsCutoffDay}d, split=${Math.round(
        next.globalConfig.trainRatio * 100
      )}/${Math.round(next.globalConfig.valRatio * 100)}/${Math.round(
        next.globalConfig.testRatio * 100
      )}, bs=${next.regConfig.batchSize}`,
    });
  };

  const handleApplyWorkflowTemplate = (
    template: WorkflowTemplate,
    options: { switchDataset: boolean }
  ) => {
    const cloned = cloneWorkflowTemplateBundle(template);
    let targetDataset = datasetName;

    if (options.switchDataset && template.recommendedPresetId !== 'custom_csv') {
      const presetMatch = DATASET_PRESETS.find(
        (p) => p.id === template.recommendedPresetId
      );
      if (presetMatch) {
        setCustomEvents(null);
        setCustomDatasetName(null);
        setImportSchemaWarning(null);
        setActivePresetId(presetMatch.id);
        targetDataset = presetMatch.name;
      }
    }

    setGlobalConfig(cloned.globalConfig);
    setRegConfig(cloned.regConfig);
    setSeqConfig(cloned.seqConfig);
    setMdpConfig(cloned.mdpConfig);
    setRulConfig(cloned.rulConfig);
    setAppliedCurationRules(cloned.appliedCurationRules);
    setEnabledEngineeredFeatures(cloned.enabledEngineeredFeatures);

    appendBatchLog({
      jobId: `tpl-${Date.now().toString(36).slice(-4)}`,
      pipeline: 'Sync',
      stage: 'Workflow Template Loaded',
      statusCode: 200,
      statusLabel: 'OK',
      progressPct: 100,
      batchDetail: `${template.name} (${template.vertical}) → ${targetDataset}`,
    });
  };

  const handleSelectPreset = (id: string) => {
    setCustomEvents(null);
    setCustomDatasetName(null);
    setImportSchemaWarning(null);
    setAppliedCurationRules([]);
    setEnabledEngineeredFeatures([]);
    setActivePresetId(id);
  };

  const searchInput = useMemo<WorkspaceSearchInput>(
    () => ({
      activePresetId,
      customDatasetName,
      datasetName,
      datasetDomain,
      events,
      presets: DATASET_PRESETS,
      globalConfig,
      regConfig,
      seqConfig,
      mdpConfig,
      piiMaskingConfig,
      regResult,
      seqResult,
      mdpResult,
      audits,
    }),
    [
      activePresetId,
      customDatasetName,
      datasetName,
      datasetDomain,
      events,
      globalConfig,
      regConfig,
      seqConfig,
      mdpConfig,
      piiMaskingConfig,
      regResult,
      seqResult,
      mdpResult,
      audits,
    ]
  );

  const handleSelectSearchResult = (item: GlobalSearchResultItem) => {
    if (item.presetIdToSelect) {
      handleSelectPreset(item.presetIdToSelect);
    }
    if (item.explorerQuery) {
      setExplorerSearchRequest({
        query: item.explorerQuery,
        nonce: Date.now() + Math.random(),
      });
    }
    setActiveTab(item.targetTab);
  };

  const handleImportCsv = (
    parsedEvents: RawEvent[],
    name: string,
    schemaReport?: SchemaValidationReport
  ) => {
    setCustomEvents(parsedEvents);
    setCustomDatasetName(name);
    setAppliedCurationRules([]);
    setEnabledEngineeredFeatures([]);
    setImportSchemaWarning(
      schemaReport && schemaReport.overallStatus !== 'ready' ? schemaReport : null
    );
    const maxTs = parsedEvents.reduce((acc, e) => Math.max(acc, e.timestampDay), 0);
    const safeCutoff = Math.max(30, Math.round(maxTs * 0.5));
    setRegConfig((prev) => ({ ...prev, obsCutoffDay: safeCutoff }));
    setSeqConfig((prev) => ({ ...prev, obsCutoffDay: safeCutoff }));
  };

  const handleLoadWorkspace = (ws: SavedWorkspaceRecord) => {
    if (ws.presetId !== 'custom_csv') {
      const exists = DATASET_PRESETS.some((p) => p.id === ws.presetId);
      if (exists) {
        setCustomEvents(null);
        setCustomDatasetName(null);
        setActivePresetId(ws.presetId);
      }
    }
    const savedRules = Array.isArray(ws.summaryStats?.appliedCurationRules)
      ? (ws.summaryStats.appliedCurationRules as CurationRuleId[])
      : [];
    const savedFeatures = Array.isArray(ws.summaryStats?.enabledEngineeredFeatures)
      ? (ws.summaryStats.enabledEngineeredFeatures as EngineeredFeatureId[])
      : [];
    setAppliedCurationRules(savedRules);
    setEnabledEngineeredFeatures(savedFeatures);

    const restored = cloneExperimentConfigs({
      globalConfig: ws.globalConfig,
      regConfig: ws.regConfig,
      seqConfig: ws.seqConfig,
      mdpConfig: ws.mdpConfig,
    });
    setGlobalConfig(restored.globalConfig);
    setRegConfig(restored.regConfig);
    setSeqConfig(restored.seqConfig);
    setMdpConfig(restored.mdpConfig);
  };

  const handleRestoreGovernanceState = (
    payload: GovernanceRestorePayload,
    label: string
  ) => {
    if (payload.presetId && payload.presetId !== 'custom_csv') {
      const exists = DATASET_PRESETS.some((p) => p.id === payload.presetId);
      if (exists) {
        setCustomEvents(null);
        setCustomDatasetName(null);
        setImportSchemaWarning(null);
        setActivePresetId(payload.presetId);
      }
    }

    const restored = cloneExperimentConfigs({
      globalConfig: payload.globalConfig,
      regConfig: payload.regConfig,
      seqConfig: payload.seqConfig,
      mdpConfig: payload.mdpConfig,
    });
    setGlobalConfig(restored.globalConfig);
    setRegConfig(restored.regConfig);
    setSeqConfig(restored.seqConfig);
    setMdpConfig(restored.mdpConfig);

    if (payload.rulConfig) {
      setRulConfig({ ...payload.rulConfig });
    }
    if (payload.appliedCurationRules) {
      setAppliedCurationRules([...payload.appliedCurationRules]);
    }
    if (payload.enabledEngineeredFeatures) {
      setEnabledEngineeredFeatures([...payload.enabledEngineeredFeatures]);
    }

    appendBatchLog({
      jobId: `vcs-${Date.now().toString(36).slice(-4)}`,
      pipeline: 'Sync',
      stage: 'VCS / Archive State Restored',
      statusCode: 200,
      statusLabel: 'OK',
      progressPct: 100,
      batchDetail: label,
    });
  };

  const yieldFrame = () =>
    new Promise<void>((resolve) => {
      window.setTimeout(resolve, 45);
    });

  const runTrackedExport = async (
    format: ExportProgressState['format'],
    label: string,
    filename: string,
    mimeType: string,
    buildContent: (
      reportProgress: (pct: number, stageNote?: string) => void
    ) => Promise<string>
  ) => {
    if (exportLockRef.current) return;
    exportLockRef.current = true;
    if (clearTimerRef.current !== null) {
      window.clearTimeout(clearTimerRef.current);
      clearTimerRef.current = null;
    }

    const pipeline: BatchProcessingLogEntry['pipeline'] =
      format === 'MDP'
        ? 'Offline RL'
        : format === 'JSON'
          ? 'Sequence'
          : filename.includes('events')
            ? 'Events'
            : 'Regression';
    const jobId = `exp-${format.toLowerCase()}-${Date.now().toString(36).slice(-4)}`;
    const t0 = performance.now();

    appendBatchLog({
      jobId,
      pipeline,
      stage: `${label} (${filename})`,
      statusCode: 100,
      statusLabel: 'INIT',
      progressPct: 12,
      batchDetail: `Initializing ${format} materialization stream`,
    });

    setExportProgress({ status: 'exporting', format, label, progress: 12 });
    try {
      await yieldFrame();
      const content = await buildContent((pct, stageNote) => {
        const clamped = Math.min(95, Math.max(12, pct));
        setExportProgress({
          status: 'exporting',
          format,
          label,
          progress: clamped,
        });
        appendBatchLog({
          jobId,
          pipeline,
          stage: `${format} Serialization`,
          statusCode: 102,
          statusLabel: 'PROC',
          progressPct: Math.round(clamped),
          batchDetail: stageNote ?? `Materializing ${filename}`,
        });
      });
      setExportProgress({ status: 'exporting', format, label, progress: 96 });
      await yieldFrame();
      triggerDownload(filename, content, mimeType);
      const elapsed = Math.max(1, Math.round(performance.now() - t0));
      const kb = (new Blob([content]).size / 1024).toFixed(1);
      appendBatchLog({
        jobId,
        pipeline,
        stage: `${format} Materialized`,
        statusCode: 200,
        statusLabel: 'OK',
        progressPct: 100,
        batchDetail: `${filename} (${kb} KB) emitted`,
        durationMs: elapsed,
      });
      setExportProgress({
        status: 'complete',
        format,
        label: `${format} Ready`,
        progress: 100,
      });
      clearTimerRef.current = window.setTimeout(() => {
        setExportProgress(null);
      }, 1400);
    } catch (err) {
      appendBatchLog({
        jobId,
        pipeline,
        stage: `${format} Export Failed`,
        statusCode: 500,
        statusLabel: 'ERR',
        progressPct: 100,
        batchDetail: err instanceof Error ? err.message : 'Unexpected materialization error',
      });
    } finally {
      exportLockRef.current = false;
    }
  };

  const runBatchMaterialization = async () => {
    const jobId = `job-${Date.now().toString(36).slice(-4)}`;
    const t0 = performance.now();
    appendBatchLog({
      jobId,
      pipeline: 'Events',
      stage: 'Canonical Stream Scan',
      statusCode: 100,
      statusLabel: 'INIT',
      progressPct: 10,
      batchDetail: `Scanning ${events.length.toLocaleString()} events across ${totalEntitiesCount} entities`,
    });
    await yieldFrame();

    const tReg0 = performance.now();
    const regRun = buildRegressionDataset(events, regConfig, globalConfig);
    const tRegMs = Math.max(1, Math.round(performance.now() - tReg0));
    appendBatchLog({
      jobId,
      pipeline: 'Regression',
      stage: 'OLS Matrix Materialized',
      statusCode: 102,
      statusLabel: 'PROC',
      progressPct: 40,
      batchDetail: `${regRun.rows.length} rows · ${regRun.batchCount} batches (R²=${regRun.linearFit.rSquared.toFixed(3)})`,
      durationMs: tRegMs,
    });
    await yieldFrame();

    const tSeq0 = performance.now();
    const seqRun = buildSequenceDataset(events, seqConfig, globalConfig);
    const tSeqMs = Math.max(1, Math.round(performance.now() - tSeq0));
    appendBatchLog({
      jobId,
      pipeline: 'Sequence',
      stage: 'Tensor Batching',
      statusCode: 102,
      statusLabel: 'PROC',
      progressPct: 72,
      batchDetail: `tensor [${seqRun.tensorShape.join(', ')}] · ${seqRun.batchCount} batches`,
      durationMs: tSeqMs,
    });
    await yieldFrame();

    const tMdp0 = performance.now();
    const mdpRun = buildMdpDataset(events, mdpConfig, globalConfig);
    const tMdpMs = Math.max(1, Math.round(performance.now() - tMdp0));
    const totalMs = Math.max(1, Math.round(performance.now() - t0));
    appendBatchLog({
      jobId,
      pipeline: 'Offline RL',
      stage: 'Batch Materialization Complete',
      statusCode: 200,
      statusLabel: 'OK',
      progressPct: 100,
      batchDetail: `${mdpRun.transitions.length.toLocaleString()} MDP tuples (${mdpRun.trajectoryCount} trajs · ${tMdpMs}ms)`,
      durationMs: totalMs,
    });
  };

  const downloadRegressionCsv = () => {
    void runTrackedExport(
      'CSV',
      'Exporting LTV CSV',
      'stratum_regression_ltv.csv',
      'text/csv',
      async (reportProgress) => {
        reportProgress(38, `Formatting ${regResult.rows.length} regression rows`);
        await yieldFrame();
        const csv = exportRegressionDatasetCsv(regResult, regConfig, piiMaskingConfig);
        reportProgress(82, `Finalized ${regResult.batchCount} CSV batch chunks`);
        await yieldFrame();
        return csv;
      }
    );
  };

  const downloadRegressionSql = () => {
    void runTrackedExport(
      'SQL',
      'Exporting Postgres SQL',
      'stratum_regression_ltv.sql',
      'application/sql',
      async (reportProgress) => {
        reportProgress(35, `Generating DDL & batch INSERT statements`);
        await yieldFrame();
        const sql = exportRegressionDatasetSql(
          regResult,
          regConfig,
          datasetName,
          piiMaskingConfig
        );
        reportProgress(85, `Serialized ${regResult.rows.length} PostgreSQL tuples`);
        await yieldFrame();
        return sql;
      }
    );
  };

  const downloadSequenceJson = () => {
    void runTrackedExport(
      'JSON',
      'Exporting Tensors JSON',
      'stratum_sequence_tensors.json',
      'application/json',
      async (reportProgress) => {
        reportProgress(30, `Packing [${seqResult.tensorShape.join(', ')}] tensor bundle`);
        await yieldFrame();
        const payload = exportSequenceDatasetBundle(seqResult, seqConfig, piiMaskingConfig);
        reportProgress(65, `Serializing ${seqResult.batchCount} mini-batches to JSON`);
        await yieldFrame();
        const json = JSON.stringify(payload, null, 2);
        reportProgress(90, `Validating sequence JSON payload`);
        await yieldFrame();
        return json;
      }
    );
  };

  const downloadMdpJson = () => {
    void runTrackedExport(
      'MDP',
      'Exporting MDP JSON',
      'stratum_offline_rl_mdp.json',
      'application/json',
      async (reportProgress) => {
        reportProgress(32, `Packing ${mdpResult.transitions.length} MDP transitions`);
        await yieldFrame();
        const payload = exportMdpDatasetBundle(mdpResult, mdpConfig, piiMaskingConfig);
        reportProgress(68, `Serializing ${mdpResult.trajectoryCount} trajectories`);
        await yieldFrame();
        const json = JSON.stringify(payload, null, 2);
        reportProgress(90, `Validating MDP JSON payload`);
        await yieldFrame();
        return json;
      }
    );
  };

  const downloadEventsCsv = (rowsToExport?: EnrichedEventRow[]) => {
    void runTrackedExport(
      'CSV',
      'Exporting Events CSV',
      'stratum_processed_events.csv',
      'text/csv',
      async (reportProgress) => {
        const header =
          'event_id,entity_id,timestamp_day,action_id,action_label,channel,recency_days,frequency_count,spend_amount,engagement_score,reward,propensity';
        const source = rowsToExport ?? events;
        const masker = createPiiMasker(piiMaskingConfig);
        const chunkSize = 1000;
        const totalChunks = Math.max(1, Math.ceil(source.length / chunkSize));
        const lines: string[] = [];
        for (let i = 0; i < source.length; i += chunkSize) {
          const end = Math.min(source.length, i + chunkSize);
          const chunkNum = Math.floor(i / chunkSize) + 1;
          for (let j = i; j < end; j++) {
            const e = source[j];
            const safeActionLabel = masker.sanitizeText(e.actionLabel).replace(/"/g, '""');
            const safeChannel = masker.sanitizeText(e.channel).replace(/"/g, '""');
            lines.push(
              [
                masker.maskEventId(e.eventId),
                masker.maskEntityId(e.entityId),
                e.timestampDay,
                e.actionId,
                `"${safeActionLabel}"`,
                `"${safeChannel}"`,
                e.recencyDays,
                e.frequencyCount,
                e.spendAmount,
                e.engagementScore,
                e.reward,
                e.propensity,
              ].join(',')
            );
          }
          const ratio = source.length > 0 ? end / source.length : 1;
          reportProgress(
            25 + Math.round(ratio * 65),
            `Chunk ${chunkNum}/${totalChunks} (${end.toLocaleString()}/${source.length.toLocaleString()} events)`
          );
          await yieldFrame();
        }
        return [header, ...lines].join('\n');
      }
    );
  };

  const downloadRulCsv = () => {
    void runTrackedExport(
      'CSV',
      'Exporting RUL Cycle CSV',
      'stratum_rul_timeseries.csv',
      'text/csv',
      async (reportProgress) => {
        reportProgress(40, 'Computing cycle-level Remaining Useful Life labels');
        await yieldFrame();
        const rulRes = buildRulDataset(events, rulConfig, globalConfig);
        const csv = exportRulDatasetCsv(rulRes);
        reportProgress(88, `Formatted ${rulRes.cycleRows.length} RUL cycle rows`);
        await yieldFrame();
        return csv;
      }
    );
  };

  const downloadAugmentedFeaturesCsv = () => {
    void runTrackedExport(
      'CSV',
      'Exporting Augmented CSV',
      'stratum_augmented_features.csv',
      'text/csv',
      async (reportProgress) => {
        reportProgress(40, `Computing ${enabledEngineeredFeatures.length} derived features`);
        await yieldFrame();
        const csv = exportAugmentedRegressionCsv({
          events,
          regResult,
          regConfig,
          enabledFeatureIds: enabledEngineeredFeatures,
          piiMaskingConfig,
        });
        reportProgress(88, `Finalized ${regResult.rows.length} augmented feature rows`);
        await yieldFrame();
        return csv;
      }
    );
  };

  const handleTopBarExport = () => {
    if (activeTab === 'regression') {
      downloadRegressionCsv();
    } else if (activeTab === 'feature_engineering') {
      downloadAugmentedFeaturesCsv();
    } else if (activeTab === 'model_comparison') {
      setActiveTab('regression');
    } else if (activeTab === 'sequence') {
      downloadSequenceJson();
    } else if (activeTab === 'rul_timeseries') {
      downloadRulCsv();
    } else if (activeTab === 'hyperparameter_optimizer') {
      downloadSequenceJson();
    } else if (activeTab === 'offline_rl') {
      downloadMdpJson();
    } else if (activeTab === 'data_explorer') {
      downloadEventsCsv();
    } else if (activeTab === 'dataset_search') {
      setActiveTab('nl_query');
    } else if (activeTab === 'nl_query') {
      downloadEventsCsv();
    } else if (activeTab === 'auto_docs') {
      setActiveTab('audit_export');
    } else if (activeTab === 'ai_curator') {
      downloadEventsCsv();
    } else {
      setActiveTab('audit_export');
    }
  };

  const exportLabel =
    activeTab === 'regression'
      ? 'Export LTV CSV'
      : activeTab === 'feature_engineering'
      ? 'Export Augmented CSV'
      : activeTab === 'model_comparison'
      ? 'Open Regression'
      : activeTab === 'sequence' || activeTab === 'hyperparameter_optimizer'
      ? 'Export Tensors JSON'
      : activeTab === 'rul_timeseries'
      ? 'Export RUL CSV'
      : activeTab === 'offline_rl'
      ? 'Export MDP JSON'
      : activeTab === 'data_explorer'
      ? 'Export Events CSV'
      : activeTab === 'ai_curator'
      ? 'Export Curated CSV'
      : activeTab === 'nl_query'
      ? 'Export Events CSV'
      : activeTab === 'dataset_search'
      ? 'Ask NL Query'
      : 'Validation & Export';

  const handleSaveTerminalSnapshot = (customName?: string): LocalSnapshotSummary => {
    const storageKey = 'stratum_local_experiment_snapshots_v1';
    const cloned = cloneExperimentConfigs({
      globalConfig,
      regConfig,
      seqConfig,
      mdpConfig,
    });
    const workspaceId = `snap-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 7)}`;
    const snapshotName = customName || formatTimestampedSnapshotName(datasetName);
    const localTimestampIso = new Date().toISOString();
    const record: SavedWorkspaceRecord = {
      workspaceId,
      ownerId: 'local-user',
      name: snapshotName,
      presetId: customDatasetName ? 'custom_csv' : activePresetId,
      datasetName,
      notes: 'Captured via Workbench Terminal CLI',
      globalConfig: cloned.globalConfig,
      regConfig: cloned.regConfig,
      seqConfig: cloned.seqConfig,
      mdpConfig: cloned.mdpConfig,
      summaryStats: {
        regRows: regResult.rows.length,
        tensorShape: [...seqResult.tensorShape] as [number, number, number],
        transitions: mdpResult.transitions.length,
        highCollinearityCount: regResult.featureMatrix.highCollinearityPairs.length,
        regRSquared: Math.round(regResult.linearFit.rSquared * 10000) / 10000,
        seqRSquared:
          (seqResult.transformerEval.holdoutMetrics.rSquared ??
            seqResult.transformerEval.allMetrics.rSquared) !== null
            ? Math.round(
                ((seqResult.transformerEval.holdoutMetrics.rSquared ??
                  seqResult.transformerEval.allMetrics.rSquared) as number) *
                  10000
              ) / 10000
            : null,
        valLoss:
          (seqResult.transformerEval.lossCurve.bestValLoss ??
            seqResult.transformerEval.lossCurve.finalValLoss) !== null
            ? Math.round(
                ((seqResult.transformerEval.lossCurve.bestValLoss ??
                  seqResult.transformerEval.lossCurve.finalValLoss) as number) *
                  10000
              ) / 10000
            : null,
        trainLoss:
          Math.round(seqResult.transformerEval.lossCurve.finalTrainLoss * 10000) /
          10000,
        regRmse: Math.round(regResult.linearFit.rmse * 100) / 100,
        datasetFingerprint,
        eventCount: events.length,
        entityCount: totalEntitiesCount,
        appliedCurationRules: [...appliedCurationRules],
        enabledEngineeredFeatures: [...enabledEngineeredFeatures],
      },
      localTimestampIso,
    };

    try {
      const raw = window.localStorage.getItem(storageKey);
      const parsed = raw ? (JSON.parse(raw) as SavedWorkspaceRecord[]) : [];
      const next = [record, ...(Array.isArray(parsed) ? parsed : [])].slice(0, 30);
      window.localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      // ignore storage write errors
    }

    return {
      workspaceId,
      name: snapshotName,
      datasetName,
      timestamp: localTimestampIso.slice(0, 19).replace('T', ' '),
      regR2: record.summaryStats.regRSquared,
    };
  };

  const handleListTerminalSnapshots = (): LocalSnapshotSummary[] => {
    try {
      const raw = window.localStorage.getItem('stratum_local_experiment_snapshots_v1');
      if (!raw) return [];
      const parsed = JSON.parse(raw) as SavedWorkspaceRecord[];
      if (!Array.isArray(parsed)) return [];
      return parsed.map((s) => ({
        workspaceId: s.workspaceId,
        name: s.name,
        datasetName: s.datasetName,
        timestamp: s.localTimestampIso
          ? s.localTimestampIso.slice(0, 19).replace('T', ' ')
          : 'Saved',
        regR2: s.summaryStats?.regRSquared,
      }));
    } catch {
      return [];
    }
  };

  const terminalContext: TerminalExecutionContext = {
    activeTab,
    activePresetId,
    customDatasetName,
    datasetName,
    datasetDomain,
    events,
    presets: DATASET_PRESETS,
    globalConfig,
    regConfig,
    seqConfig,
    mdpConfig,
    regResult,
    seqResult,
    mdpResult,
    audits,
    batchLogs,
    onRunBatchMaterialization: () => {
      void runBatchMaterialization();
    },
    onSelectTab: setActiveTab,
    onSelectPreset: handleSelectPreset,
    onUpdateGlobalConfig: setGlobalConfig,
    onUpdateRegConfig: setRegConfig,
    onUpdateSeqConfig: setSeqConfig,
    onUpdateMdpConfig: setMdpConfig,
    onExport: (kind) => {
      if (kind === 'csv') downloadRegressionCsv();
      else if (kind === 'sql') downloadRegressionSql();
      else if (kind === 'seq') downloadSequenceJson();
      else if (kind === 'mdp') downloadMdpJson();
      else if (kind === 'events') downloadEventsCsv();
    },
    onSaveSnapshot: handleSaveTerminalSnapshot,
    onListSnapshots: handleListTerminalSnapshots,
  };

  return (
    <div className="min-h-screen flex bg-slate-50 text-slate-900">
      <Sidebar
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        presets={DATASET_PRESETS}
        activePresetId={activePresetId}
        customDatasetName={customDatasetName}
        onSelectPreset={handleSelectPreset}
        globalConfig={globalConfig}
        onUpdateGlobalConfig={setGlobalConfig}
        totalEventsCount={events.length}
        totalEntitiesCount={totalEntitiesCount}
        syncDriftCount={syncDriftCount}
        onOpenGlobalSync={() => setIsGlobalSyncOpen(true)}
        onOpenWorkspaces={() => setIsWorkspacesOpen(true)}
      />

      <div className="flex-1 min-w-0 flex flex-col">
        <TopBar
          datasetName={datasetName}
          activeTab={activeTab}
          searchInput={searchInput}
          onSelectSearchResult={handleSelectSearchResult}
          onOpenCsvModal={() => setIsCsvModalOpen(true)}
          onExportCurrent={handleTopBarExport}
          exportLabel={exportLabel}
          isChatOpen={isChatOpen}
          onToggleChat={() => setIsChatOpen((prev) => !prev)}
          isTerminalOpen={isTerminalOpen}
          onToggleTerminal={() => setIsTerminalOpen((prev) => !prev)}
          exportProgress={exportProgress}
        />

        <main className="flex-1 p-6 max-w-[1440px] w-full mx-auto">
          {importSchemaWarning && (
            <div
              role="alert"
              className="mb-6 bg-amber-50 border border-amber-200 rounded-lg p-4 flex items-start justify-between gap-4"
            >
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                <div className="space-y-1.5">
                  <div className="text-xs font-semibold text-amber-950">
                    Imported Dataset Schema Warnings ({datasetName})
                  </div>
                  <div className="flex flex-wrap gap-3 text-[11px] font-mono text-amber-900">
                    {importSchemaWarning.pipelines.map((p) => (
                      <span key={p.paradigm}>
                        {p.paradigm}:{' '}
                        <strong className="uppercase">{p.status}</strong>
                        {p.missingCritical.length > 0 &&
                          ` (missing ${p.missingCritical.join(', ')})`}
                      </span>
                    ))}
                  </div>
                  {importSchemaWarning.warnings.length > 0 && (
                    <ul className="text-xs text-amber-900 space-y-0.5">
                      {importSchemaWarning.warnings.slice(0, 3).map((w, idx) => (
                        <li key={idx}>• {w}</li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setImportSchemaWarning(null)}
                aria-label="Dismiss schema warning"
                className="p-1 text-amber-700 hover:text-amber-950 rounded"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {activeTab === 'overview' && (
            <OverviewView
              activePresetId={activePresetId}
              customDatasetName={customDatasetName}
              datasetName={datasetName}
              datasetDomain={datasetDomain}
              datasetDescription={datasetDescription}
              events={events}
              globalConfig={globalConfig}
              regConfig={regConfig}
              seqConfig={seqConfig}
              mdpConfig={mdpConfig}
              rulConfig={rulConfig}
              appliedCurationRules={appliedCurationRules}
              enabledEngineeredFeatures={enabledEngineeredFeatures}
              regResult={regResult}
              seqResult={seqResult}
              mdpResult={mdpResult}
              audits={audits}
              maxDay={maxDay}
              onNavigateTab={setActiveTab}
              onOpenWorkspaces={() => setIsWorkspacesOpen(true)}
              onApplySyncedConfigs={handleApplySyncedConfigs}
              onApplyWorkflowTemplate={handleApplyWorkflowTemplate}
            />
          )}

          {activeTab === 'regression' && (
            <RegressionView
              datasetName={datasetName}
              datasetDomain={datasetDomain}
              events={events}
              globalConfig={globalConfig}
              config={regConfig}
              onUpdateConfig={setRegConfig}
              result={regResult}
              maxDay={maxDay}
            />
          )}

          {activeTab === 'model_comparison' && (
            <ModelComparisonView
              datasetName={datasetName}
              datasetDomain={datasetDomain}
              events={events}
              globalConfig={globalConfig}
              baseRegConfig={regConfig}
              regResult={regResult}
              seqResult={seqResult}
              mdpResult={mdpResult}
              rulResult={rulResult}
              rulConfig={rulConfig}
              maxDay={maxDay}
              onPromoteConfig={(cfg) => {
                setRegConfig(cfg);
                setActiveTab('regression');
              }}
              onOpenTransformerView={(arch) => {
                if (arch) {
                  setSeqConfig((prev) => ({ ...prev, transformerArch: arch }));
                }
                setActiveTab('sequence');
              }}
              onNavigateTab={setActiveTab}
            />
          )}

          {activeTab === 'feature_engineering' && (
            <FeatureEngineeringView
              datasetName={datasetName}
              datasetDomain={datasetDomain}
              events={events}
              regConfig={regConfig}
              regResult={regResult}
              piiMaskingConfig={piiMaskingConfig}
              enabledFeatureIds={enabledEngineeredFeatures}
              onToggleFeature={(id) => {
                setEnabledEngineeredFeatures((prev) =>
                  prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
                );
              }}
              onApplyFeatureSet={(ids) => {
                setEnabledEngineeredFeatures(Array.from(new Set(ids)));
              }}
            />
          )}

          {activeTab === 'sequence' && (
            <SequenceView
              config={seqConfig}
              onUpdateConfig={setSeqConfig}
              result={seqResult}
              maxDay={maxDay}
            />
          )}

          {activeTab === 'rul_timeseries' && (
            <RulTimeSeriesView
              datasetName={datasetName}
              datasetDomain={datasetDomain}
              events={events}
              globalConfig={globalConfig}
              obsCutoffDay={regConfig.obsCutoffDay}
              config={rulConfig}
              onUpdateConfig={setRulConfig}
              onOpenSensorImport={() => setIsCsvModalOpen(true)}
              onInspectEntityInExplorer={(entityId) => {
                setExplorerSearchRequest({
                  query: entityId,
                  nonce: Date.now() + Math.random(),
                });
                setActiveTab('data_explorer');
              }}
            />
          )}

          {activeTab === 'hyperparameter_optimizer' && (
            <HyperparameterOptimizerView
              events={events}
              globalConfig={globalConfig}
              seqConfig={seqConfig}
              onUpdateSeqConfig={setSeqConfig}
              onNavigateSequence={() => setActiveTab('sequence')}
            />
          )}

          {activeTab === 'offline_rl' && (
            <OfflineRlView
              config={mdpConfig}
              onUpdateConfig={setMdpConfig}
              result={mdpResult}
            />
          )}

          {activeTab === 'retention_cohorts' && (
            <RetentionCohortView
              datasetName={datasetName}
              events={events}
              globalConfig={globalConfig}
            />
          )}

          {activeTab === 'snapshot_comparison' && (
            <SnapshotComparisonView
              activePresetId={activePresetId}
              customDatasetName={customDatasetName}
              datasetName={datasetName}
              events={events}
              globalConfig={globalConfig}
              regConfig={regConfig}
              seqConfig={seqConfig}
              mdpConfig={mdpConfig}
              onLoadWorkspace={handleLoadWorkspace}
              onOpenWorkspaces={() => setIsWorkspacesOpen(true)}
            />
          )}

          {activeTab === 'data_explorer' && (
            <DataExplorerView
              datasetName={datasetName}
              events={events}
              globalConfig={globalConfig}
              obsCutoffDay={regConfig.obsCutoffDay}
              externalSearchRequest={explorerSearchRequest}
              onExportEventsCsv={downloadEventsCsv}
              onAskNaturalLanguage={(seedPrompt) => {
                if (seedPrompt.trim()) {
                  setNlQueryPromptRequest({
                    prompt: seedPrompt,
                    nonce: Date.now() + Math.random(),
                  });
                }
                setActiveTab('nl_query');
              }}
            />
          )}

          {activeTab === 'dataset_search' && (
            <DatasetSearchView
              presets={DATASET_PRESETS}
              activePresetId={activePresetId}
              customDatasetName={customDatasetName}
              customEvents={customEvents}
              globalConfig={globalConfig}
              obsCutoffDay={regConfig.obsCutoffDay}
              onActivateDataset={(presetId) => {
                handleSelectPreset(presetId);
              }}
              onOpenAutoDocs={(dsId) => {
                setAutoDocRequestedDatasetId(dsId);
                setActiveTab('auto_docs');
              }}
              onInspectInExplorer={(dsId, q) => {
                if (dsId !== 'custom_csv' && (customDatasetName || dsId !== activePresetId)) {
                  handleSelectPreset(dsId);
                }
                setExplorerSearchRequest({
                  query: q,
                  nonce: Date.now() + Math.random(),
                });
                setActiveTab('data_explorer');
              }}
            />
          )}

          {activeTab === 'governance_repository' && (
            <GovernanceRepositoryView
              presets={DATASET_PRESETS}
              activePresetId={activePresetId}
              customDatasetName={customDatasetName}
              datasetName={datasetName}
              datasetDomain={datasetDomain}
              datasetFingerprint={datasetFingerprint}
              events={events}
              totalEntitiesCount={totalEntitiesCount}
              globalConfig={globalConfig}
              regConfig={regConfig}
              seqConfig={seqConfig}
              mdpConfig={mdpConfig}
              rulConfig={rulConfig}
              appliedCurationRules={appliedCurationRules}
              enabledEngineeredFeatures={enabledEngineeredFeatures}
              piiMaskingConfig={piiMaskingConfig}
              onUpdatePiiMaskingConfig={setPiiMaskingConfig}
              audits={audits}
              summaryStats={{
                regRows: regResult.rows.length,
                tensorShape: seqResult.tensorShape,
                transitions: mdpResult.transitions.length,
                rulWindows: rulResult.windowCount,
              }}
              onActivateDataset={(presetId) => {
                if (presetId !== 'custom_csv') {
                  handleSelectPreset(presetId);
                }
              }}
              onRestoreState={handleRestoreGovernanceState}
              onOpenDatasetSearch={() => setActiveTab('dataset_search')}
              onOpenAutoDocs={(dsId) => {
                setAutoDocRequestedDatasetId(dsId);
                setActiveTab('auto_docs');
              }}
            />
          )}

          {activeTab === 'nl_query' && (
            <NlQueryView
              datasetName={datasetName}
              datasetDomain={datasetDomain}
              events={events}
              globalConfig={globalConfig}
              obsCutoffDay={regConfig.obsCutoffDay}
              regResult={regResult}
              mdpResult={mdpResult}
              externalPromptRequest={nlQueryPromptRequest}
              onInspectEntityInExplorer={(entityId) => {
                setExplorerSearchRequest({
                  query: entityId,
                  nonce: Date.now() + Math.random(),
                });
                setActiveTab('data_explorer');
              }}
            />
          )}

          {activeTab === 'auto_docs' && (
            <AutoDocumentationView
              presets={DATASET_PRESETS}
              activePresetId={activePresetId}
              customDatasetName={customDatasetName}
              customEvents={customEvents}
              requestedDatasetId={autoDocRequestedDatasetId}
              globalConfig={globalConfig}
              regConfig={regConfig}
              seqConfig={seqConfig}
              mdpConfig={mdpConfig}
              piiMaskingConfig={piiMaskingConfig}
              regResult={regResult}
              seqResult={seqResult}
              mdpResult={mdpResult}
              onActivateDataset={(presetId) => {
                handleSelectPreset(presetId);
              }}
            />
          )}

          {activeTab === 'paper_orchestra' && <PaperOrchestraView />}

          {activeTab === 'ai_curator' && (
            <AiCuratorView
              datasetName={datasetName}
              datasetDomain={datasetDomain}
              rawEvents={rawSourceEvents}
              curationTransform={curationTransform}
              appliedRules={appliedCurationRules}
              onToggleRule={(ruleId) => {
                setAppliedCurationRules((prev) =>
                  prev.includes(ruleId)
                    ? prev.filter((id) => id !== ruleId)
                    : [...prev, ruleId]
                );
              }}
              onApplyRules={(rules) => {
                setAppliedCurationRules(Array.from(new Set(rules)));
              }}
              onResetRules={() => setAppliedCurationRules([])}
              globalConfig={globalConfig}
              regConfig={regConfig}
              seqConfig={seqConfig}
              mdpConfig={mdpConfig}
              onUpdateRegConfig={setRegConfig}
              onUpdateSeqConfig={setSeqConfig}
              onUpdateMdpConfig={setMdpConfig}
              regResult={regResult}
              seqResult={seqResult}
              mdpResult={mdpResult}
              onExportCuratedEventsCsv={() => downloadEventsCsv()}
              onInspectEntityInExplorer={(entityId) => {
                setExplorerSearchRequest({
                  query: entityId,
                  nonce: Date.now() + Math.random(),
                });
                setActiveTab('data_explorer');
              }}
            />
          )}

          {activeTab === 'audit_export' && (
            <ExportAuditView
              datasetName={datasetName}
              audits={audits}
              globalConfig={globalConfig}
              regConfig={regConfig}
              seqConfig={seqConfig}
              mdpConfig={mdpConfig}
              regResult={regResult}
              seqResult={seqResult}
              mdpResult={mdpResult}
              piiMaskingConfig={piiMaskingConfig}
              onUpdatePiiMaskingConfig={setPiiMaskingConfig}
              onDownloadRegressionCsv={downloadRegressionCsv}
              onDownloadRegressionSql={downloadRegressionSql}
              onDownloadSequenceJson={downloadSequenceJson}
              onDownloadMdpJson={downloadMdpJson}
            />
          )}
        </main>

        <StratumTerminalDrawer
          isOpen={isTerminalOpen}
          onClose={() => setIsTerminalOpen(false)}
          executionContext={terminalContext}
          batchLogs={batchLogs}
          onClearBatchLogs={() => setBatchLogs([])}
          onRunBatchMaterialization={() => {
            void runBatchMaterialization();
          }}
        />
      </div>

      <CsvImportModal
        isOpen={isCsvModalOpen}
        onClose={() => setIsCsvModalOpen(false)}
        onImportEvents={handleImportCsv}
      />

      {isGlobalSyncOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Global Parameter Sync"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 overflow-y-auto"
          onClick={() => setIsGlobalSyncOpen(false)}
        >
          <div
            className="w-full max-w-4xl my-8"
            onClick={(e) => e.stopPropagation()}
          >
            <GlobalParameterSyncPanel
              globalConfig={globalConfig}
              regConfig={regConfig}
              seqConfig={seqConfig}
              mdpConfig={mdpConfig}
              maxDay={maxDay}
              onApplySyncedConfigs={handleApplySyncedConfigs}
              onCloseModal={() => setIsGlobalSyncOpen(false)}
            />
          </div>
        </div>
      )}

      <WorkspacesModal
        isOpen={isWorkspacesOpen}
        onClose={() => setIsWorkspacesOpen(false)}
        activePresetId={activePresetId}
        customDatasetName={customDatasetName}
        datasetName={datasetName}
        globalConfig={globalConfig}
        regConfig={regConfig}
        seqConfig={seqConfig}
        mdpConfig={mdpConfig}
        summaryStats={{
          regRows: regResult.rows.length,
          tensorShape: seqResult.tensorShape,
          transitions: mdpResult.transitions.length,
          highCollinearityCount: regResult.featureMatrix.highCollinearityPairs.length,
          regRSquared: Math.round(regResult.linearFit.rSquared * 10000) / 10000,
          seqRSquared:
            (seqResult.transformerEval.holdoutMetrics.rSquared ??
              seqResult.transformerEval.allMetrics.rSquared) !== null
              ? Math.round(
                  ((seqResult.transformerEval.holdoutMetrics.rSquared ??
                    seqResult.transformerEval.allMetrics.rSquared) as number) *
                    10000
                ) / 10000
              : null,
          valLoss:
            (seqResult.transformerEval.lossCurve.bestValLoss ??
              seqResult.transformerEval.lossCurve.finalValLoss) !== null
              ? Math.round(
                  ((seqResult.transformerEval.lossCurve.bestValLoss ??
                    seqResult.transformerEval.lossCurve.finalValLoss) as number) *
                    10000
                ) / 10000
              : null,
          trainLoss:
            Math.round(seqResult.transformerEval.lossCurve.finalTrainLoss * 10000) /
            10000,
          regRmse: Math.round(regResult.linearFit.rmse * 100) / 100,
          datasetFingerprint,
          eventCount: events.length,
          entityCount: totalEntitiesCount,
          appliedCurationRules: [...appliedCurationRules],
          enabledEngineeredFeatures: [...enabledEngineeredFeatures],
        }}
        onLoadWorkspace={handleLoadWorkspace}
      />

      <GeminiChatDrawer
        isOpen={isChatOpen}
        onClose={() => setIsChatOpen(false)}
        datasetName={datasetName}
        datasetDomain={datasetDomain}
        totalEntities={totalEntitiesCount}
        totalEvents={events.length}
        globalConfig={globalConfig}
        regConfig={regConfig}
        seqConfig={seqConfig}
        mdpConfig={mdpConfig}
        regResult={regResult}
        seqResult={seqResult}
        mdpResult={mdpResult}
        audits={audits}
      />
    </div>
  );
}
