import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  Copy,
  Maximize2,
  Minimize2,
  Play,
  Terminal as TerminalIcon,
  Trash2,
  X,
} from 'lucide-react';
import {
  BatchLogStatusCode,
  BatchProcessingLogEntry,
  executeStratumTerminalCommand,
  getTerminalAutocomplete,
  TerminalExecutionContext,
  TerminalLineTone,
  TerminalOutputLine,
} from '../engine/terminalEngine';

interface StratumTerminalDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  executionContext: TerminalExecutionContext;
  batchLogs: BatchProcessingLogEntry[];
  onClearBatchLogs: () => void;
  onRunBatchMaterialization: () => void;
}

type DrawerPaneMode = 'split' | 'cli' | 'logs';
type LogPipelineFilter = 'all' | BatchProcessingLogEntry['pipeline'];

const TONE_CLASSES: Record<TerminalLineTone, string> = {
  input: 'text-sky-300 font-semibold',
  info: 'text-slate-200',
  success: 'text-emerald-400',
  warn: 'text-amber-300',
  error: 'text-rose-400',
  table: 'text-slate-300 whitespace-pre',
  muted: 'text-slate-400',
};

const QUICK_COMMANDS = [
  'status',
  'metrics',
  'audit',
  'materialize',
  'logs',
  'help',
];

function getStatusCodeClass(code: BatchLogStatusCode): string {
  if (code === 200) return 'text-emerald-400';
  if (code === 102 || code === 422) return 'text-amber-300';
  if (code === 500) return 'text-rose-400';
  return 'text-sky-400';
}

function getProgressBarClass(code: BatchLogStatusCode): string {
  if (code === 200) return 'bg-emerald-500';
  if (code === 500) return 'bg-rose-500';
  if (code === 422) return 'bg-amber-400';
  return 'bg-sky-400';
}

export const StratumTerminalDrawer: React.FC<StratumTerminalDrawerProps> = ({
  isOpen,
  onClose,
  executionContext,
  batchLogs,
  onClearBatchLogs,
  onRunBatchMaterialization,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [paneMode, setPaneMode] = useState<DrawerPaneMode>('split');
  const [logFilter, setLogFilter] = useState<LogPipelineFilter>('all');
  const [inputValue, setInputValue] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState<number>(-1);
  const [copied, setCopied] = useState(false);

  const [lines, setLines] = useState<TerminalOutputLine[]>(() => [
    {
      id: 'init-1',
      tone: 'info',
      text: 'Stratum Interactive CLI ready. Inspect datasets, tune configs, query SQL, audit splits, or trigger exports.',
    },
    {
      id: 'init-2',
      tone: 'muted',
      text: 'Type `help` for commands, `materialize` to log batch runs, `Tab` to autocomplete, or `Ctrl+`` to toggle.',
    },
  ]);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const scrollEndRef = useRef<HTMLDivElement | null>(null);

  const promptLabel = useMemo(() => {
    const slug = executionContext.customDatasetName
      ? 'custom_csv'
      : executionContext.activePresetId;
    return `stratum@${slug}:~/${executionContext.activeTab}$`;
  }, [
    executionContext.activePresetId,
    executionContext.activeTab,
    executionContext.customDatasetName,
  ]);

  const suggestion = useMemo(
    () => getTerminalAutocomplete(inputValue, executionContext.presets),
    [inputValue, executionContext.presets]
  );

  const filteredLogs = useMemo(() => {
    if (logFilter === 'all') return batchLogs;
    return batchLogs.filter((l) => l.pipeline === logFilter);
  }, [batchLogs, logFilter]);

  useEffect(() => {
    if (isOpen && paneMode !== 'logs') {
      window.setTimeout(() => {
        inputRef.current?.focus();
      }, 20);
    }
  }, [isOpen, paneMode]);

  useEffect(() => {
    scrollEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [lines, isOpen]);

  const runCommand = (rawCmd: string) => {
    const trimmed = rawCmd.trim();
    const inputLine: TerminalOutputLine = {
      id: `in-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      tone: 'input',
      text: `${promptLabel} ${trimmed}`,
    };

    if (!trimmed) {
      setLines((prev) => [...prev, inputLine]);
      return;
    }

    const result = executeStratumTerminalCommand(trimmed, executionContext);
    setHistory((prev) => (prev[prev.length - 1] === trimmed ? prev : [...prev, trimmed]));
    setHistoryIdx(-1);
    setInputValue('');

    if (result.clear) {
      setLines([]);
      return;
    }

    setLines((prev) => [...prev, inputLine, ...result.lines]);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      runCommand(inputValue);
      return;
    }

    if (e.key === 'Tab') {
      if (suggestion) {
        e.preventDefault();
        setInputValue(suggestion);
      }
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (history.length === 0) return;
      const nextIdx = historyIdx === -1 ? history.length - 1 : Math.max(0, historyIdx - 1);
      setHistoryIdx(nextIdx);
      setInputValue(history[nextIdx] ?? '');
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIdx === -1) return;
      if (historyIdx >= history.length - 1) {
        setHistoryIdx(-1);
        setInputValue('');
      } else {
        const nextIdx = historyIdx + 1;
        setHistoryIdx(nextIdx);
        setInputValue(history[nextIdx] ?? '');
      }
      return;
    }

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'l') {
      e.preventDefault();
      setLines([]);
    }
  };

  const handleCopyTranscript = async () => {
    const cliText = lines.map((l) => l.text).join('\n');
    const logText = batchLogs
      .map(
        (l) =>
          `[${l.timestamp}] ${l.statusCode} ${l.statusLabel} | ${l.pipeline} · ${l.stage} (${l.progressPct}%) — ${l.batchDetail}${
            l.durationMs !== undefined ? ` [${l.durationMs}ms]` : ''
          }`
      )
      .join('\n');
    const combined =
      paneMode === 'logs'
        ? logText
        : paneMode === 'cli'
          ? cliText
          : `${cliText}\n\n--- Batch Processing Logs ---\n${logText}`;
    try {
      await navigator.clipboard.writeText(combined);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      // clipboard unavailable
    }
  };

  if (!isOpen) return null;

  const showCli = paneMode === 'split' || paneMode === 'cli';
  const showLogs = paneMode === 'split' || paneMode === 'logs';

  return (
    <section
      aria-label="Stratum interactive terminal"
      className={`sticky bottom-0 z-30 border-t border-slate-800 bg-slate-950 text-slate-100 flex flex-col shrink-0 transition-all duration-150 ${
        isExpanded ? 'h-[460px]' : 'h-[280px]'
      }`}
    >
      {/* Terminal Header Bar */}
      <div className="h-10 px-4 border-b border-slate-800 bg-slate-900 flex items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-200 whitespace-nowrap">
            <TerminalIcon className="w-3.5 h-3.5 text-sky-400" />
            <span>Workbench Terminal</span>
          </div>

          {/* Pane Mode Switcher */}
          <div className="inline-flex rounded border border-slate-700 bg-slate-950 p-0.5 shrink-0">
            <button
              type="button"
              onClick={() => setPaneMode('split')}
              className={`px-2 py-0.5 text-[11px] font-medium rounded transition-colors ${
                paneMode === 'split'
                  ? 'bg-slate-800 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Split
            </button>
            <button
              type="button"
              onClick={() => setPaneMode('cli')}
              className={`px-2 py-0.5 text-[11px] font-medium rounded transition-colors ${
                paneMode === 'cli'
                  ? 'bg-slate-800 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              CLI
            </button>
            <button
              type="button"
              onClick={() => setPaneMode('logs')}
              className={`px-2 py-0.5 text-[11px] font-medium rounded transition-colors font-mono tabular-nums ${
                paneMode === 'logs'
                  ? 'bg-slate-800 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Batch Logs ({batchLogs.length})
            </button>
          </div>

          <div className="hidden xl:flex items-center gap-3 overflow-x-auto text-[11px] font-mono text-slate-400">
            {QUICK_COMMANDS.map((cmd) => (
              <button
                key={cmd}
                type="button"
                onClick={() => {
                  if (paneMode === 'logs') setPaneMode('split');
                  runCommand(cmd);
                  inputRef.current?.focus();
                }}
                className="hover:text-sky-300 transition-colors whitespace-nowrap focus:outline-none focus-visible:underline"
              >
                {cmd}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={handleCopyTranscript}
            className="px-2 py-1 text-[11px] font-medium text-slate-300 hover:text-white hover:bg-slate-800 rounded inline-flex items-center gap-1 transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-sky-400"
          >
            {copied ? (
              <>
                <Check className="w-3 h-3 text-emerald-400" />
                <span>Copied</span>
              </>
            ) : (
              <>
                <Copy className="w-3 h-3" />
                <span>Copy</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={() => {
              setLines([]);
              inputRef.current?.focus();
            }}
            className="px-2 py-1 text-[11px] font-medium text-slate-300 hover:text-white hover:bg-slate-800 rounded inline-flex items-center gap-1 transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-sky-400"
          >
            <Trash2 className="w-3 h-3" />
            <span>Clear CLI</span>
          </button>

          <button
            type="button"
            onClick={() => setIsExpanded((prev) => !prev)}
            className="px-2 py-1 text-[11px] font-medium text-slate-300 hover:text-white hover:bg-slate-800 rounded inline-flex items-center gap-1 transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-sky-400"
          >
            {isExpanded ? (
              <>
                <Minimize2 className="w-3 h-3" />
                <span>Compact</span>
              </>
            ) : (
              <>
                <Maximize2 className="w-3 h-3" />
                <span>Expand</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close terminal"
            className="p-1 text-slate-400 hover:text-white hover:bg-slate-800 rounded transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-sky-400"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Main Terminal Content Area (CLI + Batch Processing Logs Section) */}
      <div
        className={`flex-1 min-h-0 grid ${
          paneMode === 'split'
            ? 'grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-slate-800'
            : 'grid-cols-1'
        }`}
      >
        {/* Left: Interactive CLI Console */}
        {showCli && (
          <div
            onClick={() => inputRef.current?.focus()}
            className={`${
              paneMode === 'split' ? 'lg:col-span-6' : ''
            } h-full overflow-y-auto overflow-x-auto px-4 py-3 font-mono text-xs leading-relaxed tabular-nums cursor-text space-y-1`}
          >
            {lines.map((line) => (
              <div key={line.id} className={TONE_CLASSES[line.tone]}>
                {line.text}
              </div>
            ))}

            {/* Active Prompt Row */}
            <div className="flex items-center gap-2 pt-1">
              <span className="text-emerald-400 font-semibold whitespace-nowrap select-none">
                {promptLabel}
              </span>
              <div className="relative flex-1 min-w-[160px]">
                <input
                  ref={inputRef}
                  type="text"
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={handleKeyDown}
                  spellCheck={false}
                  autoComplete="off"
                  aria-label="Stratum terminal command input"
                  placeholder="Enter command (e.g. status, materialize, logs, sql ..., help)"
                  className="w-full bg-transparent text-slate-100 placeholder:text-slate-500 focus:outline-none font-mono text-xs"
                />
              </div>
              {suggestion && suggestion !== inputValue && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setInputValue(suggestion);
                    inputRef.current?.focus();
                  }}
                  className="text-[11px] text-slate-400 hover:text-sky-300 whitespace-nowrap shrink-0"
                >
                  Tab: {suggestion}
                </button>
              )}
            </div>
            <div ref={scrollEndRef} />
          </div>
        )}

        {/* Right: Batch Processing Logs Section */}
        {showLogs && (
          <section
            aria-label="Batch Processing Logs"
            className={`${
              paneMode === 'split' ? 'lg:col-span-6' : ''
            } h-full flex flex-col min-h-0 bg-slate-950/90`}
          >
            <div className="px-4 py-2 border-b border-slate-800/80 bg-slate-900/60 flex flex-wrap items-center justify-between gap-2 shrink-0">
              <div className="flex items-center gap-2">
                <h3 className="text-xs font-semibold text-slate-200">
                  Batch Processing Logs
                </h3>
                <span className="text-[11px] font-mono text-slate-400 tabular-nums">
                  {filteredLogs.length} entries
                </span>
              </div>

              <div className="flex items-center gap-2">
                <select
                  aria-label="Filter batch logs by pipeline"
                  value={logFilter}
                  onChange={(e) => setLogFilter(e.target.value as LogPipelineFilter)}
                  className="px-2 py-0.5 text-[11px] font-mono bg-slate-900 border border-slate-700 rounded text-slate-200 focus:outline-none focus-visible:ring-1 focus-visible:ring-sky-400"
                >
                  <option value="all">All Pipelines</option>
                  <option value="Regression">Regression</option>
                  <option value="Sequence">Sequence</option>
                  <option value="Offline RL">Offline RL</option>
                  <option value="Events">Events</option>
                  <option value="Sync">Sync</option>
                </select>

                <button
                  type="button"
                  onClick={onRunBatchMaterialization}
                  className="px-2 py-0.5 text-[11px] font-medium text-sky-300 hover:text-white bg-slate-900 hover:bg-slate-800 border border-slate-700 rounded inline-flex items-center gap-1 transition-colors"
                >
                  <Play className="w-3 h-3" />
                  <span>Materialize</span>
                </button>

                <button
                  type="button"
                  onClick={onClearBatchLogs}
                  className="px-2 py-0.5 text-[11px] font-medium text-slate-400 hover:text-white hover:bg-slate-800 rounded transition-colors"
                >
                  Clear Logs
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-2 space-y-1.5 font-mono text-[11px] tabular-nums">
              {filteredLogs.length === 0 ? (
                <div className="py-6 text-center text-slate-500">
                  No batch processing logs recorded for this filter. Click Materialize or export a dataset to stream step logs.
                </div>
              ) : (
                filteredLogs.map((entry) => (
                  <div
                    key={entry.id}
                    className="grid grid-cols-[72px_74px_1fr_92px] items-center gap-2 py-1 border-b border-slate-900/90 last:border-b-0"
                  >
                    <span className="text-slate-500 truncate">{entry.timestamp}</span>
                    <span className={`font-semibold whitespace-nowrap ${getStatusCodeClass(entry.statusCode)}`}>
                      {entry.statusCode} {entry.statusLabel}
                    </span>
                    <div className="min-w-0 truncate text-slate-300">
                      <span className="text-slate-100 font-medium">{entry.pipeline}</span>
                      <span className="text-slate-500"> · {entry.stage}</span>
                      <span className="text-slate-400"> — {entry.batchDetail}</span>
                      {entry.durationMs !== undefined && (
                        <span className="text-slate-500"> ({entry.durationMs}ms)</span>
                      )}
                    </div>
                    <div className="flex items-center justify-end gap-1.5 shrink-0">
                      <div className="w-12 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                        <div
                          className={`h-full transition-all duration-150 ${getProgressBarClass(entry.statusCode)}`}
                          style={{ width: `${Math.min(100, Math.max(0, entry.progressPct))}%` }}
                        />
                      </div>
                      <span className="w-8 text-right text-slate-300">
                        {entry.progressPct}%
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>
        )}
      </div>
    </section>
  );
};
