import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  Check,
  CheckCircle2,
  Copy,
  Download,
  FileCode2,
  FileJson,
  FileText,
  Loader2,
  RefreshCw,
  Wand2,
  XCircle,
} from 'lucide-react';
import {
  AutoDocAiNarrative,
  AutoDocSectionId,
  AutoDocTemplateMode,
  DatasetPreset,
  GlobalCurationConfig,
  MdpConfig,
  MdpResult,
  PiiMaskingConfig,
  RawEvent,
  RegressionConfig,
  RegressionResult,
  SequenceConfig,
  SequenceResult,
} from '../types/curation';
import {
  buildAutoDocumentation,
  formatAutoDocHtml,
  formatAutoDocJson,
  formatAutoDocMarkdown,
} from '../engine/autoDocEngine';

interface AutoDocumentationViewProps {
  presets: DatasetPreset[];
  activePresetId: string;
  customDatasetName: string | null;
  customEvents: RawEvent[] | null;
  requestedDatasetId?: string | null;
  globalConfig: GlobalCurationConfig;
  regConfig: RegressionConfig;
  seqConfig: SequenceConfig;
  mdpConfig: MdpConfig;
  piiMaskingConfig: PiiMaskingConfig;
  regResult: RegressionResult;
  seqResult: SequenceResult;
  mdpResult: MdpResult;
  onActivateDataset: (presetId: string) => void;
}

const TEMPLATE_MODES: { id: AutoDocTemplateMode; label: string }[] = [
  { id: 'model_card', label: 'Full ML Model Card' },
  { id: 'data_dictionary', label: 'Data Dictionary & Schema' },
  { id: 'executive_brief', label: 'Executive Brief' },
];

const SECTION_ITEMS: { id: AutoDocSectionId; label: string }[] = [
  { id: 'ai_narrative', label: 'AI Model Card Narrative' },
  { id: 'overview', label: '01. Dataset Overview' },
  { id: 'data_health', label: '02. Data Health & Quality' },
  { id: 'schema_dictionary', label: '03. Data Dictionary & Schema' },
  { id: 'paradigm_specs', label: '04. ML Paradigm Specs' },
  { id: 'audit_lineage', label: '05. Cross-Paradigm Audits' },
  { id: 'usage_code', label: '06. Reproducibility & Usage' },
];

function triggerTextDownload(filename: string, content: string, mimeType: string) {
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

export const AutoDocumentationView: React.FC<AutoDocumentationViewProps> = ({
  presets,
  activePresetId,
  customDatasetName,
  customEvents,
  requestedDatasetId,
  globalConfig,
  regConfig,
  seqConfig,
  mdpConfig,
  piiMaskingConfig,
  regResult,
  seqResult,
  mdpResult,
  onActivateDataset,
}) => {
  const activeDatasetKey = customDatasetName ? 'custom_csv' : activePresetId;
  const [targetDatasetId, setTargetDatasetId] = useState<string>(
    requestedDatasetId || activeDatasetKey
  );
  const [templateMode, setTemplateMode] = useState<AutoDocTemplateMode>('model_card');
  const [visibleSections, setVisibleSections] = useState<Record<AutoDocSectionId, boolean>>({
    ai_narrative: true,
    overview: true,
    data_health: true,
    schema_dictionary: true,
    paradigm_specs: true,
    audit_lineage: true,
    usage_code: true,
  });
  const [dictionaryTab, setDictionaryTab] = useState<'canonical' | 'derived'>('canonical');
  const [copiedMd, setCopiedMd] = useState(false);

  const [aiNarrativesByKey, setAiNarrativesByKey] = useState<
    Record<string, AutoDocAiNarrative>
  >({});
  const [isGeneratingAi, setIsGeneratingAi] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  useEffect(() => {
    if (requestedDatasetId) {
      setTargetDatasetId(requestedDatasetId);
    }
  }, [requestedDatasetId]);

  useEffect(() => {
    if (targetDatasetId === 'custom_csv' && !customDatasetName) {
      setTargetDatasetId(activePresetId);
    }
  }, [targetDatasetId, customDatasetName, activePresetId]);

  const docBundle = useMemo(() => {
    if (targetDatasetId === 'custom_csv' && customDatasetName && customEvents) {
      return buildAutoDocumentation({
        datasetId: 'custom_csv',
        datasetName: customDatasetName,
        datasetDomain: 'Custom File Import',
        datasetDescription:
          'User-supplied canonical event log materialized across Regression, Sequential Tensor, and Offline RL pipelines.',
        isCustomDataset: true,
        events: customEvents,
        globalConfig,
        regConfig,
        seqConfig,
        mdpConfig,
        piiMasking: piiMaskingConfig,
        precomputed: { regResult, seqResult, mdpResult },
      });
    }

    const preset = presets.find((p) => p.id === targetDatasetId) ?? presets[0];
    const isCurrentlyActive = !customDatasetName && preset.id === activePresetId;

    return buildAutoDocumentation({
      datasetId: preset.id,
      datasetName: preset.name,
      datasetDomain: preset.domain,
      datasetDescription: preset.description,
      isCustomDataset: false,
      events: preset.events,
      globalConfig,
      regConfig,
      seqConfig,
      mdpConfig,
      piiMasking: piiMaskingConfig,
      precomputed: isCurrentlyActive ? { regResult, seqResult, mdpResult } : undefined,
    });
  }, [
    targetDatasetId,
    customDatasetName,
    customEvents,
    presets,
    activePresetId,
    globalConfig,
    regConfig,
    seqConfig,
    mdpConfig,
    piiMaskingConfig,
    regResult,
    seqResult,
    mdpResult,
  ]);

  const cacheKey = `${docBundle.datasetId}:${templateMode}`;
  const activeNarrative = aiNarrativesByKey[cacheKey] ?? null;

  const isSectionShown = (id: AutoDocSectionId): boolean => {
    if (!visibleSections[id]) return false;
    if (templateMode === 'data_dictionary' && id === 'paradigm_specs') return false;
    if (templateMode === 'executive_brief' && id === 'schema_dictionary') return false;
    if (templateMode === 'executive_brief' && id === 'usage_code') return false;
    return true;
  };

  const handleToggleSection = (id: AutoDocSectionId) => {
    setVisibleSections((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleGenerateAiNarrative = async () => {
    setIsGeneratingAi(true);
    setAiError(null);
    try {
      const response = await fetch('/api/generate-docs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          template: templateMode,
          datasetName: docBundle.datasetName,
          datasetDomain: docBundle.datasetDomain,
          datasetDescription: docBundle.datasetDescription,
          entityCount: docBundle.entityCount,
          eventCount: docBundle.eventCount,
          dayRange: docBundle.dayRange,
          channels: docBundle.channels.map((c) => ({
            name: c.name,
            sharePct: Number(c.sharePct.toFixed(1)),
          })),
          actionSpace: docBundle.actionSpace.map((a) => ({
            id: a.id,
            label: a.label,
            sharePct: Number(a.sharePct.toFixed(1)),
            meanReward: Number(a.meanReward.toFixed(2)),
          })),
          healthScore: docBundle.healthScorecard.score,
          healthTier: docBundle.healthScorecard.tierLabel,
          healthWarnings: docBundle.healthScorecard.checks
            .filter((c) => c.status !== 'pass')
            .map((c) => `${c.label}: ${c.metricSummary}`),
          regressionSpec: docBundle.regressionSpec,
          sequenceSpec: docBundle.sequenceSpec,
          mdpSpec: docBundle.mdpSpec,
          audits: docBundle.audits.map((a) => ({
            name: a.name,
            paradigm: a.paradigm,
            status: a.status,
            metricValue: a.metricValue,
          })),
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        narrative?: AutoDocAiNarrative;
        error?: string;
      };
      if (!response.ok || !payload.narrative) {
        throw new Error(payload.error || `Request failed (${response.status})`);
      }

      setAiNarrativesByKey((prev) => ({
        ...prev,
        [cacheKey]: payload.narrative!,
      }));
    } catch (err) {
      setAiError(
        err instanceof Error ? err.message : 'Unable to generate AI documentation.'
      );
    } finally {
      setIsGeneratingAi(false);
    }
  };

  const safeSlug = docBundle.datasetId.replace(/[^a-z0-9_-]/gi, '_').toLowerCase();

  const handleCopyMarkdown = async () => {
    const md = formatAutoDocMarkdown(docBundle, templateMode, activeNarrative);
    try {
      await navigator.clipboard.writeText(md);
      setCopiedMd(true);
      window.setTimeout(() => setCopiedMd(false), 1800);
    } catch {
      // Clipboard fallback via download if blocked
      triggerTextDownload(`${safeSlug}_documentation.md`, md, 'text/markdown');
    }
  };

  const handleDownloadMarkdown = () => {
    const md = formatAutoDocMarkdown(docBundle, templateMode, activeNarrative);
    triggerTextDownload(`${safeSlug}_model_card.md`, md, 'text/markdown');
  };

  const handleDownloadHtml = () => {
    const html = formatAutoDocHtml(docBundle, templateMode, activeNarrative);
    triggerTextDownload(`${safeSlug}_documentation.html`, html, 'text/html');
  };

  const handleDownloadJson = () => {
    const json = formatAutoDocJson(docBundle, activeNarrative);
    triggerTextDownload(`${safeSlug}_datacard.json`, json, 'application/json');
  };

  const activeDictRows =
    dictionaryTab === 'canonical'
      ? docBundle.canonicalDictionary
      : docBundle.derivedDictionary;

  const isDocumentingActive = docBundle.datasetId === activeDatasetKey;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900">
            Auto Documentation Generator
          </h1>
          <p className="text-sm text-slate-600 mt-1 max-w-2xl">
            Automatically compile live statistical Data Dictionaries, ML Model Cards, cross-paradigm
            lineage specs, and Markdown/HTML/JSON artifacts directly from curated dataset telemetry.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleGenerateAiNarrative}
            disabled={isGeneratingAi}
            className="px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-70 rounded-md transition-colors inline-flex items-center gap-1.5 whitespace-nowrap"
          >
            {isGeneratingAi ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Synthesizing Model Card...</span>
              </>
            ) : activeNarrative ? (
              <>
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Regenerate AI Narrative</span>
              </>
            ) : (
              <>
                <Wand2 className="w-3.5 h-3.5" />
                <span>Generate AI Narrative</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={handleCopyMarkdown}
            className="px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-md transition-colors inline-flex items-center gap-1.5 whitespace-nowrap"
          >
            {copiedMd ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-600" />
                <span>Copied Markdown</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5 text-slate-500" />
                <span>Copy MD</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={handleDownloadMarkdown}
            className="px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-md transition-colors inline-flex items-center gap-1.5 whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5 text-slate-500" />
            <span>.md</span>
          </button>

          <button
            type="button"
            onClick={handleDownloadHtml}
            className="px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-md transition-colors inline-flex items-center gap-1.5 whitespace-nowrap"
          >
            <FileCode2 className="w-3.5 h-3.5 text-slate-500" />
            <span>.html</span>
          </button>

          <button
            type="button"
            onClick={handleDownloadJson}
            className="px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-md transition-colors inline-flex items-center gap-1.5 whitespace-nowrap"
          >
            <FileJson className="w-3.5 h-3.5 text-slate-500" />
            <span>.json</span>
          </button>
        </div>
      </div>

      {/* Configuration Bar */}
      <section className="bg-white border border-slate-200 rounded-lg p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <label htmlFor="autodoc-dataset-select" className="text-xs font-medium text-slate-600">
              Target Dataset
            </label>
            <select
              id="autodoc-dataset-select"
              value={docBundle.datasetId}
              onChange={(e) => setTargetDatasetId(e.target.value)}
              className="h-9 px-2.5 text-xs font-medium bg-slate-50 border border-slate-200 rounded-md text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
            >
              {customDatasetName && (
                <option value="custom_csv">
                  CSV: {customDatasetName} (Active)
                </option>
              )}
              {presets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} {!customDatasetName && p.id === activePresetId ? '(Active)' : ''}
                </option>
              ))}
            </select>
          </div>

          {!isDocumentingActive && !docBundle.isCustomDataset && (
            <button
              type="button"
              onClick={() => onActivateDataset(docBundle.datasetId)}
              className="text-xs font-medium text-blue-700 hover:underline"
            >
              Set as Active Workspace Dataset
            </button>
          )}
        </div>

        {/* Segmented Template Switcher */}
        <div
          role="tablist"
          aria-label="Documentation template mode"
          className="inline-flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg"
        >
          {TEMPLATE_MODES.map((mode) => {
            const isSelected = templateMode === mode.id;
            return (
              <button
                key={mode.id}
                type="button"
                role="tab"
                aria-selected={isSelected}
                onClick={() => setTemplateMode(mode.id)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  isSelected
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {mode.label}
              </button>
            );
          })}
        </div>
      </section>

      {aiError && (
        <div
          role="alert"
          className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3 text-xs text-red-900"
        >
          <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold">AI Narrative Generation Failed</div>
            <p className="mt-0.5 text-red-800">{aiError}</p>
          </div>
        </div>
      )}

      {/* Main Split: Outline & Section Controls + Rendered Spec */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Sticky Outline Sidebar */}
        <aside className="lg:col-span-3 bg-white border border-slate-200 rounded-lg p-4 lg:sticky lg:top-6 space-y-4">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-800 pb-2 border-b border-slate-100">
            <BookOpen className="w-3.5 h-3.5 text-blue-700" />
            <span>Document Outline</span>
          </div>

          <div className="space-y-1.5">
            {SECTION_ITEMS.map((sec) => {
              const checked = visibleSections[sec.id];
              const hiddenByTemplate =
                (templateMode === 'data_dictionary' && sec.id === 'paradigm_specs') ||
                (templateMode === 'executive_brief' &&
                  (sec.id === 'schema_dictionary' || sec.id === 'usage_code'));
              return (
                <div
                  key={sec.id}
                  className="flex items-center justify-between gap-2 text-xs py-1"
                >
                  <a
                    href={`#doc-sec-${sec.id}`}
                    className={`truncate hover:text-blue-700 transition-colors ${
                      checked && !hiddenByTemplate
                        ? 'text-slate-700 font-medium'
                        : 'text-slate-400 line-through'
                    }`}
                  >
                    {sec.label}
                  </a>
                  <input
                    type="checkbox"
                    aria-label={`Include ${sec.label}`}
                    checked={checked && !hiddenByTemplate}
                    disabled={hiddenByTemplate}
                    onChange={() => handleToggleSection(sec.id)}
                    className="rounded border-slate-300 text-blue-700 focus:ring-blue-600 shrink-0"
                  />
                </div>
              );
            })}
          </div>

          <div className="pt-3 border-t border-slate-100 space-y-1.5 text-xs text-slate-500">
            <div className="flex justify-between">
              <span>Health Score</span>
              <span className="font-mono tabular-nums font-semibold text-slate-800">
                {docBundle.healthScorecard.score}/100
              </span>
            </div>
            <div className="flex justify-between">
              <span>Canonical Columns</span>
              <span className="font-mono tabular-nums font-semibold text-slate-800">
                {docBundle.canonicalDictionary.length}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Materialized Features</span>
              <span className="font-mono tabular-nums font-semibold text-slate-800">
                {docBundle.derivedDictionary.length}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Audit Checks</span>
              <span className="font-mono tabular-nums font-semibold text-slate-800">
                {docBundle.audits.filter((a) => a.status === 'pass').length}/
                {docBundle.audits.length} Pass
              </span>
            </div>
          </div>
        </aside>

        {/* Rendered Document Canvas */}
        <article className="lg:col-span-9 bg-white border border-slate-200 rounded-lg divide-y divide-slate-200">
          {/* Title Banner */}
          <header className="p-6 space-y-2">
            <div className="text-xs text-slate-500 font-mono">
              {docBundle.datasetDomain} · {docBundle.entityCount.toLocaleString()} entities ·{' '}
              {docBundle.eventCount.toLocaleString()} events · Days {docBundle.dayRange[0]}–
              {docBundle.dayRange[1]}
            </div>
            <h2 className="font-display text-2xl font-bold text-slate-900">
              {docBundle.datasetName}
            </h2>
            <p className="text-sm text-slate-600 leading-relaxed max-w-3xl">
              {docBundle.datasetDescription}
            </p>
          </header>

          {/* AI Model Card Narrative */}
          {isSectionShown('ai_narrative') && (
            <section id="doc-sec-ai_narrative" className="p-6 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="font-display text-base font-bold text-slate-900">
                    AI-Synthesized Model Card Narrative
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Executive abstract, intended use cases, and statistical risk caveats grounded in live workspace telemetry.
                  </p>
                </div>
                {!activeNarrative && (
                  <button
                    type="button"
                    onClick={handleGenerateAiNarrative}
                    disabled={isGeneratingAi}
                    className="px-3.5 py-2 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-md transition-colors inline-flex items-center gap-1.5"
                  >
                    {isGeneratingAi ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Synthesizing...</span>
                      </>
                    ) : (
                      <>
                        <Wand2 className="w-3.5 h-3.5" />
                        <span>Synthesize Narrative</span>
                      </>
                    )}
                  </button>
                )}
              </div>

              {activeNarrative ? (
                <div className="space-y-4 pt-1">
                  <div>
                    <h4 className="font-display text-lg font-semibold text-slate-900">
                      {activeNarrative.headline}
                    </h4>
                    <p className="text-sm text-slate-700 mt-1.5 leading-relaxed">
                      {activeNarrative.executiveAbstract}
                    </p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
                    <div>
                      <h5 className="text-xs font-semibold text-slate-900 mb-2">
                        Intended Use Cases
                      </h5>
                      <ul className="space-y-1.5 text-xs text-slate-700 list-disc pl-4">
                        {activeNarrative.intendedUseCases.map((u, idx) => (
                          <li key={idx}>{u}</li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <h5 className="text-xs font-semibold text-slate-900 mb-2">
                        Out-of-Scope / Cautionary Uses
                      </h5>
                      <ul className="space-y-1.5 text-xs text-slate-700 list-disc pl-4">
                        {activeNarrative.outOfScopeUses.map((o, idx) => (
                          <li key={idx}>{o}</li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <h5 className="text-xs font-semibold text-slate-900 mb-2">
                        Bias &amp; Statistical Risk Caveats
                      </h5>
                      <ul className="space-y-1.5 text-xs text-slate-700 list-disc pl-4">
                        {activeNarrative.biasAndRiskCaveats.map((r, idx) => (
                          <li key={idx}>{r}</li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <h5 className="text-xs font-semibold text-slate-900 mb-2">
                        Recommended Curation Actions
                      </h5>
                      <ul className="space-y-1.5 text-xs text-slate-700 list-disc pl-4">
                        {activeNarrative.curationRecommendations.map((a, idx) => (
                          <li key={idx}>{a}</li>
                        ))}
                      </ul>
                    </div>
                  </div>

                  <div className="pt-2 border-t border-slate-100 text-xs text-slate-700">
                    <span className="font-semibold text-slate-900">
                      Downstream Modeling Guidance:{' '}
                    </span>
                    {activeNarrative.downstreamModelingGuidance}
                  </div>
                </div>
              ) : (
                <div className="py-4 text-xs text-slate-500">
                  Click <strong className="text-slate-700">Generate AI Narrative</strong> above to
                  synthesize tailored Model Card prose alongside the deterministic tables below.
                </div>
              )}
            </section>
          )}

          {/* 01. Overview & Provenance */}
          {isSectionShown('overview') && (
            <section id="doc-sec-overview" className="p-6 space-y-5">
              <h3 className="font-display text-base font-bold text-slate-900">
                01. Dataset Overview &amp; Split Governance
              </h3>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
                <div>
                  <div className="text-slate-500">Train / Val / Test Split</div>
                  <div className="font-mono tabular-nums font-semibold text-slate-900 mt-1">
                    {Math.round(docBundle.splitSummary.trainRatio * 100)} /{' '}
                    {Math.round(docBundle.splitSummary.valRatio * 100)} /{' '}
                    {Math.round(docBundle.splitSummary.testRatio * 100)}%
                  </div>
                  <div className="text-[11px] text-slate-500 font-mono tabular-nums">
                    {docBundle.splitSummary.trainEntities} / {docBundle.splitSummary.valEntities} /{' '}
                    {docBundle.splitSummary.testEntities} entities
                  </div>
                </div>
                <div>
                  <div className="text-slate-500">FNV-1a Hash Salt</div>
                  <div className="font-mono font-semibold text-slate-900 mt-1">
                    {docBundle.splitSummary.seedSalt}
                  </div>
                  <div className="text-[11px] text-slate-500">Cross-paradigm invariant</div>
                </div>
                <div>
                  <div className="text-slate-500">PII Masking Policy</div>
                  <div className="font-semibold text-slate-900 mt-1">
                    {docBundle.piiMasking.enabled
                      ? `Enabled (${docBundle.piiMasking.mode.toUpperCase()})`
                      : 'Raw Identifiers'}
                  </div>
                  <div className="text-[11px] text-slate-500">Configurable in Export</div>
                </div>
                <div>
                  <div className="text-slate-500">Observation Window</div>
                  <div className="font-mono tabular-nums font-semibold text-slate-900 mt-1">
                    Day {docBundle.dayRange[0]} – {docBundle.dayRange[1]}
                  </div>
                  <div className="text-[11px] text-slate-500">
                    Cutoff T_obs = {docBundle.regressionSpec.obsCutoffDay}d
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <h4 className="text-xs font-semibold text-slate-700 mb-2">
                    Channel Distribution
                  </h4>
                  <div className="border border-slate-200 rounded-md overflow-hidden">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
                        <tr>
                          <th className="text-left px-3 py-2 font-medium">Channel</th>
                          <th className="text-right px-3 py-2 font-medium">Events</th>
                          <th className="text-right px-3 py-2 font-medium">Share</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {docBundle.channels.map((ch) => (
                          <tr key={ch.name}>
                            <td className="px-3 py-2 font-medium text-slate-800">{ch.name}</td>
                            <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-700">
                              {ch.count.toLocaleString()}
                            </td>
                            <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-600">
                              {ch.sharePct.toFixed(1)}%
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div>
                  <h4 className="text-xs font-semibold text-slate-700 mb-2">
                    Action / Treatment Space
                  </h4>
                  <div className="border border-slate-200 rounded-md overflow-hidden">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
                        <tr>
                          <th className="text-left px-3 py-2 font-medium">Action</th>
                          <th className="text-right px-3 py-2 font-medium">Events</th>
                          <th className="text-right px-3 py-2 font-medium">Share</th>
                          <th className="text-right px-3 py-2 font-medium">Mean Reward</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {docBundle.actionSpace.map((act) => (
                          <tr key={act.id}>
                            <td className="px-3 py-2 font-medium text-slate-800">
                              <span className="font-mono text-slate-400 mr-1.5">{act.id}.</span>
                              {act.label}
                            </td>
                            <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-700">
                              {act.count.toLocaleString()}
                            </td>
                            <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-600">
                              {act.sharePct.toFixed(1)}%
                            </td>
                            <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-800">
                              {act.meanReward.toFixed(2)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* 02. Data Health & Quality */}
          {isSectionShown('data_health') && (
            <section id="doc-sec-data_health" className="p-6 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-display text-base font-bold text-slate-900">
                  02. Data Health &amp; Quality Checks
                </h3>
                <div className="text-xs font-mono tabular-nums text-slate-700">
                  Score: <strong>{docBundle.healthScorecard.score}/100</strong> ·{' '}
                  {docBundle.healthScorecard.tierLabel} ({docBundle.healthScorecard.passCount} Pass /{' '}
                  {docBundle.healthScorecard.warnCount} Warn / {docBundle.healthScorecard.failCount}{' '}
                  Fail)
                </div>
              </div>

              <div className="border border-slate-200 rounded-md overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium">Check</th>
                      <th className="text-left px-3 py-2 font-medium">Category</th>
                      <th className="text-left px-3 py-2 font-medium">Status</th>
                      <th className="text-left px-3 py-2 font-medium">Measured Metric</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {docBundle.healthScorecard.checks.map((chk) => (
                      <tr key={chk.id}>
                        <td className="px-3 py-2.5 font-medium text-slate-900">{chk.label}</td>
                        <td className="px-3 py-2.5 text-slate-600">{chk.category}</td>
                        <td className="px-3 py-2.5">
                          <span
                            className={`inline-flex items-center gap-1 font-mono text-[11px] font-semibold uppercase ${
                              chk.status === 'pass'
                                ? 'text-emerald-700'
                                : chk.status === 'warn'
                                  ? 'text-amber-700'
                                  : 'text-red-700'
                            }`}
                          >
                            {chk.status === 'pass' ? (
                              <CheckCircle2 className="w-3.5 h-3.5" />
                            ) : chk.status === 'warn' ? (
                              <AlertTriangle className="w-3.5 h-3.5" />
                            ) : (
                              <XCircle className="w-3.5 h-3.5" />
                            )}
                            <span>{chk.status}</span>
                          </span>
                        </td>
                        <td className="px-3 py-2.5 font-mono text-slate-700">
                          {chk.metricSummary}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* 03. Data Dictionary & Schema */}
          {isSectionShown('schema_dictionary') && (
            <section id="doc-sec-schema_dictionary" className="p-6 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="font-display text-base font-bold text-slate-900">
                    03. Automated Data Dictionary &amp; Statistical Bounds
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Live computed column distributions across canonical event streams and materialized ML tables.
                  </p>
                </div>

                <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
                  <button
                    type="button"
                    onClick={() => setDictionaryTab('canonical')}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                      dictionaryTab === 'canonical'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Canonical Stream ({docBundle.canonicalDictionary.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setDictionaryTab('derived')}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                      dictionaryTab === 'derived'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Materialized Features ({docBundle.derivedDictionary.length})
                  </button>
                </div>
              </div>

              <div className="border border-slate-200 rounded-md overflow-x-auto">
                <table className="w-full text-xs min-w-[780px]">
                  <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium">Column</th>
                      <th className="text-left px-3 py-2 font-medium">Type</th>
                      <th className="text-right px-3 py-2 font-medium">Distinct</th>
                      <th className="text-right px-3 py-2 font-medium">Min</th>
                      <th className="text-right px-3 py-2 font-medium">Median</th>
                      <th className="text-right px-3 py-2 font-medium">Max</th>
                      <th className="text-right px-3 py-2 font-medium">Mean ± Std</th>
                      <th className="text-left px-3 py-2 font-medium">Description</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {activeDictRows.map((col) => (
                      <tr key={`${col.sourceTable}-${col.columnName}`} className="hover:bg-slate-50/70">
                        <td className="px-3 py-2.5 font-mono font-semibold text-slate-900 whitespace-nowrap">
                          {col.columnName}
                          <div className="text-[10px] font-normal text-slate-400">
                            {col.sourceTable}
                          </div>
                        </td>
                        <td className="px-3 py-2.5 font-mono text-slate-600">{col.dataType}</td>
                        <td className="px-3 py-2.5 text-right font-mono tabular-nums text-slate-700">
                          {col.distinctCount.toLocaleString()}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono tabular-nums text-slate-700">
                          {col.minVal}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono tabular-nums text-slate-700">
                          {col.p50Val}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono tabular-nums text-slate-700">
                          {col.maxVal}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono tabular-nums text-slate-700 whitespace-nowrap">
                          {col.meanVal === '—' ? '—' : `${col.meanVal} ± ${col.stdVal}`}
                        </td>
                        <td className="px-3 py-2.5 text-slate-600 max-w-xs">
                          {col.description}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* 04. ML Paradigm Specifications */}
          {isSectionShown('paradigm_specs') && (
            <section id="doc-sec-paradigm_specs" className="p-6 space-y-5">
              <h3 className="font-display text-base font-bold text-slate-900">
                04. Materialized ML Paradigm Specifications
              </h3>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                {/* Regression Spec */}
                <div className="border border-slate-200 rounded-md p-4 space-y-3">
                  <div className="text-xs font-semibold text-slate-900">
                    Regression (Tabular LTV)
                  </div>
                  <div className="space-y-1.5 text-xs">
                    <div className="flex justify-between">
                      <span className="text-slate-500">Cutoff / Horizon</span>
                      <span className="font-mono tabular-nums font-medium text-slate-800">
                        {docBundle.regressionSpec.obsCutoffDay}d / +{docBundle.regressionSpec.horizonDays}d
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Rows / OLS R²</span>
                      <span className="font-mono tabular-nums font-medium text-slate-800">
                        {docBundle.regressionSpec.rowCount} /{' '}
                        {docBundle.regressionSpec.rSquared.toFixed(3)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">RMSE / MAE</span>
                      <span className="font-mono tabular-nums font-medium text-slate-800">
                        ${docBundle.regressionSpec.rmse.toFixed(1)} / $
                        {docBundle.regressionSpec.mae.toFixed(1)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Max KL Drift</span>
                      <span className="font-mono tabular-nums font-medium text-slate-800">
                        {docBundle.regressionSpec.maxKlDivergence.toFixed(3)} nats
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Zero-Target Rate</span>
                      <span className="font-mono tabular-nums font-medium text-slate-800">
                        {docBundle.regressionSpec.zeroTargetRatePct.toFixed(1)}%
                      </span>
                    </div>
                  </div>
                </div>

                {/* Sequence Tensor Spec */}
                <div className="border border-slate-200 rounded-md p-4 space-y-3">
                  <div className="text-xs font-semibold text-slate-900">
                    Deep Learning (Sequential Tensors)
                  </div>
                  <div className="space-y-1.5 text-xs">
                    <div className="flex justify-between">
                      <span className="text-slate-500">Tensor Shape</span>
                      <span className="font-mono tabular-nums font-medium text-slate-800">
                        [{docBundle.sequenceSpec.tensorShape.join(', ')}]
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Padding / Truncation</span>
                      <span className="font-mono font-medium text-slate-800">
                        {docBundle.sequenceSpec.padding} / {docBundle.sequenceSpec.truncation}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Mask Sparsity</span>
                      <span className="font-mono tabular-nums font-medium text-slate-800">
                        {docBundle.sequenceSpec.paddingSparsityPct.toFixed(1)}%
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Holdout R²</span>
                      <span className="font-mono tabular-nums font-medium text-slate-800">
                        {docBundle.sequenceSpec.holdoutR2 !== null
                          ? docBundle.sequenceSpec.holdoutR2.toFixed(3)
                          : 'N/A'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Fit Diagnosis</span>
                      <span className="font-medium text-slate-800">
                        {docBundle.sequenceSpec.diagnosisLabel}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Offline RL MDP Spec */}
                <div className="border border-slate-200 rounded-md p-4 space-y-3">
                  <div className="text-xs font-semibold text-slate-900">
                    Offline RL (CQL / MDP)
                  </div>
                  <div className="space-y-1.5 text-xs">
                    <div className="flex justify-between">
                      <span className="text-slate-500">Discount γ / Scale</span>
                      <span className="font-mono tabular-nums font-medium text-slate-800">
                        {docBundle.mdpSpec.gamma.toFixed(2)} / {docBundle.mdpSpec.rewardScale}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Trajectories</span>
                      <span className="font-mono tabular-nums font-medium text-slate-800">
                        {docBundle.mdpSpec.trajectoryCount.toLocaleString()}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Transitions</span>
                      <span className="font-mono tabular-nums font-medium text-slate-800">
                        {docBundle.mdpSpec.transitionCount.toLocaleString()}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Mean Return G₀</span>
                      <span className="font-mono tabular-nums font-medium text-slate-800">
                        {docBundle.mdpSpec.meanInitialReturn.toFixed(2)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Low-Support OOD</span>
                      <span className="font-mono tabular-nums font-medium text-slate-800">
                        {docBundle.mdpSpec.lowSupportOodRatePct.toFixed(1)}%
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* 05. Cross-Paradigm Audits */}
          {isSectionShown('audit_lineage') && (
            <section id="doc-sec-audit_lineage" className="p-6 space-y-4">
              <h3 className="font-display text-base font-bold text-slate-900">
                05. Cross-Paradigm Leakage &amp; Parity Audits
              </h3>
              <div className="border border-slate-200 rounded-md overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium">Audit Check</th>
                      <th className="text-left px-3 py-2 font-medium">Paradigm</th>
                      <th className="text-left px-3 py-2 font-medium">Status</th>
                      <th className="text-left px-3 py-2 font-medium">Metric</th>
                      <th className="text-left px-3 py-2 font-medium">Detail</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {docBundle.audits.map((a) => (
                      <tr key={a.id}>
                        <td className="px-3 py-2.5 font-medium text-slate-900">{a.name}</td>
                        <td className="px-3 py-2.5 text-slate-600">{a.paradigm}</td>
                        <td className="px-3 py-2.5 font-mono uppercase text-[11px] font-semibold">
                          <span
                            className={
                              a.status === 'pass'
                                ? 'text-emerald-700'
                                : a.status === 'warn'
                                  ? 'text-amber-700'
                                  : 'text-red-700'
                            }
                          >
                            {a.status}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 font-mono text-slate-800">{a.metricValue}</td>
                        <td className="px-3 py-2.5 text-slate-600">{a.detail}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* 06. Usage & Reproducibility */}
          {isSectionShown('usage_code') && (
            <section id="doc-sec-usage_code" className="p-6 space-y-3">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-slate-500" />
                <h3 className="font-display text-base font-bold text-slate-900">
                  06. Reproducible Consumption Contract
                </h3>
              </div>
              <pre className="p-4 bg-slate-900 text-slate-100 rounded-md text-xs font-mono overflow-x-auto leading-relaxed">
{`# Dataset: ${docBundle.datasetName} (${docBundle.datasetDomain})
# Deterministic Split: FNV-1a(entity_id, salt="${docBundle.splitSummary.seedSalt}") -> ${Math.round(docBundle.splitSummary.trainRatio * 100)}/${Math.round(docBundle.splitSummary.valRatio * 100)}/${Math.round(docBundle.splitSummary.testRatio * 100)}
import json, pandas as pd

reg_df = pd.read_csv("stratum_regression_ltv.csv")  # T_obs=${docBundle.regressionSpec.obsCutoffDay}d, H=${docBundle.regressionSpec.horizonDays}d
seq_bundle = json.load(open("stratum_sequence_tensors.json"))  # shape=${JSON.stringify(docBundle.sequenceSpec.tensorShape)}
mdp_bundle = json.load(open("stratum_offline_rl_mdp.json"))    # gamma=${docBundle.mdpSpec.gamma}, transitions=${docBundle.mdpSpec.transitionCount}`}
              </pre>
            </section>
          )}
        </article>
      </div>
    </div>
  );
};
