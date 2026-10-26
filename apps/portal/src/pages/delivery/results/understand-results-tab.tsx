// The Results tab of the understand stage (ADR-0033): sub-tabs Units & traceability, Topology,
// Rules and Security, reusing the result views of the former stages, and a scope switch between
// the whole application (the generated views on the default branch) and one catalog item (its own
// files: on the default branch once understood, on its run's branch while in a pull request).
// Loaded lazily with its heavy libraries. URL: …&tab=results&view=<view>&item=<id>.

import { PackageOpen, RefreshCw } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { Loaded } from "@/components/loaded";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Select } from "@/components/ui/select";
import { Tabs } from "@/components/ui/tabs";
import { type CatalogView, catalogApi, type UnderstandView } from "@/lib/api/catalog";
import type { StageResults, UnderstandResults } from "@/lib/api/documents";
import type { JobRunView } from "@/lib/api/job-runs";
import type { ApplicationView, ProjectDetail } from "@/lib/api/projects";
import { shortSha } from "@/lib/format";
import { isActiveStatus } from "@/lib/status";
import { useLoader } from "@/lib/use-loader";
import { DataResultsView } from "./data-results";
import { GapsResultsView } from "./gaps-results";
import { HardenResultsView } from "./harden-results";
import { MapResultsView } from "./map-results";
import { OutputFiles, Section } from "./results-parts";
import { RulesResultsView } from "./rules-results";
import { UnderstandFirstSteps } from "./understand-first-steps";
import { UnderstandResultsView } from "./understand-results";

/** The Data view joins the rules, the topology and the traceability matrix, so it has no results of its own. */
type ViewId = UnderstandView | "data";

const VIEWS: Array<{ id: ViewId; label: string }> = [
  { id: "understand", label: "Units & traceability" },
  { id: "map", label: "Topology" },
  { id: "extract-rules", label: "Rules" },
  { id: "data", label: "Data" },
  { id: "harden", label: "Security" },
  { id: "gaps", label: "Gaps" },
];

const isView = (value: string | null): value is ViewId => VIEWS.some((view) => view.id === value);

type ResultsTab = ViewId;

export interface UnderstandResultsTabProps {
  project: ProjectDetail;
  application: ApplicationView;
  catalog: CatalogView | null;
  /** Changes when a run finishes, so the results are read again. */
  version: string;
  /** The understand runs of the application, newest first. */
  runs?: JobRunView[] | undefined;
  /** Opens the Catalog tab, where the items to understand are chosen. */
  onOpenCatalog: () => void;
  /** Opens the Runs tab. */
  onOpenRuns: () => void;
}

export default function UnderstandResultsTab({ project, application, catalog, version, runs, onOpenCatalog, onOpenRuns }: UnderstandResultsTabProps): React.JSX.Element {
  const [params, setParams] = useSearchParams();
  const requested = params.get("view");
  const view: ViewId = isView(requested) ? requested : "understand";
  const apiView: UnderstandView = view === "data" ? "understand" : view;
  const item = params.get("item") ?? undefined;
  const entry = item === undefined ? undefined : catalog?.items.find((candidate) => candidate.id === item);
  // An item in an open pull request is read at its run's branch; otherwise at the default branch.
  const ref = entry?.status === "in-pr" && entry.pr !== undefined ? `refs/heads/${entry.pr.branch}` : undefined;
  const results = useLoader(`understand-results/${project.id}/${application.id}/${apiView}/${item ?? "app"}/${ref ?? ""}/${version}`, () => catalogApi.results(project.id, application.id, apiView, item, ref));

  const update = (key: string, value: string | undefined): void =>
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        if (value === undefined) next.delete(key);
        else next.set(key, value);
        return next;
      },
      { replace: true },
    );

  const scopes = [
    { value: "", label: "Application (default branch)", hint: "Generated views" },
    ...(catalog?.items ?? [])
      .filter((candidate) => candidate.status === "understood" || candidate.status === "stale" || candidate.status === "in-pr")
      .map((candidate) => ({ value: candidate.id, label: candidate.name, hint: candidate.status === "in-pr" ? "in pull request" : candidate.id })),
  ];
  if (item !== undefined && !scopes.some((scope) => scope.value === item)) scopes.push({ value: item, label: item, hint: "" });

  const tabs = VIEWS;

  return (
    <div className="flex flex-col gap-4">
      <Card className="py-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="w-full sm:w-[340px]">
              <Select size="small" value={item ?? ""} options={scopes} onChange={(value) => update("item", value === "" ? undefined : value)} />
            </div>
            <span className="text-[12px] text-text-muted">
              {item === undefined ? "Rebuilt from every understood item after each merge." : ref === undefined ? "This item's own files on the default branch." : `This item's files in its open pull request (${entry?.pr?.branch ?? ""}).`}
            </span>
            <Button size="icon" variant="ghost" className="ml-auto" aria-label="Reload the results" onClick={() => void results.reload()}>
              <RefreshCw />
            </Button>
          </div>
        </Card>

      <Tabs<ResultsTab> label="understand results" value={view} onChange={(next) => update("view", next)} tabs={tabs} />

      <Loaded loader={results} rows={6}>
          {(loaded) =>
            loaded.empty && item === undefined ? (
              <UnderstandFirstSteps
                applicationName={application.name}
                hasCatalog={catalog !== null}
                running={(runs ?? []).some((run) => isActiveStatus(run.status))}
                onOpenCatalog={onOpenCatalog}
                onOpenRuns={onOpenRuns}
              />
            ) : loaded.empty ? (
              <Card>
                <EmptyState
                  icon={PackageOpen}
                  title={`No ${VIEWS.find((entry) => entry.id === view)?.label.toLowerCase()} for ${item ?? ""} yet`}
                  description="Run understand on this item in the Catalog; its files appear here while its pull request is open and after it is merged."
                  action={
                    <Button size="small" variant="ghost" className="shadow-border" onClick={onOpenCatalog}>
                      Go to the Catalog
                    </Button>
                  }
                />
              </Card>
            ) : (
              <>
                <ResultsView view={view} results={loaded} project={project} application={application} item={item} gitRef={ref} version={version} onOpenItem={(id) => update("item", id)} />
                <Section title="Files" description={`At ${loaded.ref.branch ?? shortSha(loaded.ref.commit)} in ${project.documentRepository?.repositoryId ?? "the document repo"}.`}>
                  <OutputFiles files={loaded.files} />
                </Section>
              </>
            )
          }
        </Loaded>
    </div>
  );
}

function ResultsView({
  view,
  results,
  project,
  application,
  item,
  gitRef,
  version,
  onOpenItem,
}: {
  view: ViewId;
  results: StageResults;
  project: ProjectDetail;
  application: ApplicationView;
  item: string | undefined;
  gitRef: string | undefined;
  version: string;
  onOpenItem: (item: string) => void;
}): React.JSX.Element | null {
  const projectId = project.id;
  if (view === "data") return results.stage === "understand" ? <DataTab results={results} project={project} application={application} item={item} gitRef={gitRef} version={version} onOpenItem={onOpenItem} /> : null;
  switch (results.stage) {
    case "map":
      return <MapResultsView results={results} compare={false} />;
    case "extract-rules":
      return <RulesResultsView results={results} compare={false} projectId={projectId} />;
    case "harden":
      return <HardenResultsView results={results} compare={false} />;
    case "understand":
      return <UnderstandResultsView results={results} compare={false} projectId={projectId} />;
    case "gaps":
      return <GapsResultsView projectId={projectId} results={results} onOpenItem={onOpenItem} />;
    default:
      return null;
  }
}

/** The Data view: the understand results it was opened on, with the rules and the topology read beside them. */
function DataTab({
  results,
  project,
  application,
  item,
  gitRef,
  version,
  onOpenItem,
}: {
  results: UnderstandResults;
  project: ProjectDetail;
  application: ApplicationView;
  item: string | undefined;
  gitRef: string | undefined;
  version: string;
  onOpenItem: (item: string) => void;
}): React.JSX.Element {
  const key = `${project.id}/${application.id}/${item ?? "app"}/${gitRef ?? ""}/${version}`;
  const rules = useLoader(`understand-results/${key}/extract-rules`, () => catalogApi.results(project.id, application.id, "extract-rules", item, gitRef));
  const map = useLoader(`understand-results/${key}/map`, () => catalogApi.results(project.id, application.id, "map", item, gitRef));
  return (
    <Loaded loader={rules} rows={4}>
      {(rulesResults) => (
        <Loaded loader={map} rows={4}>
          {(mapResults) =>
            rulesResults.stage === "extract-rules" && mapResults.stage === "map" ? <DataResultsView rules={rulesResults} map={mapResults} understand={results} onOpenItem={onOpenItem} /> : null
          }
        </Loaded>
      )}
    </Loaded>
  );
}
