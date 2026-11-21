import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  BarChart3,
  Check,
  Copy,
  Database,
  Download,
  Loader2,
  MessageSquareText,
  Plus,
  RotateCcw,
  SlidersHorizontal,
  Table2,
  Trash2,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  GlobalCurationConfig,
  MdpResult,
  NlQueryColumnMeta,
  NlQueryFilterPredicate,
  NlQueryOperator,
  NlQueryPlan,
  NlQueryTargetTable,
  RawEvent,
  RegressionResult,
} from '../types/curation';
import {
  buildSqlFromPlan,
  executeNlQueryPlan,
  exportNlQueryResultsCsv,
  NL_TABLE_FIELDS,
  NL_TABLE_LABELS,
  normalizeFieldKey,
} from '../engine/nlQueryEngine';

interface NlQueryViewProps {
  datasetName: string;
  datasetDomain: string;
  events: RawEvent[];
  globalConfig: GlobalCurationConfig;
  obsCutoffDay: number;
  regResult: RegressionResult;
  mdpResult: MdpResult;
  externalPromptRequest?: { prompt: string; nonce: number } | null;
  onInspectEntityInExplorer: (entityId: string) => void;
}

const OP_LABELS: Record<NlQueryOperator, string> = {
  eq: '=',
  neq: '!=',
  gt: '>',
  gte: '>=',
  lt: '<',
  lte: '<=',
  contains: 'contains',
};

function triggerBlobDownload(filename: string, content: string, mimeType: string) {
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

function formatCellValue(
  value: string | number | boolean | undefined,
  col: NlQueryColumnMeta
): string {
  if (value === undefined || value === null) return '—';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (col.format === 'currency') {
      return `$${value.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`;
    }
    if (col.format === 'int') {
      return Math.round(value).toLocaleString();
    }
    if (col.format === 'percent') {
      return `${value.toFixed(1)}%`;
    }
    return value.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 3,
    });
  }
  return String(value);
}

export const NlQueryView: React.FC<NlQueryViewProps> = ({
  datasetName,
  datasetDomain,
  events,
  globalConfig,
  obsCutoffDay,
  regResult,
  mdpResult,
  externalPromptRequest,
  onInspectEntityInExplorer,
}) => {
  const [questionInput, setQuestionInput] = useState('');
  const [isCompiling, setIsCompiling] = useState(false);
  const [compileError, setCompileError] = useState<string | null>(null);
  const [activePlan, setActivePlan] = useState<NlQueryPlan | null>(null);
  const [queryHistory, setQueryHistory] = useState<NlQueryPlan[]>([]);
  const [copiedSql, setCopiedSql] = useState(false);
  const [showSqlEditor, setShowSqlEditor] = useState(true);

  const availableChannels = useMemo(
    () => Array.from(new Set(events.map((e) => e.channel))).sort(),
    [events]
  );

  const availableActionLabels = useMemo(
    () => Array.from(new Set(events.map((e) => e.actionLabel))).sort(),
    [events]
  );

  const samplePrompts = useMemo(() => {
    const firstChannel = availableChannels[0] ?? 'Web';
    return [
      {
        label: 'Top predicted LTV in test',
        prompt: 'Show the top 15 entities by predicted horizon LTV in the test split',
      },
      {
        label: 'Spend & reward by channel',
        prompt: 'Compare event count, total spend, and average reward grouped by channel',
      },
      {
        label: 'Negative reward or low propensity',
        prompt: 'Find events with negative reward or propensity below 0.15 sorted by timestamp day',
      },
      {
        label: 'Low-support OOD by action',
        prompt: 'Summarize MDP transition count and average return-to-go grouped by action label where low-support OOD is true',
      },
      {
        label: `${firstChannel} horizon spenders`,
        prompt: `List the top 20 ${firstChannel} events in the horizon window sorted by spend amount descending`,
      },
      {
        label: 'Zero future LTV high spenders',
        prompt: 'Which entities had observed monetary spend above 150 but zero horizon events?',
      },
    ];
  }, [availableChannels]);

  const runNaturalLanguageQuery = async (rawPrompt: string) => {
    const trimmed = rawPrompt.trim();
    if (!trimmed || isCompiling) return;

    setIsCompiling(true);
    setCompileError(null);
    setQuestionInput(trimmed);

    try {
      const response = await fetch('/api/nl-query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: trimmed,
          datasetName,
          datasetDomain,
          obsCutoffDay,
          channels: availableChannels,
          actionLabels: availableActionLabels,
          entityCount: new Set(events.map((e) => e.entityId)).size,
          eventCount: events.length,
          regressionRowCount: regResult.rows.length,
          mdpTransitionCount: mdpResult.transitions.length,
        }),
      });

      const payload = (await response.json()) as { plan?: NlQueryPlan; error?: string };
      if (!response.ok || !payload.plan) {
        throw new Error(payload.error || `Request failed (${response.status})`);
      }

      const normalizedPlan: NlQueryPlan = {
        ...payload.plan,
        filters: payload.plan.filters.map((f) => ({
          ...f,
          field: normalizeFieldKey(payload.plan!.targetTable, f.field),
        })),
      };
      normalizedPlan.sqlPreview = buildSqlFromPlan(normalizedPlan);

      setActivePlan(normalizedPlan);
      setQueryHistory((prev) => [
        normalizedPlan,
        ...prev.filter((p) => p.question.toLowerCase() !== normalizedPlan.question.toLowerCase()),
      ].slice(0, 8));
    } catch (err) {
      setCompileError(
        err instanceof Error ? err.message : 'Unable to compile natural language query.'
      );
    } finally {
      setIsCompiling(false);
    }
  };

  useEffect(() => {
    if (externalPromptRequest && externalPromptRequest.prompt.trim()) {
      void runNaturalLanguageQuery(externalPromptRequest.prompt);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalPromptRequest]);

  const openBlankBuilder = (table: NlQueryTargetTable = 'events') => {
    const starter: NlQueryPlan = {
      question: `Direct query on ${NL_TABLE_LABELS[table]}`,
      targetTable: table,
      intentSummary: `Direct structured inspection on ${table} (live client-side execution).`,
      sqlPreview: '',
      filters: [],
      groupBy: null,
      metrics: [],
      sortBy: {
        field:
          table === 'events'
            ? 'spendAmount'
            : table === 'regression_rows'
            ? 'predictedHorizonLtv'
            : 'returnToGo',
        direction: 'desc',
      },
      limit: 25,
      chartType: 'none',
      model: 'local-builder',
      compiledAt: new Date().toISOString(),
    };
    starter.sqlPreview = buildSqlFromPlan(starter);
    setCompileError(null);
    setActivePlan(starter);
  };

  const executionResult = useMemo(() => {
    if (!activePlan) return null;
    return executeNlQueryPlan({
      plan: activePlan,
      events,
      regResult,
      mdpResult,
      globalConfig,
      obsCutoffDay,
    });
  }, [activePlan, events, regResult, mdpResult, globalConfig, obsCutoffDay]);

  const liveSql = useMemo(() => {
    if (!activePlan) return '';
    return buildSqlFromPlan(activePlan);
  }, [activePlan]);

  const updatePlan = (updater: (prev: NlQueryPlan) => NlQueryPlan) => {
    setActivePlan((prev) => {
      if (!prev) return prev;
      const next = updater(prev);
      return {
        ...next,
        sqlPreview: buildSqlFromPlan(next),
      };
    });
  };

  const handleChangeTable = (table: NlQueryTargetTable) => {
    updatePlan((prev) => ({
      ...prev,
      targetTable: table,
      filters: [],
      groupBy: null,
      metrics: [],
      sortBy: {
        field:
          table === 'events'
            ? 'spendAmount'
            : table === 'regression_rows'
            ? 'predictedHorizonLtv'
            : 'returnToGo',
        direction: 'desc',
      },
      chartType: 'none',
    }));
  };

  const handleAddFilter = () => {
    if (!activePlan) return;
    const fields = NL_TABLE_FIELDS[activePlan.targetTable];
    const defaultField = fields.find((f) => f.isNumeric) ?? fields[0];
    const newFilter: NlQueryFilterPredicate = {
      id: `flt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
      field: defaultField.key,
      op: defaultField.isNumeric ? 'gt' : 'eq',
      value: defaultField.isNumeric ? 0 : '',
    };
    updatePlan((prev) => ({
      ...prev,
      filters: [...prev.filters, newFilter],
    }));
  };

  const handleChangeGroupBy = (groupKey: string) => {
    updatePlan((prev) => {
      if (groupKey === 'none') {
        return {
          ...prev,
          groupBy: null,
          metrics: [],
          chartType: 'none',
          sortBy: {
            field:
              prev.targetTable === 'events'
                ? 'spendAmount'
                : prev.targetTable === 'regression_rows'
                ? 'predictedHorizonLtv'
                : 'returnToGo',
            direction: 'desc',
          },
        };
      }
      const primaryMetricField =
        prev.targetTable === 'events'
          ? 'spendAmount'
          : prev.targetTable === 'regression_rows'
          ? 'predictedHorizonLtv'
          : 'returnToGo';
      const defaultMetrics =
        prev.metrics.length > 0
          ? prev.metrics
          : [
              { field: groupKey, agg: 'count' as const, alias: 'row_count' },
              {
                field: primaryMetricField,
                agg: 'avg' as const,
                alias: `avg_${primaryMetricField.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`)}`,
              },
            ];
      return {
        ...prev,
        groupBy: groupKey,
        metrics: defaultMetrics,
        chartType: 'bar',
        sortBy: {
          field: defaultMetrics[0].alias,
          direction: 'desc',
        },
      };
    });
  };

  const handleCopySql = async () => {
    if (!liveSql) return;
    try {
      await navigator.clipboard.writeText(liveSql);
      setCopiedSql(true);
      window.setTimeout(() => setCopiedSql(false), 1600);
    } catch {
      // ignore clipboard errors
    }
  };

  const handleExportCsv = () => {
    if (!executionResult) return;
    const csv = exportNlQueryResultsCsv(executionResult);
    triggerBlobDownload(
      `stratum_nl_query_${executionResult.targetTable}.csv`,
      csv,
      'text/csv'
    );
  };

  const handleExportJson = () => {
    if (!activePlan || !executionResult) return;
    const payload = {
      datasetName,
      question: activePlan.question,
      sqlEquivalent: liveSql,
      compiledPlan: activePlan,
      matchedRowCount: executionResult.matchedRowCount,
      distinctEntities: executionResult.distinctEntities,
      rows: executionResult.rows,
    };
    triggerBlobDownload(
      `stratum_nl_query_${executionResult.targetTable}.json`,
      JSON.stringify(payload, null, 2),
      'application/json'
    );
  };

  const activeTableFields = activePlan ? NL_TABLE_FIELDS[activePlan.targetTable] : [];
  const groupableFields = activeTableFields.filter((f) => f.groupable);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900">
            Natural Language Query Engine
          </h1>
          <p className="text-sm text-slate-600 mt-1 max-w-2xl">
            Ask analytical, filtering, or cohort-grouping questions in plain English. Queries compile
            into verifiable SQL plans and execute deterministically against live Stratum tables.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 font-mono tabular-nums shrink-0">
          <span>{datasetName}</span>
          <span aria-hidden="true">·</span>
          <span>{events.length.toLocaleString()} events</span>
          <span aria-hidden="true">·</span>
          <span>{regResult.rows.length.toLocaleString()} reg rows</span>
          <span aria-hidden="true">·</span>
          <span>{mdpResult.transitions.length.toLocaleString()} MDP tuples</span>
        </div>
      </div>

      {/* Prompt Composer */}
      <section className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void runNaturalLanguageQuery(questionInput);
          }}
          className="flex flex-col md:flex-row gap-3"
        >
          <div className="relative flex-1">
            <MessageSquareText
              className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
              aria-hidden="true"
            />
            <input
              type="text"
              aria-label="Ask a natural language query about your dataset"
              value={questionInput}
              onChange={(e) => setQuestionInput(e.target.value)}
              placeholder='Ask e.g. "Compare average spend and reward by channel in the horizon window" or "Top 15 test entities by predicted LTV"...'
              className="w-full h-11 pl-10 pr-4 bg-slate-50 border border-slate-200 rounded-md text-sm text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600 transition-colors"
            />
          </div>
          <button
            type="submit"
            disabled={isCompiling || !questionInput.trim()}
            className="h-11 px-5 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-60 rounded-md transition-colors inline-flex items-center justify-center gap-2 whitespace-nowrap shrink-0"
          >
            {isCompiling ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Compiling Query...</span>
              </>
            ) : (
              <>
                <span>Run Query</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </>
            )}
          </button>
        </form>

        {/* Sample Prompts */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-slate-500 font-medium">Examples:</span>
          {samplePrompts.map((item) => (
            <button
              key={item.label}
              type="button"
              disabled={isCompiling}
              onClick={() => void runNaturalLanguageQuery(item.prompt)}
              className={`px-2.5 py-1.5 rounded-md border text-xs transition-colors whitespace-nowrap ${
                activePlan?.question === item.prompt
                  ? 'bg-blue-50 border-blue-200 text-blue-700 font-medium'
                  : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        {/* Session History */}
        {queryHistory.length > 0 && (
          <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center gap-2 text-xs">
            <span className="text-slate-500 font-medium">Recent:</span>
            {queryHistory.map((hist, idx) => (
              <button
                key={`${hist.compiledAt}-${idx}`}
                type="button"
                onClick={() => {
                  setQuestionInput(hist.question);
                  setActivePlan(hist);
                  setCompileError(null);
                }}
                className={`px-2.5 py-1 rounded-md border text-xs truncate max-w-[260px] transition-colors ${
                  activePlan?.question === hist.question
                    ? 'bg-slate-900 border-slate-900 text-white'
                    : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                }`}
                title={hist.question}
              >
                {hist.question}
              </button>
            ))}
          </div>
        )}

        {compileError && (
          <div
            role="alert"
            className="p-3.5 bg-red-50 border border-red-200 rounded-md text-xs text-red-800"
          >
            {compileError}
          </div>
        )}
      </section>

      {/* Initial Empty / Direct Builder Launcher */}
      {!activePlan && !isCompiling && (
        <section className="bg-white border border-slate-200 rounded-lg p-6 space-y-5">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-100 pb-4">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                Ready to Query {datasetName}
              </h2>
              <p className="text-xs text-slate-600 mt-1">
                Ask any natural language question above, pick an example prompt, or open a live
                structured table directly below.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {(['events', 'regression_rows', 'mdp_transitions'] as NlQueryTargetTable[]).map(
                (tbl) => (
                  <button
                    key={tbl}
                    type="button"
                    onClick={() => openBlankBuilder(tbl)}
                    className="px-3 py-2 text-xs font-medium text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-md transition-colors inline-flex items-center gap-1.5 whitespace-nowrap"
                  >
                    <Database className="w-3.5 h-3.5 text-blue-700" />
                    <span>Query {tbl}</span>
                  </button>
                )
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
            <div className="p-4 bg-slate-50/70 border border-slate-200 rounded-md space-y-1.5">
              <div className="font-semibold text-slate-900">canonical_events</div>
              <div className="font-mono tabular-nums text-slate-500">
                {events.length.toLocaleString()} rows · {availableChannels.length} channels
              </div>
              <p className="text-slate-600 leading-relaxed">
                Filter by <code className="font-mono">spendAmount</code>,{' '}
                <code className="font-mono">reward</code>, <code className="font-mono">propensity</code>,{' '}
                <code className="font-mono">channel</code>, <code className="font-mono">split</code>, or{' '}
                <code className="font-mono">windowPhase</code> (obs vs horizon).
              </p>
            </div>

            <div className="p-4 bg-slate-50/70 border border-slate-200 rounded-md space-y-1.5">
              <div className="font-semibold text-slate-900">regression_ltv</div>
              <div className="font-mono tabular-nums text-slate-500">
                {regResult.rows.length.toLocaleString()} entities · T_obs Day {obsCutoffDay}
              </div>
              <p className="text-slate-600 leading-relaxed">
                Rank entities by <code className="font-mono">predictedHorizonLtv</code>,{' '}
                <code className="font-mono">targetLtvRaw</code>,{' '}
                <code className="font-mono">monetarySumObs</code>, or{' '}
                <code className="font-mono">horizonEventsCount</code>.
              </p>
            </div>

            <div className="p-4 bg-slate-50/70 border border-slate-200 rounded-md space-y-1.5">
              <div className="font-semibold text-slate-900">offline_rl_mdp</div>
              <div className="font-mono tabular-nums text-slate-500">
                {mdpResult.transitions.length.toLocaleString()} transitions ·{' '}
                {mdpResult.trajectoryCount} trajectories
              </div>
              <p className="text-slate-600 leading-relaxed">
                Inspect <code className="font-mono">returnToGo</code>,{' '}
                <code className="font-mono">behaviorPropensity</code>,{' '}
                <code className="font-mono">isLowSupportOod</code>, and{' '}
                <code className="font-mono">terminalReason</code> across policies.
              </p>
            </div>
          </div>
        </section>
      )}

      {/* Compiled Plan + Live Results */}
      {activePlan && executionResult && (
        <>
          {/* Exact Summary Metrics Strip */}
          <section
            aria-label="Query result summary"
            className="grid grid-cols-2 lg:grid-cols-4 gap-4"
          >
            {executionResult.summaryMetrics.map((m) => (
              <div
                key={m.label}
                className="bg-white border border-slate-200 rounded-lg px-4 py-3.5"
              >
                <div className="text-xs text-slate-500">{m.label}</div>
                <div className="mt-1 text-lg font-bold text-slate-900 font-mono tabular-nums">
                  {m.value}
                </div>
              </div>
            ))}
          </section>

          {/* Grouped Visualization */}
          {executionResult.isGrouped && executionResult.chartData.length > 0 && (
            <section className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                  <BarChart3 className="w-4 h-4 text-blue-700" />
                  <h2 className="text-sm font-semibold text-slate-900">
                    Grouped Distribution: {executionResult.primaryChartLabel}
                    {executionResult.secondaryChartLabel
                      ? ` & ${executionResult.secondaryChartLabel}`
                      : ''}
                  </h2>
                </div>
                <span className="text-xs text-slate-500 font-mono tabular-nums">
                  {executionResult.chartData.length} groups · {executionResult.matchedRowCount.toLocaleString()} source rows
                </span>
              </div>

              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={executionResult.chartData}
                    margin={{ top: 8, right: 16, left: 8, bottom: 8 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                    <XAxis
                      dataKey="group"
                      tick={{ fontSize: 11, fill: '#475569' }}
                      axisLine={{ stroke: '#cbd5e1' }}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: '#475569' }}
                      axisLine={false}
                      tickLine={false}
                      width={56}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#ffffff',
                        borderColor: '#cbd5e1',
                        borderRadius: '6px',
                        fontSize: '12px',
                      }}
                    />
                    <Bar
                      dataKey="primaryValue"
                      name={executionResult.primaryChartLabel}
                      fill="#1d4ed8"
                      radius={[4, 4, 0, 0]}
                    />
                    {executionResult.secondaryChartLabel && (
                      <Bar
                        dataKey="secondaryValue"
                        name={executionResult.secondaryChartLabel}
                        fill="#0f766e"
                        radius={[4, 4, 0, 0]}
                      />
                    )}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </section>
          )}

          {/* Compiled Query Plan & Interactive Editor */}
          <section className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 pb-3 border-b border-slate-100">
              <div className="space-y-1 min-w-0">
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <SlidersHorizontal className="w-3.5 h-3.5 text-blue-700 shrink-0" />
                  <span className="font-semibold text-slate-800">Compiled Execution Plan</span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono tabular-nums">
                    {executionResult.executionMs}ms
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono">{activePlan.model}</span>
                </div>
                <p className="text-sm text-slate-800">{activePlan.intentSummary}</p>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setShowSqlEditor((v) => !v)}
                  className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-md transition-colors whitespace-nowrap"
                >
                  {showSqlEditor ? 'Hide SQL & Controls' : 'Edit Plan & SQL'}
                </button>
                <button
                  type="button"
                  onClick={handleCopySql}
                  className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-md transition-colors inline-flex items-center gap-1.5 whitespace-nowrap"
                >
                  {copiedSql ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-600" />
                      <span>Copied SQL</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5 text-slate-500" />
                      <span>Copy SQL</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {showSqlEditor && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
                {/* Left: Interactive Plan Controls */}
                <div className="lg:col-span-7 space-y-4">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div>
                      <label className="block text-[11px] font-medium text-slate-600 mb-1">
                        Target Table
                      </label>
                      <select
                        aria-label="Target table"
                        value={activePlan.targetTable}
                        onChange={(e) =>
                          handleChangeTable(e.target.value as NlQueryTargetTable)
                        }
                        className="w-full h-9 px-2 text-xs bg-slate-50 border border-slate-200 rounded-md text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-600"
                      >
                        <option value="events">events</option>
                        <option value="regression_rows">regression_rows</option>
                        <option value="mdp_transitions">mdp_transitions</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-[11px] font-medium text-slate-600 mb-1">
                        Group By
                      </label>
                      <select
                        aria-label="Group by field"
                        value={activePlan.groupBy ?? 'none'}
                        onChange={(e) => handleChangeGroupBy(e.target.value)}
                        className="w-full h-9 px-2 text-xs bg-slate-50 border border-slate-200 rounded-md text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-600"
                      >
                        <option value="none">None (Row Level)</option>
                        {groupableFields.map((gf) => (
                          <option key={gf.key} value={gf.key}>
                            {gf.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-[11px] font-medium text-slate-600 mb-1">
                        Sort Direction
                      </label>
                      <select
                        aria-label="Sort direction"
                        value={activePlan.sortBy.direction}
                        onChange={(e) =>
                          updatePlan((prev) => ({
                            ...prev,
                            sortBy: {
                              ...prev.sortBy,
                              direction: e.target.value as 'asc' | 'desc',
                            },
                          }))
                        }
                        className="w-full h-9 px-2 text-xs bg-slate-50 border border-slate-200 rounded-md text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-600"
                      >
                        <option value="desc">Descending</option>
                        <option value="asc">Ascending</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-[11px] font-medium text-slate-600 mb-1">
                        Row Limit
                      </label>
                      <input
                        type="number"
                        aria-label="Row limit"
                        min={1}
                        max={250}
                        value={activePlan.limit}
                        onChange={(e) =>
                          updatePlan((prev) => ({
                            ...prev,
                            limit: Math.max(1, Math.min(250, Number(e.target.value) || 25)),
                          }))
                        }
                        className="w-full h-9 px-2.5 text-xs font-mono tabular-nums bg-slate-50 border border-slate-200 rounded-md text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-600"
                      />
                    </div>
                  </div>

                  {/* Filter Predicates */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-slate-700">
                        Active Filter Predicates ({activePlan.filters.length})
                      </span>
                      <div className="flex items-center gap-2">
                        {activePlan.filters.length > 0 && (
                          <button
                            type="button"
                            onClick={() =>
                              updatePlan((prev) => ({ ...prev, filters: [] }))
                            }
                            className="text-xs text-slate-500 hover:text-slate-900 inline-flex items-center gap-1"
                          >
                            <RotateCcw className="w-3 h-3" />
                            <span>Clear Filters</span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={handleAddFilter}
                          className="px-2.5 py-1 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-md inline-flex items-center gap-1"
                        >
                          <Plus className="w-3 h-3" />
                          <span>Add Filter</span>
                        </button>
                      </div>
                    </div>

                    {activePlan.filters.length === 0 ? (
                      <div className="text-xs text-slate-500 py-2">
                        No WHERE predicates applied — evaluating all{' '}
                        {executionResult.totalSourceRows.toLocaleString()} rows.
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {activePlan.filters.map((flt) => (
                          <div
                            key={flt.id}
                            className="flex flex-wrap items-center gap-2 p-2 bg-slate-50 border border-slate-200 rounded-md"
                          >
                            <select
                              aria-label="Filter field"
                              value={normalizeFieldKey(activePlan.targetTable, flt.field)}
                              onChange={(e) =>
                                updatePlan((prev) => ({
                                  ...prev,
                                  filters: prev.filters.map((item) =>
                                    item.id === flt.id
                                      ? { ...item, field: e.target.value }
                                      : item
                                  ),
                                }))
                              }
                              className="h-8 px-2 text-xs font-mono bg-white border border-slate-200 rounded text-slate-800"
                            >
                              {activeTableFields.map((tf) => (
                                <option key={tf.key} value={tf.key}>
                                  {tf.key}
                                </option>
                              ))}
                            </select>

                            <select
                              aria-label="Filter operator"
                              value={flt.op}
                              onChange={(e) =>
                                updatePlan((prev) => ({
                                  ...prev,
                                  filters: prev.filters.map((item) =>
                                    item.id === flt.id
                                      ? { ...item, op: e.target.value as NlQueryOperator }
                                      : item
                                  ),
                                }))
                              }
                              className="h-8 px-2 text-xs font-mono bg-white border border-slate-200 rounded text-slate-800"
                            >
                              {(Object.keys(OP_LABELS) as NlQueryOperator[]).map((op) => (
                                <option key={op} value={op}>
                                  {OP_LABELS[op]}
                                </option>
                              ))}
                            </select>

                            <input
                              type="text"
                              aria-label="Filter value"
                              value={String(flt.value)}
                              onChange={(e) => {
                                const rawVal = e.target.value;
                                const trimmed = rawVal.trim();
                                let parsed: string | number | boolean = rawVal;
                                if (trimmed === 'true') parsed = true;
                                else if (trimmed === 'false') parsed = false;
                                else if (trimmed !== '' && !Number.isNaN(Number(trimmed))) {
                                  parsed = Number(trimmed);
                                }
                                updatePlan((prev) => ({
                                  ...prev,
                                  filters: prev.filters.map((item) =>
                                    item.id === flt.id ? { ...item, value: parsed } : item
                                  ),
                                }));
                              }}
                              className="flex-1 min-w-[110px] h-8 px-2.5 text-xs font-mono bg-white border border-slate-200 rounded text-slate-900"
                            />

                            <button
                              type="button"
                              aria-label="Remove filter"
                              onClick={() =>
                                updatePlan((prev) => ({
                                  ...prev,
                                  filters: prev.filters.filter((item) => item.id !== flt.id),
                                }))
                              }
                              className="p-1.5 text-slate-400 hover:text-red-600 rounded"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Right: Live SQL Equivalent */}
                <div className="lg:col-span-5">
                  <div className="text-[11px] font-medium text-slate-600 mb-1">
                    Verifiable SQL Equivalent
                  </div>
                  <pre className="p-3.5 bg-slate-900 text-slate-100 rounded-md text-xs font-mono overflow-x-auto leading-relaxed">
                    {liveSql}
                  </pre>
                </div>
              </div>
            )}
          </section>

          {/* Results Table */}
          <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 bg-slate-50/70 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-xs">
                <Table2 className="w-4 h-4 text-slate-500" />
                <span className="font-semibold text-slate-900">
                  Query Results ({NL_TABLE_LABELS[executionResult.targetTable]})
                </span>
                <span className="text-slate-400" aria-hidden="true">·</span>
                <span className="font-mono tabular-nums text-slate-500">
                  Showing {executionResult.rows.length} of{' '}
                  {executionResult.matchedRowCount.toLocaleString()} matched
                </span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleExportCsv}
                  disabled={executionResult.rows.length === 0}
                  className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-md transition-colors inline-flex items-center gap-1.5 disabled:opacity-50 whitespace-nowrap"
                >
                  <Download className="w-3.5 h-3.5 text-slate-500" />
                  <span>Export CSV</span>
                </button>
                <button
                  type="button"
                  onClick={handleExportJson}
                  disabled={executionResult.rows.length === 0}
                  className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-md transition-colors inline-flex items-center gap-1.5 disabled:opacity-50 whitespace-nowrap"
                >
                  <Download className="w-3.5 h-3.5 text-slate-500" />
                  <span>Export JSON</span>
                </button>
              </div>
            </div>

            {executionResult.rows.length === 0 ? (
              <div className="px-6 py-12 text-center space-y-3">
                <p className="text-sm font-medium text-slate-800">
                  Zero records matched the current query predicates.
                </p>
                <p className="text-xs text-slate-500">
                  Relax one of the filter thresholds above or switch target tables to inspect rows.
                </p>
                {activePlan.filters.length > 0 && (
                  <button
                    type="button"
                    onClick={() => updatePlan((prev) => ({ ...prev, filters: [] }))}
                    className="px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-md"
                  >
                    Clear All Filters
                  </button>
                )}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50/50 text-slate-600">
                      {executionResult.columns.map((col) => (
                        <th
                          key={col.key}
                          className={`px-3.5 py-2.5 font-semibold whitespace-nowrap ${
                            col.isNumeric ? 'text-right' : 'text-left'
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() =>
                              updatePlan((prev) => ({
                                ...prev,
                                sortBy: {
                                  field: col.key,
                                  direction:
                                    prev.sortBy.field === col.key &&
                                    prev.sortBy.direction === 'desc'
                                      ? 'asc'
                                      : 'desc',
                                },
                              }))
                            }
                            className="hover:text-blue-700 transition-colors inline-flex items-center gap-1"
                          >
                            <span>{col.label}</span>
                            {activePlan.sortBy.field === col.key && (
                              <span className="font-mono text-[10px] text-blue-700">
                                {activePlan.sortBy.direction === 'asc' ? '↑' : '↓'}
                              </span>
                            )}
                          </button>
                        </th>
                      ))}
                      {!executionResult.isGrouped && (
                        <th className="px-3.5 py-2.5 font-semibold text-right whitespace-nowrap">
                          Action
                        </th>
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {executionResult.rows.map((row, rIdx) => {
                      const entityId = row.entityId ? String(row.entityId) : null;
                      return (
                        <tr
                          key={rIdx}
                          className="hover:bg-slate-50/80 transition-colors"
                        >
                          {executionResult.columns.map((col) => {
                            const val = row[col.key];
                            return (
                              <td
                                key={col.key}
                                className={`px-3.5 py-2.5 whitespace-nowrap ${
                                  col.isNumeric
                                    ? 'text-right font-mono tabular-nums text-slate-800'
                                    : col.key === 'entityId' || col.key === 'eventId' || col.key === 'transitionId'
                                    ? 'font-mono text-slate-900'
                                    : 'text-slate-700'
                                }`}
                              >
                                {formatCellValue(val, col)}
                              </td>
                            );
                          })}
                          {!executionResult.isGrouped && (
                            <td className="px-3.5 py-2.5 text-right whitespace-nowrap">
                              {entityId ? (
                                <button
                                  type="button"
                                  onClick={() => onInspectEntityInExplorer(entityId)}
                                  className="text-xs font-medium text-blue-700 hover:underline inline-flex items-center gap-1"
                                >
                                  <span>Inspect</span>
                                  <ArrowRight className="w-3 h-3" />
                                </button>
                              ) : (
                                <span className="text-slate-300">—</span>
                              )}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
};
