// The common member read use cases: the project list is limited to the token scope and current Project
// Access, and document reads delegate to the documents module with the project identity attached.

import { describe, expect, it, vi } from "vitest";
import type { ProjectAccessService } from "../../src/modules/admin/project-access/index.js";
import type { MemberPrincipal } from "../../src/modules/core/auth/index.js";
import type { DocumentsService } from "../../src/modules/delivery/documents/index.js";
import { MemberApiService } from "../../src/modules/delivery/member-api/application/member-api.service.js";

const principal = (projectIds: string[]): MemberPrincipal => ({ userId: "u1", tokenId: "t1", projectIds, credentialKind: "coding-agent-read" } as MemberPrincipal);

function service(readable: Array<{ projectId: string; name: string }>, documents: Partial<DocumentsService> = {}) {
  const access = { listReadableProjects: vi.fn(async () => readable) } as unknown as ProjectAccessService;
  return { member: new MemberApiService(access, documents as DocumentsService), access };
}

describe("MemberApiService.listProjects", () => {
  it("lists only projects inside the token scope, sorted, with no duplicates", async () => {
    const { member } = service([
      { projectId: "zeta", name: "Zeta" },
      { projectId: "alpha", name: "Alpha" },
      { projectId: "alpha", name: "Alpha" },
      { projectId: "outside", name: "Outside" },
    ]);
    const result = await member.listProjects(principal(["alpha", "zeta"]), {});
    expect(result).toEqual({ schemaVersion: "1", items: [{ projectId: "alpha", name: "Alpha" }, { projectId: "zeta", name: "Zeta" }], limit: 25 });
  });

  it("pages with an opaque cursor", async () => {
    const readable = ["a", "b", "c"].map((projectId) => ({ projectId, name: projectId.toUpperCase() }));
    const { member } = service(readable);
    const first = await member.listProjects(principal(["a", "b", "c"]), { limit: 2 });
    expect(first.items.map((item) => item.projectId)).toEqual(["a", "b"]);
    expect(first.nextCursor).toBeDefined();
    const second = await member.listProjects(principal(["a", "b", "c"]), { limit: 2, cursor: first.nextCursor! });
    expect(second.items.map((item) => item.projectId)).toEqual(["c"]);
    expect(second.nextCursor).toBeUndefined();
  });

  it("rejects a forged cursor and an out-of-range limit", async () => {
    const { member } = service([]);
    await expect(member.listProjects(principal(["a"]), { cursor: "***" })).rejects.toThrow("cursor is invalid");
    await expect(member.listProjects(principal(["a"]), { limit: 101 })).rejects.toThrow("limit must be between 1 and 100");
  });

  it("refuses a token with an oversized project scope", async () => {
    const { member } = service([]);
    await expect(member.listProjects(principal(Array.from({ length: 101 }, (_, index) => `p${index}`)), {})).rejects.toThrow("no valid project scope");
  });
});

describe("MemberApiService documents", () => {
  it("reads the tree and a file through the documents module and attaches the project", async () => {
    const tree = vi.fn(async () => ({ ref: "refs/heads/main", commit: "a".repeat(40), path: "", entries: [] }));
    const file = vi.fn(async () => ({ ref: "refs/heads/main", commit: "a".repeat(40), path: "00-project/a.md", size: 3, content: "abc" }));
    const { member } = service([], { tree, file } as unknown as Partial<DocumentsService>);

    await expect(member.documentTree("shop", undefined, undefined)).resolves.toMatchObject({ schemaVersion: "1", projectId: "shop", entries: [] });
    expect(tree).toHaveBeenCalledWith("shop", undefined, "");
    await expect(member.documentFile("shop", "refs/heads/main", "00-project/a.md")).resolves.toMatchObject({ projectId: "shop", content: "abc" });
    expect(file).toHaveBeenCalledWith("shop", "refs/heads/main", "00-project/a.md");
  });
});
