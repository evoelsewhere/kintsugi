// The Build page of one application (ADR-0071): after the design, each unit is implemented and tested by a member on their own
// machine — with their AI client, the Kintsugi CLI and the Modernize plugin — who tells Kintsugi which unit they built in which merge
// request; the runtime then reviews that merge request. The page shows where every designed unit stands, the merge requests members
// recorded, and the review runs.
// URL: …&tab=units|runs, &run=<id> (opens Runs on that run).

import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ScopedRunsPanel, type ScopedRunsLabels } from "@/components/job-runs/scoped-runs-panel";
import { Loaded } from "@/components/loaded";
import { Tabs } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import { ApiError } from "@/lib/api";
import { agentsApi } from "@/lib/api/agents";
import { buildApi, type BuildConflict, type MergeRequest } from "@/lib/api/build";
import { jobRunsApi, type StageView } from "@/lib/api/job-runs";
import type { ApplicationView, ProjectDetail } from "@/lib/api/projects";
import { useAuth } from "@/lib/auth";
import { isActiveStatus } from "@/lib/status";
import { agentProblems, runBlocker, runsOfStage, stageLabel } from "@/lib/stages";
import { useLoader } from "@/lib/use-loader";
import { CompactFacts, StageHeader } from "../delivery-shell";
import { CliDialog, ReviewDialog, type ReviewRequest } from "./build-dialogs";
import { BuildUnitsTab } from "./build-units";

type BuildTab = "units" | "runs";
const TABS: readonly BuildTab[] = ["units", "runs"];
const RUN_LIMIT = 100;

const REVIEW_RUNS: ScopedRunsLabels = {
  title: "Review runs",
  emptyTitle: "No review run yet",
  emptyDescription: "Once a member records a merge request for a unit, review it from the Units tab.",
  noun: "unit",
};

export function BuildStage({ project, application, stage }: { project: ProjectDetail; application: ApplicationView; stage: StageView }): React.JSX.Element {
  const [params, setParams] = useSearchParams();
  const { can } = useAuth();
  const toast = useToast();
  const requested = params.get("tab");
  const tab: BuildTab = TABS.find((entry) => entry === requested) ?? (params.get("run") !== null ? "runs" : "units");
  const update = (patch: Record<string, string | undefined>): void =>
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        for (const [key, value] of Object.entries(patch)) {
          if (value === undefined || value === "") next.delete(key);
          else next.set(key, value);
        }
        return next;
      },
      { replace: true },
    );

  const runs = useLoader(`runs/${project.id}/${application.id}/review`, async () => (await jobRunsApi.list(project.id, application.id, RUN_LIMIT)).items, {
    live: [`job-runs:${project.id}`, `document-writes:${project.id}`],
  });
  const reviewRuns = runs.data === undefined ? undefined : runsOfStage(runs.data, "review");
  // The overview is read again when a run changes state (finished, merged, abandoned).
  const version = (reviewRuns ?? []).map((run) => `${run.id}:${run.status}:${run.documentWrite?.status ?? ""}:${run.abandonedAt ?? ""}`).join(",");
  const overview = useLoader(`build/overview/${project.id}/${application.id}/${version}`, () => buildApi.overview(project.id, application.id));
  const stages = useLoader("stages", jobRunsApi.stages);
  const agents = useLoader(`agents/${project.id}`, () => agentsApi.list(project.id));
  const reviewStage = stages.data?.find((entry) => entry.id === "review");
  const problems = reviewStage === undefined ? [] : agentProblems(reviewStage, agents.data);

  const [targetId, setTargetId] = useState<string>("");
  const [pending, setPending] = useState<ReviewRequest | undefined>(undefined);
  const [conflicts, setConflicts] = useState<BuildConflict[]>([]);
  const [cli, setCli] = useState<string | undefined>(undefined);
  const targets = overview.data?.targets ?? [];
  const target = targets.find((entry) => entry.repositoryId === targetId) ?? (targets.length === 1 ? targets[0] : undefined);
  const canRun = can("jobs.run");
  const runDisabled = !canRun ? "Starting a review needs the jobs.run permission." : runBlocker(project, application);

  async function start(): Promise<void> {
    if (pending === undefined) return;
    try {
      const run = await buildApi.review(project.id, application.id, { units: pending.units, ...(target === undefined ? {} : { target: target.repositoryId }) });
      toast.success("Review queued", `${pending.units.length} unit${pending.units.length === 1 ? "" : "s"} of ${application.name}: the worker starts shortly.`);
      setConflicts([]);
      update({ tab: "runs", run: run.id });
      await Promise.all([runs.reload(), overview.reload()]);
    } catch (failure) {
      const found = failure instanceof ApiError ? failure.body.details?.["conflicts"] : undefined;
      if (Array.isArray(found)) setConflicts(found as BuildConflict[]);
      throw failure;
    }
  }

  async function changed(): Promise<void> {
    await Promise.all([runs.reload(), overview.reload()]);
  }

  const requestReview = (request: MergeRequest, units: string[]): void => {
    setConflicts([]);
    setPending({ units, url: request.url, commit: request.commit });
  };
  const activeRuns = (reviewRuns ?? []).filter((run) => isActiveStatus(run.status)).length;

  return (
    <div className="flex flex-col gap-4">
      <StageHeader
        title={stageLabel(stage.id)}
        command={stage.command}
        application={application}
        description="After the design, a member implements and tests each unit on their machine with their own AI client; Kintsugi collects which unit and which merge request, and the runtime reviews it."
        facts={<CompactFacts project={project} application={application} />}
      />
      {problems.length === 0 ? null : <p className="text-[12px] text-text-secondary">Check the code-reviewer agent before reviewing: {[...new Set(problems)].join("; ")}. Review jobs fail until this is fixed (see Runs).</p>}
      {project.applications.length > 1 ? <p className="text-[12px] text-text-secondary">Confirm this application when recording a build with the current Modernize plugin. Older records that do not name an application must be recorded again before their merge request can be reviewed here.</p> : null}
      <Tabs<BuildTab>
        sticky
        label="Build sections"
        value={tab}
        onChange={(next) => update({ tab: next })}
        tabs={[
          { id: "units", label: "Units", ...(overview.data === undefined ? {} : { count: overview.data.units.filter((unit) => unit.designed).length }) },
          { id: "runs", label: "Reviews", ...(reviewRuns === undefined ? {} : { count: activeRuns > 0 ? activeRuns : reviewRuns.length }) },
        ]}
      />
      {tab === "runs" ? (
        <ScopedRunsPanel
          project={project}
          runs={reviewRuns}
          loader={runs}
          canRun={canRun}
          initialRun={params.get("run") ?? undefined}
          labels={REVIEW_RUNS}
          onChooseScope={() => update({ tab: "units" })}
          onChanged={changed}
        />
      ) : (
        <Loaded loader={overview} rows={8}>
          {(view) => <BuildUnitsTab overview={view} target={target} onTarget={setTargetId} runDisabled={runDisabled} conflicts={conflicts} onReview={requestReview} onCli={setCli} />}
        </Loaded>
      )}
      <ReviewDialog request={pending} applicationName={application.name} targetName={target?.repositoryId} documentRepository={project.documentRepository?.repositoryId} onConfirm={start} onClose={() => setPending(undefined)} />
      <CliDialog unit={cli} url={window.location.origin} projectId={project.id} onClose={() => setCli(undefined)} />
    </div>
  );
}
