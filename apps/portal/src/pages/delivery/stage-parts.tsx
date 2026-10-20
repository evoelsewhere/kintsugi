// Cards every stage page shares: what the stage reads and writes in the document repo, the
// decision points of its command definition and the agents it starts with their model binding.

import { AlertTriangle, ArrowDownToLine, ArrowUpFromLine, Bot, CheckCircle2, ExternalLink, GitPullRequest, Hand } from "lucide-react";
import { Link } from "react-router-dom";
import { Loaded } from "@/components/loaded";
import { StatusBadge, WriteStatusBadge } from "@/components/status-badges";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { AgentSummary } from "@/lib/api/agents";
import type { JobRunView, StageView } from "@/lib/api/job-runs";
import { useAuth } from "@/lib/auth";
import { useShell } from "@/lib/shell";
import { matchesPattern, resolvePath } from "@/lib/stages";
import type { Loader } from "@/lib/use-loader";

export interface StagePathsProps {
  stage: StageView;
  applicationId: string;
  documentRepository: string | undefined;
  /** Paths of the latest successful run's artifacts, when known. */
  produced?: string[] | undefined;
  /** The document write that carried the latest output. */
  write?: JobRunView["documentWrite"] | undefined;
}

const EYEBROW = "text-[10px] tracking-wide text-text-muted uppercase";

/** A card title with the number of entries after it, so the count leads over the description. */
function CountedTitle({ children, count }: { children: React.ReactNode; count: number }): React.JSX.Element {
  return (
    <CardTitle>
      {children} <span className="ml-1 text-[11px] font-normal tabular-nums text-text-muted">{count}</span>
    </CardTitle>
  );
}

/** Inputs the stage reads and outputs it writes in the document repo, resolved for the application. */
export function StagePaths({ stage, applicationId, documentRepository, produced, write }: StagePathsProps): React.JSX.Element {
  const reads = stage.reads;
  return (
    <Card>
      <CardHeader>
        <div className="min-w-0">
          <CardTitle>Inputs and outputs</CardTitle>
          <CardDescription>
            Paths in <span className="font-mono text-[11px] text-text">{documentRepository ?? "the document repo"}</span>, for application {applicationId}.
          </CardDescription>
        </div>
      </CardHeader>
      <div className="mt-3 flex flex-col gap-4 text-[12px]">
        <section>
          <h5 className={`mb-1 flex items-center gap-1.5 px-1.5 ${EYEBROW}`}>
            <ArrowDownToLine className="size-3.5" strokeWidth={1.75} />
            Reads
            {reads === undefined ? null : <span className="tabular-nums">{reads.length}</span>}
          </h5>
          {reads === undefined ? (
            <p className="px-1.5 text-text-muted">The legacy code repo of the application (read-only). The API does not report the stage's document inputs yet.</p>
          ) : reads.length === 0 ? (
            <p className="px-1.5 text-text-muted">Nothing from the document repo.</p>
          ) : (
            <PathList patterns={reads} applicationId={applicationId} />
          )}
        </section>
        <section>
          <h5 className={`mb-1 flex items-center gap-1.5 px-1.5 ${EYEBROW}`}>
            <ArrowUpFromLine className="size-3.5" strokeWidth={1.75} />
            Writes
            <span className="tabular-nums">{stage.writes.length}</span>
          </h5>
          {stage.writes.length === 0 ? <p className="px-1.5 text-text-muted">Nothing; the stage only shows information.</p> : <PathList patterns={stage.writes} applicationId={applicationId} produced={produced} />}
        </section>
        {write === undefined ? null : (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-1.5 text-text-secondary">
            <span className={EYEBROW}>Latest output</span>
            <WriteStatusBadge status={write.status} />
            {write.branch === undefined ? null : (
              <span className="max-w-full truncate rounded-full bg-hover px-1.5 py-0.5 font-mono text-[11px] text-text-muted" title={write.branch}>
                {write.branch}
              </span>
            )}
            {write.prUrl === undefined ? null : (
              <a
                href={write.prUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 rounded-[var(--geist-radius)] text-accent hover:underline focus-visible:outline-none focus-visible:[box-shadow:var(--ds-focus-ring)]"
              >
                <GitPullRequest className="size-3.5" />
                Pull request
                <ExternalLink className="size-3" />
              </a>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

function PathList({ patterns, applicationId, produced }: { patterns: string[]; applicationId: string; produced?: string[] | undefined }): React.JSX.Element {
  return (
    <ul className="flex flex-col gap-0.5">
      {patterns.map((pattern) => {
        const count = produced?.filter((path) => matchesPattern(pattern, applicationId, path)).length;
        const resolved = resolvePath(pattern, applicationId);
        return (
          <li key={pattern} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 rounded-[10px] px-1.5 py-1 hover:bg-hover">
            <span className="min-w-0 truncate font-mono text-[11.5px] text-text" title={resolved}>
              {resolved}
            </span>
            {count === undefined ? null : count > 0 ? (
              <span className="flex items-center justify-end gap-1 text-[11px] tabular-nums text-text-secondary" title="Produced by the latest successful run">
                <CheckCircle2 className="size-3.5 shrink-0 text-[var(--ds-status-green)]" strokeWidth={1.75} />
                {count > 1 ? `${count} files` : "latest run"}
              </span>
            ) : (
              <span className="text-right text-[11px] text-text-muted">not in the latest run</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Where a person decides before the stage goes on; hidden when the command names none. */
export function DecisionPoints({ stage }: { stage: StageView }): React.JSX.Element | null {
  if (stage.gates.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <div className="min-w-0">
          <CountedTitle count={stage.gates.length}>Decision points</CountedTitle>
          <CardDescription>Where a person decides before the stage goes on, from the stage's command definition.</CardDescription>
        </div>
      </CardHeader>
      <ul className="mt-3 flex flex-col gap-0.5 text-[12px] text-text-secondary">
        {stage.gates.map((gate) => (
          <li key={gate} className="flex items-start gap-2 rounded-[10px] px-1.5 py-1 hover:bg-hover">
            <Hand className="mt-0.5 size-3.5 shrink-0 text-text-muted" strokeWidth={1.75} />
            <span className="min-w-0 break-words">{gate}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

const bindingLabel = (binding: NonNullable<AgentSummary["binding"]>): string => `${binding.provider} · ${binding.model}${binding.thinking === undefined ? "" : ` · thinking ${binding.thinking}`}`;

/**
 * The agents a stage starts with their model binding. `runtime` agents need a binding (Settings
 * → Providers) or their jobs fail; member agents run with the member's own harness model.
 */
export function StageAgents({ stage, agents }: { stage: StageView; agents: Loader<AgentSummary[]> }): React.JSX.Element | null {
  const { can } = useAuth();
  const { openSettings } = useShell();
  if (stage.agents.length === 0) return null;
  const runtime = stage.audience === "runtime";
  return (
    <Card>
      <CardHeader>
        <div className="min-w-0">
          <CountedTitle count={stage.agents.length}>Agents</CountedTitle>
          <CardDescription>{runtime ? "Started by the stage as runtime jobs; each needs a model binding." : "Used by members in their harness through the Kintsugi plugin."}</CardDescription>
        </div>
      </CardHeader>
      <div className="mt-3">
        <Loaded loader={agents} rows={2}>
          {(list) => (
            <ul className="flex flex-col gap-0.5 text-[12px]">
              {stage.agents.map((name) => {
                const agent = list.find((entry) => entry.name === name);
                return (
                  <li key={name} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[10px] px-1.5 py-1.5 hover:bg-hover">
                    <span className="flex min-w-40 flex-1 items-center gap-2">
                      <Bot className="size-3.5 shrink-0 text-text-muted" strokeWidth={1.75} />
                      {agent === undefined ? (
                        <span className="min-w-0 truncate text-[13px] font-medium text-text" title={name}>
                          {name}
                        </span>
                      ) : (
                        <Link
                          to={`/plugins/builder/${encodeURIComponent(name)}`}
                          title={name}
                          className="min-w-0 truncate rounded-[var(--geist-radius)] text-[13px] font-medium text-text hover:underline focus-visible:outline-none focus-visible:[box-shadow:var(--ds-focus-ring)]"
                        >
                          {name}
                        </Link>
                      )}
                    </span>
                    <span className="flex max-w-full flex-wrap items-center justify-end gap-x-2 gap-y-1">
                      {agent === undefined ? (
                        <StatusBadge tone="red" label="Not in the catalog" />
                      ) : !agent.enabled ? (
                        <StatusBadge tone="orange" label="Disabled" />
                      ) : agent.problems.length > 0 ? (
                        <StatusBadge tone="red" label="Invalid" title={agent.problems.join("\n")} />
                      ) : !runtime ? null : agent.binding === undefined ? (
                        <>
                          <span className="flex items-center gap-1 text-text">
                            <AlertTriangle className="size-3.5 text-[var(--ds-status-orange)]" strokeWidth={1.75} />
                            No model binding
                          </span>
                          {can("providers.manage") ? (
                            <Button size="small" variant="link" className="h-auto px-0 text-[12px]" onClick={() => openSettings("providers")}>
                              Bind in Settings → Providers
                            </Button>
                          ) : (
                            <span className="text-text-muted">an administrator binds it in Settings → Providers</span>
                          )}
                        </>
                      ) : (
                        <span className="max-w-full truncate font-mono text-[11px] text-text-secondary" title={bindingLabel(agent.binding)}>
                          {bindingLabel(agent.binding)}
                        </span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Loaded>
      </div>
    </Card>
  );
}
