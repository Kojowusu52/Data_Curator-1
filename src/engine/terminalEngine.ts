import {
  computeRetentionCohortAnalysis,
  cloneExperimentConfigs,
  formatTimestampedSnapshotName,
  searchWorkspaceCatalog,
  validateSqlEditorSyntax,
} from './curationEngine';
import {
  AuditCheck,
  DatasetPreset,
  GlobalCurationConfig,
  MdpConfig,
  MdpResult,
  RawEvent,
  RegressionConfig,
  RegressionResult,
  SequenceConfig,
  SequenceResult,
  WorkspaceTab,
} from '../types/curation';

export type TerminalLineTone =
  | 'input'
  | 'info'
  | 'success'
  | 'warn'
  | 'error'
  | 'table'
  | 'muted';

export interface TerminalOutputLine {
  id: string;
  tone: TerminalLineTone;
  text: string;
}

export interface LocalSnapshotSummary {
  workspaceId: string;
  name: string;
  datasetName: string;
  timestamp: string;
  regR2?: number;
}

export type BatchLogStatusCode = 100 | 102 | 200 | 206 | 422 | 500;

export interface BatchProcessingLogEntry {
  id: string;
  jobId: string;
  timestamp: string;
  pipeline: 'Regression' | 'Sequence' | 'Offline RL' | 'Events' | 'Sync';
  stage: string;
  statusCode: BatchLogStatusCode;
  statusLabel: 'INIT' | 'PROC' | 'OK' | 'PARTIAL' | 'WARN' | 'ERR';
  progressPct: number;
  batchDetail: string;
  durationMs?: number;
}

export interface TerminalExecutionContext {
  activeTab: WorkspaceTab;
  activePresetId: string;
  customDatasetName: string | null;
  datasetName: string;
  datasetDomain: string;
  events: RawEvent[];
  presets: DatasetPreset[];
  globalConfig: GlobalCurationConfig;
  regConfig: RegressionConfig;
  seqConfig: SequenceConfig;
  mdpConfig: MdpConfig;
  regResult: RegressionResult;
  seqResult: SequenceResult;
  mdpResult: MdpResult;
  audits: AuditCheck[];
  batchLogs?: BatchProcessingLogEntry[];
  onRunBatchMaterialization?: () => void;
  onSelectTab: (tab: WorkspaceTab) => void;
  onSelectPreset: (id: string) => void;
  onUpdateGlobalConfig: (next: GlobalCurationConfig) => void;
  onUpdateRegConfig: (next: RegressionConfig) => void;
  onUpdateSeqConfig: (next: SequenceConfig) => void;
  onUpdateMdpConfig: (next: MdpConfig) => void;
  onExport: (kind: 'csv' | 'sql' | 'seq' | 'mdp' | 'events') => void;
  onSaveSnapshot?: (customName?: string) => LocalSnapshotSummary;
  onListSnapshots?: () => LocalSnapshotSummary[];
}

export interface TerminalExecutionResult {
  lines: TerminalOutputLine[];
  clear?: boolean;
}

const VALID_TABS: { id: WorkspaceTab; aliases: string[]; description: string }[] = [
  { id: 'overview', aliases: ['overview', 'home', 'lineage'], description: 'Overview & Lineage' },
  { id: 'regression', aliases: ['regression', 'reg', 'ltv'], description: 'Regression (LTV)' },
  { id: 'model_comparison', aliases: ['model_comparison', 'ab', 'compare'], description: 'Model Comparison (A/B)' },
  { id: 'sequence', aliases: ['sequence', 'seq', 'transformer', 'dl'], description: 'Deep Learning (Sequential Tensors)' },
  { id: 'hyperparameter_optimizer', aliases: ['hyperparameter_optimizer', 'hpo', 'optimizer'], description: 'Hyperparameter Optimizer' },
  { id: 'offline_rl', aliases: ['offline_rl', 'rl', 'mdp', 'cql'], description: 'Offline RL (CQL / MDP)' },
  { id: 'retention_cohorts', aliases: ['retention_cohorts', 'cohorts', 'retention'], description: 'Retention Cohort Analysis (D3)' },
  { id: 'snapshot_comparison', aliases: ['snapshot_comparison', 'snapshots', 'diff'], description: 'Snapshot Comparison' },
  { id: 'data_explorer', aliases: ['data_explorer', 'explorer', 'events'], description: 'Data Explorer' },
  { id: 'dataset_search', aliases: ['dataset_search', 'search', 'catalog'], description: 'Search & Metadata Catalog' },
  { id: 'governance_repository', aliases: ['governance_repository', 'governance', 'gov', 'vcs', 'archive', 'vault', 'metadata'], description: 'Governance, VCS & Archive' },
  { id: 'audit_export', aliases: ['audit_export', 'audit', 'export', 'sql'], description: 'Validation & Export' },
];

const CONFIG_KEYS = [
  'trainRatio',
  'seedSalt',
  'obsCutoffDay',
  'horizonDays',
  'winsorizePercentile',
  'klDriftThreshold',
  'outlierStdThreshold',
  'featureNormalization',
  'splitFilter',
  'excludeZeroObsEntities',
  'excludeDetectedOutliers',
  'maxSeqLen',
  'minSeqLen',
  'padding',
  'truncation',
  'normalization',
  'dModel',
  'numHeads',
  'numLayers',
  'batchSize',
  'learningRate',
  'dropoutRate',
  'gamma',
  'terminalInactivityGapDays',
  'rewardScale',
  'minTrajectorySteps',
  'includeAbsorbingStep',
];

const BASE_COMMANDS = [
  'help',
  'status',
  'ls',
  'cd',
  'use',
  'config',
  'metrics',
  'audit',
  'cohorts',
  'sql',
  'search',
  'snapshot',
  'snapshots',
  'export',
  'logs',
  'materialize',
  'clear',
];

function makeLine(tone: TerminalLineTone, text: string): TerminalOutputLine {
  return {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    tone,
    text,
  };
}

function tokenizeArgs(raw: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current.length > 0) {
        tokens.push(current);
        current = '';
      }
      continue;
    }
    current += ch;
  }
  if (current.length > 0) {
    tokens.push(current);
  }
  return tokens;
}

function formatAsciiTable(headers: string[], rows: string[][]): string[] {
  const widths = headers.map((h, idx) =>
    Math.max(h.length, ...rows.map((r) => (r[idx] ?? '').length))
  );
  const padRow = (cols: string[]) =>
    cols.map((c, idx) => c.padEnd(widths[idx], ' ')).join('  ');
  const sep = widths.map((w) => '-'.repeat(w)).join('  ');
  return [padRow(headers), sep, ...rows.map(padRow)];
}

function resolveTabAlias(raw: string): WorkspaceTab | null {
  const q = raw.trim().toLowerCase();
  for (const t of VALID_TABS) {
    if (t.id === q || t.aliases.includes(q)) return t.id;
  }
  return null;
}

function executeInMemorySql(
  sqlQuery: string,
  ctx: TerminalExecutionContext
): TerminalOutputLine[] {
  const trimmed = sqlQuery.trim().replace(/;+\s*$/, '');
  const validation = validateSqlEditorSyntax(trimmed, ctx.regConfig);

  // Check if querying stratum_events or stratum_regression_ltv
  const isEventsTable = /\bfrom\s+stratum_events\b/i.test(trimmed);
  const tableName = isEventsTable ? 'stratum_events' : 'stratum_regression_ltv';

  if (!/^select\b/i.test(trimmed)) {
    return [
      makeLine(
        'error',
        'Only read-only SELECT queries are supported in the Stratum terminal (e.g. SELECT entity_id, split, target_ltv_raw FROM stratum_regression_ltv LIMIT 8).'
      ),
    ];
  }

  if (!isEventsTable && validation.errorCount > 0) {
    return [
      makeLine(
        'error',
        `SQL syntax/schema check reported ${validation.errorCount} error(s): ${validation.diagnostics
          .filter((d) => d.severity === 'error')
          .map((d) => d.message)
          .join(' | ')}`
      ),
    ];
  }

  const selectMatch = trimmed.match(/^select\s+([\s\S]+?)\s+from\s+([a-zA-Z0-9_]+)/i);
  if (!selectMatch) {
    return [
      makeLine(
        'error',
        `Could not parse SELECT ... FROM ${tableName} clause.`
      ),
    ];
  }

  const projectionRaw = selectMatch[1].trim();
  const afterFrom = trimmed.slice(selectMatch.index! + selectMatch[0].length);

  // Build uniform row records for the requested table
  const regRecords: Record<string, string | number | boolean>[] = ctx.regResult.rows.map((r) => ({
    entity_id: r.entityId,
    split: r.split,
    batch_id: r.batchId,
    batch_size: ctx.regConfig.batchSize || 32,
    normalization: ctx.regConfig.featureNormalization,
    obs_recency_days: r.recencyAtCutoff,
    obs_frequency: r.txCountObs,
    obs_monetary_total: Number(r.monetarySumObs.toFixed(2)),
    obs_monetary_mean: Number(r.avgOrderValueObs.toFixed(2)),
    obs_engagement_mean: Number(r.meanEngagementObs.toFixed(3)),
    obs_promo_share: Number(r.promoShareObs.toFixed(3)),
    obs_tenure_days: r.tenureDaysObs,
    predicted_horizon_ltv: Number(r.predictedHorizonLtv.toFixed(2)),
    projected_future_ltv: Number(r.projectedFutureLtv.toFixed(2)),
    target_ltv_raw: Number(r.targetLtvRaw.toFixed(2)),
    target_ltv_winsorized: Number(r.targetLtvWinsorized.toFixed(2)),
    leakage_verified: r.leakageVerified,
  }));

  const eventRecords: Record<string, string | number | boolean>[] = ctx.events.map((e) => ({
    event_id: e.eventId,
    entity_id: e.entityId,
    timestamp_day: e.timestampDay,
    action_id: e.actionId,
    action_label: e.actionLabel,
    channel: e.channel,
    recency_days: e.recencyDays,
    frequency_count: e.frequencyCount,
    spend_amount: Number(e.spendAmount.toFixed(2)),
    engagement_score: Number(e.engagementScore.toFixed(3)),
    reward: Number(e.reward.toFixed(2)),
    propensity: Number(e.propensity.toFixed(3)),
  }));

  let rows = isEventsTable ? eventRecords : regRecords;

  // Simple WHERE filter support (supports AND-separated field op value)
  const whereMatch = afterFrom.match(/\bwhere\s+([\s\S]+?)(?=\border\s+by\b|\blimit\b|$)/i);
  if (whereMatch) {
    const conditions = whereMatch[1].split(/\s+and\s+/i);
    for (const cond of conditions) {
      const m = cond
        .trim()
        .match(/^([a-zA-Z0-9_]+)\s*(=|!=|<>|>=|<=|>|<)\s*('[^']*'|"[^"]*"|[a-zA-Z0-9_.-]+)$/);
      if (!m) continue;
      const [, col, op, rawVal] = m;
      const cleanVal = rawVal.replace(/^['"]|['"]$/g, '');
      const numVal = Number(cleanVal);
      const boolVal =
        cleanVal.toLowerCase() === 'true'
          ? true
          : cleanVal.toLowerCase() === 'false'
            ? false
            : null;
      rows = rows.filter((row) => {
        const cell = row[col];
        if (cell === undefined) return false;
        if (boolVal !== null && typeof cell === 'boolean') {
          return op === '=' ? cell === boolVal : cell !== boolVal;
        }
        if (!Number.isNaN(numVal) && typeof cell === 'number') {
          if (op === '=') return cell === numVal;
          if (op === '!=' || op === '<>') return cell !== numVal;
          if (op === '>') return cell > numVal;
          if (op === '<') return cell < numVal;
          if (op === '>=') return cell >= numVal;
          if (op === '<=') return cell <= numVal;
        }
        const sCell = String(cell).toLowerCase();
        const sTarget = cleanVal.toLowerCase();
        if (op === '=') return sCell === sTarget;
        if (op === '!=' || op === '<>') return sCell !== sTarget;
        return false;
      });
    }
  }

  // ORDER BY
  const orderMatch = afterFrom.match(/\border\s+by\s+([a-zA-Z0-9_]+)(?:\s+(asc|desc))?/i);
  if (orderMatch) {
    const sortCol = orderMatch[1];
    const dir = (orderMatch[2] ?? 'asc').toLowerCase() === 'desc' ? -1 : 1;
    rows = [...rows].sort((a, b) => {
      const va = a[sortCol];
      const vb = b[sortCol];
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
      return String(va ?? '').localeCompare(String(vb ?? '')) * dir;
    });
  }

  // COUNT(*) aggregate fast-path
  if (/^count\(\*\)/i.test(projectionRaw)) {
    return [
      makeLine('muted', `Query executed on ${tableName}:`),
      ...formatAsciiTable(['count'], [[String(rows.length)]]).map((l) => makeLine('table', l)),
    ];
  }

  const limitMatch = afterFrom.match(/\blimit\s+(\d+)/i);
  const limit = Math.min(25, Math.max(1, limitMatch ? Number(limitMatch[1]) : 10));
  const sliced = rows.slice(0, limit);

  if (sliced.length === 0) {
    return [makeLine('warn', `0 rows returned from ${tableName}.`)];
  }

  const cols =
    projectionRaw === '*'
      ? Object.keys(sliced[0]).slice(0, 7)
      : projectionRaw
          .split(',')
          .map((c) => c.trim().split(/\s+as\s+/i)[0].trim())
          .filter(Boolean);

  const tableLines = formatAsciiTable(
    cols,
    sliced.map((r) => cols.map((c) => String(r[c] ?? 'NULL')))
  );

  return [
    makeLine(
      'muted',
      `${tableName} · showing ${sliced.length} of ${rows.length} matching row(s)${
        projectionRaw === '*' ? ' (first 7 cols)' : ''
      }`
    ),
    ...tableLines.map((l) => makeLine('table', l)),
  ];
}

export function executeStratumTerminalCommand(
  rawInput: string,
  ctx: TerminalExecutionContext
): TerminalExecutionResult {
  const trimmed = rawInput.trim();
  if (!trimmed) {
    return { lines: [] };
  }

  const args = tokenizeArgs(trimmed);
  const cmd = (args[0] ?? '').toLowerCase();
  const rest = args.slice(1);

  if (cmd === 'clear' || cmd === 'cls') {
    return { lines: [], clear: true };
  }

  if (cmd === 'help' || cmd === '?') {
    return {
      lines: [
        makeLine('info', 'Stratum Workbench CLI — Available Commands:'),
        makeLine('table', '  status                     Show active dataset, splits, configs & audit summary'),
        makeLine('table', '  ls [datasets|views|features|snapshots]  List datasets, tabs, features, or snapshots'),
        makeLine('table', '  cd <view>                  Navigate to view (e.g. cd regression, cd retention_cohorts)'),
        makeLine('table', '  use <presetId>             Switch dataset preset (e.g. use saas_lifecycle)'),
        makeLine('table', '  config get [global|reg|seq|mdp]  Inspect live pipeline configuration JSON'),
        makeLine('table', '  config set <key> <value>   Update live config (e.g. config set obsCutoffDay 120)'),
        makeLine('table', '  metrics [reg|seq|mdp]      Print fitted Regression, Transformer & RL metrics'),
        makeLine('table', '  audit                      Run cross-paradigm leakage & parity audit table'),
        makeLine('table', '  cohorts [14|30|60]         Print D3 cohort retention table for 14d/30d/60d buckets'),
        makeLine('table', '  sql <SELECT ...>           Query stratum_regression_ltv or stratum_events'),
        makeLine('table', '  search <keyword>           Search entities, metrics, events & configs globally'),
        makeLine('table', '  snapshot [name]            Save a timestamped experiment snapshot locally'),
        makeLine('table', '  export <csv|sql|seq|mdp|events>  Download materialized dataset artifacts'),
        makeLine('table', '  logs                       Show recent Batch Processing Logs with status codes'),
        makeLine('table', '  materialize                Run full cross-pipeline batch materialization check'),
        makeLine('table', '  clear                      Clear terminal output (Shortcut: Ctrl+`)'),
      ],
    };
  }

  if (cmd === 'status' || cmd === 'info' || cmd === 'whoami') {
    const passCount = ctx.audits.filter((a) => a.status === 'pass').length;
    const warnCount = ctx.audits.filter((a) => a.status === 'warn').length;
    const failCount = ctx.audits.filter((a) => a.status === 'fail').length;
    const uniqueEntities = new Set(ctx.events.map((e) => e.entityId)).size;
    return {
      lines: [
        makeLine('info', `Dataset      : ${ctx.datasetName} (${ctx.datasetDomain})`),
        makeLine('info', `Active View  : ${ctx.activeTab}`),
        makeLine('info', `Volume       : ${uniqueEntities} entities · ${ctx.events.length.toLocaleString()} events`),
        makeLine(
          'info',
          `Hash Split   : ${Math.round(ctx.globalConfig.trainRatio * 100)}/${Math.round(
            ctx.globalConfig.valRatio * 100
          )}/${Math.round(ctx.globalConfig.testRatio * 100)} (salt="${ctx.globalConfig.seedSalt}")`
        ),
        makeLine(
          'info',
          `Regression   : T_obs=${ctx.regConfig.obsCutoffDay}d, H=${ctx.regConfig.horizonDays}d, R²=${ctx.regResult.linearFit.rSquared.toFixed(
            3
          )}, RMSE=$${ctx.regResult.linearFit.rmse.toFixed(2)}`
        ),
        makeLine(
          'info',
          `Sequence     : tensor=[${ctx.seqResult.tensorShape.join(', ')}], trunc=${ctx.seqConfig.truncation}, pad=${ctx.seqConfig.padding}`
        ),
        makeLine(
          'info',
          `Offline RL   : gamma=${ctx.mdpConfig.gamma}, scale=${ctx.mdpConfig.rewardScale}, transitions=${ctx.mdpResult.transitions.length}`
        ),
        makeLine(
          failCount > 0 ? 'error' : warnCount > 0 ? 'warn' : 'success',
          `Audit Status : ${passCount} PASS · ${warnCount} WARN · ${failCount} FAIL`
        ),
      ],
    };
  }

  if (cmd === 'ls') {
    const target = (rest[0] ?? 'all').toLowerCase();
    const lines: TerminalOutputLine[] = [];

    if (target === 'all' || target === 'datasets' || target === 'presets') {
      lines.push(makeLine('info', 'Datasets:'));
      for (const p of ctx.presets) {
        const activeMark = !ctx.customDatasetName && p.id === ctx.activePresetId ? '*' : ' ';
        lines.push(
          makeLine('table', ` ${activeMark} ${p.id.padEnd(24)} ${p.name} (${p.events.length} events)`)
        );
      }
      if (ctx.customDatasetName) {
        lines.push(
          makeLine('table', ` * custom_csv               ${ctx.customDatasetName} (${ctx.events.length} events)`)
        );
      }
    }

    if (target === 'all' || target === 'views' || target === 'tabs') {
      lines.push(makeLine('info', 'Workspace Views:'));
      for (const t of VALID_TABS) {
        const activeMark = t.id === ctx.activeTab ? '*' : ' ';
        lines.push(makeLine('table', ` ${activeMark} ${t.id.padEnd(26)} ${t.description}`));
      }
    }

    if (target === 'features') {
      lines.push(makeLine('info', 'Active Regression Features:'));
      for (const f of ctx.regConfig.selectedFeatures) {
        lines.push(makeLine('table', `  - ${f}`));
      }
    }

    if (target === 'snapshots') {
      const snaps = ctx.onListSnapshots?.() ?? [];
      if (snaps.length === 0) {
        lines.push(makeLine('warn', 'No local snapshots saved yet. Run `snapshot` to create one.'));
      } else {
        lines.push(makeLine('info', `Saved Local Snapshots (${snaps.length}):`));
        lines.push(
          ...formatAsciiTable(
            ['Name', 'Dataset', 'Reg R²', 'Timestamp'],
            snaps.map((s) => [
              s.name,
              s.datasetName,
              s.regR2 !== undefined ? s.regR2.toFixed(3) : '—',
              s.timestamp,
            ])
          ).map((l) => makeLine('table', l))
        );
      }
    }

    if (lines.length === 0) {
      return {
        lines: [makeLine('warn', `Unknown ls target "${target}". Try: ls datasets | views | features | snapshots`)],
      };
    }
    return { lines };
  }

  if (cmd === 'snapshots') {
    return executeStratumTerminalCommand('ls snapshots', ctx);
  }

  if (cmd === 'cd' || cmd === 'open' || cmd === 'goto') {
    const rawTarget = rest[0];
    if (!rawTarget) {
      return { lines: [makeLine('warn', 'Usage: cd <view>. Run `ls views` to list available views.')] };
    }
    const resolved = resolveTabAlias(rawTarget);
    if (!resolved) {
      return { lines: [makeLine('error', `Unknown view "${rawTarget}". Run \`ls views\` to see valid tabs.`)] };
    }
    ctx.onSelectTab(resolved);
    return { lines: [makeLine('success', `Navigated to view: ${resolved}`)] };
  }

  if (cmd === 'use') {
    const rawPreset = rest[0]?.toLowerCase();
    if (!rawPreset) {
      return { lines: [makeLine('warn', 'Usage: use <presetId>. Run `ls datasets` to see presets.')] };
    }
    const match =
      ctx.presets.find((p) => p.id.toLowerCase() === rawPreset) ??
      ctx.presets.find((p) => p.id.toLowerCase().startsWith(rawPreset)) ??
      ctx.presets.find((p) => p.name.toLowerCase().includes(rawPreset));
    if (!match) {
      return { lines: [makeLine('error', `Preset "${rawPreset}" not found. Run \`ls datasets\`.`)] };
    }
    ctx.onSelectPreset(match.id);
    return { lines: [makeLine('success', `Switched dataset to ${match.name} (${match.id})`)] };
  }

  if (cmd === 'config') {
    const sub = (rest[0] ?? 'get').toLowerCase();
    if (sub === 'get') {
      const scope = (rest[1] ?? 'all').toLowerCase();
      const payload =
        scope === 'global'
          ? ctx.globalConfig
          : scope === 'reg' || scope === 'regression'
            ? ctx.regConfig
            : scope === 'seq' || scope === 'sequence'
              ? ctx.seqConfig
              : scope === 'mdp' || scope === 'rl'
                ? ctx.mdpConfig
                : {
                    globalConfig: ctx.globalConfig,
                    regConfig: ctx.regConfig,
                    seqConfig: ctx.seqConfig,
                    mdpConfig: ctx.mdpConfig,
                  };
      return {
        lines: JSON.stringify(payload, null, 2)
          .split('\n')
          .map((l) => makeLine('table', l)),
      };
    }

    if (sub === 'set') {
      const key = rest[1];
      const rawVal = rest[2];
      if (!key || rawVal === undefined) {
        return {
          lines: [
            makeLine('warn', 'Usage: config set <key> <value>  (e.g. config set obsCutoffDay 120)'),
          ],
        };
      }
      const numVal = Number(rawVal);
      const boolVal =
        rawVal.toLowerCase() === 'true'
          ? true
          : rawVal.toLowerCase() === 'false'
            ? false
            : null;

      switch (key) {
        case 'seedSalt':
          ctx.onUpdateGlobalConfig({ ...ctx.globalConfig, seedSalt: rawVal });
          return { lines: [makeLine('success', `globalConfig.seedSalt = "${rawVal}"`)] };
        case 'trainRatio': {
          if (Number.isNaN(numVal) || numVal <= 0.1 || numVal >= 0.95) {
            return { lines: [makeLine('error', 'trainRatio must be between 0.10 and 0.95')] };
          }
          const rem = Number((1 - numVal).toFixed(4));
          const valRatio = Number((rem / 2).toFixed(4));
          const testRatio = Number((rem - valRatio).toFixed(4));
          ctx.onUpdateGlobalConfig({ ...ctx.globalConfig, trainRatio: numVal, valRatio, testRatio });
          return {
            lines: [
              makeLine(
                'success',
                `globalConfig splits updated: ${Math.round(numVal * 100)}/${Math.round(
                  valRatio * 100
                )}/${Math.round(testRatio * 100)}`
              ),
            ],
          };
        }
        case 'obsCutoffDay':
        case 'horizonDays':
        case 'winsorizePercentile':
        case 'klDriftThreshold':
        case 'outlierStdThreshold': {
          if (Number.isNaN(numVal) || numVal <= 0) {
            return { lines: [makeLine('error', `${key} requires a positive number.`)] };
          }
          ctx.onUpdateRegConfig({ ...ctx.regConfig, [key]: numVal });
          return { lines: [makeLine('success', `regConfig.${key} = ${numVal}`)] };
        }
        case 'featureNormalization':
          if (!['none', 'zscore', 'minmax'].includes(rawVal)) {
            return { lines: [makeLine('error', 'featureNormalization must be none | zscore | minmax')] };
          }
          ctx.onUpdateRegConfig({
            ...ctx.regConfig,
            featureNormalization: rawVal as RegressionConfig['featureNormalization'],
          });
          return { lines: [makeLine('success', `regConfig.featureNormalization = "${rawVal}"`)] };
        case 'splitFilter':
          if (!['all', 'train', 'val', 'test'].includes(rawVal)) {
            return { lines: [makeLine('error', 'splitFilter must be all | train | val | test')] };
          }
          ctx.onUpdateRegConfig({
            ...ctx.regConfig,
            splitFilter: rawVal as RegressionConfig['splitFilter'],
          });
          ctx.onUpdateSeqConfig({
            ...ctx.seqConfig,
            splitFilter: rawVal as SequenceConfig['splitFilter'],
          });
          ctx.onUpdateMdpConfig({
            ...ctx.mdpConfig,
            splitFilter: rawVal as MdpConfig['splitFilter'],
          });
          return { lines: [makeLine('success', `Updated splitFilter across all pipelines = "${rawVal}"`)] };
        case 'excludeZeroObsEntities':
        case 'excludeDetectedOutliers':
          if (boolVal === null) {
            return { lines: [makeLine('error', `${key} requires true or false`)] };
          }
          ctx.onUpdateRegConfig({ ...ctx.regConfig, [key]: boolVal });
          return { lines: [makeLine('success', `regConfig.${key} = ${boolVal}`)] };
        case 'maxSeqLen':
        case 'minSeqLen':
        case 'dModel':
        case 'numHeads':
        case 'numLayers':
        case 'batchSize':
        case 'learningRate':
        case 'dropoutRate': {
          if (Number.isNaN(numVal) || numVal < 0) {
            return { lines: [makeLine('error', `${key} requires a non-negative number.`)] };
          }
          ctx.onUpdateSeqConfig({ ...ctx.seqConfig, [key]: numVal });
          if (key === 'batchSize') {
            ctx.onUpdateRegConfig({ ...ctx.regConfig, batchSize: numVal });
          }
          return { lines: [makeLine('success', `seqConfig.${key} = ${numVal}`)] };
        }
        case 'padding':
          if (!['pre', 'post'].includes(rawVal)) {
            return { lines: [makeLine('error', 'padding must be pre | post')] };
          }
          ctx.onUpdateSeqConfig({ ...ctx.seqConfig, padding: rawVal as SequenceConfig['padding'] });
          return { lines: [makeLine('success', `seqConfig.padding = "${rawVal}"`)] };
        case 'truncation':
          if (!['recent', 'early'].includes(rawVal)) {
            return { lines: [makeLine('error', 'truncation must be recent | early')] };
          }
          ctx.onUpdateSeqConfig({
            ...ctx.seqConfig,
            truncation: rawVal as SequenceConfig['truncation'],
          });
          return { lines: [makeLine('success', `seqConfig.truncation = "${rawVal}"`)] };
        case 'normalization':
          if (!['zscore', 'minmax', 'log1p_zscore'].includes(rawVal)) {
            return { lines: [makeLine('error', 'normalization must be zscore | minmax | log1p_zscore')] };
          }
          ctx.onUpdateSeqConfig({
            ...ctx.seqConfig,
            normalization: rawVal as SequenceConfig['normalization'],
          });
          return { lines: [makeLine('success', `seqConfig.normalization = "${rawVal}"`)] };
        case 'gamma':
          if (Number.isNaN(numVal) || numVal <= 0 || numVal > 1) {
            return { lines: [makeLine('error', 'gamma must be in (0, 1.0]')] };
          }
          ctx.onUpdateMdpConfig({ ...ctx.mdpConfig, gamma: numVal });
          return { lines: [makeLine('success', `mdpConfig.gamma = ${numVal}`)] };
        case 'terminalInactivityGapDays':
        case 'minTrajectorySteps':
          if (Number.isNaN(numVal) || numVal < 1) {
            return { lines: [makeLine('error', `${key} must be >= 1`)] };
          }
          ctx.onUpdateMdpConfig({ ...ctx.mdpConfig, [key]: Math.round(numVal) });
          return { lines: [makeLine('success', `mdpConfig.${key} = ${Math.round(numVal)}`)] };
        case 'rewardScale':
          if (!['raw', 'clipped_10', 'standardized'].includes(rawVal)) {
            return { lines: [makeLine('error', 'rewardScale must be raw | clipped_10 | standardized')] };
          }
          ctx.onUpdateMdpConfig({
            ...ctx.mdpConfig,
            rewardScale: rawVal as MdpConfig['rewardScale'],
          });
          return { lines: [makeLine('success', `mdpConfig.rewardScale = "${rawVal}"`)] };
        case 'includeAbsorbingStep':
          if (boolVal === null) {
            return { lines: [makeLine('error', 'includeAbsorbingStep requires true or false')] };
          }
          ctx.onUpdateMdpConfig({ ...ctx.mdpConfig, includeAbsorbingStep: boolVal });
          return { lines: [makeLine('success', `mdpConfig.includeAbsorbingStep = ${boolVal}`)] };
        default:
          return {
            lines: [
              makeLine(
                'error',
                `Unknown config key "${key}". Supported keys include: obsCutoffDay, horizonDays, maxSeqLen, truncation, gamma, rewardScale, klDriftThreshold, trainRatio.`
              ),
            ],
          };
      }
    }

    return { lines: [makeLine('warn', 'Usage: config get [global|reg|seq|mdp] | config set <key> <value>')] };
  }

  if (cmd === 'metrics') {
    const scope = (rest[0] ?? 'all').toLowerCase();
    const lines: TerminalOutputLine[] = [];

    if (scope === 'all' || scope === 'reg' || scope === 'regression') {
      const topFeat = [...ctx.regResult.linearFit.features].sort(
        (a, b) => b.importanceShare - a.importanceShare
      )[0];
      lines.push(makeLine('info', 'Regression (OLS LTV):'));
      lines.push(
        makeLine(
          'table',
          `  rows=${ctx.regResult.rows.length} | R²=${ctx.regResult.linearFit.rSquared.toFixed(
            4
          )} | RMSE=$${ctx.regResult.linearFit.rmse.toFixed(
            2
          )} | MAE=$${ctx.regResult.linearFit.mae.toFixed(2)} | meanLTV=$${ctx.regResult.meanTargetRaw.toFixed(
            2
          )}${topFeat ? ` | topDriver=${topFeat.label} (${topFeat.importanceShare.toFixed(1)}%)` : ''}`
        )
      );
    }

    if (scope === 'all' || scope === 'seq' || scope === 'sequence') {
      const seqR2 =
        ctx.seqResult.transformerEval.holdoutMetrics.rSquared ??
        ctx.seqResult.transformerEval.allMetrics.rSquared;
      const truncRate =
        ctx.seqResult.samples.length > 0
          ? ctx.seqResult.truncatedEntitiesCount / ctx.seqResult.samples.length
          : 0;
      lines.push(makeLine('info', 'Sequence Tensor Pipeline:'));
      lines.push(
        makeLine(
          'table',
          `  shape=[${ctx.seqResult.tensorShape.join(', ')}] | truncRate=${(
            truncRate * 100
          ).toFixed(1)}% | padSparsity=${(ctx.seqResult.paddingSparsity * 100).toFixed(
            1
          )}% | R²=${seqR2 !== null ? seqR2.toFixed(4) : 'N/A'}`
        )
      );
    }

    if (scope === 'all' || scope === 'mdp' || scope === 'rl') {
      const termRate =
        ctx.mdpResult.trajectoryCount > 0
          ? ctx.mdpResult.terminalCount / ctx.mdpResult.trajectoryCount
          : 0;
      lines.push(makeLine('info', 'Offline RL (MDP):'));
      lines.push(
        makeLine(
          'table',
          `  trajectories=${ctx.mdpResult.trajectoryCount} | transitions=${ctx.mdpResult.transitions.length} | meanSteps=${ctx.mdpResult.meanTrajectoryLength.toFixed(
            1
          )} | terminalRate=${(termRate * 100).toFixed(
            1
          )}% | meanInitialReturn=$${ctx.mdpResult.meanInitialReturn.toFixed(2)}`
        )
      );
    }

    return { lines };
  }

  if (cmd === 'audit') {
    const rows = ctx.audits.map((a) => [
      a.status.toUpperCase(),
      a.paradigm,
      a.name,
      a.metricValue,
    ]);
    return {
      lines: [
        makeLine('info', `Cross-Paradigm Integrity Audit (${ctx.datasetName}):`),
        ...formatAsciiTable(['Status', 'Paradigm', 'Check', 'Metric'], rows).map((l) =>
          makeLine('table', l)
        ),
      ],
    };
  }

  if (cmd === 'cohorts') {
    const requestedDays = Number(rest[0] ?? 30);
    const periodDays: 14 | 30 | 60 =
      requestedDays === 14 ? 14 : requestedDays === 60 ? 60 : 30;
    const analysis = computeRetentionCohortAnalysis(ctx.events, ctx.globalConfig, {
      periodDays,
      splitFilter: 'all',
      channelFilter: 'all',
    });
    const rows = analysis.cohorts.slice(0, 10).map((c) => [
      c.cohortLabel,
      String(c.cohortSize),
      c.cells[0] ? `${c.cells[0].retentionPct.toFixed(0)}%` : '—',
      c.cells[1] ? `${c.cells[1].retentionPct.toFixed(1)}%` : '—',
      c.cells[2] ? `${c.cells[2].retentionPct.toFixed(1)}%` : '—',
      c.cells[3] ? `${c.cells[3].retentionPct.toFixed(1)}%` : '—',
      `$${c.arpu.toFixed(2)}`,
    ]);
    return {
      lines: [
        makeLine(
          'info',
          `Retention Cohort Matrix (${periodDays}d buckets · +1P=${
            analysis.period1RetentionPct !== null
              ? `${analysis.period1RetentionPct.toFixed(1)}%`
              : 'N/A'
          } · Half-Life=${
            analysis.halfLifePeriod !== null ? `${analysis.halfLifePeriod.toFixed(2)}P` : 'N/A'
          }):`
        ),
        ...formatAsciiTable(['Cohort', 'n', 'P0', '+1P', '+2P', '+3P', 'ARPU'], rows).map((l) =>
          makeLine('table', l)
        ),
      ],
    };
  }

  if (cmd === 'sql') {
    const queryStr = trimmed.slice(3).trim();
    if (!queryStr) {
      return {
        lines: [
          makeLine(
            'warn',
            'Usage: sql SELECT entity_id, split, target_ltv_raw FROM stratum_regression_ltv LIMIT 5'
          ),
        ],
      };
    }
    return { lines: executeInMemorySql(queryStr, ctx) };
  }

  if (cmd === 'select') {
    return { lines: executeInMemorySql(trimmed, ctx) };
  }

  if (cmd === 'search') {
    const q = rest.join(' ').trim();
    if (!q) {
      return { lines: [makeLine('warn', 'Usage: search <keyword>')] };
    }
    const report = searchWorkspaceCatalog(q, {
      activePresetId: ctx.activePresetId,
      customDatasetName: ctx.customDatasetName,
      datasetName: ctx.datasetName,
      datasetDomain: ctx.datasetDomain,
      events: ctx.events,
      presets: ctx.presets,
      globalConfig: ctx.globalConfig,
      regConfig: ctx.regConfig,
      seqConfig: ctx.seqConfig,
      mdpConfig: ctx.mdpConfig,
      piiMaskingConfig: { enabled: false, mode: 'hash', salt: 'stratum-pii-v1' },
      regResult: ctx.regResult,
      seqResult: ctx.seqResult,
      mdpResult: ctx.mdpResult,
      audits: ctx.audits,
    });
    if (report.items.length === 0) {
      return { lines: [makeLine('warn', `No workspace items matched "${q}".`)] };
    }
    const rows = report.items.slice(0, 8).map((item) => [
      item.category,
      item.title,
      item.targetTab,
      item.valueText ?? '—',
    ]);
    return {
      lines: [
        makeLine('info', `Search results for "${q}" (${report.totalMatches} total):`),
        ...formatAsciiTable(['Category', 'Item', 'View', 'Value'], rows).map((l) =>
          makeLine('table', l)
        ),
      ],
    };
  }

  if (cmd === 'snapshot') {
    if (!ctx.onSaveSnapshot) {
      return { lines: [makeLine('error', 'Snapshot handler unavailable.')] };
    }
    const label = rest.join(' ').trim() || undefined;
    const saved = ctx.onSaveSnapshot(label);
    return {
      lines: [
        makeLine(
          'success',
          `Saved timestamped snapshot "${saved.name}" (${saved.workspaceId}) for ${saved.datasetName}.`
        ),
      ],
    };
  }

  if (cmd === 'export') {
    const kindRaw = (rest[0] ?? 'csv').toLowerCase();
    const validKinds: Record<string, 'csv' | 'sql' | 'seq' | 'mdp' | 'events'> = {
      csv: 'csv',
      reg: 'csv',
      sql: 'sql',
      seq: 'seq',
      json: 'seq',
      mdp: 'mdp',
      rl: 'mdp',
      events: 'events',
    };
    const mapped = validKinds[kindRaw];
    if (!mapped) {
      return {
        lines: [makeLine('error', 'Usage: export <csv|sql|seq|mdp|events>')],
      };
    }
    ctx.onExport(mapped);
    return { lines: [makeLine('success', `Triggered ${mapped.toUpperCase()} export download.`)] };
  }

  if (cmd === 'logs') {
    const entries = ctx.batchLogs ?? [];
    if (entries.length === 0) {
      return {
        lines: [
          makeLine('warn', 'No batch processing logs recorded yet. Run `materialize` or trigger an export.'),
        ],
      };
    }
    const recent = entries.slice(0, 12);
    return {
      lines: [
        makeLine('info', `Recent Batch Processing Logs (${recent.length} of ${entries.length}):`),
        ...formatAsciiTable(
          ['Time', 'Code', 'Pipeline', 'Stage', 'Progress', 'Detail'],
          recent.map((l) => [
            l.timestamp,
            `${l.statusCode} ${l.statusLabel}`,
            l.pipeline,
            l.stage,
            `${l.progressPct}%`,
            l.batchDetail,
          ])
        ).map((line) => makeLine('table', line)),
      ],
    };
  }

  if (cmd === 'materialize') {
    if (!ctx.onRunBatchMaterialization) {
      return { lines: [makeLine('warn', 'Batch materialization runner unavailable.')] };
    }
    ctx.onRunBatchMaterialization();
    return {
      lines: [
        makeLine(
          'success',
          'Started cross-pipeline batch materialization job. Watch Batch Processing Logs for status codes.'
        ),
      ],
    };
  }

  // Helpful clone validation check
  void cloneExperimentConfigs;
  void formatTimestampedSnapshotName;

  return {
    lines: [
      makeLine('error', `Command not found: "${cmd}". Type \`help\` to list supported Stratum CLI commands.`),
    ],
  };
}

export function getTerminalAutocomplete(
  rawInput: string,
  presets: DatasetPreset[]
): string | null {
  const trimmedStart = rawInput.trimStart();
  if (!trimmedStart) return null;
  const endsWithSpace = /\s$/.test(rawInput);
  const parts = tokenizeArgs(trimmedStart);

  if (parts.length === 1 && !endsWithSpace) {
    const q = parts[0].toLowerCase();
    const match = BASE_COMMANDS.find((c) => c.startsWith(q));
    return match ? `${match} ` : null;
  }

  const cmd = parts[0].toLowerCase();
  const arg = endsWithSpace ? '' : (parts[parts.length - 1] ?? '').toLowerCase();

  if (cmd === 'cd' || cmd === 'open' || cmd === 'goto') {
    const match = VALID_TABS.find((t) => t.id.startsWith(arg));
    return match ? `${cmd} ${match.id}` : null;
  }
  if (cmd === 'use') {
    const match = presets.find((p) => p.id.toLowerCase().startsWith(arg));
    return match ? `use ${match.id}` : null;
  }
  if (cmd === 'config' && parts.length >= 2 && parts[1].toLowerCase() === 'set') {
    if (parts.length === 2 && endsWithSpace) {
      return `config set ${CONFIG_KEYS[0]} `;
    }
    if (parts.length === 3 && !endsWithSpace) {
      const match = CONFIG_KEYS.find((k) => k.toLowerCase().startsWith(arg));
      return match ? `config set ${match} ` : null;
    }
  }
  if (cmd === 'export') {
    const kinds = ['csv', 'sql', 'seq', 'mdp', 'events'];
    const match = kinds.find((k) => k.startsWith(arg));
    return match ? `export ${match}` : null;
  }
  if (cmd === 'ls') {
    const targets = ['datasets', 'views', 'features', 'snapshots'];
    const match = targets.find((t) => t.startsWith(arg));
    return match ? `ls ${match}` : null;
  }
  return null;
}
