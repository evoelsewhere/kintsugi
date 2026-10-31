// The Design stage of one application (ADR-0044, ADR-0045, ADR-0049): where the design stands, read from the
// document repo, and the runs that generate it. A person picks a design set and units; the worker writes the
// set's documents from the project's own templates into one pull request that people review. The page shows
// what exists, whether it conforms to the templates, and what is being generated.
// URL: …&tab=overview|units|runs|coverage|sets|common, &set=&state=&module=&kind= (the Units filters),
// &item=<module>/<unit>&view=<set>|coverage (the unit's drawer), &sets=<set> (a set's drawer),
// &run=<id> (opens Runs on that run), &ref=<branch or commit> (a design in an open pull request).

import { APPLICATION_UNIT_KEY } from "@kintsugi/domain";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ScopedRunsPanel, type ScopedRunsLabels } from "@/components/job-runs/scoped-runs-panel";
import { Loaded } from "@/components/loaded";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Select } from "@/components/ui/select";
import { Tabs } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import { ApiError } from "@/lib/api";
import { agentsApi } from "@/lib/api/agents";
import { designApi, type DesignActivity, type DesignConflict, type DesignOverview, type DesignState } from "@/lib/api/design";
import { documentsApi } from "@/lib/api/documents";
import { jobRunsApi, type StageView } from "@/lib/api/job-runs";
import type { ApplicationView, ProjectDetail } from "@/lib/api/projects";
import { useAuth } from "@/lib/auth";
import { unitsLine } from "@/lib/design-run";
import { deliveryLink } from "@/lib/links";
import { isActiveStatus } from "@/lib/status";
import { agentProblems, runBlocker, runsOfStage, stageLabel } from "@/lib/stages";
import { useLoader } from "@/lib/use-loader";
import { CompactFacts, StageHeader } from "../delivery-shell";
import { StageAgents } from "../stage-parts";
import { DesignCommonTab, DesignCoverageTab } from "./design-common";
import { DesignOverviewTab } from "./design-overview";
import { DesignSetsTab } from "./design-sets";
import { DesignUnitsTab } from "./design-units";
import type { UnitFilters } from "./design-state";
import { UnitDesignPage } from "./design-unit-page";

type DesignTab = "overview" | "units" | "runs" | "coverage" | "sets" | "common";
const TABS: readonly DesignTab[] = ["overview", "units", "runs", "coverage", "sets", "common"];
const STATES: readonly string[] = ["conformant", "problems", "stale", "missing", "waived"];
const RUN_LIMIT = 50;

const DESIGN_RUNS: ScopedRunsLabels = {
  title: "Design runs",
  emptyTitle: "No design run yet",
  emptyDescription: "Choose a set on the Units tab, select the units and generate its design.",
  noun: "unit",
};

/** What the page hands down to start a run: the set and units chosen somewhere (the table, the overview, a unit's drawer); `regenerate` writes the set again over a design the units have (ADR-0081). */
export type RequestGenerate = (set: string, units: string[], options?: { regenerate?: boolean; draft?: boolean }) => void;

type PendingRun = { set: string; units: string[]; regenerate?: boolean; draft?: boolean };

export function DesignStage({ project, application, stage }: { project: ProjectDetail; application: ApplicationView; stage: StageView }): React.JSX.Element {
  const [params, setParams] = useSearchParams();
  const { can } = useAuth();
  const toast = useToast();
  const requested = params.get("tab");
  const tab: DesignTab = TABS.find((entry) => entry === requested) ?? (params.get("run") !== null ? "runs" : "overview");
  const refParam = params.get("ref") ?? undefined;
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
      // Opening a unit or a set is a page of its own: Back returns to the list.
      { replace: !("item" in patch || "sets" in patch) },
    );

  const runs = useLoader(`runs/${project.id}/${application.id}/design`, async () => (await jobRunsApi.list(project.id, application.id, RUN_LIMIT)).items, {
    live: [`job-runs:${project.id}`, `document-writes:${project.id}`],
  });
  const designRuns = runs.data === undefined ? undefined : runsOfStage(runs.data, "design");
  // The documents and the activity are read again when a run changes state (finished, merged, abandoned).
  const version = (designRuns ?? []).map((run) => `${run.id}:${run.status}:${run.documentWrite?.status ?? ""}:${run.abandonedAt ?? ""}`).join(",");
  const overview = useLoader(`design/overview/${project.id}/${application.id}/${refParam ?? ""}/${version}`, () => designApi.overview(project.id, application.id, refParam));
  const sets = useLoader(`design/sets/${project.id}/${application.id}/${refParam ?? ""}/${version}`, () => designApi.sets(project.id, { app: application.id, ...(refParam === undefined ? {} : { ref: refParam }) }));
  const common = useLoader(`design/common/${project.id}/${application.id}/${refParam ?? ""}/${version}`, () => designApi.common(project.id, application.id, refParam));
  const activity = useLoader<DesignActivity>(`design/activity/${project.id}/${application.id}/${version}`, () => designApi.activity(project.id, application.id));
  const refs = useLoader(`refs/${project.id}`, () => documentsApi.refs(project.id));
  const agents = useLoader(`agents/${project.id}`, () => agentsApi.list(project.id));
  const problems = agentProblems(stage, agents.data);

  const [pending, setPending] = useState<PendingRun | undefined>(undefined);
  const [conflicts, setConflicts] = useState<DesignConflict[]>([]);
  const blocked = runBlocker(project, application);
  const canRun = can("jobs.run");
  const runDisabled = !canRun ? "Starting a run needs the jobs.run permission." : blocked;
  const requestGenerate: RequestGenerate = (set, units, options) => {
    setConflicts([]);
    setPending({ set, units, ...(options?.regenerate === true ? { regenerate: true } : {}), ...(options?.draft === true ? { draft: true } : {}) });
  };

  async function start(): Promise<void> {
    if (pending === undefined) return;
    try {
      const run = await designApi.generate(project.id, application.id, pending);
      toast.success(pending.draft === true ? "Draft design queued" : pending.regenerate === true ? "Regeneration queued" : "Design queued", `${pending.set} of ${pending.units.length} unit${pending.units.length === 1 ? "" : "s"} of ${application.name}: the worker starts shortly.`);
      setConflicts([]);
      update({ tab: "runs", run: run.id });
      await Promise.all([runs.reload(), activity.reload()]);
    } catch (failure) {
      const found = failure instanceof ApiError ? failure.body.details?.["conflicts"] : undefined;
      if (Array.isArray(found)) setConflicts(found as DesignConflict[]);
      throw failure;
    }
  }

  async function changed(): Promise<void> {
    await Promise.all([runs.reload(), activity.reload(), overview.reload(), sets.reload(), common.reload()]);
  }

  const state = params.get("state") ?? "";
  const filters: UnitFilters = {
    set: params.get("set") ?? "",
    state: (STATES.includes(state) ? state : "") as DesignState | "",
    module: params.get("module") ?? "",
    kind: params.get("kind") ?? "",
  };
  const openUnits = (set: string, next: DesignState | ""): void => update({ tab: "units", set, state: next, module: undefined, kind: undefined });
  const open = (key: string | undefined, view?: string): void => update({ item: key, view });
  const coverageFilter = (params.get("cov") === "gaps" ? "gaps" : params.get("cov") === "complete" ? "complete" : "all") as "all" | "gaps" | "complete";

  const attention = overview.data?.attention.length;
  const refOptions = [{ value: "", label: "Default branch" }, ...(refs.data?.refs ?? []).filter((entry) => entry.kind !== "default").map((entry) => ({ value: entry.ref, label: entry.label, hint: entry.status }))];
  const activeRuns = (designRuns ?? []).filter((run) => isActiveStatus(run.status)).length;
  const pendingSet = pending === undefined ? undefined : overview.data?.sets.find((entry) => entry.id === pending.set);

  return (
    <div className="flex flex-col gap-4">
      <StageHeader
        title={stageLabel(stage.id)}
        command={stage.command}
        application={application}
        description={stage.description}
        facts={<CompactFacts project={project} application={application} />}
        actions={refOptions.length > 1 ? <Select size="small" value={refParam ?? ""} onChange={(value) => update({ ref: value })} options={refOptions} /> : undefined}
      />
      {problems.length === 0 ? null : <p className="text-[12px] text-text-secondary">Check the designer agent before generating: {problems.join("; ")}. Design jobs fail until this is fixed (see Runs).</p>}
      <Tabs<DesignTab>
        sticky
        label="Design sections"
        value={tab}
        onChange={(next) => update({ tab: next })}
        tabs={[
          { id: "overview", label: "Overview", count: attention === 0 ? undefined : attention },
          { id: "units", label: "Units", count: overview.data?.units.length },
          { id: "runs", label: "Runs", ...(designRuns === undefined ? {} : { count: activeRuns > 0 ? activeRuns : designRuns.length }) },
          { id: "coverage", label: "Coverage" },
          { id: "sets", label: "Sets", count: sets.data?.sets.length },
          { id: "common", label: "Common", count: common.data?.components.length },
        ]}
      />

      {tab === "sets" ? (
        <Loaded loader={sets} rows={6}>
          {(view) => <DesignSetsTab view={view} chosen={params.get("sets") ?? undefined} onChoose={(set) => update({ sets: set })} showUsage />}
        </Loaded>
      ) : tab === "common" ? (
        <Loaded loader={common} rows={6}>
          {(view) => <DesignCommonTab common={view} onOpenUnit={(key) => open(key)} />}
        </Loaded>
      ) : tab === "runs" ? (
        <>
          <ScopedRunsPanel
            project={project}
            runs={designRuns}
            loader={runs}
            canRun={canRun}
            initialRun={params.get("run") ?? undefined}
            labels={DESIGN_RUNS}
          onChooseScope={() => update({ tab: "units" })}
            onChanged={changed}
          />
          <StageAgents stage={stage} agents={agents} />
        </>
      ) : (
        <Loaded loader={overview} rows={8}>
          {(view) =>
            tab === "overview" ? (
              <DesignOverviewTab overview={view} activity={activity.data?.items ?? []} runDisabled={runDisabled} onGenerate={requestGenerate} onOpenUnits={openUnits} onOpenUnit={(key) => open(key)} onOpenSets={() => update({ tab: "sets" })} />
            ) : tab === "units" ? (
              <DesignUnitsTab
                overview={view}
                activity={activity.data?.items ?? []}
                runDisabled={runDisabled}
                conflicts={conflicts}
                onGenerate={requestGenerate}
                setDetails={sets.data?.sets}
                filters={filters}
                onFilters={(patch) => update({ ...patch })}
                selected={params.get("item") ?? undefined}
                onOpen={(key) => open(key)}
                understandLink={`${deliveryLink({ projectId: project.id, applicationId: application.id, stage: "understand" })}&tab=catalog`}
              />
            ) : (
              <DesignCoverageTab overview={view} filter={coverageFilter} onFilter={(next) => update({ cov: next === "all" ? undefined : next })} onOpenUnit={(key) => open(key, "coverage")} />
            )
          }
        </Loaded>
      )}

      <UnitDesignPage
        project={project}
        application={application}
        unitKey={params.get("item") ?? undefined}
        refParam={refParam}
        view={params.get("view") ?? undefined}
        onView={(view) => update({ view })}
        onClose={() => open(undefined, undefined)}
        overview={overview.data}
        activity={activity.data?.items ?? []}
        runDisabled={runDisabled}
        onGenerate={requestGenerate}
      />

      <GenerateDialog
        pending={pending}
        title={pendingSet?.title}
        project={project}
        application={application}
        onConfirm={start}
        onClose={() => setPending(undefined)}
        overview={overview.data}
      />
    </div>
  );
}

function GenerateDialog({
  pending,
  title,
  project,
  application,
  overview,
  onConfirm,
  onClose,
}: {
  pending: PendingRun | undefined;
  title: string | undefined;
  project: ProjectDetail;
  application: ApplicationView;
  overview: DesignOverview | undefined;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}): React.JSX.Element {
  const count = pending?.units.length ?? 0;
  const forApplication = pending?.units.length === 1 && pending.units[0] === APPLICATION_UNIT_KEY;
  const needs = overview?.sets.find((entry) => entry.id === pending?.set)?.needs ?? [];
  const regenerate = pending?.regenerate === true;
  const draft = pending?.draft === true;
  return (
    <ConfirmDialog
      open={pending !== undefined}
      title={`${regenerate ? "Regenerate" : "Generate"}${draft ? " draft" : ""} ${title ?? `the ${pending?.set ?? ""} design`} for ${forApplication ? `${application.name} as a whole` : `${count} unit${count === 1 ? "" : "s"} of ${application.name}`}?`}
      confirmLabel={draft ? "Generate draft design" : regenerate ? "Regenerate design" : "Generate design"}
      busyLabel="Queuing…"
      confirmVariant="solid"
      onConfirm={onConfirm}
      onClose={onClose}
    >
      {draft ? <p className="mb-3 font-medium text-[var(--ds-status-orange)]">This is a draft: input evidence or dependencies may be missing. Every generated document is marked as draft, unresolved questions remain explicit, and this design cannot satisfy a later stage's prerequisite. Resolve and merge the inputs, then regenerate a final design.</p> : null}
      <p>
        The worker writes the documents of the set <span className="font-mono text-[12px]">{pending?.set}</span> from the project&apos;s template (01-standards/templates/{pending?.set}/), one designer job per unit, checks them against the template and gives
        the units with problems one more pass. It reads {forApplication ? "the assessment, the rebuilt views and the common design" : "the understanding of the units"} and {application.asIs.legacy[0]?.repositoryId ?? "the legacy repo"} read-only, and proposes the result in one pull request to{" "}
        {project.documentRepository?.repositoryId ?? "the document repo"} for people to review. Up to {count * 3} agent jobs, including independent review and one fix round.{" "}
        {regenerate
          ? "The documents are written again from the current template and replace the design the units have now: nothing changes on the default branch until the pull request is merged, the previous version stays in Git, and the designer reads the previous design to preserve supported answers and decisions in their original sections. Compare the changes before merging."
          : "A design that exists is never overwritten."}
      </p>
      {needs.length === 0 || draft ? null : <p className="mt-2 text-text-secondary">It builds on the {needs.join(", ")} design {forApplication ? "of the application" : "of each unit"}, which is already on the default branch.</p>}
      {forApplication ? null : <p className="mt-2 font-mono text-[12px] text-text-secondary">{unitsLine(pending?.units ?? [])}</p>}
    </ConfirmDialog>
  );
}
