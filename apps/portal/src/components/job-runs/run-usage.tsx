// What a run cost, for the overview of a run: the same tiles as Governance → Telemetry, from the usage the worker stored
// on the agent steps, and a way to its trace there for people who may read it.

import { Link } from "react-router-dom";
import { StatTile } from "@/components/telemetry/telemetry-parts";
import type { JobRunDetail } from "@/lib/api/job-runs";
import { useAuth } from "@/lib/auth";
import { telemetryTraceLink } from "@/lib/links";
import { cacheHitRate, formatCost, formatRate, formatTokens, sumUsage, tokenTotal } from "@/lib/telemetry";

export function RunUsage({ run }: { run: JobRunDetail }): React.JSX.Element | null {
  const { can } = useAuth();
  const usage = sumUsage(run.steps);
  if (usage === undefined) return null;
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <h5 className="text-[11px] font-medium tracking-wide text-text-muted uppercase">Usage · attempt {run.attempt}</h5>
        {can("telemetry.view") ? (
          <Link to={telemetryTraceLink({ runId: run.id })} className="text-[12px] text-text-secondary underline-offset-2 hover:text-text hover:underline focus-visible:outline-none focus-visible:[box-shadow:var(--ds-focus-ring)]">
            Open the trace in Telemetry
          </Link>
        ) : null}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Cost" value={formatCost(usage.costUsd)} />
        <StatTile label="Tokens" value={formatTokens(tokenTotal(usage))} hint={`new in ${formatTokens(usage.inputTokens)} · out ${formatTokens(usage.outputTokens)}`} />
        <StatTile label="Read from cache" value={formatRate(cacheHitRate(usage))} hint={`${formatTokens(usage.cacheReadTokens)} tokens`} />
        <StatTile label="Compactions" value={String(usage.compactions)} tone={usage.compactions > 0 ? "orange" : undefined} />
      </div>
    </section>
  );
}
