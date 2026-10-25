// Application layer: starting an understand run on a selection of catalog items (ADR-0033). The
// selection (items and whole modules) is resolved against the catalog on the default branch; the
// run's inputs carry the items, their files and the pinned document-repo commit, so every step of
// the run reads the same documents. Items that are running or in an open pull request block a new
// run on them (409 with the conflicts); Abandon on the earlier run releases them.

import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { DOCUMENT_REFERENCE_SCOPE_PATTERN } from "@kintsugi/domain";
import type { Actor } from "#common/auth/decorators.js";
import { JobRunsService, type JobRunView } from "#modules/delivery/runtime-jobs/index.js";
import { isBlocked } from "../domain/catalog.js";
import { CatalogService, UNDERSTAND_STAGE } from "./catalog.service.js";


export interface UnderstandSelection {
  items?: string[];
  modules?: string[];
  /** A failed understand run to resume instead (same as POST job-runs/:runId/retry). */
  resumeOf?: string;
}

@Injectable()
export class UnderstandRunsService {
  constructor(
    private readonly catalog: CatalogService,
    private readonly runs: JobRunsService,
  ) {}

  async start(projectId: string, applicationId: string, selection: UnderstandSelection, actor: Actor): Promise<JobRunView> {
    if (selection.resumeOf !== undefined) {
      const previous = await this.runs.summary(projectId, selection.resumeOf);
      if (previous.name !== UNDERSTAND_STAGE || previous.applicationId !== applicationId) throw new BadRequestException(`Job run ${selection.resumeOf} is not an understand run of ${applicationId}`);
      return this.runs.retry(projectId, selection.resumeOf, actor);
    }
    const loaded = await this.catalog.load(projectId, applicationId, undefined).catch((error: unknown) => {
      if (error instanceof NotFoundException && !/Application/.test(error.message)) {
        throw new ConflictException(`The item catalog of ${applicationId} is not merged on the default branch: run assess and merge its pull request first`);
      }
      throw error;
    });
    const byId = new Map(loaded.catalog.items.map((item) => [item.id, item]));
    const wanted = new Set(selection.items ?? []);
    const unknownModules: string[] = [];
    for (const module of selection.modules ?? []) {
      const members = loaded.catalog.items.filter((item) => item.id.startsWith(`${module}/`) || item.module === module);
      if (members.length === 0) unknownModules.push(module);
      for (const item of members) if (item.status === "active") wanted.add(item.id);
    }
    const invalid = [...wanted].filter((id) => byId.get(id)?.status !== "active");
    if (invalid.length > 0 || unknownModules.length > 0) {
      throw new BadRequestException({
        message: `Unknown or retired catalog ids: ${[...invalid, ...unknownModules.map((module) => `${module} (module)`)].slice(0, 20).join(", ")}`,
        details: { unknown: invalid, unknownModules },
      });
    }
    if (wanted.size === 0) throw new BadRequestException("Select at least one catalog item or module");
    const codes = loaded.catalog.items.flatMap((item) => item.referenceCode === undefined ? [] : [item.referenceCode]);
    if (new Set(codes).size !== codes.length || [...wanted].some((id) => !DOCUMENT_REFERENCE_SCOPE_PATTERN.test(byId.get(id)?.referenceCode ?? ""))) {
      throw new ConflictException("Run assess and merge its catalog before understand: the selected items need valid, unique reference codes");
    }
    const view = await this.catalog.withStatus(loaded, applicationId);
    const conflicts = view.items
      .filter((item) => wanted.has(item.id) && isBlocked(item))
      .map((item) => ({ item: item.id, runId: item.status === "in-pr" ? item.pr?.runId : item.lastRun?.id, state: item.status }));
    if (conflicts.length > 0) {
      throw new ConflictException({
        message: `${conflicts.length} selected item(s) are running or in an open pull request: ${conflicts.slice(0, 10).map((entry) => entry.item).join(", ")} (abandon a closed pull request to release its items)`,
        details: { conflicts },
      });
    }
    const items = [...wanted].sort();
    const files = [...new Set(items.flatMap((id) => byId.get(id)?.files ?? []))].sort();
    // Pinned: the default branch tip the catalog was read at.
    return this.runs.startRun(projectId, applicationId, UNDERSTAND_STAGE, actor, { inputs: { scope: { items, files }, documentsCommit: loaded.ref.commit } });
  }
}
