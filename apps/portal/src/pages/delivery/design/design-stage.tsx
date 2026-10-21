// The Design stage of one application (ADR-0044, ADR-0045): where the design stands, read from the
// document repo. Members write the designs in their harness, so the page only shows what exists,
// whether it conforms to the project's own templates, and what to do next.
// URL: …&tab=overview|units|coverage|sets|common, &set=&state=&module=&kind= (the Units filters),
// &item=<module>/<unit>&view=<set>|coverage (the unit's drawer), &sets=<set> (a set's drawer),
// &ref=<branch or commit> (a design in an open pull request).

import { useSearchParams } from "react-router-dom";
import { Loaded } from "@/components/loaded";
import { Select } from "@/components/ui/select";
import { Tabs } from "@/components/ui/tabs";
import { designApi, type DesignState } from "@/lib/api/design";
import { documentsApi } from "@/lib/api/documents";
import type { StageView } from "@/lib/api/job-runs";
import type { ApplicationView, ProjectDetail } from "@/lib/api/projects";
import { deliveryLink } from "@/lib/links";
import { stageLabel } from "@/lib/stages";
import { useLoader } from "@/lib/use-loader";
import { CompactFacts, StageHeader } from "../delivery-shell";
import { DesignCommonTab, DesignCoverageTab } from "./design-common";
import { DesignOverviewTab } from "./design-overview";
import { DesignSetsTab } from "./design-sets";
import { DesignUnitsTab } from "./design-units";
import type { UnitFilters } from "./design-state";
import { UnitDesignDrawer } from "./design-unit-drawer";

type DesignTab = "overview" | "units" | "coverage" | "sets" | "common";
const TABS: readonly DesignTab[] = ["overview", "units", "coverage", "sets", "common"];
const STATES: readonly string[] = ["conformant", "problems", "stale", "missing", "waived"];

export function DesignStage({ project, application, stage }: { project: ProjectDetail; application: ApplicationView; stage: StageView }): React.JSX.Element {
  const [params, setParams] = useSearchParams();
  const requested = params.get("tab");
  const tab: DesignTab = TABS.find((entry) => entry === requested) ?? "overview";
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
      { replace: true },
    );

  const overview = useLoader(`design/overview/${project.id}/${application.id}/${refParam ?? ""}`, () => designApi.overview(project.id, application.id, refParam));
  const sets = useLoader(`design/sets/${project.id}/${application.id}/${refParam ?? ""}`, () => designApi.sets(project.id, { app: application.id, ...(refParam === undefined ? {} : { ref: refParam }) }));
  const common = useLoader(`design/common/${project.id}/${application.id}/${refParam ?? ""}`, () => designApi.common(project.id, application.id, refParam));
  const refs = useLoader(`refs/${project.id}`, () => documentsApi.refs(project.id));

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

  return (
    <div className="flex flex-col gap-4">
      <StageHeader
        title={stageLabel(stage.id)}
        command={stage.command}
        application={application}
        description={stage.description}
        facts={<CompactFacts project={project} application={application} />}
        actions={refOptions.length > 1 ? <Select value={refParam ?? ""} onChange={(value) => update({ ref: value })} options={refOptions} /> : undefined}
      />
      <Tabs<DesignTab>
        sticky
        label="Design sections"
        value={tab}
        onChange={(next) => update({ tab: next })}
        tabs={[
          { id: "overview", label: "Overview", count: attention === 0 ? undefined : attention },
          { id: "units", label: "Units", count: overview.data?.units.length },
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
      ) : (
        <Loaded loader={overview} rows={8}>
          {(view) =>
            tab === "overview" ? (
              <DesignOverviewTab overview={view} applicationId={application.id} onOpenUnits={openUnits} onOpenUnit={(key) => open(key)} onOpenSets={() => update({ tab: "sets" })} />
            ) : tab === "units" ? (
              <DesignUnitsTab
                overview={view}
                filters={filters}
                onFilters={(patch) => update({ ...patch })}
                selected={params.get("item") ?? undefined}
                onOpen={(key) => open(key)}
                understandLink={deliveryLink({ projectId: project.id, applicationId: application.id, stage: "understand" })}
              />
            ) : (
              <DesignCoverageTab overview={view} filter={coverageFilter} onFilter={(next) => update({ cov: next === "all" ? undefined : next })} onOpenUnit={(key) => open(key, "coverage")} />
            )
          }
        </Loaded>
      )}

      <UnitDesignDrawer project={project} application={application} unitKey={params.get("item") ?? undefined} refParam={refParam} view={params.get("view") ?? undefined} onView={(view) => update({ view })} onClose={() => open(undefined, undefined)} />
    </div>
  );
}
