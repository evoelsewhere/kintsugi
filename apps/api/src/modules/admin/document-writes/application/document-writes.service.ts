// Application layer: use cases of document writes (ADR-0019). The API never commits: it
// records a write and enqueues it for the worker's writer. First caller: publishing the
// project's kintsugi.yaml, which is not an auto-commit path and so becomes a pull request.

import { ConflictException, Injectable } from "@nestjs/common";
import type { Page, PageQuery } from "#common/application/pagination.js";
import { toPage } from "#common/application/pagination.js";
import { AUDIT_ACTIONS, AuditTrail, auditRecord } from "#common/audit/audit-trail.js";
import type { Actor } from "#common/auth/decorators.js";
import { newId } from "#common/domain/ids.js";
import { ProjectsService } from "#modules/admin/projects/index.js";
import type { DocumentWriteFile, DocumentWriteFilter, DocumentWriteRecord, NewDocumentWrite } from "../domain/document-write.js";
import { DocumentRepoSkeleton, DocumentWriteQueue, DocumentWriteStore } from "../domain/document-write.ports.js";

@Injectable()
export class DocumentWritesService {
  constructor(
    private readonly store: DocumentWriteStore,
    private readonly queue: DocumentWriteQueue,
    private readonly skeleton: DocumentRepoSkeleton,
    private readonly projects: ProjectsService,
    private readonly audit: AuditTrail,
  ) {}

  /**
   * Renders kintsugi.yaml from the project's state and enqueues it as a pull request. Unless
   * `scaffold` is off, the same pull request carries the starter structure (program, portfolio,
   * architecture, standards, plugins, gates and one skeleton per application) for everything
   * the document repo does not have yet: existing documents are never replaced.
   */
  async publishManifest(projectId: string, actor: Actor, options: { scaffold?: boolean } = {}): Promise<DocumentWriteRecord> {
    const project = await this.projects.getProject(projectId);
    if (project.documentRepository === null) throw new ConflictException(`Project ${projectId} has no document repository`);
    const manifest = await this.projects.renderManifest(projectId);
    const scaffold = options.scaffold !== false;
    const structure = scaffold ? await this.skeleton.files(project.applications.map((application) => application.id)) : [];
    const write = await this.#enqueue({
      id: newId(),
      projectId,
      documentRepositoryId: project.documentRepository.repositoryId,
      kind: "manifest",
      message: `Publish ${manifest.fileName} ${scaffold ? "and the starter structure " : ""}from the project settings`,
      files: [{ path: manifest.fileName, content: manifest.content }, ...structure.filter((file) => file.path !== manifest.fileName)],
      ...(scaffold ? { reviewAll: true } : {}),
      actor: actor.username ?? actor.id,
    });
    await this.audit.recordChange(
      auditRecord(actor, AUDIT_ACTIONS.manifestPublish, {
        projectId,
        subject: write.id,
        detail: { path: manifest.fileName, scaffold, structureFiles: structure.length, documentRepositoryId: project.documentRepository.repositoryId },
      }),
    );
    return write;
  }

  /** A bounded caller supplies corrected documents; the writer proposes them for review and checks their old hashes. */
  async proposeCorrection(projectId: string, message: string, files: DocumentWriteFile[], actor: Actor): Promise<DocumentWriteRecord> {
    const project = await this.projects.getProject(projectId);
    if (project.documentRepository === null) throw new ConflictException(`Project ${projectId} has no document repository`);
    if (files.length === 0 || files.some((file) => !file.path.endsWith(".md") || !/^[0-9a-f]{64}$/.test(file.expectedHash ?? ""))) throw new ConflictException("A correction needs Markdown documents and their previous hashes");
    const write = await this.#enqueue({ id: newId(), projectId, documentRepositoryId: project.documentRepository.repositoryId, kind: "state-change", message, files, reviewAll: true, actor: actor.username ?? actor.id });
    await this.audit.recordChange(auditRecord(actor, AUDIT_ACTIONS.documentCorrection, { projectId, subject: write.id, detail: { paths: files.map((file) => file.path) } }));
    return write;
  }

  async list(projectId: string, query: PageQuery): Promise<Page<DocumentWriteRecord>> {
    await this.projects.getProject(projectId); // 404 for an unknown project
    const { items, total } = await this.store.listForProject(projectId, query.limit, query.offset);
    return toPage(items, total, query);
  }

  /** Writes across projects (for the activity views), newest first. */
  async listAll(filter: DocumentWriteFilter, query: PageQuery): Promise<Page<DocumentWriteRecord>> {
    const { items, total } = await this.store.list(filter, query.limit, query.offset);
    return toPage(items, total, query);
  }

  /** Records first, so the write is visible even when the queue is down; a failed enqueue is recorded too. */
  async #enqueue(write: NewDocumentWrite): Promise<DocumentWriteRecord> {
    const record = await this.store.create(write);
    try {
      await this.queue.enqueue(write);
    } catch (error) {
      await this.store.markFailed(write.id, `Could not enqueue the write: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
    return record;
  }
}
