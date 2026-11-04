// Moving a wiki page (P2-038, ADR-0098 decision 5): which pages are found, how the write is made, and what is refused.
// The planner has its own tests in the domain; here the service is run over fakes of the Brain, the documents and the
// writes, and the plan is applied to the files to check, with the Brain's own builder, that no link breaks.

import { ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { buildBrainTree } from "@kintsugi/domain";
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { Actor } from "../../src/common/auth/decorators.js";
import type { AuditTrail } from "../../src/common/audit/audit-trail.js";
import type { DocumentWritesService } from "../../src/modules/admin/document-writes/index.js";
import type { BrainService } from "../../src/modules/delivery/brain/index.js";
import type { DocumentsService } from "../../src/modules/delivery/documents/index.js";
import type { WikiAccessService } from "../../src/modules/delivery/wiki/application/wiki-access.service.js";
import { MOVE_ENTRY_LIMIT, WikiMoveService } from "../../src/modules/delivery/wiki/application/wiki-move.service.js";

const sha256 = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex");
const actor = { id: "u1", username: "alice", permissions: ["wiki.write"] } as unknown as Actor;

const GUIDE = "---\nid: PAGE-ENG-0001\ntitle: Guide\n---\n\n# Guide\n\n## Setup\n\nSteps.\n";
const FILES: Record<string, string> = {
  "20-spaces/eng/README.md": "---\nkey: ENG\norder:\n  - guide\n  - a\n---\n\n# Engineering\n",
  "20-spaces/eng/guide.md": GUIDE,
  "20-spaces/eng/a.md": "# A\n\nSee [the guide](guide.md) and [its setup](guide.md#setup), or [the missing page](gone.md).\n",
  "20-spaces/eng/runbooks/b.md": "# B\n\nSee [setup](../guide.md#setup).\n",
  "20-spaces/eng/unrelated.md": "# Unrelated\n\n[web](https://example.com/guide.md)\n",
  "20-spaces/ops/README.md": "---\nkey: OPS\norder: [x]\n---\n\n# Operations\n",
};

interface Setup {
  service: WikiMoveService;
  proposals: Array<Record<string, unknown>>;
  audit: ReturnType<typeof vi.fn>;
  access: { assertCanPublish: ReturnType<typeof vi.fn>; assertHasWritePermission: ReturnType<typeof vi.fn> };
}

function setup(options: { files?: Record<string, string>; linking?: string[]; open?: Record<string, string>; direct?: boolean; restricted?: string } = {}): Setup {
  const files = options.files ?? FILES;
  const linking = options.linking ?? ["20-spaces/eng/a.md", "20-spaces/eng/runbooks/b.md"];
  const proposals: Array<Record<string, unknown>> = [];
  const documents = {
    file: vi.fn(async (_project: string, _ref: string | undefined, path: string) => {
      const content = files[path];
      if (content === undefined) throw new NotFoundException(`${path} does not exist`);
      return { ref: "main", commit: "c".repeat(40), path, size: content.length, content };
    }),
  } as unknown as DocumentsService;
  const brain = {
    backlinks: vi.fn(async (_project: string, query: { node: string; offset: number; limit: number }) => {
      const all = linking.map((path) => ({ node: { path }, target: { id: query.node }, linkKind: "link" }));
      const items = all.slice(query.offset, query.offset + query.limit);
      const end = query.offset + items.length;
      return { items, total: all.length, offset: query.offset, nextOffset: end < all.length ? end : null };
    }),
  } as unknown as BrainService;
  const access = {
    assertCanPublish: vi.fn(async (_project: string, _actor: Actor, path: string) => {
      if (path === options.restricted) throw new ForbiddenException({ message: "Editing 20-spaces/eng/runbooks/ is limited to the people and roles its restriction lists", details: { refusal: { code: "restriction" } } });
      return { direct: options.direct === true };
    }),
    assertHasWritePermission: vi.fn(),
  };
  const writes = {
    openPageWrite: vi.fn(async (_project: string, path: string) => (options.open?.[path] === undefined ? undefined : { id: options.open[path] })),
    proposePage: vi.fn(async (_project: string, input: Record<string, unknown>) => {
      proposals.push(input);
      return { id: "w-1", status: "queued", kind: "page" };
    }),
  } as unknown as DocumentWritesService;
  const audit = vi.fn(async () => undefined);
  const service = new WikiMoveService(access as unknown as WikiAccessService, documents, brain, writes, { recordChange: audit } as unknown as AuditTrail);
  return { service, proposals, audit, access };
}

const FROM = "20-spaces/eng/guide.md";
const TO = "20-spaces/ops/guide.md";

describe("WikiMoveService.preview", () => {
  it("lists the moved page and every page whose links change, and counts the links, writing nothing", async () => {
    const { service, proposals } = setup();
    const preview = await service.preview("shop", { from: FROM, to: TO });
    expect(preview.entries).toEqual([
      { path: TO, renameFrom: FROM, kind: "moved" },
      { path: "20-spaces/eng/README.md", kind: "rewritten" },
      { path: "20-spaces/eng/a.md", kind: "rewritten" },
      { path: "20-spaces/eng/runbooks/b.md", kind: "rewritten" },
      { path: "20-spaces/ops/README.md", kind: "rewritten" },
    ]);
    // Two links of a.md and one of b.md; the web link stays.
    expect(preview.rewrittenLinks).toBe(3);
    expect(proposals).toEqual([]);
  });

  it("reads the pages at the head and plans a page whose text changed since the index as it is now", async () => {
    const files = { ...FILES, "20-spaces/eng/a.md": "# A\n\nNow it says [the guide](guide.md) once.\n" };
    const preview = await setup({ files }).service.preview("shop", { from: FROM, to: TO });
    expect(preview.rewrittenLinks).toBe(2);
    // A page the Brain lists that has no link any more is not rewritten.
    const none = await setup({ files: { ...FILES, "20-spaces/eng/a.md": "# A\n\nNo link here.\n" } }).service.preview("shop", { from: FROM, to: TO });
    expect(none.entries.map((entry) => entry.path)).not.toContain("20-spaces/eng/a.md");
  });

  it("answers 404 for a page that is not there and 409 target-exists for a target that is", async () => {
    await expect(setup().service.preview("shop", { from: "20-spaces/eng/nope.md", to: TO })).rejects.toBeInstanceOf(NotFoundException);
    const existing = setup({ files: { ...FILES, [TO]: "# Taken\n" } }).service.preview("shop", { from: FROM, to: TO });
    await expect(existing).rejects.toBeInstanceOf(ConflictException);
    await expect(existing).rejects.toMatchObject({ response: { details: { code: "target-exists", path: TO } } });
  });

  it("answers 400 for a path the wiki may not write", async () => {
    await expect(setup().service.preview("shop", { from: FROM, to: "plugins/p/guide.md" })).rejects.toMatchObject({ status: 400 });
    await expect(setup().service.preview("shop", { from: FROM, to: FROM })).rejects.toMatchObject({ status: 400 });
  });

  it("answers 409 too-many with the count and the limit, in words, when more pages link than the limit", async () => {
    const linking = Array.from({ length: MOVE_ENTRY_LIMIT + 5 }, (_, n) => `20-spaces/many/p${n}.md`);
    const files = { ...FILES, ...Object.fromEntries(linking.map((path) => [path, "[g](../eng/guide.md)\n"])) };
    const failure = setup({ files, linking }).service.preview("shop", { from: FROM, to: TO });
    await expect(failure).rejects.toBeInstanceOf(ConflictException);
    await expect(failure).rejects.toMatchObject({ response: { message: `Too many pages link here (${MOVE_ENTRY_LIMIT + 1}, the limit is ${MOVE_ENTRY_LIMIT})`, details: { code: "too-many", count: MOVE_ENTRY_LIMIT + 1, limit: MOVE_ENTRY_LIMIT } } });
  });
});

describe("WikiMoveService.move", () => {
  it("makes ONE write of kind page: a rename entry and a plain entry per rewritten page, each with the hash of the head", async () => {
    const { service, proposals, audit } = setup();
    const result = await service.move("shop", actor, { from: FROM, to: TO, message: "Move the guide to Operations" });
    expect(result).toEqual({ outcome: "published", write: { id: "w-1", status: "queued", mode: "pull-request" } });
    expect(proposals).toHaveLength(1);
    const [proposal] = proposals as Array<{ message: string; files: Array<Record<string, unknown>>; page: Record<string, unknown>; directPublish?: boolean }>;
    expect(proposal?.message).toBe("Move the guide to Operations");
    expect(proposal?.page).toEqual({ id: "PAGE-ENG-0001", path: TO, minor: false });
    expect(proposal?.directPublish).toBeUndefined();
    expect(proposal?.files.map((file) => [file["path"], file["renameFrom"], file["expectedHash"]])).toEqual([
      [TO, FROM, sha256(GUIDE)],
      ["20-spaces/eng/README.md", undefined, sha256(FILES["20-spaces/eng/README.md"] ?? "")],
      ["20-spaces/eng/a.md", undefined, sha256(FILES["20-spaces/eng/a.md"] ?? "")],
      ["20-spaces/eng/runbooks/b.md", undefined, sha256(FILES["20-spaces/eng/runbooks/b.md"] ?? "")],
      ["20-spaces/ops/README.md", undefined, sha256(FILES["20-spaces/ops/README.md"] ?? "")],
    ]);
    expect(audit).toHaveBeenCalledTimes(1);
  });

  it("publishes directly only when the caller may publish every path it touches", async () => {
    const direct = setup({ direct: true });
    expect((await direct.service.move("shop", actor, { from: FROM, to: TO, message: "m" })).write.mode).toBe("direct");
    expect(direct.proposals[0]).toMatchObject({ directPublish: true });
  });

  it("leaves the links intact: after the entries are applied the Brain finds the same links and the same broken one", async () => {
    const { service, proposals } = setup();
    await service.move("shop", actor, { from: FROM, to: TO, message: "m" });
    const files = (proposals[0] as { files: Array<{ path: string; content: string; renameFrom?: string }> }).files;
    const after = new Map(Object.entries(FILES));
    for (const file of files) {
      if (file.renameFrom !== undefined) after.delete(file.renameFrom);
      after.set(file.path, file.content);
    }
    const sources = (map: Map<string, string>) => [...map].map(([path, text]) => ({ path, text }));
    const before = buildBrainTree(sources(new Map(Object.entries(FILES))), "docs");
    const tree = buildBrainTree(sources(after), "docs");
    const edges = (links: typeof tree.links, rename: (id: string) => string): string[] => links.map((link) => `${rename(link.fromId)} -> ${rename(link.toId)}`).sort();
    const rename = (id: string): string => (id.startsWith(FROM) ? `${TO}${id.slice(FROM.length)}` : id);
    expect(edges(tree.links, (id) => id)).toEqual(edges(before.links, rename));
    expect(tree.broken).toEqual(before.broken);
    // The heading link still resolves to the section of the moved page.
    expect(tree.links.some((link) => link.fromId === "20-spaces/eng/a.md" && link.toId === `${TO}#setup`)).toBe(true);
  });

  it("refuses a path the caller may not write, naming it, and audits nothing itself (the access check does)", async () => {
    const { service, proposals } = setup({ restricted: "20-spaces/eng/runbooks/b.md" });
    const failure = service.move("shop", actor, { from: FROM, to: TO, message: "m" });
    await expect(failure).rejects.toBeInstanceOf(ForbiddenException);
    await expect(failure).rejects.toThrow("20-spaces/eng/runbooks/b.md");
    expect(proposals).toEqual([]);
  });

  it("checks the permission before it reads anything for a caller without wiki.write", async () => {
    const { service, access } = setup();
    access.assertHasWritePermission.mockImplementation(() => {
      throw new ForbiddenException("Missing permission: wiki.write");
    });
    await expect(service.move("shop", actor, { from: "20-spaces/eng/nope.md", to: TO, message: "m" })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("answers 409 open-write naming the page and the write when a page it would change waits for review", async () => {
    const { service, proposals } = setup({ open: { "20-spaces/eng/a.md": "w-77" } });
    const failure = service.move("shop", actor, { from: FROM, to: TO, message: "m" });
    await expect(failure).rejects.toBeInstanceOf(ConflictException);
    await expect(failure).rejects.toMatchObject({ response: { details: { code: "open-write", path: "20-spaces/eng/a.md", writeId: "w-77" } } });
    expect(proposals).toEqual([]);
    // The page itself with an open write is the same.
    await expect(setup({ open: { [FROM]: "w-78" } }).service.move("shop", actor, { from: FROM, to: TO, message: "m" })).rejects.toMatchObject({ response: { details: { code: "open-write", writeId: "w-78" } } });
  });
});
