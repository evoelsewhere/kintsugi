// Stages Kintsugi does not run itself, read-only: member stages (members run them in their own
// harness through the Kintsugi plugin; Kintsugi supplies context and ingests the results) with
// the evidence found in recent document writes, and portal stages (planned portal screens).

import { FileSearch, Laptop, LayoutDashboard } from "lucide-react";
import { DocumentWriteList } from "@/components/document-write-list";
import { Loaded } from "@/components/loaded";
import { StatusBadge } from "@/components/status-badges";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { agentsApi } from "@/lib/api/agents";
import type { StageView } from "@/lib/api/job-runs";
import { type ApplicationView, type DocumentWriteView, type ProjectDetail, projectsApi } from "@/lib/api/projects";
import { fileName, stageLabel } from "@/lib/stages";
import { useLoader } from "@/lib/use-loader";
import { ApplicationFacts } from "./delivery-shell";
import { DecisionPoints, StageAgents, StagePaths } from "./stage-parts";

const EVIDENCE_WINDOW = 50;

function StageSummary({ stage, badge, icon: Icon, children }: { stage: StageView; badge: React.ReactNode; icon: typeof Laptop; children: React.ReactNode }): React.JSX.Element {
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2">
        <Icon className="size-4 text-text-muted" strokeWidth={1.75} />
        <p className="text-[15px] font-medium text-text">{stageLabel(stage.id)}</p>
        <span className="font-mono text-[11px] text-text-muted">/{stage.command}</span>
        {badge}
      </div>
      <p className="mt-1 text-[13px] text-text-secondary">{stage.description}</p>
      <div className="mt-3 text-[12px] text-text-secondary">{children}</div>
    </Card>
  );
}

/** Writes whose message names one of the files the stage writes (or the stage's command). */
function evidenceOf(stage: StageView, writes: DocumentWriteView[]): DocumentWriteView[] {
  const names = [...new Set(stage.writes.map(fileName).filter((name): name is string => name !== undefined)), `/${stage.command}`];
  return writes.filter((write) => names.some((name) => write.message.includes(name)));
}

export function MemberStage({ project, application, stage }: { project: ProjectDetail; application: ApplicationView; stage: StageView }): React.JSX.Element {
  const agents = useLoader(`agents/${project.id}`, () => agentsApi.list(project.id));
  const writes = useLoader(`writes/${project.id}/${EVIDENCE_WINDOW}`, async () => (await projectsApi.documentWrites(project.id, EVIDENCE_WINDOW)).items, {
    live: [`document-writes:${project.id}`],
  });

  return (
    <div className="flex flex-col gap-5">
      <StageSummary stage={stage} icon={Laptop} badge={<StatusBadge tone="muted" label="Run by members" />}>
        <p>
          Members run <span className="font-mono">/{stage.command}</span> in their own harness (Claude Code, Copilot or Codex) with the Kintsugi plugin. Kintsugi supplies the context and ingests
          the results; it does not start or drive this stage. Document outputs go to the document repo; code changes, when the stage makes them, go to the application's target repos.
        </p>
        <div className="mt-3 [box-shadow:0_-1px_0_rgba(0,0,0,0.06)] pt-3">
          <ApplicationFacts project={project} application={application} />
        </div>
      </StageSummary>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <StagePaths stage={stage} applicationId={application.id} documentRepository={project.documentRepository?.repositoryId} />
        <div className="flex flex-col gap-5">
          <StageAgents stage={stage} agents={agents} />
          <DecisionPoints stage={stage} />
        </div>
      </div>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Evidence in the document repo</CardTitle>
            <CardDescription>Recent writes to the document repo that name the stage's outputs (the last {EVIDENCE_WINDOW} writes of the project).</CardDescription>
          </div>
        </CardHeader>
        <div className="mt-2">
          <Loaded loader={writes} rows={2}>
            {(list) => {
              const evidence = evidenceOf(stage, list);
              return evidence.length === 0 ? (
                <EmptyState icon={FileSearch} title="No evidence yet" description="When members commit the stage's outputs to the document repo, the writes appear here." />
              ) : (
                <DocumentWriteList writes={evidence} />
              );
            }}
          </Loaded>
        </div>
      </Card>
    </div>
  );
}

export function PortalStage({ project, application, stage }: { project: ProjectDetail; application: ApplicationView; stage: StageView }): React.JSX.Element {
  return (
    <div className="flex flex-col gap-5">
      <StageSummary stage={stage} icon={LayoutDashboard} badge={<StatusBadge tone="muted" label="Planned" />}>
        <p>
          This stage becomes a portal screen. Its command <span className="font-mono">/{stage.command}</span> specifies what the screen does; the screen is not built yet.
        </p>
      </StageSummary>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <StagePaths stage={stage} applicationId={application.id} documentRepository={project.documentRepository?.repositoryId} />
        <DecisionPoints stage={stage} />
      </div>
    </div>
  );
}
