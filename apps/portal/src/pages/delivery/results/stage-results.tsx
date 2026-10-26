// The Results tab of a runtime stage: what the stage produced, read from the document repo at a
// ref (default: the latest successful run's output, open branch or merged) and shown as tables,
// graphs and documents. A ref selector picks the default branch or an older run; "Compare with
// previous run" adds the change of every count. Loaded lazily with its heavy libraries.
// URL: …&tab=results&ref=<refs/heads/… | commit>.

import { ChevronRight, GitBranch, GitCommitHorizontal, PackageOpen, RefreshCw } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { Loaded } from "@/components/loaded";
import { DocumentLinksProvider } from "@/components/results/document-links";
import { StatusBadge } from "@/components/status-badges";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Select } from "@/components/ui/select";
import type { StatusTone } from "@/components/ui/status-dot";
import { type DocumentRef, documentsApi, type ResultStage, type StageResults } from "@/lib/api/documents";
import type { JobRunView } from "@/lib/api/job-runs";
import type { ApplicationView, ProjectDetail } from "@/lib/api/projects";
import { formatDateTime, formatRelative, shortSha } from "@/lib/format";
import { useLoader } from "@/lib/use-loader";
import { AssessResultsView } from "./assess-results";
import { GapsResultsView } from "./gaps-results";
import { HardenResultsView } from "./harden-results";
import { MapResultsView } from "./map-results";
import { OutputFiles } from "./results-parts";
import { RulesResultsView } from "./rules-results";
import { UnderstandResultsView } from "./understand-results";

export interface StageResultsProps {
  project: ProjectDetail;
  application: ApplicationView;
  stage: ResultStage;
  /** Changes when a run of the stage finishes, so the latest output is read again. */
  version: string;
  /** Why the stage cannot be run now, for the empty state; undefined when it can. */
  runBlocked: string | undefined;
  /** The stage's runs of the application, newest first (the monitoring views read them). */
  runs?: JobRunView[] | undefined;
  /** Shown instead of the plain empty state while the stage has no output yet. */
  firstRun?: React.ReactNode;
}

const STATUS: Record<DocumentRef["status"], { tone: StatusTone; label: string }> = {
  default: { tone: "green", label: "Default branch" },
  merged: { tone: "green", label: "Merged" },
  open: { tone: "orange", label: "Open branch" },
  commit: { tone: "muted", label: "Commit" },
};

/** What to do first when a stage has no output yet (the stages it builds on). */
const NEXT_ACTION: Partial<Record<ResultStage, string>> = {
  understand:
    "Run understand after assess and map are merged (extract-rules and harden are used when merged too). It proposes the units from the map, writes an AS-IS specification per unit, the traceability matrix and the work items, all in one pull request.",
};

const refLabel = (ref: DocumentRef): string =>
  ref.kind === "default" ? ref.label : ref.kind === "run" ? `Run of ${formatDateTime(ref.date)} · ${STATUS[ref.status].label.toLowerCase()}` : ref.label;

export default function StageResults({ project, application, stage, version, runBlocked, runs, firstRun }: StageResultsProps): React.JSX.Element {
  const [params, setParams] = useSearchParams();
  const ref = params.get("ref") ?? undefined;
  const compare = params.get("compare") === "1";
  const refs = useLoader(`doc-refs/${project.id}/${version}`, () => documentsApi.refs(project.id));
  const defaultRef = refs.data?.refs.find((entry) => entry.kind === "default");
  // Once the latest successful run is merged its output is the default branch: that is what is shown until a ref is picked.
  const merged = runs?.find((run) => run.status === "succeeded")?.documentWrite?.status === "merged";
  const effectiveRef = ref ?? (merged ? defaultRef?.ref : undefined);
  // The previous run's counts come along every time (a few small reads), so the toggle never reloads.
  const results = useLoader(`results/${project.id}/${application.id}/${stage}/${effectiveRef ?? "latest"}/${version}`, () =>
    documentsApi.results(project.id, application.id, stage, { ref: effectiveRef, compare: true }),
  );

  const update = (key: string, value: string | undefined): void =>
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        if (value === undefined) next.delete(key);
        else next.set(key, value);
        return next;
      },
      { replace: true },
    );

  // With no output at all (and no ref picked) there is nothing to select or compare: the first-run panel stands alone.
  const firstRunOnly = firstRun !== undefined && ref === undefined && results.data?.empty === true;
  const stageRefs = (refs.data?.refs ?? []).filter((entry) => entry.kind === "run" && entry.stage === stage && entry.applicationId === application.id);
  const options = [
    { value: "", label: "Latest result", hint: "The newest successful run's output" },
    ...(defaultRef === undefined ? [] : [{ value: defaultRef.ref, label: defaultRef.label, hint: shortSha(defaultRef.commit) }]),
    ...stageRefs.map((entry) => ({ value: entry.ref, label: refLabel(entry), hint: shortSha(entry.commit) })),
  ];
  if (ref !== undefined && !options.some((option) => option.value === ref)) options.push({ value: ref, label: ref.replace(/^refs\/heads\//, ""), hint: "" });

  return (
    <div className="flex flex-col gap-4">
      {firstRunOnly ? null : (
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] tracking-wide text-text-muted uppercase">Showing</span>
          <div className="w-full sm:w-[280px] [&>div>button]:h-[var(--geist-form-small-height)] [&>div>button]:text-[13px]">
            <Select size="small" value={effectiveRef ?? ""} options={options} onChange={(value) => update("ref", value === "" ? undefined : value)} />
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            <Button size="small" variant={compare ? "solid" : "ghost"} aria-pressed={compare} onClick={() => update("compare", compare ? undefined : "1")} className={compare ? undefined : "shadow-border"}>
              Compare with previous run
            </Button>
            <Button size="icon" variant="ghost" aria-label="Reload the results" title="Reload the results" onClick={() => void results.reload()}>
              <RefreshCw />
            </Button>
          </div>
        </div>
        {results.data === undefined ? null : <RefFacts results={results.data} />}
        {compare && results.data !== undefined && results.data.previous === undefined ? (
          <p className="text-[12px] text-text-muted">No earlier successful run of {stage} whose output is still in the document repo: nothing to compare with.</p>
        ) : null}
        {compare && results.data?.previous !== undefined ? (
          <p className="text-[12px] text-text-muted">
            Changes are against the run of {formatDateTime(results.data.previous.ref.date)} <span className="font-mono text-[11px]">{shortSha(results.data.previous.ref.commit)}</span>.
          </p>
        ) : null}
      </div>
      )}

      <Loaded loader={results} rows={6}>
        {(loaded) =>
          loaded.empty && ref === undefined && firstRun !== undefined ? (
            firstRun
          ) : loaded.empty ? (
            <Card>
              <EmptyState
                icon={PackageOpen}
                title={`No ${stage} output for ${application.name} at this ref`}
                description={
                  ref === undefined
                    ? (runBlocked ?? NEXT_ACTION[stage] ?? `Run ${stage} with the Run button above; its results appear here as soon as the run's output reaches the document repo.`)
                    : "Pick “Latest result” or another run above."
                }
                {...(ref === undefined ? {} : { action: <Button size="small" variant="ghost" className="shadow-border" onClick={() => update("ref", undefined)}>Show the latest result</Button> })}
              />
            </Card>
          ) : (
            <>
              <DocumentLinksProvider projectId={project.id} commit={loaded.ref.commit}>
                <StageView results={loaded} compare={compare} projectId={project.id} />
              </DocumentLinksProvider>
              <details className="group shadow-border rounded-xl bg-surface">
                <summary className="flex cursor-pointer list-none items-center gap-2 rounded-xl px-4 py-2.5 hover:bg-hover focus-visible:outline-none focus-visible:[box-shadow:var(--ds-focus-ring)] [&::-webkit-details-marker]:hidden">
                  <ChevronRight className="size-3.5 text-text-muted group-open:rotate-90" strokeWidth={1.75} />
                  <span className="text-[10px] tracking-wide text-text-muted uppercase">Output files</span>
                  <span className="text-[12px] text-text tabular-nums">{loaded.files.length}</span>
                  <span className="min-w-0 flex-1 truncate text-right text-[11.5px] text-text-muted" title={`At ${loaded.ref.branch ?? shortSha(loaded.ref.commit)} in ${project.documentRepository?.repositoryId ?? "the document repo"}`}>
                    {loaded.ref.branch ?? shortSha(loaded.ref.commit)} in {project.documentRepository?.repositoryId ?? "the document repo"}
                  </span>
                </summary>
                <div className="px-4 pt-1 pb-3">
                  <OutputFiles files={loaded.files} />
                </div>
              </details>
            </>
          )
        }
      </Loaded>
    </div>
  );
}

function RefFacts({ results }: { results: StageResults }): React.JSX.Element {
  const { ref } = results;
  const status = STATUS[ref.status];
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-text-secondary">
      <StatusBadge tone={status.tone} label={status.label} title={ref.status === "open" ? "The output is on a kintsugi/* branch that is not merged into the default branch yet." : undefined} />
      {ref.branch === undefined ? null : (
        <span className="flex min-w-0 items-center gap-1" title={ref.branch}>
          <GitBranch className="size-3.5 shrink-0 text-text-muted" strokeWidth={1.75} />
          <span className="max-w-[420px] truncate font-mono text-[11px]">{ref.branch}</span>
        </span>
      )}
      <span className="flex items-center gap-1">
        <GitCommitHorizontal className="size-3.5 text-text-muted" strokeWidth={1.75} />
        <span className="font-mono text-[11px]">{shortSha(ref.commit)}</span>
      </span>
      {ref.date === undefined ? null : <span title={formatDateTime(ref.date)}>{formatRelative(ref.date)}</span>}
    </div>
  );
}

function StageView({ results, compare, projectId }: { results: StageResults; compare: boolean; projectId: string }): React.JSX.Element {
  switch (results.stage) {
    case "assess":
      return <AssessResultsView results={results} compare={compare} />;
    case "map":
      return <MapResultsView results={results} compare={compare} />;
    case "extract-rules":
      return <RulesResultsView results={results} compare={compare} projectId={projectId} />;
    case "harden":
      return <HardenResultsView results={results} compare={compare} />;
    case "understand":
      return <UnderstandResultsView results={results} compare={compare} projectId={projectId} />;
    case "gaps":
      return <GapsResultsView projectId={projectId} results={results} />;
  }
}
