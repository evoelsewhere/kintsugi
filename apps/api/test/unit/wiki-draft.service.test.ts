// The draft service without a database: autosave never calls the document writer, a text over 5 MiB is a 400 (the JSON
// body limit of the API, 4 MB, answers a body larger than that before the service sees it), and revisions are checked.

import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { Actor } from "../../src/common/auth/decorators.js";
import { WikiAccessService } from "../../src/modules/delivery/wiki/application/wiki-access.service.js";
import { DRAFT_TEXT_MAX_BYTES, WikiDraftService } from "../../src/modules/delivery/wiki/application/wiki-draft.service.js";
import type { NewWikiDraft, WikiDraft } from "../../src/modules/delivery/wiki/domain/wiki.js";
import { WikiDirectPublish, WikiDrafts, WikiRestrictions, WikiSubjects } from "../../src/modules/delivery/wiki/domain/wiki.ports.js";

const actor: Actor = { id: "u1", username: "ada", permissions: ["wiki.write"] };
const COMMIT = "a".repeat(40);

class MemoryDrafts extends WikiDrafts {
  rows: WikiDraft[] = [];
  async find(projectId: string, userId: string, path: string) {
    return this.rows.find((row) => row.projectId === projectId && row.userId === userId && row.path === path);
  }
  async create(draft: NewWikiDraft) {
    const row: WikiDraft = { ...draft, id: `d${this.rows.length + 1}`, revision: 1, writeId: null, touchedAt: new Date().toISOString() };
    this.rows.push(row);
    return row;
  }
  async update(id: string, baseRevision: number, text: string) {
    const row = this.rows.find((candidate) => candidate.id === id && candidate.revision === baseRevision);
    if (row === undefined) return undefined;
    Object.assign(row, { text, revision: row.revision + 1, writeId: row.text === text ? row.writeId : null });
    return row;
  }
  async reissueId(id: string, baseRevision: number, text: string, pageId: string) {
    const row = this.rows.find((candidate) => candidate.id === id && candidate.revision === baseRevision);
    if (row === undefined) return undefined;
    Object.assign(row, { text, pageId, writeId: null, revision: row.revision + 1 });
    return row;
  }
  async setWrite(id: string, writeId: string | null) {
    const row = this.rows.find((candidate) => candidate.id === id);
    if (row !== undefined) row.writeId = writeId;
  }
  async remove(id: string) {
    const before = this.rows.length;
    this.rows = this.rows.filter((row) => row.id !== id);
    return this.rows.length < before;
  }
  async listOf(projectId: string, userId: string) {
    return this.rows.filter((row) => row.projectId === projectId && row.userId === userId);
  }
  async othersOn() {
    return [];
  }
}

/** Nobody is restricted, nobody holds a role, nothing is published directly. */
function openAccess(): WikiAccessService {
  const restrictions = new (class extends WikiRestrictions {
    async list() {
      return [];
    }
    async covering() {
      return [];
    }
    async add(): Promise<never> {
      throw new Error("not used");
    }
    async replace(): Promise<never> {
      throw new Error("not used");
    }
    async clear() {
      return 0;
    }
  })();
  const subjects = new (class extends WikiSubjects {
    async rolesOf() {
      return [];
    }
    async names() {
      return new Map<string, string>();
    }
  })();
  const direct = new (class extends WikiDirectPublish {
    async globs() {
      return [];
    }
  })();
  return new WikiAccessService(restrictions, subjects, direct, { openPageWrite: async () => undefined } as never, { recordChange: async () => undefined } as never);
}

function setup() {
  const drafts = new MemoryDrafts();
  const context = { project: {}, repo: {}, defaultBranch: "main" };
  const documents = {
    context: vi.fn(async () => context),
    branchTips: vi.fn(async () => ({ tips: new Map(), defaultTip: { name: "main", commit: COMMIT } })),
    resolve: vi.fn(async () => ({ ref: COMMIT, commit: COMMIT })),
    isAncestor: vi.fn(async () => true),
    hashAt: vi.fn(async () => "b".repeat(64)),
  };
  // The writer: autosave must never call any of it.
  const writes = { find: vi.fn(async () => undefined), proposePage: vi.fn(), proposeCorrection: vi.fn(), publishManifest: vi.fn() };
  const service = new WikiDraftService(drafts, documents as never, writes as never, openAccess());
  return { service, drafts, documents, writes };
}

describe("WikiDraftService", () => {
  it("never calls the document writer, saving, updating or discarding", async () => {
    const { service, writes } = setup();
    await service.save("shop", actor, { path: "a.md", text: "one", baseRevision: null, baseCommit: COMMIT });
    await service.save("shop", actor, { path: "a.md", text: "two", baseRevision: 1 });
    await service.get("shop", actor, "a.md");
    await service.list("shop", actor);
    await service.discard("shop", actor, "a.md");
    expect(writes.proposePage).not.toHaveBeenCalled();
    expect(writes.proposeCorrection).not.toHaveBeenCalled();
    expect(writes.publishManifest).not.toHaveBeenCalled();
  });

  it("refuses a text over 5 MiB with a 400 and keeps what fits, counting bytes not characters", async () => {
    const { service, drafts } = setup();
    const fits = "x".repeat(DRAFT_TEXT_MAX_BYTES);
    expect((await service.save("shop", actor, { path: "a.md", text: fits, baseRevision: null, baseCommit: COMMIT })).revision).toBe(1);
    await expect(service.save("shop", actor, { path: "b.md", text: `${fits}x`, baseRevision: null, baseCommit: COMMIT })).rejects.toThrow(BadRequestException);
    // Two-byte characters: half as many characters are already too many bytes.
    await expect(service.save("shop", actor, { path: "c.md", text: "é".repeat(DRAFT_TEXT_MAX_BYTES / 2 + 1), baseRevision: null, baseCommit: COMMIT })).rejects.toThrow(/5 MiB/);
    expect(drafts.rows.map((row) => row.path)).toEqual(["a.md"]);
  });

  it("refuses a caller without wiki.write before it reads anything", async () => {
    const { service, documents, drafts } = setup();
    const reader: Actor = { id: "u2", permissions: [] };
    await expect(service.save("shop", reader, { path: "a.md", text: "x", baseRevision: null, baseCommit: COMMIT })).rejects.toThrow(ForbiddenException);
    await expect(service.discard("shop", reader, "a.md")).rejects.toThrow(ForbiddenException);
    expect(documents.context).not.toHaveBeenCalled();
    expect(drafts.rows).toEqual([]);
    // Looking is allowed: no draft is a 404, not a 403.
    await expect(service.get("shop", reader, "a.md")).rejects.toThrow(NotFoundException);
  });

  it("answers a stale or missing revision with a draft-revision conflict naming the stored one", async () => {
    const { service } = setup();
    await service.save("shop", actor, { path: "a.md", text: "one", baseRevision: null, baseCommit: COMMIT });
    await service.save("shop", actor, { path: "a.md", text: "two", baseRevision: 1 });
    const conflict = await service.save("shop", actor, { path: "a.md", text: "three", baseRevision: 1 }).catch((error: unknown) => error);
    expect(conflict).toBeInstanceOf(ConflictException);
    expect((conflict as ConflictException).getResponse()).toMatchObject({ details: { code: "draft-revision", revision: 2 } });
    const missing = await service.save("shop", actor, { path: "z.md", text: "x", baseRevision: 4 }).catch((error: unknown) => error);
    expect((missing as ConflictException).getResponse()).toMatchObject({ details: { code: "draft-revision", revision: 0 } });
  });

  it("takes the hash of the page at the commit it was read from, and never looks at the head for a base it was given", async () => {
    const { service, documents } = setup();
    const view = await service.save("shop", actor, { path: "a.md", text: "x", baseRevision: null, baseCommit: COMMIT });
    expect(view).toMatchObject({ baseCommit: COMMIT, baseHash: "b".repeat(64) });
    expect(documents.hashAt).toHaveBeenCalledTimes(1);
    expect(documents.hashAt).toHaveBeenCalledWith(expect.anything(), COMMIT, "a.md", DRAFT_TEXT_MAX_BYTES);
  });
});
