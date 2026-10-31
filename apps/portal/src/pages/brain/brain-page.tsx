// The Brain (ADR-0091): the documents of a project as a tree that members' agents reason over. The page shows
// the index — its branch, commit and state — and the same tree an agent browses through the Kintsugi MCP tools:
// summaries on the left, a node's text with its citation and links on the right, and a search that looks up an
// id or a path or finds an exact text. People with `project.brain.manage` choose the branch, rebuild and turn it off.

import type { BrainStatusView } from "@kintsugi/domain";
import { BRAIN_ROOT_ID } from "@kintsugi/domain";
import { Brain, FolderKanban, GitBranch, GitCommitHorizontal, ListTree, Power, RefreshCw, Search, Settings2, TriangleAlert, X } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { Loaded } from "@/components/loaded";
import { ProjectSelector } from "@/components/project-selector";
import { DocumentLinksProvider } from "@/components/results/document-links";
import { StatusBadge } from "@/components/status-badges";
import { StickyHeader } from "@/components/sticky-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { brainApi } from "@/lib/api/brain";
import { projectsApi } from "@/lib/api/projects";
import { useAuth } from "@/lib/auth";
import { BRAIN_STATE, formatTokens } from "@/lib/brain";
import { formatDateTime, formatRelative, shortSha } from "@/lib/format";
import { projectLink } from "@/lib/links";
import { useProjectSelection } from "@/lib/project-selection";
import { useLoader } from "@/lib/use-loader";
import { BrainNodeView } from "./brain-node-view";
import { BrainSearch } from "./brain-search";
import { BrainTree } from "./brain-tree";

const MANAGE = "project.brain.manage";
const SUMMARIES_KEY = "kintsugi-brain-summaries";

const count = (value: number, noun: string): string => `${value.toLocaleString()} ${value === 1 ? noun : `${noun}s`}`;

export function BrainPage(): React.JSX.Element {
  const projects = useLoader("projects", projectsApi.list);
  const { projectId, select } = useProjectSelection(projects.data?.map((project) => project.id));
  const current = projects.data?.find((project) => project.id === projectId);

  return (
    <div className="flex flex-col gap-4">
      <StickyHeader className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <Breadcrumbs items={current === undefined ? ["Brain"] : ["Brain", current.name]} />
        {projects.data === undefined || projects.data.length === 0 ? null : (
          <div className="flex flex-wrap items-center gap-2">
            <ProjectSelector projects={projects.data} value={projectId} onChange={select} />
            {projectId === undefined ? null : (
              <Link
                to={projectLink(projectId)}
                title="Configure the project"
                className="inline-flex h-[var(--geist-form-small-height)] items-center gap-1.5 rounded-[var(--geist-radius)] px-2.5 text-[13px] text-text-secondary hover:bg-hover hover:text-text focus-visible:outline-none focus-visible:[box-shadow:var(--ds-focus-ring)]"
              >
                <Settings2 className="size-4" />
                Configure
              </Link>
            )}
          </div>
        )}
      </StickyHeader>
      <Loaded loader={projects} rows={4}>
        {(list) =>
          list.length === 0 || projectId === undefined ? (
            <Card>
              <EmptyState
                icon={FolderKanban}
                title="No projects yet"
                description="The Brain indexes a project's document repository. Create a project with its document repository first."
                action={
                  <Link to="/projects" className="text-[13px] text-accent hover:underline">
                    Go to Administration → Projects
                  </Link>
                }
              />
            </Card>
          ) : (
            <BrainProject key={projectId} projectId={projectId} projectName={current?.name ?? projectId} />
          )
        }
      </Loaded>
    </div>
  );
}

function BrainProject({ projectId, projectName }: { projectId: string; projectName: string }): React.JSX.Element {
  const status = useLoader(`brain/${projectId}/status`, () => brainApi.status(projectId), { live: [`brain:${projectId}`, `repositories`] });
  return (
    <Loaded loader={status} rows={6}>
      {(view) => (
        <div className="flex flex-col gap-4">
          <BrainHeader view={view} projectName={projectName} onChange={() => void status.reload()} />
          <BrainBody view={view} projectName={projectName} onChange={() => void status.reload()} />
        </div>
      )}
    </Loaded>
  );
}

// ---------------------------------------------------------------------------
// Header: what the Brain is, its state and the manager's controls
// ---------------------------------------------------------------------------

function BrainHeader({ view, projectName, onChange }: { view: BrainStatusView; projectName: string; onChange: () => void }): React.JSX.Element {
  const { can } = useAuth();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);
  const manage = can(MANAGE) && view.available;
  const state = BRAIN_STATE[view.state];
  const updating = (view.state === "queued" || view.state === "indexing") && view.commit !== null;

  const act = async (work: () => Promise<unknown>, done: string, detail?: string): Promise<void> => {
    setBusy(true);
    try {
      await work();
      toast.success(done, detail);
      onChange();
    } catch (failure) {
      toast.error("The Brain was not changed", failure);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 max-w-3xl">
          <h1 className="flex items-center gap-2 text-[20px] font-semibold tracking-tight text-text">
            <Brain className="size-5 text-text-muted" strokeWidth={1.5} />
            Brain
          </h1>
          <p className="mt-0.5 text-[13px] text-text-secondary">
            The documents of {projectName} as a tree an agent reasons over: a summary on every folder, document and section; it reads where they lead and
            cites what it read by line and commit. No vectors, and no model builds it.
          </p>
        </div>
        {manage && view.configured ? (
          <div className="flex flex-wrap items-center gap-2">
            {view.enabled ? (
              <>
                <div className="w-48" title="The branch the Brain follows">
                  <Select
                    value={view.branch}
                    options={view.branches.map((branch) => ({
                      value: branch,
                      label: branch,
                      ...(branch === view.defaultBranch ? { hint: "default" } : {}),
                      icon: <GitBranch className="size-4 shrink-0 text-text-muted" strokeWidth={1.5} />,
                    }))}
                    disabled={busy}
                    onChange={(branch) => void act(() => brainApi.configure(view.projectId, { enabled: true, branch }), `The Brain now follows ${branch}`, "It is built from the tip of that branch.")}
                  />
                </div>
                <Button size="small" disabled={busy || view.state === "indexing"} onClick={() => void act(() => brainApi.rebuild(view.projectId), "Rebuild queued", "The tree is built again from the tip of its branch.")}>
                  <RefreshCw />
                  Rebuild
                </Button>
                <Button size="small" disabled={busy} title="Turn the Brain off" aria-label="Turn the Brain off" onClick={() => setConfirmOff(true)}>
                  <Power />
                </Button>
              </>
            ) : (
              <Button size="small" variant="solid" disabled={busy} onClick={() => void act(() => brainApi.configure(view.projectId, { enabled: true, branch: view.branch }), "The Brain is on", "It is being built.")}>
                <Power />
                Turn on
              </Button>
            )}
          </div>
        ) : null}
      </div>
      {view.configured ? (
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-text-secondary">
          <StatusBadge tone={state.tone} busy={state.busy} label={updating ? `${state.label} · updating` : state.label} />
          <span className="flex items-center gap-1" title="The branch the Brain follows">
            <GitBranch className="size-3.5 text-text-muted" strokeWidth={1.75} />
            <span className="font-mono text-[11px]">{view.branch}</span>
          </span>
          {view.commit === null ? null : (
            <span className="flex items-center gap-1" title={`Indexed commit ${view.commit}`}>
              <GitCommitHorizontal className="size-3.5 text-text-muted" strokeWidth={1.75} />
              <span className="font-mono text-[11px]">{shortSha(view.commit)}</span>
            </span>
          )}
          {view.indexedAt === null ? null : <span title={formatDateTime(view.indexedAt)}>indexed {formatRelative(view.indexedAt)}</span>}
          {view.commit === null ? null : (
            <span className="text-text-muted">
              {count(view.documents, "document")} · {count(view.nodes, "node")} · {count(view.identifiers, "id")} · ≈ {formatTokens(view.tokens)} tokens
              {view.durationMs === null ? "" : ` · built in ${(view.durationMs / 1000).toFixed(1)} s`}
            </span>
          )}
          {view.tip !== null && view.commit !== null && view.tip !== view.commit && !updating ? (
            <span className="flex items-center gap-1 text-text-muted" title={`The branch is at ${view.tip}`}>
              newer commit {shortSha(view.tip)} waits for its build
            </span>
          ) : null}
        </div>
      ) : null}
      {view.state === "failed" && view.error !== null ? (
        <p role="alert" className="flex items-start gap-2 rounded-[var(--geist-radius)] bg-recessed px-3 py-2 text-[12px] text-text-secondary">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-[var(--ds-status-red)]" strokeWidth={1.75} />
          <span>
            The last build failed: {view.error}
            {view.commit === null ? "" : " The tree of the previous build is still served."}
          </span>
        </p>
      ) : null}
      {view.skipped > 0 ? <p className="text-[12px] text-text-muted">{view.skipped.toLocaleString()} documents were left out: the index holds 20,000 at most.</p> : null}
      <ConfirmDialog
        open={confirmOff}
        title="Turn the Brain off?"
        confirmLabel="Turn off"
        busyLabel="Turning off…"
        onClose={() => setConfirmOff(false)}
        onConfirm={async () => {
          await brainApi.configure(view.projectId, { enabled: false, branch: view.branch });
          toast.success("The Brain is off", "Members' agents can no longer browse it.");
          onChange();
        }}
      >
        <p className="text-[13px] text-text-secondary">
          Members' agents get an error from the Brain tools until it is turned on again. The tree is kept, and the documents stay in Git.
        </p>
      </ConfirmDialog>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Body: the explorer, or what to do before there is one
// ---------------------------------------------------------------------------

function BrainBody({ view, projectName, onChange }: { view: BrainStatusView; projectName: string; onChange: () => void }): React.JSX.Element {
  const { can } = useAuth();
  const toast = useToast();
  const [branch, setBranch] = useState(view.branch);
  const [busy, setBusy] = useState(false);
  const manage = can(MANAGE);

  if (!view.available) {
    return (
      <Card>
        <EmptyState
          icon={FolderKanban}
          title="No document repository to index yet"
          description={view.reason ?? "Link the project's document repository; the Brain indexes it once the worker has mirrored it."}
          action={
            <Link to={projectLink(view.projectId)} className="text-[13px] text-accent hover:underline">
              Configure the project
            </Link>
          }
        />
      </Card>
    );
  }

  // A rebuild of the same commit (a newer builder) changes the tree too: the build time keys what was loaded.
  if (view.commit !== null && view.enabled) return <BrainExplorer key={view.indexedAt ?? view.commit} projectId={view.projectId} view={view} commit={view.commit} />;

  if (view.state === "queued" || view.state === "indexing") {
    return (
      <Card>
        <EmptyState
          icon={ListTree}
          title={`Building the Brain of ${projectName}…`}
          description={`Reading every Markdown document of ${view.branch} and making its tree. This page follows the build and opens the tree when it is ready.`}
        />
      </Card>
    );
  }

  const start = async (): Promise<void> => {
    setBusy(true);
    try {
      await brainApi.configure(view.projectId, { enabled: true, branch });
      toast.success("Building the Brain", `From the tip of ${branch}.`);
      onChange();
    } catch (failure) {
      toast.error("The Brain could not be built", failure);
    } finally {
      setBusy(false);
    }
  };

  const off = view.configured && !view.enabled;
  return (
    <Card className="flex flex-col items-center gap-4 px-6 py-10 text-center">
      <Brain className="size-6 text-text-muted" strokeWidth={1.5} />
      <div className="flex max-w-xl flex-col gap-1.5">
        <p className="text-[15px] font-medium text-text">{off ? "The Brain is off" : `Give ${projectName} a Brain`}</p>
        <p className="text-[13px] text-text-secondary">
          Kintsugi reads every Markdown document of one branch of the document repository and builds a tree of folders, documents, sections and cards, with a
          summary on each taken from the documents themselves. Members' agents browse it with the Kintsugi tools <code className="font-mono text-[12px]">brain_tree</code>,{" "}
          <code className="font-mono text-[12px]">brain_read</code>, <code className="font-mono text-[12px]">brain_lookup</code> and{" "}
          <code className="font-mono text-[12px]">brain_grep</code>, and cite every answer by path, lines and commit.
        </p>
        {view.state === "failed" && view.error !== null ? <p className="text-[12px] text-[var(--ds-status-red)]">The last build failed: {view.error}</p> : null}
      </div>
      <ol className="grid w-full max-w-2xl gap-2 text-left sm:grid-cols-3">
        {[
          ["Choose a branch", "Usually the default one: what people merged. Kintsugi's own output branches are not reviewed and are left out."],
          ["Build", "Seconds for most repositories; then again after every merge, by itself."],
          ["Ask", "A member's agent starts at the root, reads summaries, opens what can hold the answer and cites it."],
        ].map(([title, text], index) => (
          <li key={title} className="flex gap-2 rounded-[var(--geist-radius)] p-3 shadow-border">
            <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-recessed font-mono text-[11px] text-text-secondary">{index + 1}</span>
            <span className="flex flex-col gap-0.5">
              <span className="text-[13px] text-text">{title}</span>
              <span className="text-[12px] text-text-muted">{text}</span>
            </span>
          </li>
        ))}
      </ol>
      {manage ? (
        <div className="flex flex-wrap items-center justify-center gap-2">
          <div className="w-56">
            <Select
              value={branch}
              options={view.branches.map((name) => ({ value: name, label: name, ...(name === view.defaultBranch ? { hint: "default" } : {}), icon: <GitBranch className="size-4 shrink-0 text-text-muted" strokeWidth={1.5} /> }))}
              onChange={setBranch}
              disabled={busy}
            />
          </div>
          <Button variant="solid" size="small" disabled={busy || view.branches.length === 0} onClick={() => void start()}>
            <ListTree />
            {busy ? "Starting…" : off ? "Turn on and build" : "Build the Brain"}
          </Button>
        </div>
      ) : (
        <p className="text-[12px] text-text-muted">A person with the permission to manage the Brain builds it.</p>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// The explorer: search and tree on the left, the selected node on the right
// ---------------------------------------------------------------------------

function readSummaries(): boolean {
  try {
    return localStorage.getItem(SUMMARIES_KEY) !== "off";
  } catch {
    return true;
  }
}

function BrainExplorer({ projectId, view, commit }: { projectId: string; view: BrainStatusView; commit: string }): React.JSX.Element {
  const [params, setParams] = useSearchParams();
  const selected = params.get("node") ?? BRAIN_ROOT_ID;
  const query = params.get("q") ?? "";
  const [draft, setDraft] = useState(query);
  // The box shows the search in the URL again after back/forward.
  const [shownQuery, setShownQuery] = useState(query);
  if (shownQuery !== query) {
    setShownQuery(query);
    setDraft(query);
  }
  const [reveal, setReveal] = useState<string[]>([]);
  const [summaries, setSummaries] = useState(readSummaries);

  const update = useCallback(
    (change: (next: URLSearchParams) => void) =>
      setParams(
        (previous) => {
          const next = new URLSearchParams(previous);
          change(next);
          return next;
        },
        { replace: false },
      ),
    [setParams],
  );
  const select = useCallback((id: string) => update((next) => (id === BRAIN_ROOT_ID ? next.delete("node") : next.set("node", id))), [update]);
  const search = (text: string): void => update((next) => (text.trim() === "" ? next.delete("q") : next.set("q", text.trim())));
  const toggleSummaries = (): void => {
    setSummaries((current) => {
      try {
        localStorage.setItem(SUMMARIES_KEY, current ? "off" : "on");
      } catch {
        // a private window keeps the choice for this page only
      }
      return !current;
    });
  };
  const root = useMemo(() => ({ id: BRAIN_ROOT_ID, kind: "root" as const, title: `${view.branch} · ${shortSha(commit)}` }), [view.branch, commit]);
  const version = `${commit}:${view.indexedAt ?? ""}`;

  return (
    <div className="flex min-h-[560px] flex-col overflow-hidden rounded-xl bg-surface shadow-border-medium lg:h-[calc(100vh-var(--page-header-height,0px)-15rem)] lg:flex-row">
      <aside
        className="flex max-h-[45vh] shrink-0 flex-col [box-shadow:0_1px_0_rgba(0,0,0,0.08)] lg:max-h-none lg:w-80 lg:[box-shadow:1px_0_0_rgba(0,0,0,0.08)] xl:w-96"
        aria-label="Browse the Brain"
      >
        <form
          className="flex items-center gap-1 p-2 [box-shadow:0_1px_0_rgba(0,0,0,0.08)]"
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            search(draft);
          }}
        >
          <label className="flex h-[var(--geist-form-small-height)] min-w-0 flex-1 items-center gap-2 rounded-[var(--geist-radius)] bg-background px-2 shadow-border focus-within:[box-shadow:var(--ds-focus-ring)]">
            <Search className="size-4 shrink-0 text-text-muted" strokeWidth={1.75} />
            <span className="sr-only">Search the Brain</span>
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  setDraft("");
                  search("");
                }
              }}
              placeholder="An id, a path or a text…"
              className="min-w-0 flex-1 bg-transparent text-[13px] text-text outline-none placeholder:text-text-muted"
            />
            {query === "" ? null : (
              <button type="button" aria-label="Clear the search" className="rounded p-0.5 text-text-muted hover:text-text" onClick={() => search("")}>
                <X className="size-3.5" strokeWidth={1.75} />
              </button>
            )}
          </label>
          <Button size="icon" type="button" aria-pressed={summaries} title={summaries ? "Hide summaries in the tree" : "Show summaries in the tree"} onClick={toggleSummaries}>
            <ListTree className={summaries ? "text-text" : undefined} />
          </Button>
        </form>
        <div className="min-h-0 flex-1 overflow-auto p-2">
          {query === "" ? (
            <BrainTree projectId={projectId} root={root} selected={selected} reveal={reveal} showSummaries={summaries} onSelect={select} />
          ) : (
            <BrainSearch projectId={projectId} version={version} text={query} selected={selected} onSelect={select} />
          )}
        </div>
      </aside>
      <section className="min-h-0 min-w-0 flex-1 overflow-auto p-4 md:p-6" aria-label="Node">
        <DocumentLinksProvider projectId={projectId} commit={commit}>
          <BrainNodeView projectId={projectId} version={version} nodeId={selected} onSelect={select} onPath={setReveal} />
        </DocumentLinksProvider>
      </section>
    </div>
  );
}
