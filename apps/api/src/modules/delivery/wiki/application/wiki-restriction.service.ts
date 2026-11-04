// Edit restrictions of a project (ADR-0099 decision 5): who may edit or publish under a path prefix. The routes that
// change them need `wiki.manage`; every change is audited with the prefix, the kind and who is let in.

import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { AUDIT_ACTIONS, AuditTrail, auditRecord } from "#common/audit/audit-trail.js";
import type { Actor } from "#common/auth/decorators.js";
import type { WikiRestriction, WikiRestrictionKind, WikiRestrictionView, WikiSubject, WikiSubjectKind } from "../domain/wiki.js";
import { WikiRestrictions, WikiSubjects } from "../domain/wiki.ports.js";

export interface SetRestrictionInput {
  pathPrefix: string;
  kind: WikiRestrictionKind;
  subjects: ReadonlyArray<{ kind: WikiSubjectKind; id: string }>;
}

// eslint-disable-next-line no-control-regex -- control characters are exactly what is refused
const CONTROL = /[\u0000-\u001f\u007f]/;

/** A prefix is a folder ("a/b/") or a page ("a/b.md"): relative, forward slashes, no `.`, `..`, empty or `.git` segment. */
export function invalidPrefix(prefix: string): string | undefined {
  if (prefix === "" || prefix === "/") return "is empty";
  if (CONTROL.test(prefix) || prefix.includes("\\")) return "has control characters or backslashes";
  if (prefix.startsWith("/")) return "is absolute";
  const folder = prefix.endsWith("/");
  if (!folder && !prefix.toLowerCase().endsWith(".md")) return "must be a folder ending in / or a Markdown page";
  for (const segment of (folder ? prefix.slice(0, -1) : prefix).split("/")) {
    if (segment === "" || segment === "." || segment === ".." || segment.toLowerCase() === ".git") return "has an empty, '.', '..' or .git segment";
  }
  return undefined;
}

@Injectable()
export class WikiRestrictionService {
  constructor(
    private readonly restrictions: WikiRestrictions,
    private readonly subjects: WikiSubjects,
    private readonly audit: AuditTrail,
  ) {}

  /** The restrictions that cover `path`, or all of the project's when there is none; by prefix, then kind. */
  async list(projectId: string, path?: string): Promise<WikiRestrictionView[]> {
    const rows = path === undefined ? await this.restrictions.list(projectId) : await this.restrictions.covering(projectId, path);
    return this.#views(rows);
  }

  /** Makes the listed people and roles exactly who may do `kind` under the prefix; an unknown one is a 400. */
  async set(projectId: string, actor: Actor, input: SetRestrictionInput): Promise<WikiRestrictionView> {
    const problem = invalidPrefix(input.pathPrefix);
    if (problem !== undefined) throw new BadRequestException(`pathPrefix ${problem}`);
    const unique = [...new Map(input.subjects.map((subject) => [`${subject.kind}:${subject.id}`, subject])).values()];
    if (unique.length === 0) throw new BadRequestException("A restriction lists at least one person or role; clear it to remove the restriction");
    for (const kind of ["user", "role"] as const) {
      const wanted = unique.filter((subject) => subject.kind === kind).map((subject) => subject.id);
      const known = await this.subjects.names(kind, wanted);
      const unknown = wanted.find((id) => !known.has(id));
      if (unknown !== undefined) throw new BadRequestException(`Unknown ${kind} "${unknown}"`);
    }
    const rows = await this.restrictions.replace({ projectId, pathPrefix: input.pathPrefix, kind: input.kind, subjects: unique, createdBy: actor.id });
    await this.audit.recordChange(
      auditRecord(actor, AUDIT_ACTIONS.wikiRestrictionSet, { projectId, subject: input.pathPrefix, detail: { pathPrefix: input.pathPrefix, kind: input.kind, subjects: unique.map((subject) => ({ kind: subject.kind, id: subject.id })) } }),
    );
    return (await this.#views(rows))[0]!;
  }

  /** Removes the restriction of the prefix and kind; 404 when there is none. */
  async clear(projectId: string, actor: Actor, pathPrefix: string, kind: WikiRestrictionKind): Promise<void> {
    const removed = await this.restrictions.clear(projectId, pathPrefix, kind);
    if (removed === 0) throw new NotFoundException(`${pathPrefix} has no ${kind} restriction`);
    await this.audit.recordChange(auditRecord(actor, AUDIT_ACTIONS.wikiRestrictionClear, { projectId, subject: pathPrefix, detail: { pathPrefix, kind, removed } }));
  }

  async #views(rows: readonly WikiRestriction[]): Promise<WikiRestrictionView[]> {
    const names = {
      user: await this.subjects.names("user", [...new Set(rows.filter((row) => row.subjectKind === "user").map((row) => row.subjectId))]),
      role: await this.subjects.names("role", [...new Set(rows.filter((row) => row.subjectKind === "role").map((row) => row.subjectId))]),
    };
    const views = new Map<string, WikiRestrictionView>();
    for (const row of rows) {
      const key = `${row.pathPrefix}\u0000${row.kind}`;
      const view = views.get(key) ?? { pathPrefix: row.pathPrefix, kind: row.kind, subjects: [] as WikiSubject[] };
      view.subjects.push({ kind: row.subjectKind, id: row.subjectId, name: names[row.subjectKind].get(row.subjectId) ?? row.subjectId });
      views.set(key, view);
    }
    return [...views.values()].sort((a, b) => (a.pathPrefix === b.pathPrefix ? a.kind.localeCompare(b.kind) : a.pathPrefix.localeCompare(b.pathPrefix)));
  }
}
