// The understand stage of one application (ADR-0033): it runs on a selection of catalog items.
// Three tabs — Catalog (the module → item tree-table with a status per item, search and filters,
// tri-state module checkboxes and a sticky run bar for the selection), Runs (the understand runs
// with their scope, status and pull request, Retry and Abandon, and their live logs) and Results
// (map, rules, security and traceability for the whole application or one item).
// URL: …&tab=catalog|runs|results (&run=<id> opens Runs on that run; &view, &item on Results).

import { ListTree, Play, RefreshCw, RotateCcw, Sparkles, Undo2, X } from "lucide-react";
import { lazy, Suspense, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { JobRunList } from "@/components/job-runs/job-run-list";
import { Loaded } from "@/components/loaded";
import { RunStatusBadge, StatusBadge } from "@/components/status-badges";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { SkeletonRows } from "@/components/ui/skeleton";
import { Tabs } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import { ApiError } from "@/lib/api";
import { type CatalogItem, type CatalogView, catalogApi, type ItemStatus, type SelectionConflict } from "@/lib/api/catalog";
import { type JobRunView, jobRunsApi, type StageView } from "@/lib/api/job-runs";
import type { ApplicationView, ProjectDetail } from "@/lib/api/projects";
import { useAuth } from "@/lib/auth";
import { ASSET_CLASS_LABEL, assetClassOf, BATCH_MAX_LOC, estimateRun, formatEstimate, recommendBatch } from "@/lib/catalog-batch";
import { formatRelative } from "@/lib/format";
import { isActiveStatus, ITEM_STATUS, styleOf } from "@/lib/status";
import { runBlocker, runsOfStage, stageLabel } from "@/lib/stages";
import { type Loader, useLoader } from "@/lib/use-loader";
import { CompactFacts, StageHeader } from "./delivery-shell";
import { PlanPanel } from "./plan-panel";
import { CatalogResults, type CatalogSelection } from "./results/catalog-view";
import { formatCount } from "./results/results-format";

// The result views and their libraries (Markdown, Mermaid) load with the Results tab.
const UnderstandResultsTab = lazy(() => import("./results/understand-results-tab"));

type Tab = "catalog" | "runs" | "results";

/** Items a run takes at most (the API's cap). */
const MAX_ITEMS = 60;
const RUN_LIMIT = 50;
const STATUSES: ItemStatus[] = ["not-analysed", "understood", "stale", "failed", "in-pr", "running", "retired"];

/** A rough count of the agent jobs a selection starts: a specification per item, rule extractors and referees, security finders and judges. */
const agentEstimate = (items: number): number => (items === 0 ? 0 : items * 4 + 10);

export function UnderstandStage({ project, application, stage }: { project: ProjectDetail; application: ApplicationView; stage: StageView }): React.JSX.Element {
  const { can } = useAuth();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const runs = useLoader(`runs/${project.id}/${application.id}/understand`, async () => (await jobRunsApi.list(project.id, application.id, RUN_LIMIT)).items, {
    refresh: (list) => (list.some((run) => isActiveStatus(run.status) || run.documentWrite?.status === "queued") ? 3000 : 30000),
  });
  const understandRuns = runs.data === undefined ? undefined : runsOfStage(runs.data, "understand");
  const rebuilds = runs.data === undefined ? [] : runsOfStage(runs.data, "rebuild");
  const version = (understandRuns ?? []).map((run) => `${run.id}:${run.status}:${run.documentWrite?.status ?? ""}:${run.abandonedAt ?? ""}`).join(",");
  const catalog = useLoader(`catalog/${project.id}/${application.id}/${version}`, () =>
    catalogApi.get(project.id, application.id).catch((error: unknown) => {
      if (error instanceof ApiError && error.status === 404) return null;
      throw error;
    }),
  );

  const requested = params.get("tab");
  const tab: Tab = requested === "runs" || requested === "results" || requested === "catalog" ? requested : params.get("run") !== null ? "runs" : "catalog";
  const setParam = (entries: Record<string, string | undefined>): void =>
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        for (const [key, value] of Object.entries(entries)) {
          if (value === undefined) next.delete(key);
          else next.set(key, value);
        }
        return next;
      },
      { replace: true },
    );

  const blocked = runBlocker(project, application);
  const runDisabled = !can("jobs.run") ? "Starting a run needs the jobs.run permission." : blocked;
  const [rebuilding, setRebuilding] = useState(false);
  const counts = catalog.data?.counts;
  const total = catalog.data?.items.filter((item) => item.status !== "retired").length ?? 0;

  async function rebuild(): Promise<void> {
    setRebuilding(true);
    try {
      await jobRunsApi.runStage(project.id, application.id, "rebuild");
      toast.success("Rebuild queued", "The generated views are rebuilt from the items on the default branch and committed there.");
      await runs.reload();
    } catch (failure) {
      toast.error("Could not queue the rebuild", failure);
    } finally {
      setRebuilding(false);
    }
  }

  async function changed(): Promise<void> {
    await Promise.all([runs.reload(), catalog.reload()]);
  }

  return (
    <div className="flex flex-col gap-4">
      <StageHeader
        title={stageLabel(stage.id)}
        command={stage.command}
        application={application}
        description="Select catalog items or whole modules and run understand on them: one pull request per run, only the paths of its own items."
        facts={<CompactFacts project={project} application={application} />}
        actions={
          <>
            <span className="text-[13px] font-medium text-text tabular-nums">{catalog.data === undefined || catalog.data === null ? "" : `${counts?.understood ?? 0}/${total} items understood`}</span>
            <Button size="small" variant="ghost" className="shadow-border" disabled={runDisabled !== undefined || rebuilding || rebuilds.some((run) => isActiveStatus(run.status))} onClick={() => void rebuild()}>
              <RefreshCw className="size-3.5" />
              Rebuild generated views
            </Button>
          </>
        }
      />

      <Tabs<Tab>
        sticky
        label="understand sections"
        value={tab}
        onChange={(next) => setParam({ tab: next })}
        tabs={[
          { id: "catalog", label: "Catalog", ...(total === 0 ? {} : { count: total }) },
          { id: "runs", label: "Runs", ...(understandRuns === undefined ? {} : { count: understandRuns.length }) },
          { id: "results", label: "Overview" },
        ]}
      />

      {tab === "catalog" ? (
        <Loaded loader={catalog} rows={6}>
          {(view) =>
            view === null ? (
              <Card>
                <EmptyState icon={ListTree} title="No item catalog yet" description="Run assess and merge its pull request: it builds the catalog understand runs on." />
              </Card>
            ) : (
              <CatalogTab
                project={project}
                application={application}
                view={view}
                runs={understandRuns ?? []}
                planRuns={runs.data === undefined ? [] : runsOfStage(runs.data, "plan-understand")}
                canRun={can("jobs.run")}
                blocked={blocked}
                onRunsChanged={runs.reload}
                disabledReason={runDisabled}
                onStarted={async (run) => {
                  setParam({ tab: "runs", run: run.id });
                  await changed();
                }}
                onChanged={changed}
              />
            )
          }
        </Loaded>
      ) : null}

      {tab === "runs" ? <RunsTab project={project} runs={understandRuns} loader={runs} canRun={can("jobs.run")} initialRun={params.get("run") ?? undefined} onChanged={changed} onStarted={(run) => setParam({ tab: "runs", run: run.id })} /> : null}

      {tab === "results" ? (
        <Suspense fallback={<Card><SkeletonRows rows={6} /></Card>}>
          <UnderstandResultsTab project={project} application={application} catalog={catalog.data ?? null} version={version} runs={understandRuns} />
        </Suspense>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Catalog: filters, selection and the run bar
// ---------------------------------------------------------------------------

interface CatalogTabProps {
  project: ProjectDetail;
  application: ApplicationView;
  view: CatalogView;
  /** The application's understand runs, for the time estimate. */
  runs: JobRunView[];
  /** The application's plan-understand runs, newest first. */
  planRuns: JobRunView[];
  canRun: boolean;
  blocked: string | undefined;
  onRunsChanged(): Promise<void>;
  disabledReason: string | undefined;
  onStarted(run: JobRunView): Promise<void>;
  onChanged(): Promise<void>;
}

function CatalogTab({ project, application, view, runs, planRuns, canRun, blocked, onRunsChanged, disabledReason, onStarted, onChanged }: CatalogTabProps): React.JSX.Element {
  const toast = useToast();
  const { can } = useAuth();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [kind, setKind] = useState("");
  const [module, setModule] = useState("");
  const [assetClass, setAssetClass] = useState("");
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [conflicts, setConflicts] = useState<SelectionConflict[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [abandoning, setAbandoning] = useState<CatalogItem | null>(null);

  const kinds = useMemo(() => [...new Set(view.items.map((item) => item.kind))].sort(), [view]);
  const filtered: CatalogView = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return {
      ...view,
      items: view.items.filter(
        (item) =>
          (status === "" || item.status === status) &&
          (kind === "" || item.kind === kind) &&
          (module === "" || item.module === module) &&
          (assetClass === "" || assetClassOf(item) === assetClass) &&
          (needle === "" || item.id.includes(needle) || item.name.toLowerCase().includes(needle) || item.files.some((file) => file.toLowerCase().includes(needle))),
      ),
    };
  }, [view, search, status, kind, module, assetClass]);

  const blockedReason = (item: CatalogItem): string | undefined =>
    item.status === "retired" ? "Retired: no longer in the source" : item.status === "running" ? "A run on this item is active" : item.status === "in-pr" ? "In an open pull request: merge it, or abandon it to release the item" : undefined;
  // Items selected before a refresh that are blocked now drop out of the selection.
  const chosen = [...selected].filter((id) => {
    const item = view.items.find((entry) => entry.id === id);
    return item !== undefined && blockedReason(item) === undefined;
  });

  const selection: CatalogSelection = {
    selected: new Set(chosen),
    blocked: blockedReason,
    toggle: (ids, on) =>
      setSelected((previous) => {
        const next = new Set(previous);
        for (const id of ids) {
          if (on) next.add(id);
          else next.delete(id);
        }
        return next;
      }),
    action: (item) =>
      item.status === "in-pr" && item.pr !== undefined && can("jobs.run") ? (
        <Button size="small" variant="ghost" className="shadow-border" onClick={() => setAbandoning(item)}>
          <Undo2 className="size-3.5" />
          Abandon
        </Button>
      ) : null,
  };

  async function start(): Promise<void> {
    try {
      const run = await catalogApi.runUnderstand(project.id, application.id, { items: chosen });
      toast.success("Understand queued", `${chosen.length} item${chosen.length === 1 ? "" : "s"} of ${application.name}: the worker starts shortly.`);
      setSelected(new Set());
      setConflicts([]);
      await onStarted(run);
    } catch (failure) {
      const found = failure instanceof ApiError ? failure.body.details?.["conflicts"] : undefined;
      if (Array.isArray(found)) setConflicts(found as SelectionConflict[]);
      throw failure;
    }
  }

  const estimate = estimateRun(chosen.length, runs);
  const nothingLeft = recommendBatch(view.items.filter((item) => blockedReason(item) === undefined)).ids.length === 0;
  function recommend(): void {
    const batch = recommendBatch(view.items.filter((item) => blockedReason(item) === undefined));
    setSelected(new Set(batch.ids));
    setConflicts([]);
    toast.success(
      `${batch.ids.length} item${batch.ids.length === 1 ? "" : "s"} recommended`,
      `${batch.high} high complexity, ${formatCount(batch.loc)} code lines${batch.budgetHit ? `; the next item would pass ${formatCount(BATCH_MAX_LOC)} lines` : ""}. Test and generated code is not picked.`,
    );
  }

  const over = chosen.length > MAX_ITEMS;
  const runBlocked = disabledReason ?? (chosen.length === 0 ? "Select items or modules to run understand on." : over ? `A run takes at most ${MAX_ITEMS} items.` : conflicts.length > 0 ? "Some selected items are blocked: see below." : undefined);

  return (
    <div className="flex flex-col gap-4">
      <PlanPanel
        projectId={project.id}
        applicationId={application.id}
        items={view.items}
        planRuns={planRuns}
        canRun={canRun}
        blocked={blocked}
        selected={new Set(chosen)}
        onSelect={(ids) => {
          setSelected(new Set(ids));
          setConflicts([]);
        }}
        onRunsChanged={onRunsChanged}
      />
      <CatalogResults view={filtered} selection={selection}>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="w-full sm:w-64">
            <Input placeholder="Search items, ids and files" value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Search the catalog" />
          </div>
          <div className="w-44">
            <Select value={status} onChange={setStatus} options={[{ value: "", label: "Any status" }, ...STATUSES.map((value) => ({ value, label: styleOf(ITEM_STATUS, value).label }))]} />
          </div>
          <div className="w-40">
            <Select value={kind} onChange={setKind} options={[{ value: "", label: "Any kind" }, ...kinds.map((value) => ({ value, label: value }))]} />
          </div>
          <div className="w-44">
            <Select value={module} onChange={setModule} options={[{ value: "", label: "Any module" }, ...view.catalog.modules.map((entry) => ({ value: entry.id, label: entry.name }))]} />
          </div>
          <div className="w-36">
            <Select value={assetClass} onChange={setAssetClass} options={[{ value: "", label: "Any class" }, ...(["code", "test", "generated"] as const).map((value) => ({ value, label: ASSET_CLASS_LABEL[value] }))]} />
          </div>
          {search === "" && status === "" && kind === "" && module === "" && assetClass === "" ? null : (
            <Button size="small" variant="ghost" onClick={() => { setSearch(""); setStatus(""); setKind(""); setModule(""); setAssetClass(""); }}>
              <X className="size-3.5" />
              Clear filters
            </Button>
          )}
          <span className="ml-auto text-[12px] text-text-muted">
            {filtered.items.length} of {view.items.length} items
          </span>
        </div>
      </CatalogResults>

      <div className="sticky bottom-3 z-10">
        <Card className="py-3 shadow-[var(--ds-shadow-menu,0_4px_16px_rgba(0,0,0,0.12))]">
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-[13px] text-text tabular-nums">
              <span className="font-medium">{chosen.length} item{chosen.length === 1 ? "" : "s"}</span>
              <span className="text-text-muted"> · ~{agentEstimate(chosen.length)} agent jobs</span>
              {estimate === undefined ? (
                chosen.length === 0 ? null : <span className="text-text-muted" title="No successful understand run of this application to estimate from yet"> · no time estimate yet</span>
              ) : (
                <span className="text-text-muted" title={`Median ${formatEstimate(estimate.perItemMs)} per item over ${estimate.basis} earlier successful run${estimate.basis === 1 ? "" : "s"}`}> · ~{formatEstimate(estimate.totalMs)}</span>
              )}
            </p>
            <Button size="small" variant="ghost" className="shadow-border" disabled={nothingLeft} onClick={recommend} title="Without AI: the most complex open code items, up to a size budget. The AI plan above also weighs how items call each other.">
              <Sparkles className="size-3.5" />
              Quick pick
            </Button>
            {chosen.length === 0 ? null : (
              <Button size="small" variant="ghost" onClick={() => { setSelected(new Set()); setConflicts([]); }}>
                Clear selection
              </Button>
            )}
            <div className="ml-auto flex items-center gap-2">
              {runBlocked === undefined ? null : <span className="max-w-sm text-right text-[11px] text-text-muted">{runBlocked}</span>}
              <Button size="small" variant="solid" disabled={runBlocked !== undefined} onClick={() => setConfirming(true)}>
                <Play className="size-3.5" />
                Run understand
              </Button>
            </div>
          </div>
          {conflicts.length === 0 ? null : (
            <ul className="mt-2 flex flex-col gap-0.5 text-[12px] text-text-secondary">
              {conflicts.map((conflict) => (
                <li key={conflict.item}>
                  <span className="font-mono">{conflict.item}</span> is {styleOf(ITEM_STATUS, conflict.state).label.toLowerCase()}
                  {conflict.runId === undefined ? "" : ` (run ${conflict.runId.slice(0, 8)})`}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <ConfirmDialog
        open={confirming}
        title={`Run understand on ${chosen.length} item${chosen.length === 1 ? "" : "s"} of ${application.name}?`}
        confirmLabel="Run understand"
        busyLabel="Queuing…"
        confirmVariant="solid"
        onConfirm={start}
        onClose={() => setConfirming(false)}
      >
        <p>
          The worker reads {application.asIs.legacy[0]?.repositoryId ?? "the legacy repo"} read-only and proposes, in one pull request to {project.documentRepository?.repositoryId ?? "the document repo"}, per item:
          its topology fragment, business rules, security findings, AS-IS specification, traceability and work item. About {agentEstimate(chosen.length)} agent jobs{estimate === undefined ? "" : `, roughly ${formatEstimate(estimate.totalMs)} from earlier runs`}.
        </p>
        <p className="mt-2 font-mono text-[12px] text-text-secondary">{chosen.slice(0, 12).join(", ")}{chosen.length > 12 ? ` +${chosen.length - 12}` : ""}</p>
      </ConfirmDialog>

      <ConfirmDialog
        open={abandoning !== null}
        title={`Abandon the pull request of ${abandoning?.name ?? ""}?`}
        confirmLabel="Abandon"
        busyLabel="Abandoning…"
        onConfirm={async () => {
          if (abandoning?.pr === undefined) return;
          await jobRunsApi.abandon(project.id, abandoning.pr.runId);
          toast.success("Pull request abandoned", "Its items can be selected again.");
          await onChanged();
        }}
        onClose={() => setAbandoning(null)}
      >
        <p>Do this when the pull request of run {abandoning?.pr?.runId.slice(0, 8)} was closed without merging: every item of that run is released and can be selected again. The run and its branch stay as they are.</p>
      </ConfirmDialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Runs: scope, status, pull request, Retry and Abandon, then the live logs
// ---------------------------------------------------------------------------

interface RunsTabProps {
  project: ProjectDetail;
  runs: JobRunView[] | undefined;
  loader: Loader<JobRunView[]>;
  canRun: boolean;
  initialRun: string | undefined;
  onChanged(): Promise<void>;
  onStarted(run: JobRunView): void;
}

function RunsTab({ project, runs, loader, canRun, initialRun, onChanged, onStarted }: RunsTabProps): React.JSX.Element {
  const toast = useToast();
  const [abandoning, setAbandoning] = useState<JobRunView | null>(null);

  async function retry(run: JobRunView): Promise<void> {
    try {
      const next = await jobRunsApi.retry(project.id, run.id);
      toast.success("Retry queued", "It skips the agent jobs that succeeded and reruns the rest.");
      onStarted(next);
      await onChanged();
    } catch (failure) {
      toast.error("Could not retry the run", failure);
    }
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Understand runs</CardTitle>
            <CardDescription>Each run is one pull request with the files of its own items. Retry a failed run; abandon a pull request that was closed without merging to release its items.</CardDescription>
          </div>
        </CardHeader>
        <div className="mt-2">
          <Loaded loader={loader} rows={3}>
            {() =>
              runs === undefined || runs.length === 0 ? (
                <EmptyState icon={Play} title="No understand run yet" description="Select items on the Catalog tab and run understand on them." />
              ) : (
                <ul className="flex flex-col">
                  {runs.map((run, index) => {
                    const items = run.scope?.items ?? [];
                    const openPr = run.status === "succeeded" && run.documentWrite?.status === "pr-opened" && run.abandonedAt === undefined;
                    return (
                      <li key={run.id} className={index > 0 ? "[box-shadow:0_-1px_0_rgba(0,0,0,0.06)] py-2.5" : "py-2.5"}>
                        <div className="flex flex-wrap items-center gap-2">
                          <RunStatusBadge status={run.status} />
                          {run.abandonedAt === undefined ? null : <StatusBadge tone="muted" label="Abandoned" />}
                          {run.resumeOf === undefined ? null : <span className="text-[11px] text-text-muted">retry of {run.resumeOf.slice(0, 8)}</span>}
                          <span className="font-mono text-[11px] text-text-muted">{run.id.slice(0, 8)}</span>
                          <span className="text-[12px] text-text-muted">{formatRelative(run.createdAt)}{run.actor === undefined ? "" : ` · ${run.actor}`}</span>
                          {run.documentWrite?.prUrl === undefined ? null : (
                            <a className="text-[12px] underline" href={run.documentWrite.prUrl} target="_blank" rel="noreferrer">
                              Pull request
                            </a>
                          )}
                          <div className="ml-auto flex items-center gap-2">
                            {canRun && run.status === "failed" ? (
                              <Button size="small" variant="ghost" className="shadow-border" onClick={() => void retry(run)}>
                                <RotateCcw className="size-3.5" />
                                Retry
                              </Button>
                            ) : null}
                            {canRun && openPr ? (
                              <Button size="small" variant="ghost" className="shadow-border" onClick={() => setAbandoning(run)}>
                                <Undo2 className="size-3.5" />
                                Abandon
                              </Button>
                            ) : null}
                          </div>
                        </div>
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {items.slice(0, 8).map((item) => (
                            <span key={item} className="rounded-full bg-recessed px-2 py-0.5 font-mono text-[11px] text-text-secondary">
                              {item}
                            </span>
                          ))}
                          {items.length > 8 ? <span className="text-[11px] text-text-muted">+{items.length - 8} more</span> : null}
                        </div>
                        {run.failureReason === undefined ? null : <p className="mt-1 text-[12px] text-[var(--ds-status-red)]">{run.failureReason}</p>}
                      </li>
                    );
                  })}
                </ul>
              )
            }
          </Loaded>
        </div>
      </Card>

      {runs === undefined || runs.length === 0 ? null : (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Steps and live logs</CardTitle>
              <CardDescription>Open a run for its steps, artifacts and live log.</CardDescription>
            </div>
          </CardHeader>
          <div className="mt-2">
            <JobRunList key={initialRun ?? "none"} runs={runs} canCancel={canRun} {...(initialRun === undefined ? {} : { initialOpen: initialRun })} onChanged={() => void onChanged()} />
          </div>
        </Card>
      )}

      <ConfirmDialog
        open={abandoning !== null}
        title="Abandon this pull request?"
        confirmLabel="Abandon"
        busyLabel="Abandoning…"
        onConfirm={async () => {
          if (abandoning === null) return;
          await jobRunsApi.abandon(project.id, abandoning.id);
          toast.success("Pull request abandoned", "Its items can be selected again.");
          await onChanged();
        }}
        onClose={() => setAbandoning(null)}
      >
        <p>Do this when the pull request was closed without merging: its {abandoning?.scope?.items.length ?? 0} item(s) are released and can be selected again.</p>
      </ConfirmDialog>
    </>
  );
}
