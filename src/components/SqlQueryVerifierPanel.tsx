import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  Database,
  Play,
  RotateCcw,
  Table2,
  Terminal,
  Wand2,
  XCircle,
} from 'lucide-react';
import {
  PiiMaskingConfig,
  RegressionConfig,
  RegressionResult,
  SqlSyntaxDiagnostic,
  SqlSyntaxTokenType,
} from '../types/curation';
import {
  analyzeSqlVerificationQuery,
  validateSqlEditorSyntax,
} from '../engine/curationEngine';

interface SqlQueryVerifierPanelProps {
  generatedSql: string;
  datasetName: string;
  regConfig: RegressionConfig;
  regResult: RegressionResult;
  piiMaskingConfig: PiiMaskingConfig;
  columns: { name: string; pgType: string; description: string }[];
}

type OutputTab = 'explain' | 'preview' | 'schema';

const TOKEN_CLASS_MAP: Record<SqlSyntaxTokenType, string> = {
  whitespace: '',
  comment: 'text-slate-500 italic',
  string: 'text-amber-300',
  number: 'text-orange-300',
  operator: 'text-slate-400',
  keyword: 'text-sky-400 font-semibold',
  function: 'text-violet-300',
  table_valid: 'text-emerald-300 font-medium',
  column_valid: 'text-slate-100',
  alias: 'text-teal-300 italic',
  invalid_keyword:
    'text-rose-200 bg-rose-500/25 underline decoration-wavy decoration-rose-400 rounded-[2px]',
  invalid_schema:
    'text-amber-200 bg-amber-500/25 underline decoration-wavy decoration-amber-400 rounded-[2px]',
  syntax_error:
    'text-rose-200 bg-rose-500/30 underline decoration-wavy decoration-rose-400 rounded-[2px]',
};

export const SqlQueryVerifierPanel: React.FC<SqlQueryVerifierPanelProps> = ({
  generatedSql,
  datasetName,
  regConfig,
  regResult,
  piiMaskingConfig,
  columns,
}) => {
  const [editableSql, setEditableSql] = useState(generatedSql);
  const [isDirty, setIsDirty] = useState(false);
  const [statementIdx, setStatementIdx] = useState(0);
  const [outputTab, setOutputTab] = useState<OutputTab>('explain');
  const [copied, setCopied] = useState(false);
  const [copiedColumn, setCopiedColumn] = useState<string | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const backdropRef = useRef<HTMLPreElement | null>(null);
  const gutterRef = useRef<HTMLDivElement | null>(null);

  // Keep synced with upstream config changes until the user customizes the query
  useEffect(() => {
    if (!isDirty) {
      setEditableSql(generatedSql);
      setStatementIdx(0);
    }
  }, [generatedSql, isDirty]);

  const analysis = useMemo(
    () =>
      analyzeSqlVerificationQuery(
        editableSql,
        regResult,
        regConfig,
        piiMaskingConfig,
        statementIdx
      ),
    [editableSql, regResult, regConfig, piiMaskingConfig, statementIdx]
  );

  const syntaxReport = useMemo(
    () => validateSqlEditorSyntax(editableSql, regConfig),
    [editableSql, regConfig]
  );

  const errorLinesSet = useMemo(
    () => new Set(syntaxReport.errorLines),
    [syntaxReport.errorLines]
  );

  const handleEditorScroll = () => {
    const ta = textareaRef.current;
    if (!ta) return;
    if (backdropRef.current) {
      backdropRef.current.scrollTop = ta.scrollTop;
      backdropRef.current.scrollLeft = ta.scrollLeft;
    }
    if (gutterRef.current) {
      gutterRef.current.scrollTop = ta.scrollTop;
    }
  };

  const handleReset = () => {
    setEditableSql(generatedSql);
    setIsDirty(false);
    setStatementIdx(0);
  };

  const applyPresetQuery = (sql: string) => {
    setEditableSql(sql);
    setIsDirty(true);
    setStatementIdx(0);
  };

  const handleApplyQuickFix = (diag: SqlSyntaxDiagnostic) => {
    if (!diag.suggestion) return;
    const nextSql =
      editableSql.slice(0, diag.start) +
      diag.suggestion +
      editableSql.slice(diag.end);
    setEditableSql(nextSql);
    setIsDirty(true);
    const nextCaretPos = diag.start + diag.suggestion.length;
    window.requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (ta) {
        ta.focus();
        ta.setSelectionRange(nextCaretPos, nextCaretPos);
      }
    });
  };

  const handleJumpToDiagnostic = (diag: SqlSyntaxDiagnostic) => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.focus();
    ta.setSelectionRange(diag.start, diag.end);
  };

  const handleCopySql = async () => {
    try {
      await navigator.clipboard.writeText(editableSql);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  const highValueThreshold = Math.max(
    50,
    Math.round(regResult.meanTargetWinsorized * 1.25)
  );

  const quickTemplates = [
    {
      id: 'train_scan',
      label: 'Train Index Scan',
      sql: `SELECT\n  entity_id,\n  split,\n  batch_id,\n  predicted_horizon_ltv,\n  target_ltv_winsorized\nFROM stratum_regression_ltv\nWHERE split = 'train' AND leakage_verified = TRUE\nORDER BY batch_id ASC, target_ltv_winsorized DESC\nLIMIT ${regConfig.batchSize || 32};`,
    },
    {
      id: 'split_agg',
      label: 'Split Aggregation',
      sql: `SELECT\n  split,\n  COUNT(*) AS entity_count,\n  COUNT(DISTINCT batch_id) AS batch_chunks,\n  ROUND(AVG(projected_future_ltv)::numeric, 2) AS mean_projected_ltv,\n  ROUND(AVG(target_ltv_winsorized)::numeric, 2) AS mean_target_ltv\nFROM stratum_regression_ltv\nWHERE leakage_verified = TRUE\nGROUP BY split\nORDER BY split ASC;`,
    },
    {
      id: 'high_ltv',
      label: `Target LTV >= $${highValueThreshold}`,
      sql: `SELECT\n  entity_id,\n  split,\n  projected_future_ltv,\n  target_ltv_winsorized\nFROM stratum_regression_ltv\nWHERE target_ltv_winsorized >= ${highValueThreshold}\nORDER BY target_ltv_winsorized DESC\nLIMIT 25;`,
    },
  ];

  const errorCount = analysis.issues.filter((i) => i.severity === 'error').length;
  const warnCount = analysis.issues.filter((i) => i.severity === 'warning').length;
  const visibleDiagnostics = syntaxReport.diagnostics.slice(0, 5);

  return (
    <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Database className="w-4 h-4 text-blue-700 shrink-0" />
            <h2 className="text-sm font-semibold text-slate-900">
              Interactive SQL Schema &amp; Execution Plan Verifier
            </h2>
          </div>
          <p className="text-xs text-slate-500 mt-0.5 font-mono tabular-nums">
            Live planner against {datasetName} · Relation:{' '}
            {analysis.expectedTableName} ({analysis.totalTableRows} rows ·{' '}
            {columns.length} materialized cols)
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {quickTemplates.map((tpl) => (
            <button
              key={tpl.id}
              type="button"
              onClick={() => applyPresetQuery(tpl.sql)}
              className="px-2.5 py-1.5 text-[11px] font-medium text-slate-700 bg-slate-50 border border-slate-200 rounded-md hover:bg-slate-100 transition-colors"
            >
              {tpl.label}
            </button>
          ))}

          {isDirty && (
            <button
              type="button"
              onClick={handleReset}
              className="px-2.5 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-md hover:bg-blue-100 inline-flex items-center gap-1.5 transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset Generated SQL</span>
            </button>
          )}

          <button
            type="button"
            onClick={handleCopySql}
            className="px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 inline-flex items-center gap-1.5"
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-600" />
                <span>Copied</span>
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

      {/* Main Two-Column Interactive Workspace */}
      <div className="grid grid-cols-1 xl:grid-cols-12 divide-y xl:divide-y-0 xl:divide-x divide-slate-200">
        {/* Left: Syntax-Highlighted SQL Editor & Column Reference */}
        <div className="xl:col-span-6 p-5 flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label
              htmlFor="interactive-sql-editor"
              className="text-xs font-semibold text-slate-800 inline-flex items-center gap-1.5"
            >
              <Play className="w-3.5 h-3.5 text-emerald-600" />
              <span>Editable PostgreSQL Verification Query</span>
            </label>

            <div className="flex items-center gap-3">
              <span
                className={`inline-flex items-center gap-1 text-[11px] font-medium font-mono tabular-nums ${
                  syntaxReport.isSyntaxClean
                    ? 'text-emerald-700'
                    : 'text-rose-700'
                }`}
              >
                {syntaxReport.isSyntaxClean ? (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                    <span>Syntax Clean</span>
                  </>
                ) : (
                  <>
                    <XCircle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                    <span>
                      {syntaxReport.errorCount} Syntax / Schema Issue
                      {syntaxReport.errorCount === 1 ? '' : 's'}
                    </span>
                  </>
                )}
              </span>

              {analysis.statementCount > 1 && (
                <div
                  className="inline-flex rounded-md border border-slate-200 bg-slate-50 p-0.5"
                  role="group"
                  aria-label="Inspect SQL statement index"
                >
                  {Array.from(
                    { length: analysis.statementCount },
                    (_, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => setStatementIdx(idx)}
                        className={`px-2 py-0.5 text-[11px] font-mono rounded transition-colors ${
                          analysis.activeStatementIndex === idx
                            ? 'bg-white text-slate-900 shadow-xs font-semibold'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        Stmt {idx + 1}
                      </button>
                    )
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Synchronized Syntax-Highlighted SQL Editor */}
          <div
            className={`rounded-md border overflow-hidden bg-slate-950 focus-within:ring-2 focus-within:ring-blue-600 ${
              syntaxReport.isSyntaxClean
                ? 'border-slate-800'
                : 'border-rose-500/70'
            }`}
          >
            <div className="flex h-[312px]">
              {/* Line Number Gutter */}
              <div
                ref={gutterRef}
                aria-hidden="true"
                className="w-10 shrink-0 bg-slate-900/90 border-r border-slate-800 py-3.5 px-2 overflow-hidden select-none text-right font-mono text-xs leading-6 tabular-nums"
              >
                {Array.from({ length: syntaxReport.lineCount }, (_, idx) => {
                  const lineNo = idx + 1;
                  const hasErr = errorLinesSet.has(lineNo);
                  return (
                    <div
                      key={lineNo}
                      className={
                        hasErr
                          ? 'text-rose-400 bg-rose-950/60 font-semibold px-1 -mx-1 rounded-xs'
                          : 'text-slate-500'
                      }
                    >
                      {lineNo}
                    </div>
                  );
                })}
              </div>

              {/* Token Highlight Backdrop + Transparent Foreground Textarea */}
              <div className="relative flex-1 min-w-0 h-full">
                <pre
                  ref={backdropRef}
                  aria-hidden="true"
                  className="absolute inset-0 m-0 p-3.5 font-mono text-xs leading-6 whitespace-pre overflow-hidden pointer-events-none select-none [tab-size:2]"
                >
                  {syntaxReport.tokens.map((tok) => (
                    <span
                      key={tok.id}
                      className={TOKEN_CLASS_MAP[tok.type]}
                    >
                      {tok.text}
                    </span>
                  ))}
                  {' '}
                </pre>

                <textarea
                  ref={textareaRef}
                  id="interactive-sql-editor"
                  value={editableSql}
                  onChange={(e) => {
                    setEditableSql(e.target.value);
                    setIsDirty(true);
                  }}
                  onScroll={handleEditorScroll}
                  spellCheck={false}
                  autoCapitalize="off"
                  autoComplete="off"
                  autoCorrect="off"
                  aria-label="Interactive PostgreSQL query editor"
                  className="relative z-10 w-full h-full m-0 p-3.5 bg-transparent text-transparent caret-white selection:bg-blue-500/35 font-mono text-xs leading-6 whitespace-pre overflow-auto resize-none focus:outline-none [tab-size:2]"
                />
              </div>
            </div>

            {/* Highlight Color Legend & Line Counter */}
            <div className="px-3.5 py-1.5 bg-slate-900/80 border-t border-slate-800 flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono">
              <div className="flex flex-wrap items-center gap-3 text-slate-400">
                <span className="text-sky-400">Keywords</span>
                <span className="text-emerald-300">Relation</span>
                <span className="text-rose-300 underline decoration-wavy decoration-rose-400">
                  Invalid Keyword
                </span>
                <span className="text-amber-200 underline decoration-wavy decoration-amber-400">
                  Invalid Schema
                </span>
              </div>
              <span className="text-slate-400 tabular-nums">
                Ln {syntaxReport.lineCount} ·{' '}
                {isDirty ? 'Custom Edit' : 'Synced w/ Config'}
              </span>
            </div>
          </div>

          {/* Real-Time Syntax & Schema Diagnostics Strip */}
          {syntaxReport.diagnostics.length > 0 && (
            <div
              className="rounded-md border border-rose-200 bg-rose-50/70 divide-y divide-rose-200/70"
              role="region"
              aria-label="Real-time SQL syntax diagnostics"
            >
              {visibleDiagnostics.map((diag) => {
                const isSchemaIssue =
                  diag.code === 'invalid_table' || diag.code === 'invalid_column';
                return (
                  <div
                    key={diag.id}
                    className="px-3 py-2 flex flex-wrap items-center justify-between gap-2 text-xs"
                  >
                    <div className="flex items-start gap-2 min-w-0">
                      <button
                        type="button"
                        onClick={() => handleJumpToDiagnostic(diag)}
                        title="Jump to token in SQL editor"
                        className={`font-mono text-[11px] font-semibold shrink-0 underline-offset-2 hover:underline ${
                          isSchemaIssue ? 'text-amber-800' : 'text-rose-800'
                        }`}
                      >
                        Ln {diag.line}:{diag.column}
                      </button>
                      <span className="text-slate-800 text-[11px] leading-snug">
                        {diag.message}
                      </span>
                    </div>

                    {diag.suggestion && (
                      <button
                        type="button"
                        onClick={() => handleApplyQuickFix(diag)}
                        className="px-2 py-1 text-[11px] font-mono font-semibold text-slate-900 bg-white border border-slate-300 rounded hover:bg-slate-100 inline-flex items-center gap-1 shrink-0 transition-colors"
                      >
                        <Wand2 className="w-3 h-3 text-blue-700" />
                        <span>Fix → {diag.suggestion}</span>
                      </button>
                    )}
                  </div>
                );
              })}
              {syntaxReport.diagnostics.length > visibleDiagnostics.length && (
                <div className="px-3 py-1.5 text-[11px] font-mono text-rose-700">
                  +
                  {syntaxReport.diagnostics.length - visibleDiagnostics.length}{' '}
                  additional syntax issue
                  {syntaxReport.diagnostics.length - visibleDiagnostics.length === 1
                    ? ''
                    : 's'}
                </div>
              )}
            </div>
          )}

          {/* Available Schema Columns Quick Reference */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[11px] text-slate-500">
              <span>
                Active Schema Columns ({columns.length}) — click to copy column
                name
              </span>
              {copiedColumn && (
                <span className="font-mono text-emerald-700">
                  Copied {copiedColumn}
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {columns.map((col) => {
                const isReferenced = !analysis.missingSchemaColumns.includes(
                  col.name
                );
                return (
                  <button
                    key={col.name}
                    type="button"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(col.name);
                        setCopiedColumn(col.name);
                        window.setTimeout(() => setCopiedColumn(null), 1500);
                      } catch {
                        // ignore clipboard errors
                      }
                    }}
                    title={`${col.name} (${col.pgType}): ${col.description}`}
                    className={`px-2 py-0.5 text-[11px] font-mono rounded border transition-colors ${
                      isReferenced
                        ? 'bg-blue-50 text-blue-800 border-blue-200 hover:bg-blue-100'
                        : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    {col.name}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right: Immediate Execution Plan, Row Count Estimation & Schema Check */}
        <div className="xl:col-span-6 p-5 flex flex-col gap-4 bg-slate-50/40">
          {/* Schema Status Banner */}
          <div
            className={`rounded-md border px-3.5 py-2.5 flex items-start gap-2.5 text-xs ${
              errorCount > 0
                ? 'bg-red-50 border-red-200 text-red-900'
                : warnCount > 0
                  ? 'bg-amber-50 border-amber-200 text-amber-900'
                  : 'bg-emerald-50 border-emerald-200 text-emerald-900'
            }`}
          >
            {errorCount > 0 ? (
              <XCircle className="w-4 h-4 text-red-700 shrink-0 mt-0.5" />
            ) : warnCount > 0 ? (
              <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
            ) : (
              <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
            )}
            <div className="space-y-1 min-w-0">
              <div className="font-semibold">
                {errorCount > 0
                  ? 'Schema Expectation Mismatch'
                  : warnCount > 0
                    ? 'Query Verified with Advisory Notes'
                    : 'Schema & Relation Verified'}
              </div>
              {analysis.issues.length > 0 ? (
                <ul className="space-y-0.5 text-[11px]">
                  {analysis.issues.map((iss, i) => (
                    <li key={i}>{iss.message}</li>
                  ))}
                </ul>
              ) : (
                <div className="text-[11px]">
                  All {analysis.projectedColumns.length} projected expressions
                  match <code className="font-mono">{analysis.tableName}</code>{' '}
                  column types.
                </div>
              )}
            </div>
          </div>

          {/* 4-Card Row Count & Cost Estimation Strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <div className="bg-white border border-slate-200 rounded-md px-3 py-2">
              <div className="text-[10px] font-medium text-slate-500">
                Table Rows
              </div>
              <div className="text-base font-semibold font-mono tabular-nums text-slate-900 mt-0.5">
                {analysis.totalTableRows.toLocaleString()}
              </div>
              <div className="text-[10px] font-mono text-slate-400">
                unfiltered
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-md px-3 py-2">
              <div className="text-[10px] font-medium text-slate-500">
                WHERE Matched
              </div>
              <div className="text-base font-semibold font-mono tabular-nums text-blue-700 mt-0.5">
                {analysis.matchedRows.toLocaleString()}
              </div>
              <div className="text-[10px] font-mono tabular-nums text-slate-500">
                {analysis.selectivityPct.toFixed(1)}% selectivity
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-md px-3 py-2">
              <div className="text-[10px] font-medium text-slate-500">
                Output Rows
              </div>
              <div className="text-base font-semibold font-mono tabular-nums text-slate-900 mt-0.5">
                {analysis.outputRows.toLocaleString()}
              </div>
              <div className="text-[10px] font-mono tabular-nums text-slate-500">
                {analysis.limitApplied !== null
                  ? `LIMIT ${analysis.limitApplied}`
                  : analysis.groupByColumns.length > 0
                    ? `GROUP BY (${analysis.groupByColumns.length})`
                    : 'full set'}
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-md px-3 py-2">
              <div className="text-[10px] font-medium text-slate-500">
                Scan &amp; Est. Cost
              </div>
              <div className="text-xs font-semibold font-mono tabular-nums text-slate-900 mt-1 truncate">
                {analysis.scanStrategy}
              </div>
              <div className="text-[10px] font-mono tabular-nums text-slate-500 mt-0.5">
                cost={analysis.estimatedTotalCost.toFixed(2)} ·{' '}
                {analysis.estimatedRowWidthBytes}B/row
              </div>
            </div>
          </div>

          {/* Output Diagnostics Tabs */}
          <div className="flex items-center justify-between gap-2">
            <div
              className="inline-flex rounded-md border border-slate-200 bg-white p-0.5"
              role="group"
              aria-label="SQL planner diagnostic view"
            >
              <button
                type="button"
                onClick={() => setOutputTab('explain')}
                className={`px-2.5 py-1 text-xs font-medium rounded inline-flex items-center gap-1.5 transition-colors ${
                  outputTab === 'explain'
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Terminal className="w-3.5 h-3.5" />
                <span>Execution Plan</span>
              </button>
              <button
                type="button"
                onClick={() => setOutputTab('preview')}
                className={`px-2.5 py-1 text-xs font-medium rounded inline-flex items-center gap-1.5 transition-colors ${
                  outputTab === 'preview'
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Table2 className="w-3.5 h-3.5" />
                <span>Result Preview ({analysis.previewRows.length})</span>
              </button>
              <button
                type="button"
                onClick={() => setOutputTab('schema')}
                className={`px-2.5 py-1 text-xs font-medium rounded transition-colors ${
                  outputTab === 'schema'
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Projected Types ({analysis.projectedColumns.length})
              </button>
            </div>

            {analysis.indexName && (
              <span className="text-[11px] font-mono text-emerald-700">
                Using {analysis.indexName}
              </span>
            )}
          </div>

          {/* Tab Content */}
          {outputTab === 'explain' && (
            <div className="space-y-3">
              {/* Structured Plan Tree Cards */}
              {analysis.planNodes.length > 0 && (
                <div className="bg-white border border-slate-200 rounded-md divide-y divide-slate-100">
                  {analysis.planNodes.map((node) => (
                    <div
                      key={node.id}
                      className="px-3.5 py-2.5 text-xs flex flex-col gap-1"
                      style={{ paddingLeft: `${14 + node.depth * 18}px` }}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-mono font-semibold text-slate-900">
                          {node.depth > 0 && (
                            <span className="text-slate-400 mr-1.5">↳</span>
                          )}
                          {node.operator}
                        </span>
                        <span className="font-mono text-[11px] tabular-nums text-slate-600">
                          cost={node.startupCost.toFixed(2)}..
                          {node.totalCost.toFixed(2)} · rows=
                          {node.estimatedRows} · width={node.rowWidthBytes}B
                        </span>
                      </div>
                      {node.detail && (
                        <div className="text-[11px] font-mono text-slate-500">
                          {node.detail}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Raw EXPLAIN Block */}
              <pre className="p-3.5 bg-slate-950 text-emerald-300 font-mono text-[11px] rounded-md overflow-x-auto leading-relaxed">
                <code>{analysis.planText}</code>
              </pre>
            </div>
          )}

          {outputTab === 'preview' && (
            <div className="bg-white border border-slate-200 rounded-md overflow-hidden">
              {analysis.previewRows.length === 0 ? (
                <div className="py-10 px-4 text-center text-xs text-slate-500">
                  No preview rows returned under the current query filters and
                  schema check.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-mono font-semibold text-slate-700">
                        {analysis.previewColumns.map((col, idx) => (
                          <th key={`${col}-${idx}`} className="py-2 px-3">
                            {col}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 text-xs font-mono tabular-nums">
                      {analysis.previewRows.map((row, rIdx) => (
                        <tr key={rIdx} className="bg-white hover:bg-slate-50">
                          {analysis.previewColumns.map((col, cIdx) => {
                            const val = row[col];
                            return (
                              <td
                                key={`${rIdx}-${cIdx}`}
                                className="py-1.5 px-3 text-slate-800 whitespace-nowrap"
                              >
                                {typeof val === 'boolean'
                                  ? val
                                    ? 'TRUE'
                                    : 'FALSE'
                                  : String(val ?? 'NULL')}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="px-3 py-2 bg-slate-50 border-t border-slate-200 text-[11px] font-mono text-slate-500 tabular-nums">
                Showing {analysis.previewRows.length} sample row
                {analysis.previewRows.length === 1 ? '' : 's'} out of{' '}
                {analysis.outputRows.toLocaleString()} estimated output rows
              </div>
            </div>
          )}

          {outputTab === 'schema' && (
            <div className="bg-white border border-slate-200 rounded-md overflow-hidden">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-600">
                    <th className="py-2 px-3">Output Column</th>
                    <th className="py-2 px-3">Source Expression</th>
                    <th className="py-2 px-3">Inferred Type</th>
                    <th className="py-2 px-3 text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-xs">
                  {analysis.projectedColumns.map((p, idx) => (
                    <tr key={`${p.outputName}-${idx}`} className="bg-white">
                      <td className="py-1.5 px-3 font-mono font-semibold text-slate-900">
                        {p.outputName}
                      </td>
                      <td className="py-1.5 px-3 font-mono text-slate-600 truncate max-w-[200px]">
                        {p.sourceExpression}
                      </td>
                      <td className="py-1.5 px-3 font-mono text-blue-700">
                        {p.pgType}
                      </td>
                      <td className="py-1.5 px-3 text-right font-mono font-semibold">
                        {p.isValid ? (
                          <span className="text-emerald-700">OK</span>
                        ) : (
                          <span className="text-red-700">INVALID</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </section>
  );
};
