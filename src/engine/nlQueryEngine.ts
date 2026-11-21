import {
  GlobalCurationConfig,
  MdpResult,
  NlQueryAggMetric,
  NlQueryColumnMeta,
  NlQueryExecutionResult,
  NlQueryFilterPredicate,
  NlQueryPlan,
  NlQueryTargetTable,
  RawEvent,
  RegressionResult,
} from '../types/curation';
import { assignEntitySplit } from './curationEngine';

export interface TableFieldDefinition extends NlQueryColumnMeta {
  aliases?: string[];
  sqlColumn: string;
  groupable?: boolean;
  defaultVisible?: boolean;
}

export const NL_TABLE_LABELS: Record<NlQueryTargetTable, string> = {
  events: 'canonical_events (Event Log)',
  regression_rows: 'regression_ltv (Entity Features & Targets)',
  mdp_transitions: 'offline_rl_mdp (MDP Transitions)',
};

export const NL_TABLE_FIELDS: Record<NlQueryTargetTable, TableFieldDefinition[]> = {
  events: [
    { key: 'eventId', sqlColumn: 'event_id', label: 'Event ID', isNumeric: false, format: 'text', defaultVisible: true },
    { key: 'entityId', sqlColumn: 'entity_id', label: 'Entity ID', isNumeric: false, format: 'text', defaultVisible: true },
    { key: 'split', sqlColumn: 'split', label: 'Split', isNumeric: false, format: 'text', groupable: true, defaultVisible: true },
    { key: 'windowPhase', sqlColumn: 'window_phase', label: 'Window', isNumeric: false, format: 'text', groupable: true, defaultVisible: true },
    { key: 'timestampDay', sqlColumn: 'timestamp_day', label: 'Day', isNumeric: true, format: 'int', defaultVisible: true, aliases: ['day', 'timestamp'] },
    { key: 'actionId', sqlColumn: 'action_id', label: 'Action ID', isNumeric: true, format: 'int', groupable: true, defaultVisible: false },
    { key: 'actionLabel', sqlColumn: 'action_label', label: 'Action', isNumeric: false, format: 'text', groupable: true, defaultVisible: true, aliases: ['action'] },
    { key: 'channel', sqlColumn: 'channel', label: 'Channel', isNumeric: false, format: 'text', groupable: true, defaultVisible: true },
    { key: 'spendAmount', sqlColumn: 'spend_amount', label: 'Spend ($)', isNumeric: true, format: 'currency', defaultVisible: true, aliases: ['spend', 'amount', 'revenue'] },
    { key: 'reward', sqlColumn: 'reward', label: 'Reward', isNumeric: true, format: 'decimal', defaultVisible: true },
    { key: 'engagementScore', sqlColumn: 'engagement_score', label: 'Engagement', isNumeric: true, format: 'decimal', defaultVisible: true, aliases: ['engagement'] },
    { key: 'propensity', sqlColumn: 'propensity', label: 'Propensity', isNumeric: true, format: 'decimal', defaultVisible: true },
    { key: 'recencyDays', sqlColumn: 'recency_days', label: 'Recency (d)', isNumeric: true, format: 'int', defaultVisible: false, aliases: ['recency'] },
    { key: 'frequencyCount', sqlColumn: 'frequency_count', label: 'Freq', isNumeric: true, format: 'int', defaultVisible: false, aliases: ['frequency'] },
  ],
  regression_rows: [
    { key: 'entityId', sqlColumn: 'entity_id', label: 'Entity ID', isNumeric: false, format: 'text', defaultVisible: true },
    { key: 'split', sqlColumn: 'split', label: 'Split', isNumeric: false, format: 'text', groupable: true, defaultVisible: true },
    { key: 'txCountObs', sqlColumn: 'tx_count_obs', label: 'Obs Tx Count', isNumeric: true, format: 'int', defaultVisible: true },
    { key: 'monetarySumObs', sqlColumn: 'monetary_sum_obs', label: 'Obs Spend ($)', isNumeric: true, format: 'currency', defaultVisible: true, aliases: ['observed_spend'] },
    { key: 'avgOrderValueObs', sqlColumn: 'avg_order_value_obs', label: 'AOV ($)', isNumeric: true, format: 'currency', defaultVisible: true, aliases: ['aov'] },
    { key: 'recencyAtCutoff', sqlColumn: 'recency_at_cutoff', label: 'Recency Cutoff (d)', isNumeric: true, format: 'int', defaultVisible: false },
    { key: 'tenureDaysObs', sqlColumn: 'tenure_days_obs', label: 'Tenure (d)', isNumeric: true, format: 'int', defaultVisible: false },
    { key: 'meanEngagementObs', sqlColumn: 'mean_engagement_obs', label: 'Mean Engagement', isNumeric: true, format: 'decimal', defaultVisible: true },
    { key: 'promoShareObs', sqlColumn: 'promo_share_obs', label: 'Promo Share', isNumeric: true, format: 'decimal', defaultVisible: false },
    { key: 'targetLtvRaw', sqlColumn: 'target_ltv_raw', label: 'Target LTV Raw ($)', isNumeric: true, format: 'currency', defaultVisible: true, aliases: ['target_ltv', 'ltv'] },
    { key: 'targetLtvWinsorized', sqlColumn: 'target_ltv_winsorized', label: 'Target LTV Cap ($)', isNumeric: true, format: 'currency', defaultVisible: false },
    { key: 'predictedHorizonLtv', sqlColumn: 'predicted_horizon_ltv', label: 'Predicted LTV ($)', isNumeric: true, format: 'currency', defaultVisible: true, aliases: ['predicted_ltv'] },
    { key: 'currentObservedLtv', sqlColumn: 'current_observed_ltv', label: 'Current Obs LTV ($)', isNumeric: true, format: 'currency', defaultVisible: false },
    { key: 'projectedFutureLtv', sqlColumn: 'projected_future_ltv', label: 'Projected Future ($)', isNumeric: true, format: 'currency', defaultVisible: false },
    { key: 'horizonEventsCount', sqlColumn: 'horizon_events_count', label: 'Horizon Events', isNumeric: true, format: 'int', defaultVisible: true },
    { key: 'leakageVerified', sqlColumn: 'leakage_verified', label: 'Leakage Verified', isNumeric: false, format: 'boolean', groupable: true, defaultVisible: false },
  ],
  mdp_transitions: [
    { key: 'transitionId', sqlColumn: 'transition_id', label: 'Transition ID', isNumeric: false, format: 'text', defaultVisible: true },
    { key: 'entityId', sqlColumn: 'entity_id', label: 'Entity ID', isNumeric: false, format: 'text', defaultVisible: true },
    { key: 'split', sqlColumn: 'split', label: 'Split', isNumeric: false, format: 'text', groupable: true, defaultVisible: true },
    { key: 'stepIdx', sqlColumn: 'step_idx', label: 'Step', isNumeric: true, format: 'int', defaultVisible: true },
    { key: 'timestampDay', sqlColumn: 'timestamp_day', label: 'Day', isNumeric: true, format: 'int', defaultVisible: true },
    { key: 'actionLabel', sqlColumn: 'action_label', label: 'Action', isNumeric: false, format: 'text', groupable: true, defaultVisible: true, aliases: ['action'] },
    { key: 'rewardRaw', sqlColumn: 'reward_raw', label: 'Reward Raw', isNumeric: true, format: 'decimal', defaultVisible: true, aliases: ['reward'] },
    { key: 'rewardScaled', sqlColumn: 'reward_scaled', label: 'Reward Scaled', isNumeric: true, format: 'decimal', defaultVisible: false },
    { key: 'returnToGo', sqlColumn: 'return_to_go', label: 'Return-to-Go', isNumeric: true, format: 'decimal', defaultVisible: true, aliases: ['rtg', 'return'] },
    { key: 'behaviorPropensity', sqlColumn: 'behavior_propensity', label: 'Propensity', isNumeric: true, format: 'decimal', defaultVisible: true, aliases: ['propensity'] },
    { key: 'supportCount', sqlColumn: 'support_count', label: 'Support Count', isNumeric: true, format: 'int', defaultVisible: true },
    { key: 'isLowSupportOod', sqlColumn: 'is_low_support_ood', label: 'Low-Support OOD', isNumeric: false, format: 'boolean', groupable: true, defaultVisible: true, aliases: ['ood'] },
    { key: 'terminalReason', sqlColumn: 'terminal_reason', label: 'Terminal Reason', isNumeric: false, format: 'text', groupable: true, defaultVisible: true },
    { key: 'done', sqlColumn: 'done', label: 'Done', isNumeric: true, format: 'int', groupable: true, defaultVisible: false },
    { key: 'stateCumSpend', sqlColumn: 'state_cum_spend', label: 'State Cum Spend ($)', isNumeric: true, format: 'currency', defaultVisible: true },
    { key: 'stateEngagement', sqlColumn: 'state_engagement', label: 'State Engagement', isNumeric: true, format: 'decimal', defaultVisible: false },
    { key: 'stateFrequency', sqlColumn: 'state_frequency', label: 'State Freq', isNumeric: true, format: 'int', defaultVisible: false },
    { key: 'stateRecency', sqlColumn: 'state_recency', label: 'State Recency (d)', isNumeric: true, format: 'int', defaultVisible: false },
  ],
};

export function normalizeFieldKey(table: NlQueryTargetTable, rawField: string): string {
  const fields = NL_TABLE_FIELDS[table];
  const normalized = rawField.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  for (const f of fields) {
    if (f.key.toLowerCase() === rawField.trim().toLowerCase()) return f.key;
    if (f.sqlColumn.toLowerCase() === rawField.trim().toLowerCase()) return f.key;
    if (f.key.toLowerCase().replace(/[^a-z0-9]/g, '') === normalized) return f.key;
    if (f.aliases?.some((a) => a.toLowerCase().replace(/[^a-z0-9]/g, '') === normalized)) {
      return f.key;
    }
  }
  return fields[0].key;
}

function getSqlColumnName(table: NlQueryTargetTable, key: string): string {
  const def = NL_TABLE_FIELDS[table].find((f) => f.key === key);
  return def ? def.sqlColumn : key;
}

function formatSqlLiteral(val: string | number | boolean): string {
  if (typeof val === 'number') return String(val);
  if (typeof val === 'boolean') return val ? 'TRUE' : 'FALSE';
  const trimmed = String(val).trim();
  if (/^(true|false)$/i.test(trimmed)) return trimmed.toUpperCase();
  if (trimmed !== '' && !Number.isNaN(Number(trimmed))) return trimmed;
  return `'${trimmed.replace(/'/g, "''")}'`;
}

export function buildSqlFromPlan(plan: NlQueryPlan): string {
  const tableName =
    plan.targetTable === 'events'
      ? 'canonical_events'
      : plan.targetTable === 'regression_rows'
      ? 'regression_ltv'
      : 'offline_rl_mdp';

  const groupField =
    plan.groupBy && plan.groupBy !== 'none'
      ? normalizeFieldKey(plan.targetTable, plan.groupBy)
      : null;

  const selectCols: string[] = [];
  if (groupField) {
    selectCols.push(getSqlColumnName(plan.targetTable, groupField));
    const metrics =
      plan.metrics.length > 0
        ? plan.metrics
        : [{ field: groupField, agg: 'count' as const, alias: 'row_count' }];
    for (const m of metrics) {
      const col = m.agg === 'count' && m.field === '*' ? '*' : getSqlColumnName(plan.targetTable, normalizeFieldKey(plan.targetTable, m.field));
      const fn = m.agg.toUpperCase();
      const alias = (m.alias || `${m.agg}_${col}`).replace(/[^a-zA-Z0-9_]/g, '_');
      selectCols.push(`${fn}(${col}) AS ${alias}`);
    }
  } else {
    const visible = NL_TABLE_FIELDS[plan.targetTable]
      .filter((f) => f.defaultVisible)
      .map((f) => f.sqlColumn);
    selectCols.push(...visible);
  }

  const whereClauses = plan.filters.map((f) => {
    const col = getSqlColumnName(plan.targetTable, normalizeFieldKey(plan.targetTable, f.field));
    switch (f.op) {
      case 'eq':
        return `${col} = ${formatSqlLiteral(f.value)}`;
      case 'neq':
        return `${col} != ${formatSqlLiteral(f.value)}`;
      case 'gt':
        return `${col} > ${formatSqlLiteral(f.value)}`;
      case 'gte':
        return `${col} >= ${formatSqlLiteral(f.value)}`;
      case 'lt':
        return `${col} < ${formatSqlLiteral(f.value)}`;
      case 'lte':
        return `${col} <= ${formatSqlLiteral(f.value)}`;
      case 'contains':
        return `LOWER(${col}) LIKE '%${String(f.value).toLowerCase().replace(/'/g, "''")}%'`;
    }
  });

  const parts = [`SELECT\n  ${selectCols.join(',\n  ')}`, `FROM ${tableName}`];
  if (whereClauses.length > 0) {
    parts.push(`WHERE ${whereClauses.join('\n  AND ')}`);
  }
  if (groupField) {
    parts.push(`GROUP BY ${getSqlColumnName(plan.targetTable, groupField)}`);
  }

  let orderExpr = '';
  if (groupField) {
    const matchingMetric = plan.metrics.find(
      (m) =>
        m.alias.toLowerCase() === plan.sortBy.field.toLowerCase() ||
        m.field.toLowerCase() === plan.sortBy.field.toLowerCase()
    );
    if (matchingMetric) {
      orderExpr = matchingMetric.alias.replace(/[^a-zA-Z0-9_]/g, '_');
    } else if (plan.metrics.length > 0) {
      orderExpr = plan.metrics[0].alias.replace(/[^a-zA-Z0-9_]/g, '_');
    } else {
      orderExpr = getSqlColumnName(plan.targetTable, groupField);
    }
  } else {
    orderExpr = getSqlColumnName(plan.targetTable, normalizeFieldKey(plan.targetTable, plan.sortBy.field));
  }

  parts.push(`ORDER BY ${orderExpr} ${plan.sortBy.direction.toUpperCase()}`);
  parts.push(`LIMIT ${Math.max(1, Math.min(500, Math.round(plan.limit || 25)))}`);

  return parts.join('\n') + ';';
}

type FlatRow = Record<string, string | number | boolean>;

function materializeSourceRows(params: {
  table: NlQueryTargetTable;
  events: RawEvent[];
  regResult: RegressionResult;
  mdpResult: MdpResult;
  globalConfig: GlobalCurationConfig;
  obsCutoffDay: number;
}): FlatRow[] {
  const { table, events, regResult, mdpResult, globalConfig, obsCutoffDay } = params;

  if (table === 'events') {
    return events.map((ev) => ({
      eventId: ev.eventId,
      entityId: ev.entityId,
      split: assignEntitySplit(ev.entityId, globalConfig),
      windowPhase: ev.timestampDay <= obsCutoffDay ? 'obs' : 'horizon',
      timestampDay: ev.timestampDay,
      actionId: ev.actionId,
      actionLabel: ev.actionLabel,
      channel: ev.channel,
      spendAmount: Math.round(ev.spendAmount * 100) / 100,
      reward: Math.round(ev.reward * 100) / 100,
      engagementScore: Math.round(ev.engagementScore * 1000) / 1000,
      propensity: Math.round(ev.propensity * 1000) / 1000,
      recencyDays: ev.recencyDays,
      frequencyCount: ev.frequencyCount,
    }));
  }

  if (table === 'regression_rows') {
    return regResult.rows.map((r) => ({
      entityId: r.entityId,
      split: r.split,
      txCountObs: r.txCountObs,
      monetarySumObs: Math.round(r.monetarySumObs * 100) / 100,
      avgOrderValueObs: Math.round(r.avgOrderValueObs * 100) / 100,
      recencyAtCutoff: Math.round(r.recencyAtCutoff * 10) / 10,
      tenureDaysObs: Math.round(r.tenureDaysObs * 10) / 10,
      meanEngagementObs: Math.round(r.meanEngagementObs * 1000) / 1000,
      promoShareObs: Math.round(r.promoShareObs * 1000) / 1000,
      targetLtvRaw: Math.round(r.targetLtvRaw * 100) / 100,
      targetLtvWinsorized: Math.round(r.targetLtvWinsorized * 100) / 100,
      predictedHorizonLtv: Math.round(r.predictedHorizonLtv * 100) / 100,
      currentObservedLtv: Math.round(r.currentObservedLtv * 100) / 100,
      projectedFutureLtv: Math.round(r.projectedFutureLtv * 100) / 100,
      horizonEventsCount: r.horizonEventsCount,
      leakageVerified: r.leakageVerified,
    }));
  }

  return mdpResult.transitions.map((t) => ({
    transitionId: t.transitionId,
    entityId: t.entityId,
    split: t.split,
    stepIdx: t.stepIdx,
    timestampDay: t.timestampDay,
    actionId: t.actionId,
    actionLabel: t.actionLabel,
    rewardRaw: Math.round(t.rewardRaw * 100) / 100,
    rewardScaled: Math.round(t.rewardScaled * 1000) / 1000,
    returnToGo: Math.round(t.returnToGo * 100) / 100,
    behaviorPropensity: Math.round(t.behaviorPropensity * 1000) / 1000,
    supportCount: t.supportCount,
    isLowSupportOod: t.isLowSupportOod,
    terminalReason: t.terminalReason,
    done: t.done,
    stateCumSpend: Math.round(t.state.cumSpend * 100) / 100,
    stateEngagement: Math.round(t.state.engagementScore * 1000) / 1000,
    stateFrequency: t.state.frequencyCount,
    stateRecency: t.state.recencyDays,
  }));
}

function matchesPredicate(
  row: FlatRow,
  predicate: NlQueryFilterPredicate,
  table: NlQueryTargetTable
): boolean {
  const fieldKey = normalizeFieldKey(table, predicate.field);
  const actual = row[fieldKey];
  if (actual === undefined) return true;

  const rawTarget = predicate.value;

  if (typeof actual === 'boolean') {
    const targetBool =
      typeof rawTarget === 'boolean'
        ? rawTarget
        : String(rawTarget).trim().toLowerCase() === 'true' || String(rawTarget).trim() === '1';
    if (predicate.op === 'neq') return actual !== targetBool;
    return actual === targetBool;
  }

  if (typeof actual === 'number') {
    const numTarget = typeof rawTarget === 'number' ? rawTarget : Number(rawTarget);
    if (Number.isNaN(numTarget)) return true;
    switch (predicate.op) {
      case 'eq':
        return Math.abs(actual - numTarget) < 1e-9;
      case 'neq':
        return Math.abs(actual - numTarget) >= 1e-9;
      case 'gt':
        return actual > numTarget;
      case 'gte':
        return actual >= numTarget;
      case 'lt':
        return actual < numTarget;
      case 'lte':
        return actual <= numTarget;
      case 'contains':
        return String(actual).includes(String(rawTarget));
    }
  }

  const actualStr = String(actual).toLowerCase();
  const targetStr = String(rawTarget).trim().toLowerCase();
  switch (predicate.op) {
    case 'eq':
      return actualStr === targetStr;
    case 'neq':
      return actualStr !== targetStr;
    case 'contains':
      return actualStr.includes(targetStr);
    case 'gt':
      return actualStr > targetStr;
    case 'gte':
      return actualStr >= targetStr;
    case 'lt':
      return actualStr < targetStr;
    case 'lte':
      return actualStr <= targetStr;
  }
}

function computeAggValue(rows: FlatRow[], metric: NlQueryAggMetric, table: NlQueryTargetTable): number {
  if (metric.agg === 'count') return rows.length;
  const key = normalizeFieldKey(table, metric.field);
  const nums = rows
    .map((r) => Number(r[key]))
    .filter((n) => Number.isFinite(n));
  if (nums.length === 0) return 0;

  switch (metric.agg) {
    case 'sum':
      return Math.round(nums.reduce((a, b) => a + b, 0) * 100) / 100;
    case 'avg':
      return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 1000) / 1000;
    case 'min':
      return Math.round(Math.min(...nums) * 1000) / 1000;
    case 'max':
      return Math.round(Math.max(...nums) * 1000) / 1000;
  }
}

export function executeNlQueryPlan(params: {
  plan: NlQueryPlan;
  events: RawEvent[];
  regResult: RegressionResult;
  mdpResult: MdpResult;
  globalConfig: GlobalCurationConfig;
  obsCutoffDay: number;
}): NlQueryExecutionResult {
  const t0 = performance.now();
  const { plan, events, regResult, mdpResult, globalConfig, obsCutoffDay } = params;
  const table = plan.targetTable;
  const sourceRows = materializeSourceRows({
    table,
    events,
    regResult,
    mdpResult,
    globalConfig,
    obsCutoffDay,
  });

  const matchedRows = sourceRows.filter((row) =>
    plan.filters.every((pred) => matchesPredicate(row, pred, table))
  );

  const distinctEntities = new Set(
    matchedRows.map((r) => String(r.entityId ?? ''))
  ).size;

  const groupFieldRaw = plan.groupBy && plan.groupBy !== 'none' ? plan.groupBy : null;
  const groupFieldDef = groupFieldRaw
    ? NL_TABLE_FIELDS[table].find(
        (f) => f.key === normalizeFieldKey(table, groupFieldRaw) && f.groupable
      ) ?? NL_TABLE_FIELDS[table].find((f) => f.key === normalizeFieldKey(table, groupFieldRaw))
    : undefined;

  const limit = Math.max(1, Math.min(250, Math.round(plan.limit || 25)));

  if (groupFieldDef) {
    const groups = new Map<string, FlatRow[]>();
    for (const row of matchedRows) {
      const keyVal = String(row[groupFieldDef.key] ?? 'Unknown');
      const arr = groups.get(keyVal) ?? [];
      arr.push(row);
      groups.set(keyVal, arr);
    }

    const activeMetrics: NlQueryAggMetric[] =
      plan.metrics.length > 0
        ? plan.metrics
        : [
            {
              field: groupFieldDef.key,
              agg: 'count',
              alias: 'record_count',
            },
            {
              field:
                table === 'events'
                  ? 'spendAmount'
                  : table === 'regression_rows'
                  ? 'targetLtvRaw'
                  : 'returnToGo',
              agg: 'avg',
              alias:
                table === 'events'
                  ? 'avg_spend'
                  : table === 'regression_rows'
                  ? 'avg_target_ltv'
                  : 'avg_return_to_go',
            },
          ];

    const columns: NlQueryColumnMeta[] = [
      {
        key: groupFieldDef.key,
        label: groupFieldDef.label,
        isNumeric: false,
        format: groupFieldDef.format ?? 'text',
      },
      {
        key: '_groupEntities',
        label: 'Entities',
        isNumeric: true,
        format: 'int',
      },
      ...activeMetrics.map((m, idx) => {
        const targetDef = NL_TABLE_FIELDS[table].find(
          (f) => f.key === normalizeFieldKey(table, m.field)
        );
        const colKey = m.alias || `metric_${idx}`;
        const fmt: NlQueryColumnMeta['format'] =
          m.agg === 'count'
            ? 'int'
            : targetDef?.format === 'currency'
            ? 'currency'
            : 'decimal';
        return {
          key: colKey,
          label: (m.alias || `${m.agg}(${m.field})`).replace(/_/g, ' '),
          isNumeric: true,
          format: fmt,
        };
      }),
    ];

    const groupedRows: FlatRow[] = Array.from(groups.entries()).map(([groupVal, gRows]) => {
      const entry: FlatRow = {
        [groupFieldDef.key]: groupVal,
        _groupEntities: new Set(gRows.map((r) => String(r.entityId ?? ''))).size,
      };
      activeMetrics.forEach((m, idx) => {
        const colKey = m.alias || `metric_${idx}`;
        entry[colKey] = computeAggValue(gRows, m, table);
      });
      return entry;
    });

    const sortKey =
      columns.find(
        (c) =>
          c.key.toLowerCase() === plan.sortBy.field.toLowerCase() ||
          c.key.toLowerCase().replace(/[^a-z0-9]/g, '') ===
            plan.sortBy.field.toLowerCase().replace(/[^a-z0-9]/g, '')
      )?.key ??
      activeMetrics[0]?.alias ??
      groupFieldDef.key;

    groupedRows.sort((a, b) => {
      const va = a[sortKey];
      const vb = b[sortKey];
      if (typeof va === 'number' && typeof vb === 'number') {
        return plan.sortBy.direction === 'asc' ? va - vb : vb - va;
      }
      return plan.sortBy.direction === 'asc'
        ? String(va).localeCompare(String(vb))
        : String(vb).localeCompare(String(va));
    });

    const limitedRows = groupedRows.slice(0, limit);
    const primaryMetricKey = activeMetrics[0]?.alias || '_groupEntities';
    const secondaryMetricKey =
      activeMetrics.length > 1 ? activeMetrics[1].alias : undefined;

    const chartData = limitedRows.map((r) => ({
      group: String(r[groupFieldDef.key]),
      primaryValue: Number(r[primaryMetricKey] ?? 0),
      secondaryValue: secondaryMetricKey ? Number(r[secondaryMetricKey] ?? 0) : undefined,
      count: Number(r._groupEntities ?? 0),
    }));

    const summaryMetrics = buildSummaryMetrics(table, matchedRows, distinctEntities, groups.size);

    return {
      targetTable: table,
      totalSourceRows: sourceRows.length,
      matchedRowCount: matchedRows.length,
      distinctEntities,
      columns,
      rows: limitedRows,
      summaryMetrics,
      isGrouped: true,
      chartData,
      primaryChartLabel:
        columns.find((c) => c.key === primaryMetricKey)?.label ?? primaryMetricKey,
      secondaryChartLabel: secondaryMetricKey
        ? columns.find((c) => c.key === secondaryMetricKey)?.label ?? secondaryMetricKey
        : undefined,
      executionMs: Math.max(1, Math.round(performance.now() - t0)),
    };
  }

  // Ungrouped flat listing
  const sortFieldKey = normalizeFieldKey(table, plan.sortBy.field);
  const sortedRows = [...matchedRows].sort((a, b) => {
    const va = a[sortFieldKey];
    const vb = b[sortFieldKey];
    if (typeof va === 'number' && typeof vb === 'number') {
      return plan.sortBy.direction === 'asc' ? va - vb : vb - va;
    }
    if (typeof va === 'boolean' && typeof vb === 'boolean') {
      return plan.sortBy.direction === 'asc'
        ? Number(va) - Number(vb)
        : Number(vb) - Number(va);
    }
    return plan.sortBy.direction === 'asc'
      ? String(va).localeCompare(String(vb))
      : String(vb).localeCompare(String(va));
  });

  const limitedRows = sortedRows.slice(0, limit);

  // Include default visible columns + any filtered or sorted column so user sees why each row matched
  const extraKeys = new Set<string>([
    sortFieldKey,
    ...plan.filters.map((f) => normalizeFieldKey(table, f.field)),
  ]);
  const columns: NlQueryColumnMeta[] = NL_TABLE_FIELDS[table]
    .filter((f) => f.defaultVisible || extraKeys.has(f.key))
    .map(({ key, label, isNumeric, format }) => ({ key, label, isNumeric, format }));

  const summaryMetrics = buildSummaryMetrics(table, matchedRows, distinctEntities);

  return {
    targetTable: table,
    totalSourceRows: sourceRows.length,
    matchedRowCount: matchedRows.length,
    distinctEntities,
    columns,
    rows: limitedRows,
    summaryMetrics,
    isGrouped: false,
    chartData: [],
    primaryChartLabel: '',
    executionMs: Math.max(1, Math.round(performance.now() - t0)),
  };
}

function buildSummaryMetrics(
  table: NlQueryTargetTable,
  matchedRows: FlatRow[],
  distinctEntities: number,
  groupCount?: number
): Array<{ label: string; value: string }> {
  const n = matchedRows.length;
  if (table === 'events') {
    const totalSpend = matchedRows.reduce((acc, r) => acc + Number(r.spendAmount ?? 0), 0);
    const meanReward = n > 0 ? matchedRows.reduce((acc, r) => acc + Number(r.reward ?? 0), 0) / n : 0;
    return [
      { label: 'Matched Events', value: n.toLocaleString() },
      { label: 'Distinct Entities', value: distinctEntities.toLocaleString() },
      {
        label: groupCount !== undefined ? 'Distinct Groups' : 'Total Matched Spend',
        value:
          groupCount !== undefined
            ? groupCount.toLocaleString()
            : `$${totalSpend.toLocaleString(undefined, { maximumFractionDigits: 2 })}`,
      },
      { label: 'Mean Event Reward', value: meanReward.toFixed(2) },
    ];
  }

  if (table === 'regression_rows') {
    const meanPred =
      n > 0 ? matchedRows.reduce((acc, r) => acc + Number(r.predictedHorizonLtv ?? 0), 0) / n : 0;
    const meanActual =
      n > 0 ? matchedRows.reduce((acc, r) => acc + Number(r.targetLtvRaw ?? 0), 0) / n : 0;
    return [
      { label: 'Matched Entities', value: n.toLocaleString() },
      { label: 'Mean Predicted LTV', value: `$${meanPred.toFixed(2)}` },
      { label: 'Mean Target LTV', value: `$${meanActual.toFixed(2)}` },
      {
        label: groupCount !== undefined ? 'Distinct Groups' : 'Total Target LTV',
        value:
          groupCount !== undefined
            ? groupCount.toLocaleString()
            : `$${matchedRows
                .reduce((acc, r) => acc + Number(r.targetLtvRaw ?? 0), 0)
                .toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
      },
    ];
  }

  const meanRtg =
    n > 0 ? matchedRows.reduce((acc, r) => acc + Number(r.returnToGo ?? 0), 0) / n : 0;
  const oodCount = matchedRows.filter((r) => Boolean(r.isLowSupportOod)).length;
  return [
    { label: 'Matched Transitions', value: n.toLocaleString() },
    { label: 'Distinct Entities', value: distinctEntities.toLocaleString() },
    { label: 'Mean Return-to-Go', value: meanRtg.toFixed(2) },
    {
      label: groupCount !== undefined ? 'Distinct Groups' : 'Low-Support OOD',
      value:
        groupCount !== undefined
          ? groupCount.toLocaleString()
          : `${oodCount.toLocaleString()} (${n > 0 ? ((oodCount / n) * 100).toFixed(1) : '0.0'}%)`,
    },
  ];
}

export function exportNlQueryResultsCsv(result: NlQueryExecutionResult): string {
  const header = result.columns.map((c) => c.key).join(',');
  const lines = result.rows.map((row) =>
    result.columns
      .map((col) => {
        const val = row[col.key];
        if (typeof val === 'string') {
          return `"${val.replace(/"/g, '""')}"`;
        }
        return String(val ?? '');
      })
      .join(',')
  );
  return [header, ...lines].join('\n');
}
