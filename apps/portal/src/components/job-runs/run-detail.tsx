// One run workspace. The URL keeps the selected tab, attempt and step shareable.
import { AlertCircle, ChevronDown, ChevronRight, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Loaded } from "@/components/loaded";
import { RunStatusBadge } from "@/components/status-badges";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { Tabs } from "@/components/ui/tabs";
import { jobRunsApi, type JobRunDetail, type JobRunView } from "@/lib/api/job-runs";
import { formatDuration } from "@/lib/format";
import { isActiveStatus } from "@/lib/status";
import { useLoader } from "@/lib/use-loader";
import { useNow } from "@/lib/use-now";
import { RunActions, type RunActionProps } from "./run-actions";
import { RunAttempts } from "./run-attempts";
import { humanize, isProblem, logLine, statsByStep, useRunEvents, withDescendants } from "./run-events";
import { RunLog } from "./run-log";
import { type ConsoleFilter, eventStepLabels, filterRunEvents, stepsForAttempt } from "./run-model";
import { RunOutput } from "./run-output";
import { RunOverview } from "./run-overview";
import { StepList, type StepsContext } from "./run-steps";

type RunTab = "summary" | "console" | "output" | "attempts";
interface Props extends RunActionProps {
  projectId: string;
  runId: string;
  version: string;
}

export function RunDetail({ projectId, runId, version, ...actions }: Props): React.JSX.Element {
  const detail = useLoader(`run-workspace/${projectId}/${runId}`, () => jobRunsApi.get(projectId, runId));
  const reload = detail.reload;
  useEffect(() => {
    void reload();
  }, [version, reload]);
  return (
    <Loaded loader={detail} rows={8}>
      {(run) => <RunWorkspace key={`${run.id}/${run.attempt}`} run={run} reload={reload} {...actions} />}
    </Loaded>
  );
}

function RunWorkspace({
  run,
  reload,
  scopeNoun = "item",
  ...actions
}: RunActionProps & { run: JobRunDetail; reload: () => Promise<void> }): React.JSX.Element {
  const [params, setParams] = useSearchParams();
  const value = params.get("runView");
  const tab: RunTab = value === "console" || value === "output" || value === "attempts" ? value : "summary";
  const requestedAttempt = Number(params.get("runAttempt"));
  const attempt =
    requestedAttempt > 0 && (requestedAttempt === run.attempt || run.attempts?.some((entry) => entry.n === requestedAttempt))
      ? requestedAttempt
      : run.attempt;
  const selected = params.get("runStep") ?? undefined;
  const [stepRevision, setStepRevision] = useState(0);
  const [stepsOpen, setStepsOpen] = useState(false);
  const [filter, setFilter] = useState<ConsoleFilter>("activity");
  const [children, setChildren] = useState<Record<string, JobRunView[]>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const externalChanged = actions.onChanged;
  const changed = useCallback(() => {
    void reload();
    externalChanged();
  }, [reload, externalChanged]);
  const stepsChanged = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setStepRevision((current) => current + 1);
      void reload();
    }, 500);
  }, [reload]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const active = isActiveStatus(run.status);
  const now = useNow(active);
  const steps = stepsForAttempt(run, attempt);
  const onChildren = useCallback(
    (id: string, entries: JobRunView[]) =>
      setChildren((previous) => {
        if (JSON.stringify(previous[id]) === JSON.stringify(entries)) return previous;
        return { ...previous, [id]: entries };
      }),
    [],
  );
  const apiLabels = useMemo(() => {
    const result = new Map<string, string>();
    for (const siblings of [stepsForAttempt(run, attempt), ...Object.values(children)]) {
      const seen = new Map<string, number>();
      for (const step of siblings) {
        const n = (seen.get(step.name) ?? 0) + 1;
        seen.set(step.name, n);
        const suffix = siblings.filter((candidate) => candidate.name === step.name).length > 1 ? ` #${n}` : "";
        result.set(step.id, humanize(step.name) + suffix);
      }
    }
    return result;
  }, [run, attempt, children]);
  const childrenIds = useMemo(
    () => Object.fromEntries(Object.entries(children).map(([id, entries]) => [id, entries.map((entry) => entry.id)])),
    [children],
  );
  const selectedIds = useMemo(() => (selected === undefined ? undefined : withDescendants(selected, childrenIds)), [selected, childrenIds]);
  const { events, live, connection, received } = useRunEvents(run.projectId, run.id, {
    onStatus: changed,
    onStep: stepsChanged,
    attempt: tab === "console" ? attempt : run.attempt,
    ...(tab === "console" && selectedIds !== undefined ? { stepIds: selectedIds } : {}),
  });
  const labels = useMemo(() => {
    const result = eventStepLabels(events);
    for (const [id, label] of apiLabels) result.set(id, label);
    return result;
  }, [apiLabels, events]);
  const stepLabel = useCallback(
    (id: string | undefined) => (id === undefined ? "Run" : (labels.get(id) ?? `Step ${id.slice(0, 8)}`)),
    [labels],
  );
  const attemptEvents = useMemo(
    () => filterRunEvents(events, { filter: "all", query: "", tool: "", attempt }, stepLabel),
    [events, attempt, stepLabel],
  );
  const currentEvents = useMemo(
    () => filterRunEvents(events, { filter: "all", query: "", tool: "", attempt: run.attempt }, stepLabel),
    [events, run.attempt, stepLabel],
  );
  const stats = useMemo(() => statsByStep(attemptEvents), [attemptEvents]);
  const problems = attemptEvents.filter(isProblem).length;
  const update = (patch: Record<string, string | undefined>): void =>
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        for (const [key, entry] of Object.entries(patch)) {
          if (entry === undefined) next.delete(key);
          else next.set(key, entry);
        }
        return next;
      },
      { replace: true },
    );
  const inspect = (id?: string): void => {
    setFilter("activity");
    update({ runView: "console", runStep: id });
  };
  const context: StepsContext = {
    projectId: run.projectId,
    now,
    stats,
    selected,
    onSelect: (id) => {
      update({ runStep: id });
      setStepsOpen(false);
    },
    onChildren,
    version: `${run.attempt}/${run.status}/${stepRevision}/${steps.map((step) => step.status).join(",")}`,
  };
  const working = [...stats.entries()].flatMap(([id, entry]) =>
    id !== "" && !entry.finished && entry.progress !== undefined && (selectedIds === undefined || selectedIds.has(id))
      ? [{ id, label: stepLabel(id), progress: entry.progress, lastToolAt: entry.lastAt }]
      : [],
  );
  const diagnostics = [
    `Run ${run.id} · ${run.name} · ${run.status} · attempt ${attempt}`,
    ...(run.failureReason === undefined ? [] : [run.failureReason]),
    ...attemptEvents.map((event) => logLine(event, stepLabel(event.stepRunId))),
  ].join("\n");
  const attempts = [...new Set([run.attempt, ...(run.attempts ?? []).map((entry) => entry.n)])].sort((a, b) => b - a);
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <header className="flex flex-wrap items-center justify-between gap-4 rounded-xl bg-recessed/40 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <RunStatusBadge status={run.status} cancelling={run.cancelRequestedAt !== undefined && active} />
          <span className="text-[13px] text-text-secondary">
            Attempt {run.attempt} · {formatDuration(run.startedAt, run.finishedAt, now)}
          </span>
          <CopyButton value={run.id} label="Copy run ID" iconOnly />
          <Button size="icon" title="Refresh run" aria-label="Refresh run" onClick={() => void reload()}>
            <RefreshCw />
          </Button>
        </div>
        <RunActions run={run} scopeNoun={scopeNoun} {...actions} onChanged={changed} />
      </header>
      {run.failureReason === undefined ? null : (
        <section role="alert" className="rounded-xl bg-surface p-4 shadow-border">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 size-4 shrink-0 text-text-secondary" />
            <div className="min-w-0 flex-1">
              <h2 className="text-[14px] font-medium text-text">Run failed</h2>
              <p className="mt-2 whitespace-pre-wrap break-words text-[13px] leading-6 text-text-secondary">{run.failureReason}</p>
              <Button
                size="small"
                className="mt-2 shadow-border"
                onClick={() => {
                  setFilter("problems");
                  update({ runView: "console", runStep: undefined, runAttempt: undefined });
                }}
              >
                Inspect problems
              </Button>
            </div>
          </div>
        </section>
      )}
      <Tabs
        scrollable
        label="Run details"
        value={tab}
        onChange={(next) => update({ runView: next })}
        tabs={[
          { id: "summary", label: "Summary" },
          { id: "console", label: "Console" },
          { id: "output", label: "Output", count: run.artifacts.length },
          { id: "attempts", label: "Attempts", count: run.attempt },
        ]}
      />
      {tab === "summary" ? (
        <RunOverview
          run={run}
          events={currentEvents}
          now={now}
          scopeNoun={scopeNoun}
          onInspectStep={(id) => {
            update({ runAttempt: undefined, runStep: id, runView: "console" });
            setFilter("activity");
          }}
          onConsole={() => inspect()}
        />
      ) : null}
      <div hidden={tab !== "console"}>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-[13px] text-text-secondary">
              Attempt
              <select
                aria-label="Console attempt"
                className="h-8 rounded-md bg-surface px-3 text-[13px] text-text shadow-border"
                value={attempt}
                onChange={(event) => {
                  setFilter("activity");
                  update({ runAttempt: event.target.value, runStep: undefined });
                }}
              >
                {attempts.map((n) => (
                  <option key={n} value={n}>
                    Attempt {n}
                    {n === run.attempt ? " · latest" : ""}
                  </option>
                ))}
              </select>
            </label>
            <span className="text-[12px] text-text-secondary">
              {attempt === run.attempt && active ? "Live execution" : "Recorded execution"} · {steps.length} steps · {problems} problems in
              loaded events
            </span>
          </div>
          <CopyButton value={diagnostics} label="Copy diagnostics" />
        </div>
        <div className="grid min-w-0 items-start gap-4 xl:grid-cols-[290px_minmax(0,1fr)]">
          <aside className="min-w-0 rounded-xl bg-recessed/40 p-3">
            <div className="mb-3 flex items-center justify-between px-2">
              <h2 className="hidden text-[13px] font-medium text-text xl:block">Steps</h2>
              <button
                type="button"
                aria-expanded={stepsOpen}
                onClick={() => setStepsOpen(!stepsOpen)}
                className="flex items-center gap-2 rounded-md text-[13px] font-medium text-text xl:hidden"
              >
                {stepsOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}Steps · {steps.length}
              </button>
              <button
                type="button"
                aria-pressed={selected === undefined}
                onClick={() => update({ runStep: undefined })}
                className="rounded-md px-2 py-1 text-[12px] text-accent hover:bg-hover"
              >
                All steps
              </button>
            </div>
            <p className="mb-3 hidden px-2 text-[12px] text-text-secondary xl:block">Select a step to filter its events.</p>
            <div className={`${stepsOpen ? "block" : "hidden"} max-h-64 overflow-y-auto xl:block xl:max-h-[650px]`}>
              {steps.length === 0 ? (
                <p className="px-2 py-6 text-[13px] text-text-secondary">No steps recorded for this attempt.</p>
              ) : (
                <StepList steps={steps} context={context} />
              )}
            </div>
          </aside>
          <RunLog
            key={`${run.id}/${attempt}`}
            visible={tab === "console"}
            events={attemptEvents}
            live={active && live && attempt === run.attempt}
            connection={connection}
            received={received}
            runStart={Date.parse(run.attempts?.find((entry) => entry.n === attempt)?.startedAt ?? run.startedAt ?? run.createdAt)}
            stepLabel={stepLabel}
            stepIds={selectedIds}
            stepName={selected === undefined ? undefined : stepLabel(selected)}
            onClearStep={() => update({ runStep: undefined })}
            working={active && attempt === run.attempt ? working : []}
            now={now}
            filter={filter}
            onFilter={setFilter}
          />
        </div>
      </div>
      {tab === "output" ? <RunOutput run={run} /> : null}
      {tab === "attempts" ? (
        <RunAttempts
          run={run}
          onConsole={(n) => {
            setFilter("activity");
            update({ runView: "console", runAttempt: String(n), runStep: undefined });
          }}
        />
      ) : null}
    </div>
  );
}
