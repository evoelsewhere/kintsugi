// Application layer: the portfolio overview. Reads every application's runs, assessment and item
// catalog, the gates and the pull requests waiting for a person, and composes where each
// application stands, what to decide next and the unit funnel. A source that cannot be read for
// one application (no catalog merged yet, a mirror still cloning) leaves that part empty instead
// of failing the overview.

import { Injectable } from "@nestjs/common";
import type { ItemStatus } from "@kintsugi/domain";
import { nowIso } from "#common/util/time.js";
import { DocumentWritesService } from "#modules/admin/document-writes/index.js";
import { type ProjectDetail, ProjectsService } from "#modules/admin/projects/index.js";
import { CatalogService, type CatalogItemView } from "#modules/delivery/catalog/index.js";
import { StageResultsService } from "#modules/delivery/documents/index.js";
import { JobRunsService, type JobRunView } from "#modules/delivery/runtime-jobs/index.js";
import { type Gate, GatesService } from "#modules/governance/gates/index.js";
import {
  type ApplicationProgress,
  type DecisionItem,
  DECISIONS_LIMIT,
  type GateState,
  PHASE_GATE,
  type PortfolioOverview,
  type RiskyUnit,
  derivePhase,
  riskiestUnits,
} from "../domain/portfolio.js";

/** Rows read per list; the overview is for one installation, not a data export. */
const PAGE = { limit: 500, offset: 0 };
const RECENT_RUNS = 200;

const KIND_RANK = { gate: 0, "pull-request": 1, findings: 2 } as const;

const firstLine = (message: string): string => message.split("\n", 1)[0]!.trim();
const oldestFirst = (a: { at: string }, b: { at: string }): number => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0);
const settle = <T>(work: Promise<T>): Promise<T | null> => work.catch(() => null);

interface Entry {
  progress: ApplicationProgress;
  items: CatalogItemView[];
}

@Injectable()
export class PortfolioService {
  constructor(
    private readonly projects: ProjectsService,
    private readonly runs: JobRunsService,
    private readonly results: StageResultsService,
    private readonly catalogs: CatalogService,
    private readonly gates: GatesService,
    private readonly writes: DocumentWritesService,
  ) {}

  async overview(): Promise<PortfolioOverview> {
    const projectList = (await this.projects.listProjects(PAGE)).items;
    const [details, gates, pullRequests] = await Promise.all([
      Promise.all(projectList.map((project) => this.projects.getProject(project.id))),
      this.gates.list({}, PAGE),
      this.writes.listAll({ statuses: ["pr-opened"] }, PAGE),
    ]);

    const entries = await Promise.all(details.flatMap((project) => project.applications.map((application) => this.#entry(project, application.id, application.name, gates.items))));

    const units: RiskyUnit[] = [];
    const funnel: PortfolioOverview["funnel"] = { total: 0, counts: {} };
    const decisions: DecisionItem[] = [];

    for (const { progress, items } of entries) {
      for (const item of items) {
        if (item.status === "retired") continue;
        funnel.total += 1;
        funnel.counts[item.status] = (funnel.counts[item.status] ?? 0) + 1;
        units.push({ projectId: progress.projectId, applicationId: progress.applicationId, id: item.id, name: item.name, module: item.module, complexity: item.complexity, loc: item.loc, status: item.status });
      }
      const { assess } = progress;
      if (assess !== null && assess.critical + assess.high > 0) {
        decisions.push({
          kind: "findings",
          at: progress.lastRunAt ?? nowIso(),
          title: `${progress.applicationName}: ${assess.critical} critical and ${assess.high} high security findings to triage`,
          projectId: progress.projectId,
          applicationId: progress.applicationId,
        });
      }
    }

    for (const gate of gates.items.filter((entry) => entry.status === "pending")) {
      decisions.push({
        kind: "gate",
        at: gate.requestedAt,
        title: `${gate.gateKey} · ${gate.title}`,
        detail: `Requested by ${gate.requestedBy}`,
        projectId: gate.projectId,
        ...(gate.applicationId === undefined ? {} : { applicationId: gate.applicationId }),
        gateId: gate.id,
      });
    }
    for (const write of pullRequests.items) {
      decisions.push({
        kind: "pull-request",
        at: write.updatedAt,
        title: firstLine(write.message),
        projectId: write.projectId,
        documentWriteId: write.id,
        ...(write.prUrl === undefined ? {} : { prUrl: write.prUrl }),
      });
    }
    // Gates first, then pull requests, then findings; the longest waiting first within each kind.
    decisions.sort((a, b) => KIND_RANK[a.kind] - KIND_RANK[b.kind] || oldestFirst(a, b));

    return {
      generatedAt: nowIso(),
      applications: entries.map((entry) => entry.progress),
      decisions: decisions.slice(0, DECISIONS_LIMIT),
      funnel,
      riskiest: riskiestUnits(units),
    };
  }

  async #entry(project: ProjectDetail, applicationId: string, applicationName: string, gates: readonly Gate[]): Promise<Entry> {
    const application = project.applications.find((candidate) => candidate.id === applicationId)!;
    const readable = project.documentRepository !== null;
    const blocked = !readable ? "The project has no document repo, so job output has nowhere to go." : application.asIs.legacy.length === 0 ? "Link a legacy code repo to the application to run stages." : undefined;
    const runs: JobRunView[] = readable ? ((await settle(this.runs.list(project.id, applicationId, { limit: RECENT_RUNS, offset: 0 })))?.items ?? []) : [];
    const stageRuns = runs.filter((run) => run.kind === "stage");
    const succeeded = (stage: string): boolean => stageRuns.some((run) => run.name === stage && run.status === "succeeded");
    const assessed = succeeded("assess");
    const [assessResults, catalog] = await Promise.all([
      assessed ? settle(this.results.results(project.id, applicationId, "assess", undefined, false)) : Promise.resolve(null),
      assessed ? settle(this.catalogs.view(project.id, applicationId, undefined)) : Promise.resolve(null),
    ]);

    const assessView = assessResults?.stage === "assess" ? assessResults : null;
    const inventory = assessView?.inventory ?? null;
    const security = assessView?.highlights.security ?? [];
    const items = catalog?.items ?? [];
    const open = items.filter((item) => item.status !== "retired");
    const understood = open.filter((item) => item.status === "understood").length;
    const phase = derivePhase({ ready: blocked === undefined, assessed, items: open.length, understood, designed: succeeded("design") });

    const gateKey = PHASE_GATE[phase];
    const latest = gates
      .filter((gate) => gate.projectId === project.id && gate.gateKey === gateKey && (gate.applicationId === undefined || gate.applicationId === applicationId))
      .sort((a, b) => (a.requestedAt < b.requestedAt ? 1 : -1))[0];
    const gate: GateState | null = gateKey === undefined ? null : latest === undefined ? { key: gateKey, status: "not-requested" } : { key: gateKey, status: latest.status, gateId: latest.id, requestedAt: latest.requestedAt };

    const progress: ApplicationProgress = {
      projectId: project.id,
      projectName: project.name,
      applicationId,
      applicationName,
      phase,
      gate,
      assess:
        assessView === null
          ? null
          : {
              sloc: inventory?.sloc ?? 0,
              sourceFiles: inventory?.sourceFileCount ?? 0,
              complexityIndex: inventory?.complexityIndex ?? 0,
              critical: security.filter((finding) => finding.severity === "Critical").length,
              high: security.filter((finding) => finding.severity === "High").length,
              securityFindings: security.length,
              ...(assessView.highlights.recommendation === undefined ? {} : { recommendation: assessView.highlights.recommendation }),
            },
      catalog: catalog === null ? null : { total: open.length, understood, counts: catalog.counts as Partial<Record<ItemStatus, number>> },
      ...(blocked === undefined ? {} : { blocked }),
      ...(stageRuns[0] === undefined ? {} : { lastRunAt: stageRuns[0].createdAt }),
    };
    return { progress, items };
  }
}
