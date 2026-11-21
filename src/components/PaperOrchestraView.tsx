import React, { useEffect, useMemo, useState } from 'react';
import {
  BookOpen,
  Download,
  FilePlus2,
  FileText,
  LoaderCircle,
  Plus,
  Sparkles,
  Trash2,
} from 'lucide-react';

interface ResearchSource {
  id: string;
  title: string;
  author: string;
  year: string;
  url: string;
}

interface DraftSection {
  id: string;
  title: string;
  content: string;
}

interface ResearchProject {
  id: string;
  title: string;
  researchQuestion: string;
  updatedAt: string;
  sources: ResearchSource[];
  sections: DraftSection[];
}

interface LoadedProjects {
  projects: ResearchProject[];
  error: string | null;
}

const STORAGE_KEY = 'stratum_paper_orchestra_projects_v1';

function makeId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseProjects(value: unknown): ResearchProject[] {
  if (!Array.isArray(value)) {
    throw new Error('Saved Paper Orchestra data has an invalid format.');
  }

  return value.map((project) => {
    if (
      !isRecord(project) ||
      typeof project.id !== 'string' ||
      typeof project.title !== 'string' ||
      typeof project.researchQuestion !== 'string' ||
      typeof project.updatedAt !== 'string' ||
      !Array.isArray(project.sources) ||
      !Array.isArray(project.sections) ||
      project.sections.length === 0
    ) {
      throw new Error('A saved research project is incomplete or invalid.');
    }

    const sources = project.sources.map((source): ResearchSource => {
      if (
        !isRecord(source) ||
        typeof source.id !== 'string' ||
        typeof source.title !== 'string' ||
        typeof source.author !== 'string' ||
        typeof source.year !== 'string' ||
        typeof source.url !== 'string'
      ) {
        throw new Error('A saved source reference is incomplete or invalid.');
      }
      return {
        id: source.id,
        title: source.title,
        author: source.author,
        year: source.year,
        url: source.url,
      };
    });

    const sections = project.sections.map((section): DraftSection => {
      if (
        !isRecord(section) ||
        typeof section.id !== 'string' ||
        typeof section.title !== 'string' ||
        typeof section.content !== 'string'
      ) {
        throw new Error('A saved draft section is incomplete or invalid.');
      }
      return {
        id: section.id,
        title: section.title,
        content: section.content,
      };
    });

    return {
      id: project.id,
      title: project.title,
      researchQuestion: project.researchQuestion,
      updatedAt: project.updatedAt,
      sources,
      sections,
    };
  });
}

function loadProjects(): LoadedProjects {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return { projects: raw ? parseProjects(JSON.parse(raw)) : [], error: null };
  } catch (error) {
    return {
      projects: [],
      error:
        error instanceof Error
          ? error.message
          : 'Unable to read saved Paper Orchestra projects.',
    };
  }
}

function formatPlainText(project: ResearchProject): string {
  const sections = project.sections
    .map((section) => `${section.title.trim() || 'Untitled section'}\n\n${section.content.trim()}`)
    .join('\n\n');
  const references = project.sources
    .map((source) => {
      const citation = [source.author, source.year && `(${source.year})`, source.title]
        .filter(Boolean)
        .join('. ');
      return `${citation}${source.url ? `\n${source.url}` : ''}`;
    })
    .join('\n\n');

  return [
    project.title.trim() || 'Untitled research project',
    '='.repeat(Math.max(1, (project.title.trim() || 'Untitled research project').length)),
    '',
    'Research question',
    project.researchQuestion.trim() || 'Not specified',
    '',
    sections,
    references ? `\n\nReferences\n\n${references}` : '',
  ]
    .filter((part) => part !== '')
    .join('\n');
}

function downloadText(project: ResearchProject) {
  const filename =
    (project.title.trim() || 'paper-orchestra')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'paper-orchestra';
  const url = URL.createObjectURL(
    new Blob([formatPlainText(project)], { type: 'text/plain;charset=utf-8' })
  );
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${filename}.txt`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export const PaperOrchestraView: React.FC = () => {
  const [loaded] = useState(loadProjects);
  const [projects, setProjects] = useState(loaded.projects);
  const [storageError, setStorageError] = useState<string | null>(loaded.error);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);
  const [projectTitle, setProjectTitle] = useState('');
  const [researchQuestion, setResearchQuestion] = useState('');
  const [sourceTitle, setSourceTitle] = useState('');
  const [sourceAuthor, setSourceAuthor] = useState('');
  const [sourceYear, setSourceYear] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [assistantPrompt, setAssistantPrompt] = useState('');
  const [assistantSuggestion, setAssistantSuggestion] = useState('');
  const [assistantError, setAssistantError] = useState<string | null>(null);
  const [isAssisting, setIsAssisting] = useState(false);

  useEffect(() => {
    if (loaded.error) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
      setStorageError(null);
    } catch (error) {
      setStorageError(
        error instanceof Error
          ? `Unable to save projects on this device: ${error.message}`
          : 'Unable to save projects on this device.'
      );
    }
  }, [loaded.error, projects]);

  useEffect(() => {
    if (!activeProjectId && projects.length > 0) {
      setActiveProjectId(projects[0].id);
    } else if (activeProjectId && !projects.some((project) => project.id === activeProjectId)) {
      setActiveProjectId(projects[0]?.id ?? null);
    }
  }, [activeProjectId, projects]);

  const activeProject = useMemo(
    () => projects.find((project) => project.id === activeProjectId) ?? null,
    [projects, activeProjectId]
  );
  const activeSection =
    activeProject?.sections.find((section) => section.id === activeSectionId) ??
    activeProject?.sections[0] ??
    null;

  useEffect(() => {
    if (activeSection && activeSectionId !== activeSection.id) {
      setActiveSectionId(activeSection.id);
    }
  }, [activeSection, activeSectionId]);

  const updateProject = (updater: (project: ResearchProject) => ResearchProject) => {
    if (!activeProjectId) return;
    setProjects((current) =>
      current.map((project) =>
        project.id === activeProjectId
          ? updater({ ...project, updatedAt: new Date().toISOString() })
          : project
      )
    );
  };

  const createProject = (event: React.FormEvent) => {
    event.preventDefault();
    const title = projectTitle.trim();
    if (!title) return;

    const firstSection = { id: makeId('section'), title: 'Introduction', content: '' };
    const project: ResearchProject = {
      id: makeId('project'),
      title,
      researchQuestion: researchQuestion.trim(),
      updatedAt: new Date().toISOString(),
      sources: [],
      sections: [firstSection],
    };
    setProjects((current) => [...current, project]);
    setActiveProjectId(project.id);
    setActiveSectionId(firstSection.id);
    setProjectTitle('');
    setResearchQuestion('');
    setAssistantSuggestion('');
  };

  const addSection = () => {
    const section = { id: makeId('section'), title: 'New section', content: '' };
    updateProject((project) => ({ ...project, sections: [...project.sections, section] }));
    setActiveSectionId(section.id);
  };

  const removeActiveSection = () => {
    if (!activeProject || !activeSection || activeProject.sections.length <= 1) return;
    const remaining = activeProject.sections.filter((section) => section.id !== activeSection.id);
    setActiveSectionId(remaining[0].id);
    updateProject((project) => ({ ...project, sections: remaining }));
  };

  const addSource = (event: React.FormEvent) => {
    event.preventDefault();
    if (!sourceTitle.trim()) return;
    const source: ResearchSource = {
      id: makeId('source'),
      title: sourceTitle.trim(),
      author: sourceAuthor.trim(),
      year: sourceYear.trim(),
      url: sourceUrl.trim(),
    };
    updateProject((project) => ({ ...project, sources: [...project.sources, source] }));
    setSourceTitle('');
    setSourceAuthor('');
    setSourceYear('');
    setSourceUrl('');
  };

  const requestAssistance = async () => {
    if (!activeProject || !activeSection || !assistantPrompt.trim()) return;
    setIsAssisting(true);
    setAssistantError(null);
    setAssistantSuggestion('');
    try {
      const response = await fetch('/api/paper-assist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instruction: assistantPrompt.trim(),
          projectTitle: activeProject.title,
          researchQuestion: activeProject.researchQuestion,
          sectionTitle: activeSection.title,
          sectionText: activeSection.content,
          sources: activeProject.sources.map(({ title, author, year, url }) => ({
            title,
            author,
            year,
            url,
          })),
        }),
      });
      const payload = (await response.json()) as { suggestion?: string; error?: string };
      if (!response.ok || !payload.suggestion) {
        throw new Error(payload.error || `Writing assistance failed (${response.status}).`);
      }
      setAssistantSuggestion(payload.suggestion);
    } catch (error) {
      setAssistantError(
        error instanceof Error ? error.message : 'Unable to generate a writing suggestion.'
      );
    } finally {
      setIsAssisting(false);
    }
  };

  const insertSuggestion = () => {
    if (!assistantSuggestion || !activeSection) return;
    updateProject((project) => ({
      ...project,
      sections: project.sections.map((section) =>
        section.id === activeSection.id
          ? {
              ...section,
              content: [section.content.trimEnd(), assistantSuggestion]
                .filter(Boolean)
                .join('\n\n'),
            }
          : section
      ),
    }));
    setAssistantSuggestion('');
  };

  const deleteProject = (project: ResearchProject) => {
    if (!window.confirm(`Delete "${project.title}" and all its sources and draft sections?`)) {
      return;
    }
    const remaining = projects.filter((item) => item.id !== project.id);
    setProjects(remaining);
    if (activeProjectId === project.id) {
      setActiveProjectId(remaining[0]?.id ?? null);
      setActiveSectionId(remaining[0]?.sections[0]?.id ?? null);
    }
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <BookOpen className="h-4 w-4 text-blue-700" />
            Paper Orchestra
          </div>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-slate-500">
            Organize research projects, collect references, and compose a section-based draft.
            Projects are saved in this browser on this device.
          </p>
        </div>
        {activeProject && (
          <button
            type="button"
            onClick={() => downloadText(activeProject)}
            className="inline-flex items-center gap-2 rounded-md bg-blue-700 px-3 py-2 text-xs font-medium text-white hover:bg-blue-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
          >
            <Download className="h-3.5 w-3.5" />
            Export plain text
          </button>
        )}
      </header>

      {storageError && (
        <div role="alert" className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {storageError}
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-600">Projects</h2>
            <span className="font-mono text-[11px] text-slate-400">{projects.length}</span>
          </div>
          <div className="space-y-1">
            {projects.map((project) => (
              <div
                key={project.id}
                className={`group flex items-start gap-1 rounded-md ${
                  activeProjectId === project.id ? 'bg-blue-50' : 'hover:bg-slate-50'
                }`}
              >
                <button
                  type="button"
                  onClick={() => {
                    setActiveProjectId(project.id);
                    setActiveSectionId(project.sections[0]?.id ?? null);
                    setAssistantSuggestion('');
                  }}
                  className={`min-w-0 flex-1 px-2.5 py-2 text-left text-xs ${
                    activeProjectId === project.id ? 'text-blue-800' : 'text-slate-700'
                  }`}
                >
                  <span className="block truncate font-medium">{project.title}</span>
                  <span className="mt-0.5 block text-[10px] text-slate-500">
                    {project.sources.length} sources · {project.sections.length} sections
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => deleteProject(project)}
                  aria-label={`Delete ${project.title}`}
                  title="Delete project"
                  className="mr-1 mt-1.5 rounded p-1 text-slate-400 opacity-0 hover:bg-red-50 hover:text-red-700 focus:opacity-100 focus-visible:opacity-100 group-hover:opacity-100"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            {projects.length === 0 && (
              <p className="px-2 py-3 text-xs text-slate-400">Your projects will appear here.</p>
            )}
          </div>

          <form onSubmit={createProject} className="space-y-2 border-t border-slate-100 pt-4">
            <label className="block text-[11px] font-medium text-slate-600" htmlFor="paper-project-title">
              New research project
            </label>
            <input
              id="paper-project-title"
              value={projectTitle}
              onChange={(event) => setProjectTitle(event.target.value)}
              maxLength={120}
              placeholder="Project title"
              className="w-full rounded-md border border-slate-200 px-2.5 py-2 text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
            />
            <textarea
              value={researchQuestion}
              onChange={(event) => setResearchQuestion(event.target.value)}
              maxLength={3000}
              rows={2}
              aria-label="Research question for new project"
              placeholder="Research question (optional)"
              className="w-full resize-y rounded-md border border-slate-200 px-2.5 py-2 text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
            />
            <button
              type="submit"
              disabled={!projectTitle.trim()}
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-slate-900 px-3 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" />
              Create project
            </button>
          </form>
        </aside>

        {activeProject && activeSection ? (
          <div className="grid min-w-0 gap-5 2xl:grid-cols-[minmax(0,1.5fr)_minmax(280px,0.8fr)]">
            <section className="min-w-0 space-y-4 rounded-lg border border-slate-200 bg-white p-5">
              <div className="space-y-3">
                <input
                  aria-label="Project title"
                  value={activeProject.title}
                  onChange={(event) =>
                    updateProject((project) => ({ ...project, title: event.target.value }))
                  }
                  maxLength={120}
                  className="w-full border-0 border-b border-slate-200 px-0 py-2 text-lg font-semibold text-slate-900 focus:border-blue-600 focus:outline-none"
                />
                <div>
                  <label htmlFor="paper-research-question" className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Research question
                  </label>
                  <textarea
                    id="paper-research-question"
                    value={activeProject.researchQuestion}
                    onChange={(event) =>
                      updateProject((project) => ({
                        ...project,
                        researchQuestion: event.target.value,
                      }))
                    }
                    maxLength={3000}
                    rows={2}
                    placeholder="What are you investigating?"
                    className="w-full resize-y rounded-md border border-slate-200 px-3 py-2 text-xs leading-relaxed focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2">
                <div className="flex min-w-0 flex-wrap gap-1">
                  {activeProject.sections.map((section) => (
                    <button
                      type="button"
                      key={section.id}
                      onClick={() => {
                        setActiveSectionId(section.id);
                        setAssistantSuggestion('');
                      }}
                      className={`max-w-40 truncate rounded-md px-2.5 py-1.5 text-[11px] font-medium ${
                        section.id === activeSection.id
                          ? 'bg-blue-50 text-blue-800'
                          : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800'
                      }`}
                    >
                      {section.title || 'Untitled section'}
                    </button>
                  ))}
                </div>
                <div className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    onClick={addSection}
                    className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1.5 text-[11px] font-medium text-slate-600 hover:bg-slate-50"
                  >
                    <FilePlus2 className="h-3.5 w-3.5" />
                    Add section
                  </button>
                  <button
                    type="button"
                    onClick={removeActiveSection}
                    disabled={activeProject.sections.length <= 1}
                    aria-label="Delete active section"
                    title="Delete active section"
                    className="rounded-md border border-slate-200 p-1.5 text-slate-500 hover:bg-red-50 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <input
                  aria-label="Section heading"
                  value={activeSection.title}
                  onChange={(event) =>
                    updateProject((project) => ({
                      ...project,
                      sections: project.sections.map((section) =>
                        section.id === activeSection.id
                          ? { ...section, title: event.target.value }
                          : section
                      ),
                    }))
                  }
                  maxLength={120}
                  placeholder="Section heading"
                  className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                />
                <textarea
                  aria-label="Section draft"
                  value={activeSection.content}
                  onChange={(event) =>
                    updateProject((project) => ({
                      ...project,
                      sections: project.sections.map((section) =>
                        section.id === activeSection.id
                          ? { ...section, content: event.target.value }
                          : section
                      ),
                    }))
                  }
                  rows={16}
                  placeholder="Write or paste your draft for this section..."
                  className="w-full resize-y rounded-md border border-slate-200 px-3 py-3 text-xs leading-6 text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                />
              </div>

              <div className="space-y-3 rounded-md border border-violet-100 bg-violet-50/50 p-3">
                <div className="flex items-center gap-2 text-xs font-semibold text-violet-950">
                  <Sparkles className="h-3.5 w-3.5 text-violet-700" />
                  Writing assistant
                </div>
                <p className="text-[11px] leading-relaxed text-violet-900/80">
                  Ask for an outline, revision, or critique. Suggestions are not added to your draft unless you choose to insert them.
                </p>
                <p className="text-[10px] leading-relaxed text-slate-500">
                  Requests send this project's title, research question, active section, and source metadata to the configured Gemini API.
                </p>
                <textarea
                  value={assistantPrompt}
                  onChange={(event) => setAssistantPrompt(event.target.value)}
                  maxLength={3000}
                  rows={2}
                  aria-label="Writing assistant instruction"
                  placeholder="e.g. Suggest a concise outline for this section"
                  className="w-full resize-y rounded-md border border-violet-200 bg-white px-3 py-2 text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
                />
                <button
                  type="button"
                  onClick={requestAssistance}
                  disabled={!assistantPrompt.trim() || isAssisting}
                  className="inline-flex items-center gap-1.5 rounded-md bg-violet-700 px-3 py-2 text-xs font-medium text-white hover:bg-violet-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isAssisting ? (
                    <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="h-3.5 w-3.5" />
                  )}
                  {isAssisting ? 'Working...' : 'Get suggestion'}
                </button>
                {assistantError && <p role="alert" className="text-xs text-red-700">{assistantError}</p>}
                {assistantSuggestion && (
                  <div className="space-y-2 rounded-md border border-violet-200 bg-white p-3">
                    <pre className="max-h-64 overflow-auto whitespace-pre-wrap font-sans text-xs leading-relaxed text-slate-700">
                      {assistantSuggestion}
                    </pre>
                    <button
                      type="button"
                      onClick={insertSuggestion}
                      className="rounded-md border border-violet-200 px-2.5 py-1.5 text-[11px] font-medium text-violet-800 hover:bg-violet-50"
                    >
                      Insert below section draft
                    </button>
                  </div>
                )}
              </div>
            </section>

            <aside className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Source library
                </h2>
                <span className="font-mono text-[11px] text-slate-400">{activeProject.sources.length}</span>
              </div>
              <form onSubmit={addSource} className="space-y-2">
                <input
                  value={sourceTitle}
                  onChange={(event) => setSourceTitle(event.target.value)}
                  maxLength={300}
                  aria-label="Source title"
                  placeholder="Title (required)"
                  className="w-full rounded-md border border-slate-200 px-2.5 py-2 text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                />
                <div className="grid grid-cols-2 gap-2">
                  <input
                    value={sourceAuthor}
                    onChange={(event) => setSourceAuthor(event.target.value)}
                    maxLength={160}
                    aria-label="Source author"
                    placeholder="Author"
                    className="min-w-0 rounded-md border border-slate-200 px-2.5 py-2 text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                  />
                  <input
                    value={sourceYear}
                    onChange={(event) => setSourceYear(event.target.value)}
                    maxLength={20}
                    aria-label="Source year"
                    placeholder="Year"
                    className="min-w-0 rounded-md border border-slate-200 px-2.5 py-2 text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                  />
                </div>
                <input
                  type="url"
                  value={sourceUrl}
                  onChange={(event) => setSourceUrl(event.target.value)}
                  maxLength={2000}
                  aria-label="Source URL"
                  placeholder="URL (optional)"
                  className="w-full rounded-md border border-slate-200 px-2.5 py-2 text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                />
                <button
                  type="submit"
                  disabled={!sourceTitle.trim()}
                  className="inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add source
                </button>
              </form>

              <div className="space-y-2 border-t border-slate-100 pt-3">
                {activeProject.sources.length === 0 ? (
                  <p className="text-xs leading-relaxed text-slate-400">
                    Add citations and links for sources used in this project.
                  </p>
                ) : (
                  activeProject.sources.map((source) => (
                    <article key={source.id} className="rounded-md border border-slate-100 bg-slate-50/70 p-2.5">
                      <div className="flex items-start gap-2">
                        <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
                        <div className="min-w-0 flex-1">
                          <h3 className="break-words text-xs font-medium text-slate-800">{source.title}</h3>
                          {(source.author || source.year) && (
                            <p className="mt-0.5 text-[10px] text-slate-500">
                              {[source.author, source.year].filter(Boolean).join(' · ')}
                            </p>
                          )}
                          {source.url && (
                            <a
                              href={source.url}
                              target="_blank"
                              rel="noreferrer"
                              className="mt-1 block break-all text-[10px] text-blue-700 hover:underline"
                            >
                              {source.url}
                            </a>
                          )}
                        </div>
                        <button
                          type="button"
                          aria-label={`Remove ${source.title}`}
                          onClick={() =>
                            updateProject((project) => ({
                              ...project,
                              sources: project.sources.filter((item) => item.id !== source.id),
                            }))
                          }
                          className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-700"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </article>
                  ))
                )}
              </div>
            </aside>
          </div>
        ) : (
          <section className="flex min-h-64 flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center">
            <BookOpen className="h-8 w-8 text-slate-300" />
            <h2 className="mt-3 text-sm font-semibold text-slate-800">Start a research project</h2>
            <p className="mt-1 max-w-sm text-xs leading-relaxed text-slate-500">
              Create a project to collect source references and organize your draft into sections.
            </p>
          </section>
        )}
      </div>
    </div>
  );
};
