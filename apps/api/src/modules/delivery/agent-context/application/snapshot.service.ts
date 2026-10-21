// Creates immutable, Project Access-scoped snapshots and renders bounded task briefs from Git.

import { createHash, randomUUID } from "node:crypto";
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
} from "@nestjs/common";
import type { ContextSource, TaskBrief, TaskBriefQuery } from "@kintsugi/harness-sdk";
import { DEFAULT_CONTEXT_BYTES, taskBriefSchema } from "@kintsugi/harness-sdk";
import { markdownHeading, memberTaskSummary, type MemberActivity } from "@kintsugi/domain";
import type { MemberPrincipal } from "#modules/core/auth/index.js";
import { DocumentsService } from "#modules/delivery/documents/index.js";
import { TaskApprovalEvidenceReader } from "../domain/task.js";
import type { MemberTaskRecord } from "../domain/task.js";
import { ProjectAccessPort } from "../domain/project-access.ports.js";
import {
  SnapshotRepository,
  boundSnapshotSections,
  buildSnapshotManifest,
  contextSourceId,
  indexMarkdownSections,
  type SnapshotManifest,
  type SnapshotRecord,
  type SnapshotSource,
} from "../domain/snapshot.js";
import { TaskQueryService } from "./task-query.service.js";
import { selectBriefSections } from "./brief-sections.js";
import { snapshotError } from "./snapshot-error.js";

const SNAPSHOT_TTL_MS = 24 * 60 * 60 * 1000;
const PREPARE_TIMEOUT_MS = 30_000;
const PREPARE_POLL_MS = 100;
const MAX_SOURCE_BYTES = 256 * 1024;
const MAX_SNAPSHOT_SOURCES = 100;
const MAX_BRIEF_SOURCE_BYTES = 8 * 1024 * 1024;
const POLICY_REVISION = "member-context-v1";

interface PreparedSnapshot {
  manifest: SnapshotManifest;
  workItem: MemberTaskRecord["workItem"];
  readiness: MemberTaskRecord["readiness"];
}

@Injectable()
export class SnapshotService {
  constructor(
    private readonly tasks: TaskQueryService,
    private readonly approvals: TaskApprovalEvidenceReader,
    private readonly projectAccess: ProjectAccessPort,
    private readonly documents: DocumentsService,
    private readonly snapshots: SnapshotRepository,
  ) {}

  /**
   * Rebuilds the current implementation context for a server-side gate decision. The caller
   * supplies identity only; revisions and required deliverables always come from Git-backed data.
   */
  async currentGateContext(userId: string, projectId: string, unitId: string): Promise<{
    projectId: string;
    unitId: string;
    contextRevision: string;
    policyRevision: string;
    requiredDeliverableIds: string[];
    requiredDeliverables: Array<{ id: string; repositoryId: string; path: string }>;
  }> {
    const principal: MemberPrincipal = {
      userId,
      tokenId: "session-gate-context",
      projectIds: [projectId],
      credentialKind: "coding-agent-read",
    };
    await this.authorize(principal, projectId);
    const task = await this.tasks.get(principal, { projectId, unitId });
    const prepared = await this.prepareSnapshot(task, "implementation", "gate_" + randomUUID());
    return {
      projectId,
      unitId,
      contextRevision: prepared.manifest.contextRevision,
      policyRevision: prepared.manifest.policyRevision,
      requiredDeliverableIds: [...prepared.manifest.requiredDeliverableIds],
      requiredDeliverables: (prepared.workItem.requiredDeliverables ?? []).map(({ id, repositoryId, path }) => ({ id, repositoryId, path })),
    };
  }

  async brief(principal: MemberPrincipal, query: TaskBriefQuery): Promise<TaskBrief> {
    await this.authorize(principal, query.projectId);
    const maxBytes = query.maxBytes ?? DEFAULT_CONTEXT_BYTES;
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > DEFAULT_CONTEXT_BYTES) {
      throw new ConflictException("maxBytes must be between 1 and " + DEFAULT_CONTEXT_BYTES);
    }

    let record: SnapshotRecord;
    if (query.snapshotId === undefined) {
      const task = await this.tasks.get(principal, { projectId: query.projectId, unitId: query.unitId });
      const prepared = await this.prepareSnapshot(task, query.activity, "ctx_" + randomUUID());
      await this.snapshots.create({
        manifest: prepared.manifest,
        workItem: prepared.workItem,
        readiness: prepared.readiness,
        requestedByUserId: principal.userId,
        retentionMs: SNAPSHOT_TTL_MS,
      });
      record = await this.waitUntilReady(prepared.manifest.snapshotId);
    } else {
      record = await this.requireSnapshot(query.snapshotId);
      this.assertIdentity(record, query.projectId, query.unitId, query.activity);
      await this.assertAvailable(record);
      if (record.status === "preparing") record = await this.waitUntilReady(query.snapshotId);
      if (record.status === "failed") throw snapshotError("SNAPSHOT_UNAVAILABLE", record.manifest.snapshotId, record.errorCode ?? "SNAPSHOT_UNAVAILABLE");
      if (record.status === "expired" || record.status === "expiring") throw snapshotError("SNAPSHOT_EXPIRED", record.manifest.snapshotId);
    }

    const currentness = await this.currentness(principal, record);
    const sourceTexts = await this.readBriefSources(record);
    const taskPack = record.manifest.sources.find((source) => source.role === "task-pack");
    const taskPackText = taskPack === undefined ? undefined : sourceTexts.get(taskPack.sourceId);
    const { objective, acceptanceCriteria } = memberTaskSummary(taskPackText, record.workItem.title);
    const summaryBytes = Buffer.byteLength(objective, "utf8")
      + acceptanceCriteria.reduce((total, criterion) => total + Buffer.byteLength(criterion, "utf8"), 0);
    if (summaryBytes > maxBytes) {
      throw new PayloadTooLargeException("The required task summary exceeds the requested brief byte limit");
    }
    const selection = selectBriefSections(record.manifest.sources, sourceTexts, maxBytes - summaryBytes);

    let nextCursor: string | undefined;
    for (const omitted of selection.omittedSections) {
      const source = record.manifest.sources.find((candidate) => candidate.sourceId === omitted.sourceId);
      if (source === undefined || !source.readable || sourceTexts.get(source.sourceId) === undefined) continue;
      if (!source.sections.some((section) => section.sectionId === omitted.sectionId)) continue;
      nextCursor = await this.snapshots.createCursor({
        snapshotId: record.manifest.snapshotId,
        kind: "document",
        sourceId: source.sourceId,
        sectionId: omitted.sectionId,
        characterOffset: 0,
      });
      break;
    }

    const sources: ContextSource[] = record.manifest.sources.map((source) => ({
      sourceId: source.sourceId,
      role: source.role,
      repositoryId: source.repositoryId,
      path: source.path,
      availability: source.availability,
      publication: source.publication,
      approval: { status: source.approval },
      ...(source.commit === undefined ? {} : { commit: source.commit }),
      ...(source.contentHash === undefined ? {} : { contentHash: source.contentHash }),
    }));
    const result: TaskBrief = {
      schemaVersion: "1",
      projectId: record.manifest.projectId,
      unitId: record.manifest.unitId,
      activity: record.manifest.activity,
      title: record.workItem.title.slice(0, 500),
      objective,
      acceptanceCriteria,
      snapshotId: record.manifest.snapshotId,
      contextRevision: record.manifest.contextRevision,
      documentRepoCommit: record.manifest.task.commit,
      sources,
      requiredDeliverableIds: record.manifest.requiredDeliverableIds,
      readiness: record.readiness,
      blockers: record.readiness.blockers,
      requiredContextStatus: selection.requiredContextStatus,
      sections: selection.sections,
      omittedSections: selection.omittedSections,
      freshness: currentness,
      fetchedAt: new Date().toISOString(),
      ...(nextCursor === undefined ? {} : { nextCursor }),
    };
    return taskBriefSchema.parse(result);
  }

  async authorize(principal: MemberPrincipal, projectId: string): Promise<void> {
    if (!principal.projectIds.includes(projectId)) {
      throw new ForbiddenException("The token is not scoped to this project");
    }
    await this.projectAccess.requireRead(principal.userId, projectId);
  }

  async requireSnapshot(snapshotId: string): Promise<SnapshotRecord> {
    const record = await this.snapshots.get(snapshotId);
    if (record === undefined) throw new NotFoundException("Snapshot not found");
    return record;
  }

  async assertAvailable(record: SnapshotRecord): Promise<void> {
    if (
      record.status === "expired" ||
      record.status === "expiring" ||
      !(await this.snapshots.isAvailable(record.manifest.snapshotId))
    ) {
      throw snapshotError("SNAPSHOT_EXPIRED", record.manifest.snapshotId);
    }
  }

  assertIdentity(record: SnapshotRecord, projectId: string, unitId: string, activity: MemberActivity): void {
    if (
      record.manifest.projectId !== projectId ||
      record.manifest.unitId !== unitId ||
      record.manifest.activity !== activity
    ) {
      throw new NotFoundException("Snapshot not found");
    }
  }

  async readSource(record: SnapshotRecord, source: SnapshotSource): Promise<string> {
    if (!source.readable || source.availability !== "present" || source.commit === undefined || source.contentHash === undefined) {
      throw snapshotError("SNAPSHOT_UNAVAILABLE", record.manifest.snapshotId, "SNAPSHOT_SOURCE_UNAVAILABLE");
    }
    const context = await this.documents.context(record.manifest.projectId).catch((error: unknown) => {
      if (error instanceof ConflictException) {
        throw snapshotError("SNAPSHOT_UNAVAILABLE", record.manifest.snapshotId, "Snapshot repository context is unavailable");
      }
      throw error;
    });
    if (context.repo.repositoryId !== source.repositoryId) {
      throw snapshotError("SNAPSHOT_UNAVAILABLE", record.manifest.snapshotId, "The snapshot repository is no longer linked to this project");
    }
    try {
      await this.documents.resolve(context, source.commit);
    } catch (error) {
      if (error instanceof NotFoundException) throw snapshotError("SNAPSHOT_UNAVAILABLE", record.manifest.snapshotId);
      throw error;
    }
    const text = await this.documents.readText(context, source.commit, source.path, MAX_SOURCE_BYTES);
    if (text === undefined) throw snapshotError("SNAPSHOT_UNAVAILABLE", record.manifest.snapshotId, "SNAPSHOT_SOURCE_UNAVAILABLE");
    const actualHash = "sha256:" + hash(text);
    if (actualHash !== source.contentHash) throw snapshotError("SNAPSHOT_UNAVAILABLE", record.manifest.snapshotId, "SNAPSHOT_SOURCE_HASH_MISMATCH");
    return text;
  }

  async waitUntilReady(snapshotId: string): Promise<SnapshotRecord> {
    const deadline = Date.now() + PREPARE_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const record = await this.requireSnapshot(snapshotId);
      await this.assertAvailable(record);
      if (record.status === "ready") return record;
      if (record.status === "failed") throw snapshotError("SNAPSHOT_UNAVAILABLE", record.manifest.snapshotId, record.errorCode ?? "SNAPSHOT_UNAVAILABLE");
      if (record.status === "expired") throw snapshotError("SNAPSHOT_EXPIRED", record.manifest.snapshotId);
      await new Promise((resolve) => setTimeout(resolve, PREPARE_POLL_MS));
    }
    throw snapshotError("SNAPSHOT_PREPARING", snapshotId);
  }

  private async prepareSnapshot(task: MemberTaskRecord, activity: MemberActivity, snapshotId: string): Promise<PreparedSnapshot> {
    const context = await this.documents.context(task.projectId);
    if (context.repo.repositoryId !== task.repositoryId) {
      throw new ConflictException("The task index repository changed while preparing its snapshot");
    }
    const taskRef = await this.documents.resolve(context, task.sourceCommit);
    if (taskRef.commit !== task.sourceCommit) throw new ConflictException("The task source commit changed during snapshot preparation");

    const sources: SnapshotSource[] = [];
    const taskText = await this.documents.readText(context, task.sourceCommit, task.sourcePath, MAX_SOURCE_BYTES);
    if (taskText === undefined) throw new ConflictException("The task source is missing at its indexed commit");
    const taskHash = "sha256:" + hash(taskText);
    if (taskHash !== "sha256:" + task.sourceHash) throw new ConflictException("The task source hash changed during snapshot preparation");
    const taskSourceId = contextSourceId(task.repositoryId, "task", task.sourcePath);
    sources.push({
      sourceId: taskSourceId,
      role: "task",
      repositoryId: task.repositoryId,
      path: task.sourcePath,
      commit: task.sourceCommit,
      contentHash: taskHash,
      availability: "present",
      publication: "published",
      approval: "not-required",
      requiredFor: [activity],
      required: true,
      readable: true,
      sections: indexMarkdownSections(taskSourceId, taskText, true),
    });

    if (task.sourceReferences.length + sources.length > MAX_SNAPSHOT_SOURCES) {
      throw new PayloadTooLargeException("The task has too many registered context sources");
    }
    let totalBytes = Buffer.byteLength(taskText, "utf8");
    for (const reference of task.sourceReferences) {
      const approval = reference.approval === "not-required"
        ? "not-required"
        : await this.approvals.sourceApproval(task.projectId, reference.path, task.sourceCommit);
      const required = reference.requiredFor.includes(activity);
      const readable =
        reference.availability === "present" &&
        reference.publication === "published" &&
        (approval === "approved" || approval === "not-required");
      let content: string | undefined;
      if (readable) {
        content = await this.documents.readText(context, task.sourceCommit, reference.path, MAX_SOURCE_BYTES);
        if (content === undefined) throw new ConflictException("A registered source is unavailable at its indexed commit");
        if (reference.contentHash !== undefined && hash(content) !== reference.contentHash) {
          throw new ConflictException("A registered source hash changed during snapshot preparation");
        }
        totalBytes += Buffer.byteLength(content, "utf8");
        if (totalBytes > MAX_BRIEF_SOURCE_BYTES) throw new PayloadTooLargeException("The task context exceeds the source byte limit");
      }
      if (reference.availability === "present" && reference.contentHash === undefined) {
        throw new ConflictException("A present source has no indexed content hash");
      }
      const sourceIdValue = contextSourceId(reference.repositoryId, reference.role, reference.path);
      sources.push({
        sourceId: sourceIdValue,
        role: reference.role,
        repositoryId: reference.repositoryId,
        path: reference.path,
        ...(reference.availability === "present" && reference.contentHash !== undefined
          ? { commit: task.sourceCommit, contentHash: "sha256:" + reference.contentHash }
          : {}),
        availability: reference.availability,
        publication: reference.publication,
        approval,
        requiredFor: [...reference.requiredFor],
        required,
        readable,
        sections: content === undefined ? [] : indexMarkdownSections(sourceIdValue, content, required).map((section) => ({
          ...section,
          required: required && !representedInBrief(reference.role, section.title, content),
        })),
      });
    }

    const manifest = buildSnapshotManifest({
      snapshotId,
      projectId: task.projectId,
      unitId: task.unitId,
      activity,
      repositories: [{ repositoryId: task.repositoryId, commit: task.sourceCommit }],
      task: {
        sourceId: taskSourceId,
        repositoryId: task.repositoryId,
        path: task.sourcePath,
        commit: task.sourceCommit,
        contentHash: taskHash,
      },
      sources: boundSnapshotSections(sources),
      requiredDeliverableIds: task.workItem.requiredDeliverables?.map((deliverable) => deliverable.id) ?? [],
      policyRevision: POLICY_REVISION,
    });
    return { manifest, workItem: task.workItem, readiness: task.readiness };
  }

  private async readBriefSources(record: SnapshotRecord): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    let totalBytes = 0;
    for (const source of record.manifest.sources) {
      if (!source.readable || source.availability !== "present") continue;
      const text = await this.readSource(record, source);
      totalBytes += Buffer.byteLength(text, "utf8");
      if (totalBytes > MAX_BRIEF_SOURCE_BYTES) throw new PayloadTooLargeException("The task context exceeds the source byte limit");
      result.set(source.sourceId, text);
    }
    return result;
  }

  private async currentness(principal: MemberPrincipal, record: SnapshotRecord): Promise<TaskBrief["freshness"]> {
    const observedAt = new Date().toISOString();
    try {
      const task = await this.tasks.get(principal, {
        projectId: record.manifest.projectId,
        unitId: record.manifest.unitId,
      });
      const current = await this.prepareSnapshot(task, record.manifest.activity, "ctx_" + randomUUID());
      return current.manifest.contextRevision === record.manifest.contextRevision
        ? { isCurrent: true, observedAt }
        : { isCurrent: false, observedAt, newerContextRevision: current.manifest.contextRevision };
    } catch (error) {
      if (error instanceof ConflictException || error instanceof NotFoundException || error instanceof PayloadTooLargeException) {
        return { isCurrent: false, observedAt };
      }
      throw error;
    }
  }
}

function hash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function representedInBrief(role: string, title: string, markdown: string): boolean {
  if (role !== "task-pack") return false;
  const normalizedTitle = title.trim().toLowerCase();
  if (normalizedTitle === "objective") {
    const objective = markdownHeading(markdown, "Objective");
    return objective !== undefined && objective.length > 0 && objective.length <= 16_384;
  }
  if (normalizedTitle !== "acceptance criteria") return false;
  const criteria = markdownHeading(markdown, "Acceptance criteria");
  if (criteria === undefined) return false;
  const lines = criteria.split(/\r\n|\n|\r/).map((line) => line.trim()).filter((line) => line.length > 0);
  return lines.length <= 100 && lines.every((line) => {
    const match = /^(?:[-*+][ \t]+|\d+[.)][ \t]+)(.+)$/.exec(line);
    return match !== null && match[1]!.length <= 2_000;
  });
}
