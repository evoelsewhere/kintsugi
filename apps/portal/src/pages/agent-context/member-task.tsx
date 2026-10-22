import type { MemberActivity } from "@kintsugi/domain";
import type { ReviewReport, TaskBrief, TaskSummary, TaskStatus } from "@kintsugi/harness-sdk";
import { AlertTriangle, ArrowUpRight, ClipboardCopy, FileText, GitPullRequest, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { agentContextApi } from "@/lib/api/agent-context";
import { projectsApi, type ProjectDetail } from "@/lib/api/projects";
import { useAuth } from "@/lib/auth";
import { errorText, formatDateTime } from "@/lib/format";
import { deliveryLink } from "@/lib/links";
import { MemberTokensPanel, ProjectAccessPanel } from "./member-tokens";
import { createTaskHandoffPrompt } from "./handoff";

const ACTIVITIES: { value: MemberActivity; label: string }[] = [
  { value: "design", label: "Design" },
  { value: "implementation", label: "Implementation" },
  { value: "verification", label: "Verification" },
];

function queryLabel(task: TaskSummary, activity: MemberActivity): string {
  const status = task.readiness.byActivity[activity];
  return status.ready ? `Ready for ${activity}` : `${status.blockers.length} blocker${status.blockers.length === 1 ? "" : "s"} for ${activity}`;
}

function reviewState(report: ReviewReport): string {
  if (report.currentness !== "current") return `Review ${report.currentness}`;
  return `Review ${report.verdict} · ${report.coverage} coverage`;
}

export function MemberTaskPage(): React.JSX.Element {
  const { projectId = "" } = useParams();
  return <MemberTaskContent key={projectId} projectId={projectId} />;
}

function MemberTaskContent({ projectId }: { projectId: string }): React.JSX.Element {
  const { can } = useAuth();
  const canRead = can("member.read");
  const canManageAccess = can("project.access.manage");
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [selected, setSelected] = useState<TaskSummary | null>(null);
  const [activity, setActivity] = useState<MemberActivity>("implementation");
  const [brief, setBrief] = useState<TaskBrief | null>(null);
  const [status, setStatus] = useState<TaskStatus | null>(null);
  const [reviews, setReviews] = useState<ReviewReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [briefLoading, setBriefLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [handoffCopied, setHandoffCopied] = useState(false);
  const handoffPrompt = useMemo(() => selected === null ? "" : createTaskHandoffPrompt(projectId, selected.unitId, activity), [projectId, selected, activity]);
  const loadGeneration = useRef(0);
  const briefGeneration = useRef(0);

  const load = useCallback(async (): Promise<void> => {
    const generation = ++loadGeneration.current;
    try {
      const detail = await projectsApi.get(projectId);
      if (generation !== loadGeneration.current) return;
      setProject(detail);
      if (canRead) {
        const result = await agentContextApi.tasks({ projectId, limit: 100, mine: true });
        if (generation !== loadGeneration.current) return;
        setTasks(result.items);
      } else {
        setTasks([]);
      }
      setError(null);
    } catch (failure) {
      if (generation === loadGeneration.current) setError(errorText(failure));
    } finally {
      if (generation === loadGeneration.current) setLoading(false);
    }
  }, [projectId, canRead]);

  // load() updates state only after its API request settles.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  async function openTask(task: TaskSummary, nextActivity: MemberActivity = activity): Promise<void> {
    const request = ++briefGeneration.current;
    setSelected(task);
    setActivity(nextActivity);
    setBrief(null);
    setStatus(null);
    setReviews([]);
    setBriefLoading(true);
    setError(null);
    try {
      const identity = { projectId, unitId: task.unitId };
      const [nextBrief, nextStatus] = await Promise.all([
        agentContextApi.brief({ ...identity, activity: nextActivity }),
        agentContextApi.status(identity),
      ]);
      if (request !== briefGeneration.current) return;
      setBrief(nextBrief);
      setStatus(nextStatus);
      if (nextStatus.currentReviewIds.length > 0) {
        const reports = await Promise.all(nextStatus.currentReviewIds.map((reviewId) => agentContextApi.review({ ...identity, reviewId }).catch(() => null)));
        if (request !== briefGeneration.current) return;
        setReviews(reports.filter((report): report is ReviewReport => report !== null));
      }
    } catch (failure) {
      if (request === briefGeneration.current) setError(errorText(failure));
    } finally {
      if (request === briefGeneration.current) setBriefLoading(false);
    }
  }

  async function copyHandoff(): Promise<void> {
    try {
      await navigator.clipboard.writeText(handoffPrompt);
      setHandoffCopied(true);
      window.setTimeout(() => setHandoffCopied(false), 1800);
    } catch {
      setError("Clipboard access is unavailable. Select and copy the handoff text manually.");
    }
  }

  if (loading && project === null) {
    return <div className="flex flex-col gap-5"><Breadcrumbs items={["Projects", { label: projectId, to: `/projects/${projectId}` }, "Coding Agent Workflow"]} /><p className="text-[13px] text-text-muted">Loading project context…</p></div>;
  }
  if (project === null) {
    return <div className="flex flex-col gap-5"><Breadcrumbs items={["Projects", { label: projectId, to: `/projects/${projectId}` }, "Coding Agent Workflow"]} /><p role="alert" className="text-[13px] text-[var(--ds-status-red)]">{error ?? "Project is unavailable."}</p></div>;
  }

  return (
    <div className="flex flex-col gap-5">
      <Breadcrumbs items={["Projects", { label: project.name, to: `/projects/${projectId}` }, "Coding Agent Workflow"]} />
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[18px] font-semibold text-text">Work in your AI</h1>
          <p className="mt-1 text-[13px] text-text-secondary">{project.name} · authorized task context, citations and PR evidence for your chosen coding agent.</p>
        </div>
        <div className="flex gap-2">
          <Link to={deliveryLink({ projectId })} className="inline-flex h-[var(--geist-form-small-height)] items-center gap-1.5 rounded-[var(--geist-radius)] px-3 text-[13px] text-text-secondary hover:bg-hover hover:text-text"><ArrowUpRight className="size-4" />Delivery</Link>
          <Button size="icon" variant="ghost" aria-label="Refresh Coding Agent Workflow" onClick={() => { setLoading(true); void load(); }}><RefreshCw className="size-4" /></Button>
        </div>
      </header>
      {error === null ? null : <p role="alert" className="text-[13px] text-[var(--ds-status-red)]">{error}</p>}

      <section aria-labelledby="tasks-heading" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div><h2 id="tasks-heading" className="text-[15px] font-medium text-text">Your tasks</h2><p className="mt-0.5 text-[12px] text-text-muted">This list reflects your stable identity assignment. Reading a task never claims or changes it.</p></div>
          <Field label="Activity" className="w-48"><Select value={activity} options={ACTIVITIES.map((item) => ({ value: item.value, label: item.label }))} onChange={(value) => { const next = value as MemberActivity; setActivity(next); if (selected !== null) void openTask(selected, next); }} /></Field>
        </div>
        {!canRead ? <EmptyState icon={AlertTriangle} title="Member read access is required" description="Your account needs member.read and an explicit Project Access grant to retrieve task context." /> : tasks.length === 0 ? <EmptyState icon={FileText} title={loading ? "Loading assigned tasks…" : "No assigned tasks"} description="When a task is assigned to your account, its readiness and task brief appear here." /> : (
          <ul className="flex flex-col shadow-border rounded-lg bg-surface px-3">
            {tasks.map((task, index) => {
              const selectedTask = selected?.unitId === task.unitId;
              return <li key={task.unitId} className={`flex flex-wrap items-center gap-3 py-2.5 ${index > 0 ? "[box-shadow:0_-1px_0_rgba(0,0,0,0.06)]" : ""}`}>
                <div className="min-w-0 flex-1"><p className="text-[13px] font-medium text-text">{task.title}</p><p className="mt-0.5 font-mono text-[11px] text-text-muted">{task.unitId}</p></div>
                <Badge>{task.phase} · {task.status}</Badge><Badge>{queryLabel(task, activity)}</Badge>
                <Button size="small" variant={selectedTask ? "solid" : "ghost"} onClick={() => void openTask(task)}>{selectedTask ? "Context open" : "Open context"}</Button>
              </li>;
            })}
          </ul>
        )}
      </section>

      {selected === null ? null : <section aria-labelledby="task-brief-heading" className="flex flex-col gap-3 shadow-border rounded-lg bg-surface p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><h2 id="task-brief-heading" className="text-[15px] font-medium text-text">{brief?.title ?? selected.title}</h2><p className="mt-0.5 font-mono text-[11px] text-text-muted">{selected.unitId} · {activity}</p></div>
          <Button variant="solid" onClick={() => void copyHandoff()} disabled={brief === null}>{handoffCopied ? "Copied handoff" : "Work in my AI"}<ClipboardCopy className="size-4" /></Button>
        </div>
        {briefLoading ? <p className="text-[12px] text-text-muted">Preparing cited task context…</p> : brief === null ? null : <>
          <div className="flex flex-wrap gap-2 text-[12px]">
            <Badge>{brief.readiness.byActivity[activity].ready ? "Ready" : "Blocked"} for {activity}</Badge>
            <Badge>{brief.requiredContextStatus === "complete" ? "Required context complete" : "Context has more sections"}</Badge>
            <Badge>{brief.freshness.isCurrent ? "Current snapshot" : "Newer context available"}</Badge>
          </div>
          <p className="whitespace-pre-wrap text-[13px] leading-5 text-text-secondary">{brief.objective}</p>
          {brief.blockers.length > 0 ? <div className="rounded-md bg-recessed p-3"><p className="text-[12px] font-medium text-text">Resolve these blockers before {activity}</p><ul className="mt-1 list-disc pl-5 text-[12px] leading-5 text-text-secondary">{brief.blockers.map((blocker, index) => <li key={`${blocker.code}-${blocker.sourceId ?? blocker.gateId ?? index}`}>{blocker.message}</li>)}</ul></div> : null}
          {brief.acceptanceCriteria.length > 0 ? <div><h3 className="text-[12px] font-medium text-text">Acceptance criteria</h3><ul className="mt-1 list-disc pl-5 text-[12px] leading-5 text-text-secondary">{brief.acceptanceCriteria.map((criterion) => <li key={criterion}>{criterion}</li>)}</ul></div> : null}
          <div className="flex flex-col gap-2">
            <h3 className="text-[12px] font-medium text-text">Cited context</h3>
            {brief.sections.map((section, index) => <article key={`${section.sourceId}-${section.sectionId}-${index}`} className="shadow-border rounded-md bg-background p-3">
              <h4 className="text-[12px] font-medium text-text">{section.title}</h4><p className="mt-1 whitespace-pre-wrap text-[12px] leading-5 text-text-secondary">{section.text}</p>
              <p className="mt-1 font-mono text-[10px] text-text-muted">{section.citation.path}{section.citation.startLine === undefined ? "" : `:${section.citation.startLine}`}{section.citation.endLine === undefined ? "" : `-${section.citation.endLine}`}</p>
            </article>)}
          </div>
          {brief.omittedSections.length > 0 || brief.nextCursor !== undefined ? <p className="text-[12px] text-text-muted">Some context is outside this preview. The MCP handoff tells your agent to retrieve every required section from snapshot <code>{brief.snapshotId}</code>.</p> : null}
          <p className="font-mono text-[10px] text-text-muted">Context {brief.contextRevision} · fetched {formatDateTime(brief.fetchedAt)}</p>
        </>}
        {status === null ? null : <div className="flex flex-col gap-2 border-t border-[var(--color-border)] pt-3">
          <div className="flex flex-wrap items-center gap-2"><GitPullRequest className="size-4 text-text-muted" /><h3 className="text-[12px] font-medium text-text">Observed pull requests</h3></div>
          {status.evidenceAvailability.pullRequests === "unavailable" ? <p className="text-[12px] text-text-muted">PR evidence is not configured for this task yet.</p> : status.pullRequests.length === 0 ? <p className="text-[12px] text-text-muted">No associated pull request is visible yet. Open your normal PR with the association values from the brief.</p> : <ul className="flex flex-col">{status.pullRequests.map((pr) => <li key={`${pr.repositoryId}-${pr.pullRequestId}`} className="flex flex-wrap gap-2 py-1.5 text-[12px]"><span className="font-mono text-text">{pr.repositoryId} · {pr.pullRequestId}</span><Badge>{pr.state}</Badge><span className="text-text-muted">{pr.headRevision.slice(0, 12)}</span></li>)}</ul>}
          {status.evidenceAvailability.reviews === "unavailable" ? <p className="text-[12px] text-text-muted">Review evidence is not configured for this task yet.</p> : status.currentReviewIds.length === 0 ? <p className="text-[12px] text-text-muted">No current review report is linked to this task.</p> : reviews.length === 0 ? <p className="text-[12px] text-text-muted">Current review findings could not be loaded. Refresh task status before acting on older findings.</p> : <div><h3 className="text-[12px] font-medium text-text">Current findings</h3>{reviews.map((report) => <div key={report.reviewId} className="mt-1"><p className="text-[11px] text-text-secondary">{reviewState(report)} · {report.reviewedHead.slice(0, 12)}</p>{report.findings.length === 0 ? <p className="mt-1 text-[12px] text-text-muted">No findings in this report.</p> : report.findings.map((finding) => <article key={finding.findingId} className="mt-1 rounded-md bg-recessed p-2.5"><p className="text-[12px] font-medium text-text">{finding.severity} · {finding.title} <span className="font-normal text-text-muted">({finding.currentness})</span></p><p className="mt-0.5 text-[12px] text-text-secondary">{finding.rationale}</p><p className="mt-1 font-mono text-[10px] text-text-muted">{finding.citation.path}:{finding.citation.startLine}</p><p className="mt-0.5 text-[12px] text-text-secondary">{finding.repairGuidance}</p></article>)}</div>)}</div>}
          <div><h3 className="text-[12px] font-medium text-text">Gate and next action</h3>{status.gates.length === 0 ? <p className="mt-1 text-[12px] text-text-muted">No gate state is currently available.</p> : <ul className="mt-1 flex flex-col">{status.gates.map((gate) => <li key={gate.gateId} className="flex flex-wrap gap-2 py-1 text-[12px]"><span className="font-mono text-text">{gate.gateId}</span><Badge>Decision: {gate.status}</Badge><Badge>Git record: {gate.publication}</Badge></li>)}</ul>}<p className="mt-1 text-[12px] text-text-secondary">{status.nextAction}</p><p className="text-[10px] text-text-muted">The governance list shows whether a publication is awaiting Git merge or effective.</p></div>
          {status.latestContinuation === undefined ? null : (
            <aside aria-label="Latest continuation guidance" className="rounded-md border border-[var(--color-border)] bg-recessed p-3">
              <div className="flex flex-wrap items-center gap-2"><h3 className="text-[12px] font-medium text-text">Continuation guidance</h3><Badge>{typeof status.latestContinuation.metadata.status === "string" ? status.latestContinuation.metadata.status : "recorded"}</Badge></div>
              {typeof status.latestContinuation.metadata.nextAction === "string" ? <p className="mt-1 text-[12px] text-text-secondary">{status.latestContinuation.metadata.nextAction}</p> : null}
              <p className="mt-1 text-[10px] text-text-muted tabular-nums">
                Recorded <time dateTime={status.latestContinuation.occurredAt}>{formatDateTime(status.latestContinuation.occurredAt)}</time>
                {typeof status.latestContinuation.metadata.code === "string" ? <> · <span className="font-mono">{status.latestContinuation.metadata.code}</span></> : null}
                {typeof status.latestContinuation.metadata.phase === "string" ? <> · <span className="font-mono">{status.latestContinuation.metadata.phase}</span></> : null}
                {typeof status.latestContinuation.metadata.stage === "string" ? <>/<span className="font-mono">{status.latestContinuation.metadata.stage}</span></> : null}
              </p>
              <p className="mt-1 text-[10px] text-text-muted">This durable event records guidance at that time. Refresh task context before acting; it does not approve a gate or start work.</p>
            </aside>
          )}
        </div>}
        {handoffPrompt.length > 0 ? <details className="text-[12px] text-text-muted"><summary className="cursor-pointer">Preview the handoff instructions</summary><textarea className="mt-2 min-h-32 w-full rounded-md bg-recessed p-2 font-mono text-[11px] leading-5 text-text focus-visible:outline-none focus-visible:[box-shadow:var(--ds-focus-ring)]" readOnly value={handoffPrompt} aria-label="Handoff instructions for the coding agent" /></details> : null}
      </section>}

      <section aria-label="Coding agent setup and access" className="shadow-border rounded-lg bg-surface p-4">
        <div className="grid gap-5 xl:grid-cols-2">
          <MemberTokensPanel projectId={projectId} canManage={can("tokens.manage-own")} canRead={canRead} />
          <ProjectAccessPanel projectId={projectId} canManage={canManageAccess} />
        </div>
      </section>
    </div>
  );
}
