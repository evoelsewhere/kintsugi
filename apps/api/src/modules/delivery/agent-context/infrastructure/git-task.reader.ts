// Builds a bounded, rebuildable task projection from one immutable document-repo commit.

import { createHash } from "node:crypto";
import { ConflictException, Injectable, PayloadTooLargeException } from "@nestjs/common";
import { assertSafeRepoPath } from "@kintsugi/git";
import {
  applicationDesignPath,
  isFullUnitId,
  unitAsIsPath,
  unitDesignPath,
  unitStatePath,
  unitTaskPath,
  type MemberActivity,
  type RequiredTaskInput,
  type WorkItemFile,
} from "@kintsugi/domain";
import { parseUnitDocument, MAX_UNIT_DOCUMENT_BYTES } from "@kintsugi/agents";
import { DocumentsService, type DocumentContext } from "#modules/delivery/documents/index.js";
import {
  TaskSourceReader,
  type MemberTaskProjection,
  type ProjectTaskSnapshot,
  type TaskIndexIssue,
  type TaskSourceRevision,
  type TaskSourceReference,
} from "../domain/task.js";

const MAX_PROJECT_TASKS = 10_000;
const MAX_SOURCE_BYTES = 256 * 1024;
const MAX_PROJECT_INDEX_BYTES = 64 * 1024 * 1024;
const SEGMENT = /^[a-z0-9][a-z0-9-]{0,62}$/;
const IMPLEMENTATION_ACTIVITIES: readonly MemberActivity[] = ["implementation", "verification"];
const TASK_ACTIVITIES: readonly MemberActivity[] = ["design", "implementation", "verification"];

@Injectable()
export class GitTaskReader extends TaskSourceReader {
  constructor(private readonly documents: DocumentsService) {
    super();
  }

  async currentRevision(projectId: string): Promise<TaskSourceRevision> {
    const context = await this.documents.context(projectId);
    const resolved = await this.documents.resolve(context, undefined);
    return { repositoryId: context.repo.repositoryId, commit: resolved.commit };
  }

  async readProject(projectId: string, revision: TaskSourceRevision): Promise<ProjectTaskSnapshot> {
    const context = await this.documents.context(projectId);
    if (context.repo.repositoryId !== revision.repositoryId) {
      throw new ConflictException("The project's document repository changed during task indexing");
    }
    const resolved = await this.documents.resolve(context, revision.commit);
    const tasks: MemberTaskProjection[] = [];
    const issues: TaskIndexIssue[] = [];
    const sourceBudget = { bytes: 0 };
    const knownApplications = new Set(context.project.applications.map((application) => application.id));

    const applicationEntries = await this.listNamesBounded(context, resolved.commit, "applications");
    let visitedModules = 0;
    let visitedUnitDirectories = 0;
    for (const application of applicationEntries.filter((entry) => entry.kind === "dir")) {
      if (!SEGMENT.test(application.name)) continue;
      const applicationPath = "applications/" + application.name;
      if (!knownApplications.has(application.name)) {
        issues.push({ path: applicationPath, messages: ["application is not registered to this project"] });
        continue;
      }

      const modulesPath = applicationPath + "/units";
      const moduleEntries = await this.listNamesBounded(context, resolved.commit, modulesPath);
      for (const module of moduleEntries.filter((entry) => entry.kind === "dir")) {
        if (!SEGMENT.test(module.name)) continue;
        visitedModules += 1;
        if (visitedModules > MAX_PROJECT_TASKS) {
          throw new PayloadTooLargeException("The document repository exceeds the task indexing limit");
        }
        const modulePath = modulesPath + "/" + module.name;
        const unitEntries = await this.listNamesBounded(context, resolved.commit, modulePath);
        for (const unit of unitEntries.filter((entry) => entry.kind === "dir")) {
          if (!SEGMENT.test(unit.name)) continue;
          visitedUnitDirectories += 1;
          if (visitedUnitDirectories > MAX_PROJECT_TASKS || tasks.length + issues.length >= MAX_PROJECT_TASKS) {
            throw new PayloadTooLargeException("The document repository exceeds the task indexing limit");
          }
          const unitId = application.name + "/" + module.name + "/" + unit.name;
          const sourcePath = unitStatePath(application.name, module.name, unit.name);
          const unitPath = modulePath + "/" + unit.name;
          const files = await this.listNamesBounded(context, resolved.commit, unitPath);
          if (!files.some((file) => file.kind === "file" && file.name === "unit.md")) continue;

          const markdown = await this.documents.readText(context, resolved.commit, sourcePath, MAX_UNIT_DOCUMENT_BYTES);
          if (markdown === undefined) {
            issues.push({ path: sourcePath, messages: ["unit document is missing, oversized, or unreadable"] });
            continue;
          }
          this.accountSourceBudget(sourceBudget, markdown);
          const parsed = parseUnitDocument(markdown, unitId);
          if (!parsed.ok) {
            issues.push({ path: sourcePath, messages: parsed.issues.map((issue) => issue.path ? issue.path + ": " + issue.message : issue.message) });
            continue;
          }
          if (parsed.value.dependsOn?.some((dependency) => !isFullUnitId(dependency))) {
            issues.push({ path: sourcePath, messages: ["unit document contains a dependency that is not a full unit identity"] });
            continue;
          }

          const unsafePath = this.invalidDocumentPath(parsed.value.links?.taskPack)
            ?? this.invalidDocumentPath(parsed.value.links?.asIs)
            ?? parsed.value.links?.mappings?.map((path) => this.invalidDocumentPath(path)).find((path) => path !== undefined)
            ?? parsed.value.links?.businessRules?.map((path) => this.invalidDocumentPath(path)).find((path) => path !== undefined);
          if (unsafePath !== undefined) {
            issues.push({ path: sourcePath, messages: ["unit document contains an invalid or restricted document path"] });
            continue;
          }

          const sourceHash = createHash("sha256").update(markdown, "utf8").digest("hex");
          const task = await this.projectTask(context, resolved.commit, unitId, sourcePath, sourceHash, parsed.value, sourceBudget);
          tasks.push(task);
        }
      }
    }

    tasks.sort((left, right) => left.unitId.localeCompare(right.unitId));
    return {
      projectId,
      repositoryId: revision.repositoryId,
      commit: resolved.commit,
      tasks,
      issues,
    };
  }

  private async projectTask(
    context: DocumentContext,
    commit: string,
    unitId: string,
    sourcePath: string,
    sourceHash: string,
    workItem: WorkItemFile,
    sourceBudget: { bytes: number },
  ): Promise<MemberTaskProjection> {
    const identity = unitId.split("/");
    const application = identity[0] ?? "";
    const module = identity[1] ?? "";
    const unit = identity[2] ?? "";
    const requiredInputs: RequiredTaskInput[] = [];
    const sourceReferences: TaskSourceReference[] = [];
    const add = async (
      role: string,
      path: string,
      requiredFor: readonly MemberActivity[],
      approval: RequiredTaskInput["approval"],
      producedBy?: MemberActivity,
    ): Promise<void> => {
      const content = await this.documents.readText(context, commit, path, MAX_SOURCE_BYTES);
      if (content !== undefined) this.accountSourceBudget(sourceBudget, content);
      const sourceId = role + ":" + path;
      const availability = content === undefined ? "missing" as const : "present" as const;
      const publication = availability === "present" ? "published" as const : "unknown" as const;
      requiredInputs.push({
        sourceId,
        role,
        requiredFor,
        availability,
        publication,
        approval,
        ...(producedBy === undefined ? {} : { producedBy }),
      });
      sourceReferences.push({
        sourceId,
        role,
        repositoryId: context.repo.repositoryId,
        path,
        requiredFor,
        availability,
        publication,
        approval,
        ...(producedBy === undefined ? {} : { producedBy }),
        ...(content === undefined ? {} : { contentHash: createHash("sha256").update(content, "utf8").digest("hex") }),
      });
    };

    const taskPack = workItem.links?.taskPack ?? unitTaskPath(application, module, unit);
    const asIs = workItem.links?.asIs ?? unitAsIsPath(application, module, unit);
    await add("task-pack", taskPack, TASK_ACTIVITIES, "not-required");
    await add("as-is-specification", asIs, TASK_ACTIVITIES, "not-required");
    await add("basic-design", applicationDesignPath(application), IMPLEMENTATION_ACTIVITIES, "unknown");
    await add("detailed-design", unitDesignPath(application, module, unit), IMPLEMENTATION_ACTIVITIES, "unknown", "design");
    for (const path of workItem.links?.mappings ?? []) await add("mapping", path, IMPLEMENTATION_ACTIVITIES, "unknown");
    for (const path of workItem.links?.businessRules ?? []) await add("business-rule", path, IMPLEMENTATION_ACTIVITIES, "unknown");

    const predecessorGates = [{
      unitId,
      gateId: "G3",
      status: "unknown" as const,
      requiredFor: IMPLEMENTATION_ACTIVITIES,
    }];
    for (const dependency of workItem.dependsOn ?? []) {
      if (!isFullUnitId(dependency)) continue;
      predecessorGates.push({
        unitId: dependency,
        gateId: "G3",
        status: "unknown" as const,
        requiredFor: IMPLEMENTATION_ACTIVITIES,
      });
    }

    return {
      projectId: context.project.id,
      unitId,
      repositoryId: context.repo.repositoryId,
      sourceCommit: commit,
      sourcePath,
      sourceHash,
      workItem,
      requiredInputs,
      sourceReferences,
      predecessorGates,
    };
  }

  private invalidDocumentPath(path: string | undefined): string | undefined {
    if (path === undefined) return undefined;
    try {
      assertSafeRepoPath(path);
      if (path.split("/").some((segment) => ["restricted", ".git"].includes(segment.toLowerCase()))) return path;
      return undefined;
    } catch {
      return path;
    }
  }

  private async listNamesBounded(context: DocumentContext, commit: string, path: string) {
    const entries = await this.documents.listNames(context, commit, path);
    if (entries.length > MAX_PROJECT_TASKS) {
      throw new PayloadTooLargeException("The document repository exceeds the task indexing limit");
    }
    return entries;
  }

  private accountSourceBudget(budget: { bytes: number }, content: string): void {
    budget.bytes += Buffer.byteLength(content, "utf8");
    if (budget.bytes > MAX_PROJECT_INDEX_BYTES) {
      throw new PayloadTooLargeException("The project task sources exceed the indexing byte limit");
    }
  }
}
