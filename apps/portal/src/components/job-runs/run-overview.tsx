import { ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { JobRunDetail, JobRunEvent } from "@/lib/api/job-runs";
import { formatDateTime, formatDuration } from "@/lib/format";
import { RunDesignLoop } from "./run-design-loop";
import { humanize, statsByStep, stuckReason } from "./run-events";
import { describeStepCounts, stepCounts, stepsForAttempt } from "./run-model";
import { PossiblyStuck, StepTimeline } from "./run-timeline";
import { RunUsage } from "./run-usage";

function Fact({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="min-w-0">
      <dt className="text-[12px] text-text-secondary">{label}</dt>
      <dd className="mt-1 break-words text-[13px] text-text">{children}</dd>
    </div>
  );
}

export function RunOverview({
  run,
  events,
  now,
  scopeNoun,
  onInspectStep,
  onConsole,
}: {
  run: JobRunDetail;
  events: readonly JobRunEvent[];
  now: number;
  scopeNoun: string;
  onInspectStep: (id: string) => void;
  onConsole: () => void;
}): React.JSX.Element {
  const steps = stepsForAttempt(run, run.attempt);
  const counts = describeStepCounts(stepCounts(run, steps, events), run);
  const current = steps.filter((step) => step.status === "running");
  const stats = statsByStep(events);
  // A running step that repeats one call or sits in one model turn for long is flagged, from its events alone.
  const stuck = new Map(
    current.flatMap((step) => {
      const reason = stuckReason(stats.get(step.id), now);
      return reason === undefined ? [] : [[step.id, reason] as const];
    }),
  );
  const activity = events
    .filter((event) => event.kind === "status" || event.kind === "step.started" || event.kind === "step.finished")
    .slice(-6)
    .reverse();
  return (
    <div className="flex flex-col gap-5">
      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          {
            label: "Duration",
            value: formatDuration(run.startedAt, run.finishedAt, now),
            hint: run.startedAt === undefined ? "Waiting for worker" : run.finishedAt === undefined ? "Elapsed time" : "Finished",
          },
          { label: "Steps finished", value: counts.value, hint: counts.hint },
          {
            label: "Scope",
            value: run.scope === undefined ? "All" : String(run.scope.items.length),
            hint:
              run.scope === undefined ? "Whole application" : `${scopeNoun}s${run.scope.set === undefined ? "" : ` · ${run.scope.set}`}`,
          },
          { label: "Output", value: String(run.artifacts.length), hint: "Files in the document repository" },
        ].map((metric) => (
          <div key={metric.label} className="rounded-xl bg-recessed/50 p-4">
            <dt className="text-[12px] text-text-secondary">{metric.label}</dt>
            <dd className="mt-2 text-[24px] font-medium tracking-tight text-text tabular-nums">{metric.value}</dd>
            <p className="mt-1 text-[12px] text-text-secondary">{metric.hint}</p>
          </div>
        ))}
      </dl>
      {current.length === 0 ? null : (
        <div className="rounded-lg bg-recessed/50 px-4 py-3 text-[13px] text-text">
          <p>Working on {current.map((step) => humanize(step.name)).join(", ")}</p>
          {[...stuck.entries()].map(([id, reason]) => (
            <p key={id} className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-text-secondary">
              <PossiblyStuck reason={reason} />
              {humanize(current.find((step) => step.id === id)?.name ?? "")}: {reason}
            </p>
          ))}
        </div>
      )}
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(250px,1fr)]">
        <section className="min-w-0 rounded-xl bg-surface p-4 shadow-border sm:p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-[14px] font-medium text-text">Execution steps</h2>
              <p className="mt-1 text-[12px] text-text-secondary">Select a step to inspect its console.</p>
            </div>
            <Button size="small" onClick={onConsole}>
              Console <ArrowUpRight />
            </Button>
          </div>
          {steps.length === 0 ? (
            <p className="py-8 text-center text-[13px] text-text-secondary">No steps recorded in this attempt yet.</p>
          ) : (
            <StepTimeline steps={steps} now={now} stuck={stuck} onSelect={onInspectStep} />
          )}
        </section>
        <section className="rounded-xl bg-recessed/40 p-4 sm:p-5">
          <h2 className="mb-4 text-[14px] font-medium text-text">Run information</h2>
          <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
            <Fact label="Started by">{run.actor ?? "System"}</Fact>
            <Fact label="Created">{formatDateTime(run.createdAt)}</Fact>
            <Fact label="Started">{run.startedAt === undefined ? "Not started" : formatDateTime(run.startedAt)}</Fact>
            <Fact label="Finished">{run.finishedAt === undefined ? "Not finished" : formatDateTime(run.finishedAt)}</Fact>
            <Fact label="Project / application">
              {run.projectId}
              {run.applicationId === undefined ? "" : ` / ${run.applicationId}`}
            </Fact>
          </dl>
        </section>
      </div>
      <RunDesignLoop run={run} />
      <RunUsage run={{ ...run, steps }} />
      {run.scope === undefined ? null : (
        <section className="rounded-xl bg-recessed/40 p-4 sm:p-5">
          <h2 className="text-[14px] font-medium text-text">
            Scope · {run.scope.items.length} {scopeNoun}s
          </h2>
          {run.scope.set === undefined ? null : <p className="mt-1 text-[13px] text-text-secondary">Design set: {run.scope.set}</p>}
          <ul className="mt-3 grid max-h-64 gap-2 overflow-y-auto sm:grid-cols-2" aria-label="Run scope">
            {run.scope.items.map((item) => (
              <li key={item} className="min-w-0 rounded-md bg-surface px-3 py-2 font-mono text-[12px] break-all text-text-secondary">
                {item}
              </li>
            ))}
          </ul>
        </section>
      )}
      {run.sources === undefined ? null : (
        <section className="rounded-xl bg-recessed/40 p-4 sm:p-5">
          <h2 className="text-[14px] font-medium text-text">Pinned sources</h2>
          <ul className="mt-3 flex flex-col gap-2">
            {run.sources.map((source) => (
              <li key={source.repositoryId} className="flex flex-wrap items-center justify-between gap-2 text-[13px]">
                <span className="text-text">
                  {source.repositoryId}
                  <span className="ml-2 text-[12px] text-text-secondary">{source.role ?? "source"}</span>
                </span>
                <code className="break-all text-[12px] text-text-secondary">{source.commit ?? "No commit recorded"}</code>
              </li>
            ))}
          </ul>
        </section>
      )}
      {activity.length === 0 ? null : (
        <section className="rounded-xl bg-surface p-4 shadow-border sm:p-5">
          <h2 className="mb-3 text-[14px] font-medium text-text">Recent events</h2>
          <ul className="flex flex-col gap-3">
            {activity.map((event) => (
              <li key={event.id} className="flex items-start justify-between gap-4 text-[12px]">
                <p className="min-w-0 whitespace-pre-wrap break-words text-text-secondary">{event.message}</p>
                <time className="shrink-0 tabular-nums text-text-muted" dateTime={event.at}>
                  {new Date(event.at).toLocaleTimeString()}
                </time>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
