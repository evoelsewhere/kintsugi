// Delivery → <stage>: one pipeline stage for the chosen application. Runtime stages can be run
// and followed here; member stages and portal stages are explained read-only.
// URL: /delivery/<stage>?project=<id>&app=<id>&run=<id>. An unknown stage (such as a former
// per-workstream path) goes back to the Delivery overview, keeping the query.

import { Navigate, useLocation, useParams } from "react-router-dom";
import { Loaded } from "@/components/loaded";
import { Card } from "@/components/ui/card";
import { jobRunsApi, type StageView } from "@/lib/api/job-runs";
import type { ProjectDetail } from "@/lib/api/projects";
import { AUDIENCE_LABEL } from "@/lib/stages";
import { useLoader } from "@/lib/use-loader";
import { ApplicationTabs, DeliveryShell, NoApplications, WithProject } from "./delivery-shell";
import { useApplication } from "./use-application";
import { MemberStage, PortalStage } from "./other-stages";
import { RuntimeStage } from "./runtime-stage";
import { UnderstandStage } from "./understand-stage";

const DESCRIPTION: Record<StageView["audience"], string> = {
  runtime: "Runs as Kintsugi runtime jobs: read the legacy code read-only, propose the outputs to the document repo.",
  member: "Run by members in their own harness; Kintsugi supplies context and shows the evidence.",
  portal: "A portal screen, planned.",
};

export function DeliveryStagePage(): React.JSX.Element {
  const { stage: stageId = "" } = useParams();
  const { search } = useLocation();
  const stages = useLoader("stages", jobRunsApi.stages);
  const stage = stages.data?.find((entry) => entry.id === stageId);

  if (stages.data !== undefined && stage === undefined) return <Navigate replace to={`/delivery${search}`} />;

  return (
    <DeliveryShell
      crumbs={stage === undefined ? [stageId] : [AUDIENCE_LABEL[stage.audience], stage.id]}
      title={`Stage ${stageId}`}
      description={stage === undefined ? "" : DESCRIPTION[stage.audience]}
    >
      {(projectId) =>
        stage === undefined ? (
          <Card>
            <Loaded loader={stages} rows={4}>
              {() => null}
            </Loaded>
          </Card>
        ) : (
          <WithProject projectId={projectId}>{(project) => <StageForProject project={project} stage={stage} />}</WithProject>
        )
      }
    </DeliveryShell>
  );
}

function StageForProject({ project, stage }: { project: ProjectDetail; stage: StageView }): React.JSX.Element {
  const { application, choose } = useApplication(project);
  if (application === undefined) return <NoApplications project={project} />;
  return (
    <div className="flex flex-col gap-4">
      {project.applications.length > 1 ? <ApplicationTabs project={project} value={application.id} onChange={choose} /> : null}
      {stage.id === "understand" ? (
        <UnderstandStage key={application.id} project={project} application={application} stage={stage} />
      ) : stage.audience === "runtime" ? (
        <RuntimeStage key={`${application.id}/${stage.id}`} project={project} application={application} stage={stage} />
      ) : stage.audience === "member" ? (
        <MemberStage key={`${application.id}/${stage.id}`} project={project} application={application} stage={stage} />
      ) : (
        <PortalStage project={project} application={application} stage={stage} />
      )}
    </div>
  );
}
