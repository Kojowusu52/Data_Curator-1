import React, { useEffect, useMemo, useState } from 'react';
import {
  BookmarkPlus,
  CheckCircle2,
  FolderKanban,
  Layers,
  Play,
  Plus,
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
  BUILTIN_WORKFLOW_TEMPLATES,
  LOCAL_WORKFLOW_TEMPLATES_KEY,
  WORKFLOW_VERTICALS,
  cloneWorkflowTemplateBundle,
  isWorkflowTemplateActive,
} from '../data/workflowTemplates';
import {
  CurationRuleId,
  EngineeredFeatureId,
  GlobalCurationConfig,
  MdpConfig,
  RegressionConfig,
  RulConfig,
  SequenceConfig,
  WorkflowTemplate,
  WorkflowVertical,
} from '../types/curation';

interface WorkflowTemplatesSectionProps {
  activePresetId: string;
  customDatasetName: string | null;
  datasetName: string;
  globalConfig: GlobalCurationConfig;
  regConfig: RegressionConfig;
  seqConfig: SequenceConfig;
  mdpConfig: MdpConfig;
  rulConfig: RulConfig;
  appliedCurationRules: CurationRuleId[];
  enabledEngineeredFeatures: EngineeredFeatureId[];
  onApplyWorkflowTemplate: (
    template: WorkflowTemplate,
    options: { switchDataset: boolean }
  ) => void;
}

type VerticalFilter = 'all' | 'custom' | WorkflowVertical;

function makeTemplateId(): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `tpl-${Date.now().toString(36)}-${rand}`.replace(/[^a-zA-Z0-9_-]/g, '');
}

function loadLocalWorkflowTemplates(): WorkflowTemplate[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(LOCAL_WORKFLOW_TEMPLATES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as WorkflowTemplate[]) : [];
  } catch {
    return [];
  }
}

function persistLocalWorkflowTemplates(list: WorkflowTemplate[]) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      LOCAL_WORKFLOW_TEMPLATES_KEY,
      JSON.stringify(list.slice(0, 30))
    );
  } catch {
    // ignore browser quota errors
  }
}

function inferDefaultVertical(presetId: string): WorkflowVertical {
  if (presetId === 'ecommerce_ltv') return 'E-Commerce Retail';
  if (presetId === 'saas_retention') return 'B2B SaaS';
  if (presetId === 'fintech_credit_policy') return 'Consumer Fintech';
  if (presetId === 'industrial_sensor_rul') return 'Industrial IoT & RUL';
  return 'Custom Vertical';
}

export const WorkflowTemplatesSection: React.FC<WorkflowTemplatesSectionProps> = ({
  activePresetId,
  customDatasetName,
  datasetName,
  globalConfig,
  regConfig,
  seqConfig,
  mdpConfig,
  rulConfig,
  appliedCurationRules,
  enabledEngineeredFeatures,
  onApplyWorkflowTemplate,
}) => {
  const { user, authReady, profileSynced } = useAuth();
  const [cloudTemplates, setCloudTemplates] = useState<WorkflowTemplate[]>([]);
  const [localTemplates, setLocalTemplates] = useState<WorkflowTemplate[]>(() =>
    loadLocalWorkflowTemplates()
  );
  const [verticalFilter, setVerticalFilter] = useState<VerticalFilter>('all');
  const [isComposerOpen, setIsComposerOpen] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [verticalInput, setVerticalInput] = useState<WorkflowVertical>(() =>
    inferDefaultVertical(activePresetId)
  );
  const [descriptionInput, setDescriptionInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const isCloudReady = Boolean(authReady && user && profileSynced);

  useEffect(() => {
    setVerticalInput(inferDefaultVertical(customDatasetName ? 'custom_csv' : activePresetId));
  }, [activePresetId, customDatasetName]);

  useEffect(() => {
    if (!isCloudReady || !user) {
      setCloudTemplates([]);
      return;
    }

    const colPath = `users/${user.uid}/workflowTemplates`;
    const q = query(
      collection(db, 'users', user.uid, 'workflowTemplates'),
      where('ownerId', '==', user.uid),
      orderBy('updatedAt', 'desc')
    );

    const unsubscribe = onSnapshot(
      q,
      (snap) => {
        const docs = snap.docs.map((d) => d.data() as WorkflowTemplate);
        setCloudTemplates(docs);
      },
      (err) => {
        setErrorMessage('Unable to load cloud workflow templates.');
        handleFirestoreError(err, OperationType.LIST, colPath);
      }
    );

    return () => unsubscribe();
  }, [isCloudReady, user]);

  const savedTemplates = isCloudReady ? cloudTemplates : localTemplates;

  const allTemplates = useMemo(
    () => [...savedTemplates, ...BUILTIN_WORKFLOW_TEMPLATES],
    [savedTemplates]
  );

  const filteredTemplates = useMemo(() => {
    return allTemplates.filter((tpl) => {
      if (verticalFilter === 'all') return true;
      if (verticalFilter === 'custom') return !tpl.isBuiltIn;
      return tpl.vertical === verticalFilter;
    });
  }, [allTemplates, verticalFilter]);

  const handleSaveTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = nameInput.trim().slice(0, 120);
    if (!cleanName) {
      setErrorMessage('Enter a workflow template name.');
      return;
    }

    const defaultDesc = `${verticalInput} workflow bundle · Regression T=${regConfig.obsCutoffDay}d / H=${regConfig.horizonDays}d, Transformer L=${seqConfig.maxSeqLen} (${seqConfig.transformerArch ?? 'transformer_encoder'}), Offline RL γ=${mdpConfig.gamma}.`;
    const cleanDesc = (descriptionInput.trim() || defaultDesc).slice(0, 500);
    const presetBinding = (customDatasetName ? 'custom_csv' : activePresetId).slice(0, 64);

    const cloned = cloneWorkflowTemplateBundle({
      globalConfig,
      regConfig,
      seqConfig,
      mdpConfig,
      rulConfig,
      appliedCurationRules,
      enabledEngineeredFeatures,
    });

    const templateId = makeTemplateId();
    const boundedRules = cloned.appliedCurationRules.slice(0, 10);
    const boundedFeatures = cloned.enabledEngineeredFeatures.slice(0, 10);

    setSaving(true);
    setErrorMessage(null);
    setStatusMessage(null);

    if (isCloudReady && user) {
      const docPath = `users/${user.uid}/workflowTemplates/${templateId}`;
      try {
        await setDoc(doc(db, 'users', user.uid, 'workflowTemplates', templateId), {
          templateId,
          ownerId: user.uid,
          name: cleanName,
          vertical: verticalInput,
          description: cleanDesc,
          recommendedPresetId: presetBinding,
          globalConfig: cloned.globalConfig,
          regConfig: cloned.regConfig,
          seqConfig: cloned.seqConfig,
          mdpConfig: cloned.mdpConfig,
          rulConfig: cloned.rulConfig,
          appliedCurationRules: boundedRules,
          enabledEngineeredFeatures: boundedFeatures,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        setStatusMessage(`Saved "${cleanName}" to cloud workflow templates.`);
        setNameInput('');
        setDescriptionInput('');
        setIsComposerOpen(false);
      } catch (err) {
        setErrorMessage('Failed to save workflow template to Firestore.');
        handleFirestoreError(err, OperationType.CREATE, docPath);
      } finally {
        setSaving(false);
      }
      return;
    }

    const localRecord: WorkflowTemplate = {
      templateId,
      ownerId: 'local_session',
      name: cleanName,
      vertical: verticalInput,
      description: cleanDesc,
      recommendedPresetId: presetBinding,
      isBuiltIn: false,
      globalConfig: cloned.globalConfig,
      regConfig: cloned.regConfig,
      seqConfig: cloned.seqConfig,
      mdpConfig: cloned.mdpConfig,
      rulConfig: cloned.rulConfig,
      appliedCurationRules: boundedRules,
      enabledEngineeredFeatures: boundedFeatures,
      localTimestampIso: new Date().toISOString(),
    };

    const next = [localRecord, ...localTemplates];
    setLocalTemplates(next);
    persistLocalWorkflowTemplates(next);
    setSaving(false);
    setStatusMessage(`Saved "${cleanName}" to browser workflow templates.`);
    setNameInput('');
    setDescriptionInput('');
    setIsComposerOpen(false);
  };

  const handleDeleteTemplate = async (templateId: string) => {
    setErrorMessage(null);
    setStatusMessage(null);
    if (isCloudReady && user) {
      const docPath = `users/${user.uid}/workflowTemplates/${templateId}`;
      try {
        await deleteDoc(doc(db, 'users', user.uid, 'workflowTemplates', templateId));
        setStatusMessage('Removed workflow template from cloud library.');
      } catch (err) {
        setErrorMessage('Failed to remove workflow template.');
        handleFirestoreError(err, OperationType.DELETE, docPath);
      }
      return;
    }

    const next = localTemplates.filter((t) => t.templateId !== templateId);
    setLocalTemplates(next);
    persistLocalWorkflowTemplates(next);
    setStatusMessage('Removed workflow template from browser library.');
  };

  const handleLoad = (tpl: WorkflowTemplate, switchDataset: boolean) => {
    setErrorMessage(null);
    setStatusMessage(
      switchDataset
        ? `Loaded "${tpl.name}" (multi-paradigm configs + ${tpl.vertical} preset).`
        : `Applied "${tpl.name}" configs onto "${datasetName}".`
    );
    onApplyWorkflowTemplate(tpl, { switchDataset });
  };

  return (
    <section
      aria-label="Workflow Templates Library"
      className="bg-white border border-slate-200 rounded-lg overflow-hidden"
    >
      {/* Header & Actions */}
      <div className="px-6 py-4 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <FolderKanban className="w-3.5 h-3.5 text-blue-700" aria-hidden="true" />
            <span>Multi-Paradigm Presets</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums">
              {BUILTIN_WORKFLOW_TEMPLATES.length} Built-In · {savedTemplates.length}{' '}
              {isCloudReady ? 'Cloud Saved' : 'Local Saved'}
            </span>
          </div>
          <h2 className="text-base font-semibold text-slate-900 mt-0.5">
            Workflow Templates Library
          </h2>
          <p className="text-xs text-slate-600 mt-0.5 max-w-2xl">
            Save and load unified Regression, Sequence Transformer, and Offline RL configuration bundles tuned for specific industry verticals.
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            setIsComposerOpen((prev) => !prev);
            setErrorMessage(null);
          }}
          className="px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-md transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 self-start lg:self-auto"
        >
          {isComposerOpen ? (
            <>
              <X className="w-3.5 h-3.5" />
              <span>Close Save Form</span>
            </>
          ) : (
            <>
              <Plus className="w-3.5 h-3.5" />
              <span>Save Current Workflow</span>
            </>
          )}
        </button>
      </div>

      {/* Inline Save Current Workflow Composer */}
      {isComposerOpen && (
        <form
          onSubmit={handleSaveTemplate}
          className="px-6 py-5 border-b border-slate-200 bg-slate-50/70 space-y-4"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="text-xs font-semibold text-slate-900">
              Capture Active Multi-Paradigm Configuration
            </div>
            <div className="text-[11px] font-mono tabular-nums text-slate-500">
              Reg T={regConfig.obsCutoffDay}d · Seq L={seqConfig.maxSeqLen} · RL γ={mdpConfig.gamma} ·{' '}
              {appliedCurationRules.length} rules · {enabledEngineeredFeatures.length} derived cols
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
            <div className="md:col-span-5">
              <label
                htmlFor="workflow-template-name"
                className="block text-[11px] font-medium text-slate-600 mb-1"
              >
                Template Name
              </label>
              <input
                id="workflow-template-name"
                type="text"
                required
                maxLength={120}
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                placeholder={`e.g. ${verticalInput} Production Pipeline`}
                className="w-full h-9 px-3 text-xs bg-white border border-slate-200 rounded-md text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>

            <div className="md:col-span-3">
              <label
                htmlFor="workflow-template-vertical"
                className="block text-[11px] font-medium text-slate-600 mb-1"
              >
                Industry Vertical
              </label>
              <select
                id="workflow-template-vertical"
                value={verticalInput}
                onChange={(e) => setVerticalInput(e.target.value as WorkflowVertical)}
                className="w-full h-9 px-2.5 text-xs bg-white border border-slate-200 rounded-md text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-600"
              >
                {WORKFLOW_VERTICALS.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </div>

            <div className="md:col-span-4">
              <label
                htmlFor="workflow-template-desc"
                className="block text-[11px] font-medium text-slate-600 mb-1"
              >
                Description (Optional)
              </label>
              <input
                id="workflow-template-desc"
                type="text"
                maxLength={500}
                value={descriptionInput}
                onChange={(e) => setDescriptionInput(e.target.value)}
                placeholder="Notes on cutoff window, RL reward scale, architecture..."
                className="w-full h-9 px-3 text-xs bg-white border border-slate-200 rounded-md text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <span className="text-[11px] text-slate-500">
              {isCloudReady
                ? 'Synced to your private Firestore workflow templates library.'
                : 'Saved locally in this browser. Sign in with Google in the sidebar for cloud sync.'}
            </span>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setIsComposerOpen(false)}
                className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-2 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-md transition-colors inline-flex items-center gap-1.5 disabled:opacity-60"
              >
                <BookmarkPlus className="w-3.5 h-3.5" />
                <span>{saving ? 'Saving...' : 'Save Template'}</span>
              </button>
            </div>
          </div>
        </form>
      )}

      {/* Filter Tabs & Feedback Banner */}
      <div className="px-6 py-3 border-b border-slate-200 bg-slate-50/40 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div
          role="tablist"
          aria-label="Filter workflow templates by industry vertical"
          className="inline-flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg"
        >
          {(
            [
              { id: 'all', label: 'All Verticals' },
              { id: 'E-Commerce Retail', label: 'E-Commerce Retail' },
              { id: 'B2B SaaS', label: 'B2B SaaS' },
              { id: 'Consumer Fintech', label: 'Consumer Fintech' },
              { id: 'Industrial IoT & RUL', label: 'Industrial IoT & RUL' },
              { id: 'custom', label: `Saved Custom (${savedTemplates.length})` },
            ] as { id: VerticalFilter; label: string }[]
          ).map((tab) => {
            const active = verticalFilter === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setVerticalFilter(tab.id)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  active
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {(statusMessage || errorMessage) && (
          <div
            role="status"
            className={`text-xs font-medium ${
              errorMessage ? 'text-red-700' : 'text-emerald-700'
            }`}
          >
            {errorMessage || statusMessage}
          </div>
        )}
      </div>

      {/* Templates Grid */}
      <div className="p-6">
        {filteredTemplates.length === 0 ? (
          <div className="py-10 text-center space-y-2 border border-dashed border-slate-200 rounded-lg bg-slate-50/40">
            <Layers className="w-5 h-5 text-slate-400 mx-auto" aria-hidden="true" />
            <div className="text-sm font-medium text-slate-800">
              No custom workflow templates saved yet.
            </div>
            <p className="text-xs text-slate-500 max-w-md mx-auto">
              Tune Regression, Sequence Transformer, and Offline RL parameters across the workspace, then click Save Current Workflow to store a reusable vertical template.
            </p>
            <div className="pt-2">
              <button
                type="button"
                onClick={() => setIsComposerOpen(true)}
                className="px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-md transition-colors"
              >
                Save Current Workflow
              </button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {filteredTemplates.map((tpl) => {
              const isMatched = isWorkflowTemplateActive(tpl, {
                globalConfig,
                regConfig,
                seqConfig,
                mdpConfig,
              });
              const canSwitchPreset =
                tpl.recommendedPresetId !== 'custom_csv' &&
                (Boolean(customDatasetName) || tpl.recommendedPresetId !== activePresetId);

              return (
                <article
                  key={tpl.templateId}
                  className={`border rounded-lg p-5 flex flex-col justify-between gap-4 transition-colors ${
                    isMatched
                      ? 'border-blue-300 bg-blue-50/30'
                      : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}
                >
                  <div className="space-y-3">
                    {/* Unboxed Typographic Metadata Line */}
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <div className="flex flex-wrap items-center gap-1.5 text-slate-500 font-mono">
                        <span className="font-sans font-semibold text-slate-700">
                          {tpl.vertical}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>{tpl.isBuiltIn ? 'Built-In' : isCloudReady ? 'Cloud Saved' : 'Local Saved'}</span>
                        <span aria-hidden="true">·</span>
                        <span className="tabular-nums">
                          {Math.round(tpl.globalConfig.trainRatio * 100)}/
                          {Math.round(tpl.globalConfig.valRatio * 100)}/
                          {Math.round(tpl.globalConfig.testRatio * 100)}
                        </span>
                      </div>

                      {isMatched && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 whitespace-nowrap shrink-0">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>Active Config</span>
                        </span>
                      )}
                    </div>

                    <div>
                      <h3 className="text-sm font-semibold text-slate-900">
                        {tpl.name}
                      </h3>
                      <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                        {tpl.description}
                      </p>
                    </div>

                    {/* Multi-Paradigm Parameter Summary Matrix */}
                    <div className="grid grid-cols-3 gap-3 pt-3 border-t border-slate-100 text-[11px]">
                      <div>
                        <div className="text-slate-500 font-medium">Regression (LTV)</div>
                        <div className="font-mono tabular-nums font-semibold text-slate-900 mt-0.5">
                          T={tpl.regConfig.obsCutoffDay}d · H={tpl.regConfig.horizonDays}d
                        </div>
                        <div className="font-mono text-slate-500 mt-0.5">
                          P{tpl.regConfig.winsorizePercentile} · {tpl.regConfig.featureNormalization}
                        </div>
                      </div>

                      <div>
                        <div className="text-slate-500 font-medium">Sequence Tensor</div>
                        <div className="font-mono tabular-nums font-semibold text-slate-900 mt-0.5">
                          L={tpl.seqConfig.maxSeqLen} · d={tpl.seqConfig.dModel ?? 128}
                        </div>
                        <div className="font-mono text-slate-500 mt-0.5 truncate">
                          {tpl.seqConfig.transformerArch ?? 'transformer_encoder'}
                        </div>
                      </div>

                      <div>
                        <div className="text-slate-500 font-medium">Offline RL (MDP)</div>
                        <div className="font-mono tabular-nums font-semibold text-slate-900 mt-0.5">
                          γ={tpl.mdpConfig.gamma.toFixed(2)} · {tpl.mdpConfig.rewardScale}
                        </div>
                        <div className="font-mono text-slate-500 mt-0.5">
                          Gap {tpl.mdpConfig.terminalInactivityGapDays}d · min {tpl.mdpConfig.minTrajectorySteps}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Card Footer Actions */}
                  <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleLoad(tpl, canSwitchPreset)}
                        className="px-3.5 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-md transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
                      >
                        <Play className="w-3.5 h-3.5" />
                        <span>
                          {canSwitchPreset ? 'Load Vertical & Dataset' : 'Load Template'}
                        </span>
                      </button>

                      {canSwitchPreset && (
                        <button
                          type="button"
                          onClick={() => handleLoad(tpl, false)}
                          className="px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-md transition-colors whitespace-nowrap shrink-0"
                        >
                          Apply Configs Only
                        </button>
                      )}
                    </div>

                    {!tpl.isBuiltIn && (
                      <button
                        type="button"
                        onClick={() => void handleDeleteTemplate(tpl.templateId)}
                        aria-label={`Delete template ${tpl.name}`}
                        className="p-2 text-slate-400 hover:text-red-600 rounded-md hover:bg-red-50 transition-colors shrink-0"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
};
