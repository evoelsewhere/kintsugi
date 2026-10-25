// Shared run history. A row opens a full run workspace; returning restores the list and filters.
import { ArrowUpRight, Clock3 } from "lucide-react";
import { useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { DetailPage } from "@/components/detail-page";
import { RunStatusBadge, WriteStatusBadge } from "@/components/status-badges";
import type { JobRunView } from "@/lib/api/job-runs";
import { isActive } from "@/lib/api/job-runs";
import { formatDateTime, formatDuration, formatRelative } from "@/lib/format";
import { useNow } from "@/lib/use-now";
import { RunDetail } from "./run-detail";
import type { RunActionProps } from "./run-actions";
import { runLabel } from "./run-model";

export interface JobRunListProps extends RunActionProps {
  runs: JobRunView[];
  projectId?: string;
  showProject?: boolean;
  initialOpen?: string | undefined;
}

function RunTime({ run }: { run: JobRunView }): React.JSX.Element {
  const now = useNow(isActive(run));
  return (
    <span className="tabular-nums">{run.startedAt === undefined ? "Waiting" : formatDuration(run.startedAt, run.finishedAt, now)}</span>
  );
}

const columns = "xl:grid-cols-[minmax(190px,1.5fr)_minmax(140px,1.1fr)_135px_120px_90px_24px]";

export function JobRunList({
  runs,
  initialOpen,
  projectId,
  showProject = false,
  scopeNoun = "item",
  ...actions
}: JobRunListProps): React.JSX.Element {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const trigger = useRef<HTMLButtonElement | null>(null);
  const scroll = useRef(0);
  const openId = params.get("run") ?? initialOpen;
  const opened = runs.find((run) => run.id === openId);
  const owner = opened?.projectId ?? params.get("runProject") ?? projectId ?? runs[0]?.projectId;
  const select = (id: string | undefined): void =>
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        if (id === undefined) {
          next.delete("run");
          next.delete("runProject");
        } else {
          next.set("run", id);
          const owner = runs.find((run) => run.id === id)?.projectId ?? projectId ?? previous.get("runProject");
          if (owner) next.set("runProject", owner);
        }
        next.delete("runView");
        next.delete("runStep");
        next.delete("runAttempt");
        return next;
      },
      { replace: id === undefined || openId !== undefined },
    );
  useEffect(() => {
    if (openId !== undefined || trigger.current === null) return;
    const frame = requestAnimationFrame(() => {
      trigger.current?.focus({ preventScroll: true });
      window.scrollTo(0, scroll.current);
    });
    return () => cancelAnimationFrame(frame);
  }, [openId]);
  return (
    <>
      {runs.length === 0 ? null : (
        <>
          <div className={`hidden grid-cols-2 gap-4 px-4 py-2 text-[11px] font-medium text-text-muted xl:grid ${columns}`} aria-hidden>
            <span>Run</span>
            <span>{showProject ? "Project / application" : "Scope"}</span>
            <span>Status / output</span>
            <span>Latest attempt</span>
            <span>Duration</span>
            <span />
          </div>
          <ul aria-label="Run history" className="flex flex-col gap-1">
            {runs.map((run) => {
              const items = run.scope?.items ?? [];
              const context = showProject
                ? run.projectId
                : run.scope?.set === undefined
                  ? items.length > 0
                    ? `${items.length} ${scopeNoun}${items.length === 1 ? "" : "s"}`
                    : "Application"
                  : `${run.scope.set} · ${items.length} ${scopeNoun}${items.length === 1 ? "" : "s"}`;
              const subcontext = showProject
                ? run.applicationId
                : items.length > 0
                  ? items.map((item) => item.split("/").at(-1)).join(", ")
                  : (run.agent ?? run.kind);
              return (
                <li key={run.id}>
                  <button
                    type="button"
                    onClick={(event) => {
                      trigger.current = event.currentTarget;
                      scroll.current = window.scrollY;
                      select(run.id);
                    }}
                    aria-label={`Open ${runLabel(run)} run ${run.id.slice(0, 8)}`}
                    className={`grid w-full grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 gap-y-3 rounded-lg bg-surface px-4 py-4 text-left hover:bg-hover focus-visible:outline-none focus-visible:[box-shadow:var(--ds-focus-ring)] xl:items-center ${columns}`}
                  >
                    <span className="min-w-0">
                      <span className="block text-[14px] font-medium text-text">{runLabel(run)}</span>
                      <span className="mt-1 block font-mono text-[11px] text-text-secondary">
                        {run.id.slice(0, 8)} <span className="font-sans text-text-muted">· attempt {run.attempt}</span>
                      </span>
                      {run.failureReason === undefined ? null : (
                        <span className="mt-1.5 line-clamp-1 text-[12px] text-text-secondary" title={run.failureReason}>
                          {run.failureReason}
                        </span>
                      )}
                    </span>
                    <span className="hidden min-w-0 xl:block">
                      <span className="block truncate text-[13px] text-text">{context}</span>
                      <span className="mt-1 block truncate text-[12px] text-text-secondary" title={subcontext}>
                        {subcontext}
                      </span>
                    </span>
                    <span className="flex flex-col items-end gap-1.5 xl:items-start">
                      <RunStatusBadge status={run.status} cancelling={run.cancelRequestedAt !== undefined && run.status === "running"} />
                      {run.abandonedAt !== undefined ? (
                        <span className="text-[11px] text-text-secondary">Scope released</span>
                      ) : run.documentWrite === undefined ? null : (
                        <WriteStatusBadge status={run.documentWrite.status} />
                      )}
                    </span>
                    <span className="min-w-0 text-[12px] text-text-secondary" title={formatDateTime(run.startedAt ?? run.createdAt)}>
                      <span className="block">
                        {run.status === "queued" ? "Waiting to start" : formatRelative(run.startedAt ?? run.createdAt)}
                      </span>
                      <span className="mt-1 block truncate text-[11px] text-text-muted">{run.actor ?? "System"}</span>
                    </span>
                    <span className="flex items-center justify-end gap-1.5 text-[12px] text-text-secondary xl:justify-start">
                      <Clock3 className="size-3.5 xl:hidden" />
                      <RunTime run={run} />
                    </span>
                    <ArrowUpRight className="hidden size-4 text-text-muted xl:block" />
                    <span className="col-span-2 truncate text-[12px] text-text-muted xl:hidden">
                      {context}
                      {subcontext === undefined ? "" : ` · ${subcontext}`}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
      <DetailPage
        open={openId !== undefined}
        title={opened === undefined ? "Run details" : runLabel(opened)}
        subtitle={openId}
        onClose={() => {
          if (trigger.current === null) select(undefined);
          else navigate(-1);
        }}
      >
        {openId === undefined ? null : owner === undefined ? (
          <p className="text-[13px] text-text-secondary">Go back to run history and select the project that owns this run.</p>
        ) : (
          <RunDetail
            key={`${owner}/${openId}`}
            projectId={owner ?? ""}
            runId={openId}
            version={`${opened?.status ?? ""}/${opened?.documentWrite?.status ?? ""}/${opened?.attempt ?? ""}/${opened?.cancelRequestedAt ?? ""}`}
            scopeNoun={scopeNoun}
            {...actions}
            onRetried={(run) => {
              select(run.id);
              actions.onRetried?.(run);
            }}
          />
        )}
      </DetailPage>
    </>
  );
}
