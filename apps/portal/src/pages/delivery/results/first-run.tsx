// The Overview of a stage that has no output yet: what running it does, where the run stands and the
// one next action (run it, or open the run that is going or failed). Steps are listed so the
// path from "nothing yet" to "items to choose" is visible before the first click.

import { Play, X } from "lucide-react";
import { RunStatusBadge } from "@/components/status-badges";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { JobRunView } from "@/lib/api/job-runs";
import { formatRelative } from "@/lib/format";
import { isActiveStatus } from "@/lib/status";
import { cn } from "@/lib/utils";

export interface FirstRunProps {
  stage: string;
  applicationName: string;
  /** The newest run of the stage, if any. */
  latest: JobRunView | undefined;
  /** Why the stage cannot be run now; undefined when it can. */
  blocked: string | undefined;
  onRun: () => void;
  onOpenRun: (id: string) => void;
}

interface Step {
  title: string;
  detail: string;
}

/** What happens between the first run and a usable result, per stage (generic when not listed). */
const STEPS: Record<string, Step[]> = {
  assess: [
    { title: "Run the assessment", detail: "Measures the repository, analyses structure, debt and security, extracts the topology and proposes the item catalog." },
    { title: "Review and merge the pull request", detail: "The assessment, the diagram and the catalog arrive as one pull request in the document repository." },
    { title: "Pick items in the Catalog", detail: "The items you select there are what AS-IS understanding analyses next." },
  ],
};

const genericSteps = (stage: string): Step[] => [
  { title: `Run ${stage}`, detail: "Its jobs run in an isolated workspace; the output reaches the document repository." },
  { title: "Review and merge the pull request", detail: "Results appear here as soon as the output is on a branch or merged." },
];

export function FirstRun({ stage, applicationName, latest, blocked, onRun, onOpenRun }: FirstRunProps): React.JSX.Element {
  const steps = STEPS[stage] ?? genericSteps(stage);
  const active = latest !== undefined && isActiveStatus(latest.status);
  const failed = latest !== undefined && (latest.status === "failed" || latest.status === "cancelled");
  return (
    <Card className="p-0">
      <div className="grid grid-cols-1 gap-0 lg:grid-cols-[minmax(0,5fr)_minmax(0,4fr)]">
        <div className="flex flex-col gap-4 p-6">
          <div>
            <p className="text-[10px] tracking-wide text-text-muted uppercase">{stage} · {applicationName}</p>
            <h2 className="mt-1 text-[18px] leading-tight font-semibold tracking-[-0.3px] text-text">
              {active ? "The first run is in progress" : failed ? "The last run did not finish" : "No result yet. Run it to get started"}
            </h2>
            <p className="mt-1.5 max-w-prose text-[13px] text-text-secondary">
              {active
                ? "Results appear here as soon as the run succeeds and its output reaches the document repository."
                : failed
                  ? "Nothing was produced to show. Open the run to see which step failed, then run it again."
                  : "Nothing has been produced for this application yet. The overview fills in after the first successful run."}
            </p>
          </div>

          {latest === undefined ? null : (
            <div className="flex flex-wrap items-center gap-2 rounded-[var(--geist-radius)] bg-recessed px-3 py-2">
              <RunStatusBadge status={latest.status} cancelling={latest.cancelRequestedAt !== undefined && latest.status === "running"} />
              <span className="text-[12px] tabular-nums text-text-muted">{formatRelative(latest.createdAt)}</span>
              {latest.failureReason === undefined ? null : (
                <span className="flex min-w-0 flex-1 basis-60 items-start gap-1.5 text-[11.5px] leading-[1.45] text-[var(--ds-status-red)]" title={latest.failureReason}>
                  <span className="mt-[5px] size-1.5 shrink-0 rounded-full bg-[var(--ds-status-red)]" aria-hidden />
                  <span className="line-clamp-2 break-words">{latest.failureReason}</span>
                </span>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            {active ? null : (
              <span title={blocked}>
                <Button variant="solid" disabled={blocked !== undefined} onClick={onRun}>
                  <Play className="size-3.5" />
                  {failed ? "Run again" : `Run ${stage}`}
                </Button>
              </span>
            )}
            {latest === undefined ? null : (
              <Button variant="ghost" className="shadow-border" onClick={() => onOpenRun(latest.id)}>
                {active ? "Watch the run" : "Open the run"}
              </Button>
            )}
          </div>
          {blocked === undefined || active ? null : <p className="text-[12px] text-text-muted">{blocked}</p>}
        </div>

        <ol className="flex flex-col gap-0 bg-recessed/60 p-6 lg:rounded-r-xl" aria-label="What happens next">
          {steps.map((step, index) => {
            const current = index === 0;
            const last = index === steps.length - 1;
            return (
              <li key={step.title} className="relative flex gap-3 pb-5 last:pb-0">
                {last ? null : <span className="absolute top-6 bottom-0 left-[11px] w-px bg-hover" aria-hidden />}
                <span
                  className={cn(
                    "flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-medium tabular-nums",
                    current && failed
                      ? "text-[var(--ds-status-red)] shadow-[0_0_0_1px_var(--ds-status-red)]"
                      : current
                        ? "bg-text text-background"
                        : "bg-surface text-text-muted shadow-border",
                  )}
                >
                  {current && failed ? <X className="size-3" strokeWidth={2} /> : current && active ? <span className="size-1.5 animate-pulse rounded-full bg-background" /> : index + 1}
                </span>
                <div className="min-w-0">
                  <p className={cn("text-[13px] font-medium", current ? "text-text" : "text-text-secondary")}>{step.title}</p>
                  <p className="mt-0.5 text-[12px] text-text-muted">{step.detail}</p>
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </Card>
  );
}
