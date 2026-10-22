// The runs of a stage that works on a selection (understand: catalog items, design: units): each run
// with its scope, status and pull request, Retry for a failed one and Abandon for a pull request that was
// closed without merging (which releases its items), then the steps and live logs of the runs.

import { Play, RotateCcw, Undo2 } from "lucide-react";
import { useState } from "react";
import { JobRunList } from "@/components/job-runs/job-run-list";
import { Loaded } from "@/components/loaded";
import { RunStatusBadge, StatusBadge } from "@/components/status-badges";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { type JobRunView, jobRunsApi } from "@/lib/api/job-runs";
import type { ProjectDetail } from "@/lib/api/projects";
import { formatRelative } from "@/lib/format";
import { stageLabel } from "@/lib/stages";
import type { Loader } from "@/lib/use-loader";

export interface ScopedRunsLabels {
  title: string;
  description: string;
  emptyTitle: string;
  emptyDescription: string;
  /** What a run's scope holds, singular: "item" or "unit". */
  noun: string;
  /** The stage the panel is about; runs of the stages that go with it (planning, rebuild) are labelled with theirs. */
  stage?: string;
}

interface ScopedRunsPanelProps {
  project: ProjectDetail;
  runs: JobRunView[] | undefined;
  loader: Loader<JobRunView[]>;
  canRun: boolean;
  initialRun: string | undefined;
  labels: ScopedRunsLabels;
  onChanged(): Promise<void>;
  onStarted(run: JobRunView): void;
}

export function ScopedRunsPanel({ project, runs, loader, canRun, initialRun, labels, onChanged, onStarted }: ScopedRunsPanelProps): React.JSX.Element {
  const toast = useToast();
  const [abandoning, setAbandoning] = useState<JobRunView | null>(null);

  async function retry(run: JobRunView, options: { fresh?: boolean } = {}): Promise<void> {
    try {
      const next = await jobRunsApi.retry(project.id, run.id, options);
      toast.success(`Attempt ${next.attempt} queued`, options.fresh === true ? "It begins from nothing; the pinned commits stay." : "It skips the steps whose inputs did not change and runs the rest.");
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
            <CardTitle>{labels.title}</CardTitle>
            <CardDescription>{labels.description}</CardDescription>
          </div>
        </CardHeader>
        <div className="mt-2">
          <Loaded loader={loader} rows={3}>
            {() =>
              runs === undefined || runs.length === 0 ? (
                <EmptyState icon={Play} title={labels.emptyTitle} description={labels.emptyDescription} />
              ) : (
                <ul className="flex flex-col">
                  {runs.map((run, index) => {
                    const items = run.scope?.items ?? [];
                    const openPr = run.status === "succeeded" && run.documentWrite?.status === "pr-opened" && run.abandonedAt === undefined;
                    return (
                      <li key={run.id} className={index > 0 ? "[box-shadow:0_-1px_0_rgba(0,0,0,0.06)] py-2.5" : "py-2.5"}>
                        <div className="flex flex-wrap items-center gap-2">
                          <RunStatusBadge status={run.status} />
                          {labels.stage === undefined || run.name === labels.stage ? null : <StatusBadge tone="muted" label={stageLabel(run.name)} />}
                          {run.abandonedAt === undefined ? null : <StatusBadge tone="muted" label="Abandoned" />}
                          {run.scope?.set === undefined ? null : <span className="rounded-full bg-hover px-2 py-0.5 font-mono text-[11px] text-text-secondary">{run.scope.set}</span>}
                          {run.attempt > 1 ? <span className="text-[11px] text-text-muted">attempt {run.attempt}</span> : null}
                          <span className="font-mono text-[11px] text-text-muted">{run.id.slice(0, 8)}</span>
                          <span className="text-[12px] text-text-muted">
                            {formatRelative(run.createdAt)}
                            {run.actor === undefined ? "" : ` · ${run.actor}`}
                          </span>
                          {run.documentWrite?.prUrl === undefined ? null : (
                            <a className="text-[12px] underline" href={run.documentWrite.prUrl} target="_blank" rel="noreferrer">
                              Pull request
                            </a>
                          )}
                          <div className="ml-auto flex items-center gap-2">
                            {canRun && run.status === "failed" ? (
                              <>
                                <Button size="small" variant="ghost" className="shadow-border" onClick={() => void retry(run)}>
                                  <RotateCcw className="size-3.5" />
                                  Retry
                                </Button>
                                <Button size="small" variant="ghost" title="Discard what the job kept and begin again from the same commits" onClick={() => void retry(run, { fresh: true })}>
                                  From scratch
                                </Button>
                              </>
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
          toast.success("Pull request abandoned", `Its ${labels.noun}s can be selected again.`);
          await onChanged();
        }}
        onClose={() => setAbandoning(null)}
      >
        <p>
          Do this when the pull request was closed without merging: its {abandoning?.scope?.items.length ?? 0} {labels.noun}(s) are released and can be selected again.
        </p>
      </ConfirmDialog>
    </>
  );
}
