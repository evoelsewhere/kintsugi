// The rules of who may edit or publish under a path (ADR-0099 decision 5), and the access service built on them,
// without a database: tables of cases for the pure evaluation, and the answer of the access service with fakes.

import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { Actor } from "../../src/common/auth/decorators.js";
import { WikiAccessService } from "../../src/modules/delivery/wiki/application/wiki-access.service.js";
import { invalidPrefix } from "../../src/modules/delivery/wiki/application/wiki-restriction.service.js";
import type { WikiRestriction, WikiRestrictionKind, WikiSubjectKind } from "../../src/modules/delivery/wiki/domain/wiki.js";
import { WikiDirectPublish, WikiRestrictions, WikiSubjects } from "../../src/modules/delivery/wiki/domain/wiki.ports.js";
import { evaluateRestrictions, prefixCovers } from "../../src/modules/delivery/wiki/domain/wiki.restrictions.js";

let counter = 0;
const row = (pathPrefix: string, subjectKind: WikiSubjectKind, subjectId: string, kind: WikiRestrictionKind = "edit"): WikiRestriction => ({
  id: `r${++counter}`,
  projectId: "shop",
  pathPrefix,
  subjectKind,
  subjectId,
  kind,
  createdBy: null,
  createdAt: "2026-11-05T00:00:00.000Z",
});

describe("prefixCovers", () => {
  it("covers the page itself and what is under a folder, not a similar name or a page's children", () => {
    expect(prefixCovers("a/b.md", "a/b.md")).toBe(true);
    expect(prefixCovers("a/", "a/b/c.md")).toBe(true);
    expect(prefixCovers("a/", "a/b.md")).toBe(true);
    expect(prefixCovers("a/", "ab/c.md")).toBe(false);
    expect(prefixCovers("a", "a/b.md")).toBe(false);
    expect(prefixCovers("a/b.md", "a/b.md.md")).toBe(false);
    expect(prefixCovers("a/b/", "a/b.md")).toBe(false);
  });
});

describe("evaluateRestrictions", () => {
  const cases: Array<{ name: string; rows: WikiRestriction[]; user: string; roles: string[]; path: string; kind?: WikiRestrictionKind; refusedBy?: string }> = [
    { name: "no rows: no extra limit", rows: [], user: "u1", roles: [], path: "a/b.md" },
    { name: "a rule that does not cover the page says nothing", rows: [row("other/", "user", "u2")], user: "u1", roles: [], path: "a/b.md" },
    { name: "a listed user is let in", rows: [row("a/", "user", "u1")], user: "u1", roles: [], path: "a/b.md" },
    { name: "an unlisted user is refused", rows: [row("a/", "user", "u2")], user: "u1", roles: [], path: "a/b.md", refusedBy: "a/" },
    { name: "a listed role is let in", rows: [row("a/", "role", "editors")], user: "u1", roles: ["user", "editors"], path: "a/b.md" },
    { name: "a role the person does not hold refuses", rows: [row("a/", "role", "editors")], user: "u1", roles: ["user"], path: "a/b.md", refusedBy: "a/" },
    { name: "rows of a prefix are alternatives: user or role", rows: [row("a/", "user", "u2"), row("a/", "role", "editors")], user: "u1", roles: ["editors"], path: "a/b.md" },
    { name: "a subject with the same id but another kind does not count", rows: [row("a/", "role", "u1")], user: "u1", roles: [], path: "a/b.md", refusedBy: "a/" },
    { name: "a page rule adds to its folder's: both must be met", rows: [row("a/", "role", "editors"), row("a/b.md", "user", "u1")], user: "u1", roles: ["editors"], path: "a/b.md" },
    { name: "…the folder's rule still refuses someone who meets only the page's", rows: [row("a/", "role", "editors"), row("a/b.md", "user", "u1")], user: "u1", roles: [], path: "a/b.md", refusedBy: "a/" },
    { name: "…and the page's rule refuses someone who meets only the folder's", rows: [row("a/", "role", "editors"), row("a/b.md", "user", "u2")], user: "u1", roles: ["editors"], path: "a/b.md", refusedBy: "a/b.md" },
    { name: "the deepest refusing prefix is the one reported", rows: [row("a/", "user", "u2"), row("a/b/", "user", "u2")], user: "u1", roles: [], path: "a/b/c.md", refusedBy: "a/b/" },
    { name: "a rule on a sibling page does not touch this page", rows: [row("a/b.md", "user", "u2")], user: "u1", roles: [], path: "a/c.md" },
    { name: "a rule of the other kind is not this kind's", rows: [row("a/", "user", "u2", "publish")], user: "u1", roles: [], path: "a/b.md", kind: "edit" },
    { name: "a publish rule refuses publishing", rows: [row("a/", "user", "u2", "publish")], user: "u1", roles: [], path: "a/b.md", kind: "publish", refusedBy: "a/" },
    { name: "the kinds are independent: edit rows let in, publish rows refuse", rows: [row("a/", "user", "u1", "edit"), row("a/", "user", "u2", "publish")], user: "u1", roles: [], path: "a/b.md", kind: "publish", refusedBy: "a/" },
  ];
  for (const { name, rows, user, roles, path, kind = "edit", refusedBy } of cases) {
    it(name, () => {
      const outcome = evaluateRestrictions(rows, user, roles, path, kind);
      expect(outcome).toEqual(refusedBy === undefined ? { allowed: true } : { allowed: false, pathPrefix: refusedBy });
    });
  }

  it("never widens: adding a rule can only turn an allowed into a refused", () => {
    const base = [row("a/", "role", "editors")];
    const more = [...base, row("a/b.md", "user", "u9")];
    for (const roles of [[], ["editors"]]) {
      const before = evaluateRestrictions(base, "u1", roles, "a/b.md", "edit").allowed;
      const after = evaluateRestrictions(more, "u1", roles, "a/b.md", "edit").allowed;
      expect(before || !after).toBe(true);
    }
  });
});

describe("invalidPrefix", () => {
  it("takes a folder or a Markdown page of the repository, nothing else", () => {
    for (const ok of ["a/", "a/b/", "a/b.md", "20-spaces/eng/guide.md"]) expect(invalidPrefix(ok), ok).toBeUndefined();
    for (const bad of ["", "/", "/a/", "a", "a/b.txt", "a//b/", "a/../b/", "./a/", "a/.git/", "a\\b/", "a/\u0001/"]) expect(invalidPrefix(bad), bad).toBeDefined();
  });
});

describe("WikiAccessService", () => {
  class Restrictions extends WikiRestrictions {
    rows: WikiRestriction[] = [];
    async list() {
      return this.rows;
    }
    async covering(_projectId: string, path: string) {
      return this.rows.filter((candidate) => prefixCovers(candidate.pathPrefix, path));
    }
    async add(): Promise<WikiRestriction> {
      throw new Error("not used");
    }
    async replace(): Promise<WikiRestriction[]> {
      throw new Error("not used");
    }
    async clear() {
      return 0;
    }
  }
  const setup = (options: { roles?: string[]; globs?: string[]; open?: unknown } = {}) => {
    const restrictions = new Restrictions();
    const subjects = new (class extends WikiSubjects {
      async rolesOf() {
        return options.roles ?? ["user"];
      }
      async names() {
        return new Map<string, string>();
      }
    })();
    const direct = new (class extends WikiDirectPublish {
      async globs() {
        return options.globs ?? [];
      }
    })();
    const writes = { openPageWrite: vi.fn(async () => options.open) };
    const audit = { recordChange: vi.fn(async () => undefined) };
    const service = new WikiAccessService(restrictions, subjects, direct, writes as never, audit as never);
    return { service, restrictions, audit, writes };
  };
  const editor: Actor = { id: "u1", username: "ada", permissions: ["wiki.write"] };
  const publisher: Actor = { id: "u1", username: "ada", permissions: ["wiki.write", "wiki.publish"] };

  it("answers: editable, may write and publish by pull request, not directly without the right and a path", async () => {
    const { service } = setup({ globs: ["10-eng/**"] });
    expect(await service.access("shop", editor, "10-eng/guide.md")).toEqual({ path: "10-eng/guide.md", editable: true, canWrite: true, canPublish: true, direct: false, refusal: null, pending: null });
    // wiki.publish alone is not enough on a path outside directPublishPaths, and a path inside needs wiki.publish.
    expect((await service.access("shop", publisher, "10-eng/guide.md")).direct).toBe(true);
    expect((await service.access("shop", publisher, "20-hr/guide.md")).direct).toBe(false);
  });

  it("does not let wiki.publish stand in for wiki.write, and says why", async () => {
    const { service } = setup({ globs: ["**"] });
    const answer = await service.access("shop", { id: "u1", permissions: ["wiki.publish"] }, "a.md");
    expect(answer).toMatchObject({ editable: true, canWrite: false, canPublish: false, direct: false, refusal: { code: "permission" } });
  });

  it("refuses a path that is not a page, a person without wiki.write, and a restriction they do not meet, in that order", async () => {
    const { service, restrictions } = setup({ roles: ["user"] });
    expect((await service.access("shop", editor, "restricted/x.md")).refusal).toMatchObject({ code: "not-editable" });
    expect((await service.access("shop", { id: "u1", permissions: [] }, "a.md")).refusal).toMatchObject({ code: "permission" });
    restrictions.rows = [row("a/", "role", "leads")];
    const refused = await service.access("shop", editor, "a/b.md");
    expect(refused).toMatchObject({ canWrite: false, canPublish: false, refusal: { code: "restriction", pathPrefix: "a/" } });
    expect((await service.access("shop", editor, "b/c.md")).canWrite).toBe(true);
  });

  it("limits direct publishing by the publish restrictions, and never lets a manager through", async () => {
    const { service, restrictions } = setup({ roles: ["user", "wiki-manager"], globs: ["**"] });
    const manager: Actor = { id: "u1", permissions: ["wiki.write", "wiki.publish", "wiki.manage"] };
    expect((await service.access("shop", manager, "a.md")).direct).toBe(true);
    restrictions.rows = [row("a.md", "role", "leads", "publish")];
    expect(await service.access("shop", manager, "a.md")).toMatchObject({ canWrite: true, canPublish: true, direct: false });
    restrictions.rows = [row("a.md", "user", "u2", "edit")];
    expect((await service.access("shop", manager, "a.md")).canWrite).toBe(false);
  });

  it("shows the write waiting for review", async () => {
    const { service } = setup({ open: { id: "w1", status: "pr-opened", prUrl: "https://git.example/pr/3", actor: "grace" } });
    expect((await service.access("shop", editor, "a.md")).pending).toEqual({ writeId: "w1", status: "pr-opened", prUrl: "https://git.example/pr/3", author: "grace" });
  });

  it("audits a refusal at the draft and at the publish, once, with the code and the operation; a bad path is a 400 without audit", async () => {
    const { service, audit, restrictions } = setup();
    await expect(service.assertCanWrite("shop", { id: "u1", username: "ada", permissions: [] }, "a.md", "draft")).rejects.toThrow(ForbiddenException);
    expect(audit.recordChange).toHaveBeenCalledTimes(1);
    expect(audit.recordChange).toHaveBeenLastCalledWith({ actor: "u1", action: "wiki-page.refused", projectId: "shop", subject: "a.md", detail: { path: "a.md", code: "permission", operation: "draft", username: "ada" } });
    restrictions.rows = [row("a/", "user", "u2")];
    await expect(service.assertCanPublish("shop", editor, "a/b.md")).rejects.toMatchObject({ response: { details: { refusal: { code: "restriction", pathPrefix: "a/" } } } });
    expect(audit.recordChange).toHaveBeenLastCalledWith(expect.objectContaining({ action: "wiki-page.refused", detail: expect.objectContaining({ code: "restriction", operation: "publish", pathPrefix: "a/" }) }));
    await expect(service.assertCanWrite("shop", editor, "restricted/x.md", "draft")).rejects.toThrow(BadRequestException);
    expect(audit.recordChange).toHaveBeenCalledTimes(2);
    // Allowed: no entry.
    await service.assertCanWrite("shop", editor, "b/c.md", "draft");
    expect(await service.assertCanPublish("shop", publisher, "b/c.md")).toEqual({ direct: false });
    expect(audit.recordChange).toHaveBeenCalledTimes(2);
  });

  it("checks only the permission to discard a draft", () => {
    const { service } = setup();
    expect(() => service.assertHasWritePermission(editor)).not.toThrow();
    expect(() => service.assertHasWritePermission({ id: "u2", permissions: [] })).toThrow(ForbiddenException);
  });
});
