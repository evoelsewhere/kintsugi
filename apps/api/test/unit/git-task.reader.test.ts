import { createHash } from "node:crypto";
import { GitTaskReader } from "../../src/modules/delivery/agent-context/infrastructure/git-task.reader.js";
import type { DocumentsService } from "../../src/modules/delivery/documents/index.js";
import { describe, expect, it, vi } from "vitest";

function unitMarkdown(id: string): string {
  return [
    "---",
    "id: " + id,
    "application: web",
    "module: core",
    "kind: module",
    "title: Task " + id.split("/").at(-1),
    "phase: migrate",
    "status: pending",
    "assignee: alice",
    "---",
    "Task body.",
    "",
  ].join("\n");
}

describe("GitTaskReader", () => {
  it("rejects oversized directory listings before filtering their entries", async () => {
    const oversizedDirectory = Array.from({ length: 10_001 }, (_, index) => ({
      kind: "file",
      name: "unusable-entry-" + index,
    }));
    const documents = {
      context: vi.fn(async () => ({
        repo: { repositoryId: "docs" },
        project: { id: "shop", applications: [{ id: "web" }] },
      })),
      resolve: vi.fn(async (_context: unknown, commit: string) => ({ commit })),
      listNames: vi.fn(async (_context: unknown, _commit: string, path: string) =>
        path === "applications"
          ? [{ kind: "dir", name: "web" }]
          : path === "applications/web/units"
            ? oversizedDirectory
            : [],
      ),
      readText: vi.fn(),
    } as unknown as DocumentsService;
    const reader = new GitTaskReader(documents);

    const errorMessage = await reader.readProject("shop", { repositoryId: "docs", commit: "a".repeat(40), applicationIdsFingerprint: createHash("sha256").update(JSON.stringify(["web"])).digest("hex") })
      .then(() => "", (error: unknown) => error instanceof Error ? error.message : String(error));
    expect(errorMessage).toContain("document repository exceeds the task indexing limit");
    expect(documents.readText).not.toHaveBeenCalled();
  });

  it("rejects a project index that exceeds its aggregate source-byte budget", async () => {
    const units = Array.from({ length: 257 }, (_, index) => "unit-" + String(index).padStart(3, "0"));
    const largeSource = "x".repeat(64 * 1024);
    const documents = {
      context: vi.fn(async () => ({
        repo: { repositoryId: "docs" },
        project: { id: "shop", applications: [{ id: "web" }] },
      })),
      resolve: vi.fn(async (_context: unknown, commit: string) => ({ commit })),
      listNames: vi.fn(async (_context: unknown, _commit: string, path: string) => {
        if (path === "applications") return [{ kind: "dir", name: "web" }];
        if (path === "applications/web/units") return [{ kind: "dir", name: "core" }];
        if (path === "applications/web/units/core") return units.map((name) => ({ kind: "dir", name }));
        if (path.startsWith("applications/web/units/core/unit-")) return [{ kind: "file", name: "unit.md" }];
        return [];
      }),
      readText: vi.fn(async (_context: unknown, _commit: string, path: string) =>
        path.endsWith("/unit.md") ? unitMarkdown(path.split("/").at(-2) ? "web/core/" + path.split("/").at(-2) : "web/core/unknown") : largeSource,
      ),
    } as unknown as DocumentsService;
    const reader = new GitTaskReader(documents);

    const errorMessage = await reader.readProject("shop", { repositoryId: "docs", commit: "a".repeat(40), applicationIdsFingerprint: createHash("sha256").update(JSON.stringify(["web"])).digest("hex") })
      .then(() => "", (error: unknown) => error instanceof Error ? error.message : String(error));
    expect(errorMessage).toContain("project task sources exceed the indexing byte limit");
  });
});


it("fingerprints registered application IDs independently of database order and Git movement", async () => {
  let applications = [{ id: "web" }, { id: "billing" }];
  const documents = {
    context: async () => ({ repo: { repositoryId: "docs" }, project: { id: "shop", applications } }),
    resolve: async () => ({ commit: "a".repeat(40) }),
  } as unknown as DocumentsService;
  const reader = new GitTaskReader(documents);
  const original = await reader.currentRevision("shop");
  applications = [{ id: "billing" }, { id: "web" }];
  expect(await reader.currentRevision("shop")).toEqual(original);
  applications = [{ id: "web" }];
  const changed = await reader.currentRevision("shop");
  expect(changed.commit).toBe(original.commit);
  expect(changed.applicationIdsFingerprint).not.toBe(original.applicationIdsFingerprint);
});


it.each([
  { field: "title", markdown: unitMarkdown("web/core/task").replace("title: Task task", "title: " + "x".repeat(501)) },
  { field: "assignee", markdown: unitMarkdown("web/core/task").replace("assignee: alice", "assignee: " + "x".repeat(201)) },
])("records oversized $field as an issue while excluding the invalid unit", async ({ field, markdown }) => {
  const documents = {
    context: async () => ({ repo: { repositoryId: "docs" }, project: { id: "shop", applications: [{ id: "web" }] } }),
    resolve: async () => ({ commit: "a".repeat(40) }),
    listNames: async (_context: unknown, _commit: string, path: string) => {
      if (path === "applications") return [{ kind: "dir", name: "web" }];
      if (path === "applications/web/units") return [{ kind: "dir", name: "core" }];
      if (path === "applications/web/units/core") return [{ kind: "dir", name: "task" }];
      return [{ kind: "file", name: "unit.md" }];
    },
    readText: async () => markdown,
  } as unknown as DocumentsService;
  const reader = new GitTaskReader(documents);
  const indexed = await reader.readProject("shop", await reader.currentRevision("shop"));
  expect(indexed.tasks).toEqual([]);
  expect(indexed.issues).toEqual([{ path: "applications/web/units/core/task/unit.md", messages: [field + ": is too long"] }]);
});
