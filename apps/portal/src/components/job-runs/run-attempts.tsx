import { ArrowUpRight } from "lucide-react";
import { RunStatusBadge } from "@/components/status-badges";
import { Button } from "@/components/ui/button";
import type { JobRunDetail, JobRunStatus } from "@/lib/api/job-runs";
import { formatDateTime, formatDuration } from "@/lib/format";

export function RunAttempts({ run, onConsole }: { run: JobRunDetail; onConsole: (attempt: number) => void }): React.JSX.Element {
  const attempts: Array<{ n: number; status: JobRunStatus; startedAt?: string; finishedAt?: string; reason?: string }> = [
    ...(run.attempts ?? []),
  ];
  if (!attempts.some((attempt) => attempt.n === run.attempt))
    attempts.push({ n: run.attempt, status: run.status, startedAt: run.startedAt, finishedAt: run.finishedAt, reason: run.failureReason });
  return (
    <section className="rounded-xl bg-surface p-4 shadow-border sm:p-5">
      <h2 className="text-[14px] font-medium text-text">Attempt history</h2>
      <p className="mt-1 mb-5 text-[13px] text-text-secondary">Each retry keeps the same run ID and pinned source commits.</p>
      <ol className="flex flex-col gap-3">
        {attempts
          .sort((a, b) => b.n - a.n)
          .map((attempt) => (
            <li key={attempt.n} className="rounded-lg bg-recessed/50 p-4">
              <div className="flex flex-wrap items-center gap-3">
                <h3 className="text-[14px] font-medium text-text">
                  Attempt {attempt.n}
                  {attempt.n === run.attempt ? <span className="ml-2 text-[12px] font-normal text-text-secondary">Latest</span> : null}
                </h3>
                <RunStatusBadge status={attempt.status} />
                <span className="text-[12px] text-text-secondary">{formatDuration(attempt.startedAt, attempt.finishedAt)}</span>
                <Button size="small" className="ml-auto" onClick={() => onConsole(attempt.n)}>
                  View console <ArrowUpRight />
                </Button>
              </div>
              <p className="mt-2 text-[12px] text-text-secondary">
                {attempt.startedAt === undefined ? "Waiting for a worker" : formatDateTime(attempt.startedAt)}
              </p>
              {attempt.reason === undefined ? null : (
                <p className="mt-3 whitespace-pre-wrap break-words text-[13px] leading-6 text-text">{attempt.reason}</p>
              )}
            </li>
          ))}
      </ol>
    </section>
  );
}
