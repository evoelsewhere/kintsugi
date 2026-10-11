// The stage pipeline of one application: the built-in stages that run as Kintsugi runtime jobs
// (packages/agents/builtin/commands with audience `runtime`), in order, each with its last run
// and a Run button when the portal can start it — the others say "coming soon". Stages that
// members run in their harnesses or that are portal screens are named below the pipeline.

import { Play } from "lucide-react";
import { RunStatusBadge, StatusBadge } from "@/components/status-badges";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { JobRunView, StageView } from "@/lib/api/job-runs";
import { formatDateTime, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface StagePipelineProps {
  stages: StageView[];
  /** Runs of the application, newest first. */
  runs: JobRunView[];
  canRun: boolean;
  /** Why no stage can start (no legacy or document repo); undefined when they can. */
  blocked: string | undefined;
  busyStage: string | null;
  onRun: (stage: StageView) => void;
}

export function StagePipeline({ stages, runs, canRun, blocked, busyStage, onRun }: StagePipelineProps): React.JSX.Element {
  const runtime = stages.filter((stage) => stage.audience === "runtime");
  const member = stages.filter((stage) => stage.audience === "member");
  const portal = stages.filter((stage) => stage.audience === "portal");

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Stage pipeline</CardTitle>
          <CardDescription>
            Runtime stages read the legacy repo read-only and propose their output to the document repo. {blocked ?? ""}
          </CardDescription>
        </div>
      </CardHeader>
      <ol className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {runtime.map((stage, index) => {
          const last = runs.find((run) => run.kind === "stage" && run.name === stage.id);
          const active = last !== undefined && (last.status === "queued" || last.status === "running");
          return (
            <li key={stage.id} className={cn("flex flex-col gap-2 rounded-[10px] p-3 shadow-border", !stage.runnable && "bg-recessed/50")}>
              <div className="flex items-center gap-2">
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-hover font-mono text-[11px] text-text-secondary">{index + 1}</span>
                <span className="text-[14px] font-medium text-text">{stage.id}</span>
                <span className="ml-auto">{stage.runnable ? null : <StatusBadge tone="muted" label="Coming soon" />}</span>
              </div>
              <p className="line-clamp-3 text-[12px] text-text-secondary" title={stage.description}>
                {stage.description}
              </p>
              {stage.agents.length === 0 ? null : <p className="truncate text-[11px] text-text-muted">Agents: {stage.agents.join(", ")}</p>}
              <div className="mt-auto flex items-center gap-2 pt-1">
                {last === undefined ? (
                  <span className="text-[11px] text-text-muted">{stage.runnable ? "Not run yet" : "Not wired yet"}</span>
                ) : (
                  <span className="flex min-w-0 items-center gap-1.5" title={formatDateTime(last.createdAt)}>
                    <RunStatusBadge status={last.status} />
                    <span className="truncate text-[11px] text-text-muted">{formatRelative(last.createdAt)}</span>
                  </span>
                )}
                {stage.runnable && canRun ? (
                  <Button size="small" variant="solid" className="ml-auto" disabled={blocked !== undefined || busyStage !== null || active} title={active ? "A run of this stage is active" : blocked} onClick={() => onRun(stage)}>
                    <Play className="size-3.5" />
                    {busyStage === stage.id ? "Queuing…" : "Run"}
                  </Button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
      {member.length + portal.length === 0 ? null : (
        <p className="mt-3 text-[12px] text-text-muted">
          {member.length === 0 ? null : (
            <>
              Members run <span className="text-text-secondary">{member.map((stage) => stage.id).join(", ")}</span> in their own harnesses.{" "}
            </>
          )}
          {portal.length === 0 ? null : (
            <>
              Portal screens (planned): <span className="text-text-secondary">{portal.map((stage) => stage.id).join(", ")}</span>.
            </>
          )}
        </p>
      )}
    </Card>
  );
}
