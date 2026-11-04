// Who may write a page (ADR-0099 decisions 5 and 7). One place decides: the access route answers it, the draft and
// publish routes enforce it, and a refusal at either is audited here and nowhere else.
//
// `wiki.write` is checked here, not by a route decorator: a decorator means any-of and cannot audit the refusal.

import { BadRequestException, ForbiddenException, Injectable } from "@nestjs/common";
import { isWikiEditablePath, matchesPathGlob } from "@kintsugi/domain";
import { AUDIT_ACTIONS, AuditTrail, auditRecord } from "#common/audit/audit-trail.js";
import type { Actor } from "#common/auth/decorators.js";
import { DocumentWritesService } from "#modules/admin/document-writes/index.js";
import type { WikiAccess, WikiRefusal, WikiRestriction } from "../domain/wiki.js";
import { WikiDirectPublish, WikiRestrictions, WikiSubjects } from "../domain/wiki.ports.js";
import { evaluateRestrictions } from "../domain/wiki.restrictions.js";

/** The permission to write wiki pages, and the one to publish straight to the default branch (ADR-0099 decision 5). */
const WIKI_WRITE = "wiki.write";
const WIKI_PUBLISH = "wiki.publish";

/** The permission to comment on wiki pages (ADR-0099 decision 5). */
const WIKI_COMMENT = "wiki.comment";

/** What a refused person was doing, for the audit entry. */
export type WikiOperation = "draft" | "publish";

interface Decision {
  editable: boolean;
  refusal: WikiRefusal | null;
  roleIds: string[];
  rows: WikiRestriction[];
}

@Injectable()
export class WikiAccessService {
  constructor(
    private readonly restrictions: WikiRestrictions,
    private readonly subjects: WikiSubjects,
    private readonly directPublish: WikiDirectPublish,
    private readonly writes: DocumentWritesService,
    private readonly audit: AuditTrail,
  ) {}

  /** What the caller may do to the page, with the open write it is waiting on. Never audited: it is a question, not an attempt. */
  async access(projectId: string, actor: Actor, path: string): Promise<WikiAccess> {
    const decision = await this.#decide(projectId, actor, path);
    const canWrite = decision.refusal === null;
    const direct = canWrite && (await this.#direct(projectId, actor, path, decision));
    const open = await this.writes.openPageWrite(projectId, path);
    return {
      path,
      editable: decision.editable,
      canWrite,
      canPublish: canWrite,
      direct,
      refusal: decision.refusal,
      pending: open === undefined ? null : { writeId: open.id, status: open.status, prUrl: open.prUrl ?? null, author: open.actor ?? null },
    };
  }

  /**
   * Saving a draft: 400 for a path that cannot be edited, 403 (audited as `wiki-page.refused`) for a person without
   * `wiki.write` or outside a restriction that covers the page.
   */
  async assertCanWrite(projectId: string, actor: Actor, path: string, operation: WikiOperation): Promise<void> {
    const decision = await this.#decide(projectId, actor, path);
    await this.#enforce(projectId, actor, path, operation, decision);
  }

  /** Publishing: the same checks as a draft, and whether the page may go straight to the default branch. */
  async assertCanPublish(projectId: string, actor: Actor, path: string): Promise<{ direct: boolean }> {
    const decision = await this.#decide(projectId, actor, path);
    await this.#enforce(projectId, actor, path, "publish", decision);
    return { direct: await this.#direct(projectId, actor, path, decision) };
  }

  /** Commenting needs `wiki.comment`: reading comments is Project Access alone. */
  assertCanComment(actor: Actor): void {
    if (!actor.permissions.includes(WIKI_COMMENT)) throw new ForbiddenException(`Missing permission: ${WIKI_COMMENT}`);
  }

  /** Discarding a draft needs the permission but no page restriction: it is the caller's own text. */
  assertHasWritePermission(actor: Actor): void {
    if (!actor.permissions.includes(WIKI_WRITE)) throw new ForbiddenException(`Missing permission: ${WIKI_WRITE}`);
  }

  async #decide(projectId: string, actor: Actor, path: string): Promise<Decision> {
    const editable = isWikiEditablePath(path);
    const [rows, roleIds] = await Promise.all([this.restrictions.covering(projectId, path), this.subjects.rolesOf(actor.id)]);
    let refusal: WikiRefusal | null = null;
    if (!editable) refusal = { code: "not-editable", message: `${path} is not a page or attachment that can be edited` };
    else if (!actor.permissions.includes(WIKI_WRITE)) refusal = { code: "permission", message: `Editing pages needs the ${WIKI_WRITE} permission` };
    else {
      const outcome = evaluateRestrictions(rows, actor.id, roleIds, path, "edit");
      if (!outcome.allowed) refusal = { code: "restriction", message: `Editing ${outcome.pathPrefix} is limited to the people and roles its restriction lists`, pathPrefix: outcome.pathPrefix };
    }
    return { editable, refusal, roleIds, rows };
  }

  async #enforce(projectId: string, actor: Actor, path: string, operation: WikiOperation, decision: Decision): Promise<void> {
    const { refusal } = decision;
    if (refusal === null) return;
    // A path that is not a page is a bad request, not a refusal of a right.
    if (refusal.code === "not-editable") throw new BadRequestException(refusal.message);
    await this.audit.recordChange(
      auditRecord(actor, AUDIT_ACTIONS.wikiPageRefused, { projectId, subject: path, detail: { path, code: refusal.code, operation, ...(refusal.pathPrefix === undefined ? {} : { pathPrefix: refusal.pathPrefix }) } }),
    );
    throw new ForbiddenException({ message: refusal.message, details: { refusal } });
  }

  /** `wiki.publish`, a path of `directPublishPaths`, and the `publish` restrictions; the caller already may write. */
  async #direct(projectId: string, actor: Actor, path: string, decision: Decision): Promise<boolean> {
    if (!actor.permissions.includes(WIKI_PUBLISH)) return false;
    if (!evaluateRestrictions(decision.rows, actor.id, decision.roleIds, path, "publish").allowed) return false;
    const globs = await this.directPublish.globs(projectId);
    return globs.some((glob) => matchesPathGlob(path, glob));
  }
}
