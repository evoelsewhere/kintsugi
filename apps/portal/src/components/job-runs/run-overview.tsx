// The plain view of a run for the people who ask it for something rather than debug it: where it is
// (the step it is in, how many are done), what it has produced so far, whether it still moves, a
// pipeline of its steps with workers of the same kind folded into one row, and an activity feed in
// plain words. Everything technical (model turns, tokens, the raw log) stays in the technical view.

import { AlertTriangle, ChevronDown, ChevronRight, FileText, Search, Eye } from "lucide-react";
import { useMemo, useState } from "react";
import { StatusDot } from "@/components/ui/status-dot";
import { type JobRunDetail, type JobRunView, jobRunsApi } from "@/lib/api/job-runs";
import { formatDuration, formatRelative } from "@/lib/format";
import { isActiveStatus, RUN_STATUS, styleOf } from "@/lib/status";
import { useLoader } from "@/lib/use-loader";
import { cn } from "@/lib/utils";
import { describeGroup, feedGroups, humanize, isProblem, tidyPath, timelineOf, type StepStats } from "./run-events";
import { StepTimeline } from "./run-timeline";
import { RunUsage } from "./run-usage";
import type { JobRunEvent } from "@/lib/api/job-runs";

/** No tool call or report for this long while a run is active: worth a word to the person waiting. */
const QUIET_MS = 2 * 60 * 1000;
const FEED_ROWS = 12;

type Feed = "activity" | "written" | "problems";

export function RunOverview({
  run,
  events,
  stats,
  live,
  now,
  version,
  stepLabel,
  onInspect,
}: {
  run: JobRunDetail;
  events: readonly JobRunEvent[];
  stats: ReadonlyMap<string, StepStats>;
  live: boolean;
  now: number;
  version: string;
  stepLabel: (id: string | undefined) => string;
  onInspect: () => void;
}): React.JSX.Element {
  const active = isActiveStatus(run.status);
  const steps = run.steps;
  const finished = steps.filter((step) => step.status === "succeeded" || step.status === "failed" || step.status === "cancelled").length;
  const current = steps.find((step) => step.status === "running") ?? steps.find((step) => step.status === "queued");
  const sum = (tool: string): number => [...stats.values()].reduce((total, entry) => total + (entry.tools[tool] ?? 0), 0);
  const blocked = [...stats.values()].reduce((total, entry) => total + entry.blocked, 0);
  const problems = useMemo(() => events.filter(isProblem), [events]);
  const lastAt = [...stats.values()].reduce((latest, entry) => Math.max(latest, entry.lastAt === undefined ? 0 : Date.parse(entry.lastAt), entry.progress === undefined ? 0 : Date.parse(entry.progress.at)), 0);
  const quiet = active && live && lastAt > 0 && now - lastAt > QUIET_MS;

  return (
    <div className="flex flex-col gap-5 rounded-xl bg-recessed/60 p-4">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h4 className="text-[15px] font-semibold text-text">
            {active && current !== undefined
              ? `${humanize(current.name)}${steps.length > 1 ? ` · step ${steps.indexOf(current) + 1} of ${steps.length}` : ""}`
              : styleOf(RUN_STATUS, run.status).label}
          </h4>
          <span className="text-[12px] tabular-nums text-text-secondary">
            {run.startedAt === undefined ? "Waiting for the worker" : `${active ? "running for" : "took"} ${formatDuration(run.startedAt, run.finishedAt, now)}`}
          </span>
        </div>
        {/* Once two steps have started the timeline below says the same and more. */}
        {steps.length === 0 || timelineOf(steps, now).started >= 2 ? null : (
          <>
            <div className="flex gap-1" role="img" aria-label={`${finished} of ${steps.length} steps finished`}>
              {steps.map((step) => (
                <div key={step.id} className="flex min-w-0 flex-1 flex-col gap-1" title={`${humanize(step.name)} · ${styleOf(RUN_STATUS, step.status).label}`}>
                  <span className="relative h-2 overflow-hidden rounded-full bg-hover">
                    <span
                      className={cn("absolute inset-y-0 left-0 rounded-full transition-[width] duration-700", step.status === "running" && "run-bar-active")}
                      style={{ width: step.status === "queued" ? "0%" : "100%", backgroundColor: step.status === "queued" ? "transparent" : `var(--ds-status-${toneOf(step.status)})` }}
                    />
                  </span>
                  <span className={cn("flex items-baseline justify-between gap-2 text-[11px]", step.status === "running" ? "font-medium text-text" : "text-text-muted")}>
                    <span className="truncate">{humanize(step.name)}</span>
                    <span className="shrink-0 tabular-nums font-normal text-text-muted">{step.startedAt === undefined ? "" : formatDuration(step.startedAt, step.finishedAt, now)}</span>
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
        {run.scope === undefined || run.scope.items.length === 0 ? null : (
          <p className="text-[12px] text-text-muted">
            {run.scope.items.length} item{run.scope.items.length === 1 ? "" : "s"} in scope
          </p>
        )}
      </header>

      {quiet ? (
        <p className="flex items-center gap-2 rounded-[var(--geist-radius)] px-3 py-2 text-[12px] text-text shadow-border">
          <AlertTriangle className="size-3.5 shrink-0 text-[var(--ds-status-orange)]" strokeWidth={1.75} />
          No activity for {formatRelative(new Date(lastAt).toISOString(), now).replace(" ago", "")}. A long model turn can be quiet; the run stops itself if the provider stops answering.
        </p>
      ) : null}
      {blocked + problems.length === 0 ? null : (
        <p className="flex items-center gap-2 rounded-[var(--geist-radius)] px-3 py-2 text-[12px] text-[var(--ds-status-red)] shadow-border">
          <AlertTriangle className="size-3.5 shrink-0" strokeWidth={1.75} />
          {problems.length} problem{problems.length === 1 ? "" : "s"} so far{blocked > 0 ? `, ${blocked} blocked tool call${blocked === 1 ? "" : "s"}` : ""}. Show them in the activity below.
        </p>
      )}

      <dl className="grid grid-cols-3 gap-4">
        <Figure icon={Eye} label="Files read" value={sum("read")} />
        <Figure icon={Search} label="Searches" value={sum("grep") + sum("find")} />
        <Figure icon={FileText} label="Files written" value={sum("write") + sum("edit")} />
      </dl>

      <RunUsage run={run} />

      <section className="flex flex-col gap-2">
        <h5 className="text-[11px] font-medium tracking-wide text-text-muted uppercase">Steps</h5>
        <StepTimeline steps={steps} now={now} />
        {steps.length === 0 ? (
          <p className="text-[12px] text-text-muted">{active ? "Waiting for the first step…" : "No steps recorded."}</p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {steps.map((step) => (
              <Node key={step.id} step={step} projectId={run.projectId} stats={stats} now={now} version={version} depth={0} />
            ))}
          </ul>
        )}
      </section>

      <Activity events={events} stepLabel={stepLabel} now={now} live={live} />

      <button type="button" onClick={onInspect} className="w-fit text-[12px] text-text-secondary underline-offset-2 hover:text-text hover:underline focus-visible:outline-none focus-visible:[box-shadow:var(--ds-focus-ring)]">
        Model turns, tokens and the full log in the technical view
      </button>
    </div>
  );
}

const toneOf = (status: string): string => (status === "succeeded" ? "green" : status === "failed" ? "red" : status === "cancelled" ? "orange" : "blue");

function Figure({ icon: Icon, label, value }: { icon: typeof Eye; label: string; value: number }): React.JSX.Element {
  return (
    <div className="flex items-center gap-2.5">
      <Icon className="size-4 shrink-0 text-text-muted" strokeWidth={1.5} />
      <div className="min-w-0">
        <dd className="text-[18px] leading-6 font-semibold tracking-tight text-text tabular-nums">{value.toLocaleString()}</dd>
        <dt className="truncate text-[11px] text-text-muted">{label}</dt>
      </div>
    </div>
  );
}

/** What a step is doing right now, in words: its newest tool call. */
function nowDoing(stats: StepStats | undefined): string | undefined {
  if (stats?.last === undefined) return undefined;
  const [tool = "", ...rest] = stats.last.split(" ");
  return describeGroup({ key: "", stepRunId: undefined, tool, count: 1, target: tidyPath(rest.join(" ")), at: stats.lastAt ?? "", blocked: false });
}

function Row({ step, label, note, detail, depth, open, onToggle }: { step: JobRunView | undefined; label: string; note: string; detail?: string | undefined; depth: number; open?: boolean | undefined; onToggle?: (() => void) | undefined }): React.JSX.Element {
  const style = styleOf(RUN_STATUS, step?.status);
  const Chevron = open === true ? ChevronDown : ChevronRight;
  return (
    <div className="flex flex-col rounded-[var(--geist-radius)] hover:bg-hover" style={{ marginLeft: depth * 14 }}>
      <button
        type="button"
        onClick={onToggle}
        disabled={onToggle === undefined}
        aria-expanded={onToggle === undefined ? undefined : open}
        className="flex items-center gap-2 px-2 py-1.5 text-left focus-visible:outline-none focus-visible:[box-shadow:var(--ds-focus-ring)] disabled:cursor-default"
      >
        {onToggle === undefined ? <span className="size-3.5 shrink-0" aria-hidden /> : <Chevron className="size-3.5 shrink-0 text-text-muted" />}
        <StatusDot tone={style.tone} busy={step !== undefined && isActiveStatus(step.status) ? style.busy : undefined} className="size-2" />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-text">{label}</span>
        <span className="shrink-0 text-[11.5px] tabular-nums text-text-secondary">{note}</span>
      </button>
      {detail === undefined ? null : <p className="truncate pr-2 pb-1.5 pl-[2.1rem] text-[11.5px] text-text-muted">{detail}</p>}
      {step?.failureReason === undefined ? null : <p className="line-clamp-2 pr-2 pb-1.5 pl-[2.1rem] text-[11.5px] text-[var(--ds-status-red)]">{step.failureReason}</p>}
    </div>
  );
}

/** A step: its own row, and below it (when it holds steps of its own) the workers folded by name. */
function Node({ step, projectId, stats, now, version, depth }: { step: JobRunView; projectId: string; stats: ReadonlyMap<string, StepStats>; now: number; version: string; depth: number }): React.JSX.Element {
  const nested = step.kind === "workflow" || step.kind === "stage";
  const active = isActiveStatus(step.status);
  const [open, setOpen] = useState(active);
  const own = stats.get(step.id);
  const doing = active ? nowDoing(own) : undefined;
  const time = step.startedAt === undefined ? styleOf(RUN_STATUS, step.status).label : formatDuration(step.startedAt, step.finishedAt, now);
  return (
    <li>
      <Row
        step={step}
        label={humanize(step.name)}
        note={time}
        detail={doing === undefined ? undefined : `${doing}${own?.lastAt === undefined ? "" : ` · ${formatRelative(own.lastAt, now)}`}`}
        depth={depth}
        open={open}
        onToggle={nested ? () => setOpen(!open) : undefined}
      />
      {nested && open ? <Children stepId={step.id} projectId={projectId} stats={stats} now={now} version={`${version}/${step.status}`} depth={depth + 1} /> : null}
    </li>
  );
}

function Children({ stepId, projectId, stats, now, version, depth }: { stepId: string; projectId: string; stats: ReadonlyMap<string, StepStats>; now: number; version: string; depth: number }): React.JSX.Element | null {
  const children = useLoader(`overview/${projectId}/${stepId}/${version}`, () => jobRunsApi.get(projectId, stepId));
  const groups = useMemo(() => {
    const byName = new Map<string, JobRunView[]>();
    for (const child of children.data?.steps ?? []) byName.set(child.name, [...(byName.get(child.name) ?? []), child]);
    return [...byName.entries()];
  }, [children.data]);
  if (children.data === undefined) return null;
  if (groups.length === 0) return <p className="py-1 text-[12px] text-text-muted" style={{ marginLeft: depth * 14 + 8 }}>Nothing started yet.</p>;
  return (
    <ul className="flex flex-col gap-0.5 border-l border-black/10 dark:border-white/10" style={{ marginLeft: 12 }}>
      {groups.map(([name, members]) =>
        members.length === 1 ? (
          <Node key={members[0]!.id} step={members[0]!} projectId={projectId} stats={stats} now={now} version={version} depth={0} />
        ) : (
          <Workers key={name} name={name} members={members} projectId={projectId} stats={stats} now={now} version={version} />
        ),
      )}
    </ul>
  );
}

/** Several runs of the same agent: one row that says how many are done, and opens to each of them. */
function Workers({ name, members, projectId, stats, now, version }: { name: string; members: JobRunView[]; projectId: string; stats: ReadonlyMap<string, StepStats>; now: number; version: string }): React.JSX.Element {
  const running = members.filter((member) => isActiveStatus(member.status));
  const done = members.filter((member) => member.status === "succeeded").length;
  const failed = members.filter((member) => member.status === "failed").length;
  const [open, setOpen] = useState(false);
  const newest = running
    .map((member) => stats.get(member.id))
    .filter((entry): entry is StepStats => entry?.lastAt !== undefined)
    .sort((a, b) => Date.parse(b.lastAt!) - Date.parse(a.lastAt!))[0];
  const doing = nowDoing(newest);
  const status = failed > 0 ? "failed" : running.length > 0 ? "running" : "succeeded";
  const pseudo = { ...members[0]!, status: status as JobRunView["status"], failureReason: undefined };
  return (
    <li>
      <Row
        step={pseudo}
        label={`${humanize(name)} ×${members.length}`}
        note={`${done} done${running.length > 0 ? ` · ${running.length} working` : ""}${failed > 0 ? ` · ${failed} failed` : ""}`}
        detail={doing === undefined ? undefined : `${doing}${newest?.lastAt === undefined ? "" : ` · ${formatRelative(newest.lastAt, now)}`}`}
        depth={0}
        open={open}
        onToggle={() => setOpen(!open)}
      />
      {open ? (
        <ul className="flex flex-col gap-0.5 border-l border-black/10 dark:border-white/10" style={{ marginLeft: 12 }}>
          {members.map((member, index) => (
            <Node key={member.id} step={{ ...member, name: `${member.name} ${index + 1}` }} projectId={projectId} stats={stats} now={now} version={version} depth={0} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/** The newest things the run did, in words, with a switch to the files it wrote or to its problems. */
function Activity({ events, stepLabel, now, live }: { events: readonly JobRunEvent[]; stepLabel: (id: string | undefined) => string; now: number; live: boolean }): React.JSX.Element {
  const [feed, setFeed] = useState<Feed>("activity");
  const rows = useMemo(() => {
    if (feed === "problems") {
      return events
        .filter(isProblem)
        .slice(-FEED_ROWS)
        .reverse()
        .map((event) => ({ key: event.id, text: tidyPath(event.message), who: stepLabel(event.stepRunId), at: event.at, problem: true }));
    }
    const groups = feedGroups(events).filter((group) => feed === "activity" || group.tool === "write" || group.tool === "edit");
    return groups
      .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
      .slice(0, FEED_ROWS)
      .map((group) => ({ key: group.key, text: describeGroup(group), who: stepLabel(group.stepRunId), at: group.at, problem: group.blocked }));
  }, [events, feed, stepLabel]);
  const tabs: Array<{ id: Feed; label: string }> = [
    { id: "activity", label: "Activity" },
    { id: "written", label: "Files written" },
    { id: "problems", label: "Problems" },
  ];
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <h5 className="flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-text-muted uppercase">
          {live ? <StatusDot tone="blue" className="size-2 animate-pulse" /> : null}
          {live ? "Happening now" : "What happened"}
        </h5>
        <div className="ml-auto flex gap-1" role="group" aria-label="What to show">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              aria-pressed={feed === tab.id}
              onClick={() => setFeed(tab.id)}
              className={cn(
                "h-6 rounded-[var(--geist-pill-radius)] px-2.5 text-[11.5px] shadow-border focus-visible:outline-none focus-visible:[box-shadow:var(--ds-focus-ring)]",
                feed === tab.id ? "bg-hover font-medium text-text" : "text-text-muted hover:bg-hover hover:text-text-secondary",
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="py-2 text-[12px] text-text-muted">{feed === "problems" ? "No problems." : feed === "written" ? "Nothing written yet." : live ? "Waiting for the first action…" : "No activity recorded."}</p>
      ) : (
        <ul className="flex flex-col">
          {rows.map((row) => (
            <li key={row.key} className="flex items-baseline gap-3 rounded-[var(--geist-radius)] px-2 py-1 text-[12.5px] hover:bg-hover">
              <span className={cn("min-w-0 flex-1 truncate", row.problem ? "text-[var(--ds-status-red)]" : "text-text")} title={row.text}>
                {row.text}
              </span>
              <span className="hidden max-w-40 shrink-0 truncate text-[11px] text-text-muted sm:block" title={row.who}>
                {humanize(row.who)}
              </span>
              <span className="w-24 shrink-0 whitespace-nowrap text-right text-[11px] tabular-nums text-text-muted">{formatRelative(row.at, now)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
