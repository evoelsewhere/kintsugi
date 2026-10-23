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
  it("indexes README cards and derives inputs from current unit design sets", async () => {
    const detailSet = ["---", "id: detail", "title: Detailed design", "version: 1", "needs: []", "---", "| Path | Template | Required |", "| --- | --- | --- |", "| logic.md | logic.md | yes |"].join("\n");
    const moduleProfile = ["---", "kind: module", "version: 1", "---", "| Path | Template | Required |", "| --- | --- | --- |", "| module-contract.md | module-contract.md | yes |", "| data-access.md | data-access.md | yes |"].join("\n");
    const appSet = ["---", "id: architecture", "title: Application architecture", "version: 1", "scope: application", "needs: []", "---", "| Path | Template | Required |", "| --- | --- | --- |", "| overview.md | overview.md | yes |"].join("\n");
    const card = unitMarkdown("web/core/task").replace("assignee: alice", "links:\n  businessRules: [RULE-001]\n  mappings: [01-standards/mappings/example.md]\nwaived:\n  - \"detail/data-access.md: no data store\"\nassignee: alice");
    const extraTemplateFiles = Array.from({ length: 40 }, (_, index) => "unused-" + index + ".md");
    let activeTemplateReads = 0;
    let maximumTemplateReads = 0;
    const contents = new Map<string, string>([
      ["01-standards/templates/architecture/set.md", appSet],
      ["01-standards/templates/architecture/overview.md", "# Application overview"],
      ["10-applications/web/02-modern/_design/architecture/overview.md", "# App design"],
      ["01-standards/templates/detail/set.md", detailSet],
      ["01-standards/templates/detail/logic.md", "# Unit logic"],
      ["01-standards/templates/detail/module/profile.md", moduleProfile],
      ["01-standards/templates/detail/module/module-contract.md", "# Module contract"],
      ["01-standards/templates/detail/module/data-access.md", "# Data access"],
      ["10-applications/web/02-modern/core/task/task.md", "# Task"],
      ["10-applications/web/01-legacy/core/task/spec.md", "# AS IS"],
      ["10-applications/web/01-legacy/core/task/rules/RULE-001.md", "# Rule"],
      ["01-standards/mappings/example.md", "# Mapping"],
    ]);
    const documents = {
      context: async () => ({ repo: { repositoryId: "docs" }, project: { id: "shop", applications: [{ id: "web" }] } }),
      resolve: async (_context: unknown, commit: string) => ({ commit }),
      listNames: async (_context: unknown, _commit: string, path: string) => {
        if (path === "10-applications") return [{ kind: "dir", name: "web" }];
        if (path === "10-applications/web/02-modern") return [{ kind: "dir", name: "core" }];
        if (path === "10-applications/web/02-modern/core") return [{ kind: "dir", name: "task" }];
        if (path === "10-applications/web/02-modern/core/task") return [{ kind: "file", name: "README.md" }];
        if (path === "01-standards/templates") return [{ kind: "dir", name: "architecture" }, { kind: "dir", name: "detail" }];
        if (path === "01-standards/templates/architecture") return ["set.md", "overview.md"].map((name) => ({ kind: "file", name }));
        if (path === "01-standards/templates/detail") return ["set.md", "logic.md", ...extraTemplateFiles].map((name) => ({ kind: "file", name })).concat({ kind: "dir", name: "module" });
        if (path === "01-standards/templates/detail/module") return ["profile.md", "module-contract.md", "data-access.md"].map((name) => ({ kind: "file", name }));
        return [];
      },
      readText: async (_context: unknown, _commit: string, path: string) => {
        if (path.startsWith("01-standards/templates/detail/")) {
          activeTemplateReads++;
          maximumTemplateReads = Math.max(maximumTemplateReads, activeTemplateReads);
          try {
            await new Promise((resolve) => setTimeout(resolve, 0));
            return contents.get(path);
          } finally {
            activeTemplateReads--;
          }
        }
        return path === "10-applications/web/02-modern/core/task/README.md" ? card : contents.get(path);
      },
    } as unknown as DocumentsService;
    const reader = new GitTaskReader(documents);
    const indexed = await reader.readProject("shop", await reader.currentRevision("shop"));
    expect(indexed.issues).toEqual([]);
    expect(indexed.tasks).toHaveLength(1);
    const sources = indexed.tasks[0]?.sourceReferences ?? [];
    expect(sources.find((source) => source.role === "task-pack")?.path).toBe("10-applications/web/02-modern/core/task/task.md");
    expect(sources.find((source) => source.role === "as-is-specification")?.path).toBe("10-applications/web/01-legacy/core/task/spec.md");
    expect(sources.find((source) => source.role === "basic-design")?.path).toBe("10-applications/web/02-modern/_design/architecture/overview.md");
    expect(sources.filter((source) => source.role === "detailed-design").map((source) => source.path)).toEqual([
      "10-applications/web/02-modern/core/task/detail/logic.md",
      "10-applications/web/02-modern/core/task/detail/module-contract.md",
    ]);
    expect(sources.find((source) => source.role === "business-rule")?.path).toBe("10-applications/web/01-legacy/core/task/rules/RULE-001.md");
    expect(sources.find((source) => source.role === "mapping")?.path).toBe("01-standards/mappings/example.md");
    expect(maximumTemplateReads).toBeLessThanOrEqual(20);
    expect(maximumTemplateReads).toBeGreaterThan(1);
  });

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
        path === "10-applications"
          ? [{ kind: "dir", name: "web" }]
          : path === "10-applications/web/02-modern"
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
    const units = Array.from({ length: 513 }, (_, index) => "unit-" + String(index).padStart(3, "0"));
    const largeSource = "x".repeat(64 * 1024);
    const documents = {
      context: vi.fn(async () => ({
        repo: { repositoryId: "docs" },
        project: { id: "shop", applications: [{ id: "web" }] },
      })),
      resolve: vi.fn(async (_context: unknown, commit: string) => ({ commit })),
      listNames: vi.fn(async (_context: unknown, _commit: string, path: string) => {
        if (path === "10-applications") return [{ kind: "dir", name: "web" }];
        if (path === "10-applications/web/02-modern") return [{ kind: "dir", name: "core" }];
        if (path === "10-applications/web/02-modern/core") return units.map((name) => ({ kind: "dir", name }));
        if (path.startsWith("10-applications/web/02-modern/core/unit-")) return [{ kind: "file", name: "README.md" }];
        return [];
      }),
      readText: vi.fn(async (_context: unknown, _commit: string, path: string) =>
        path.endsWith("/README.md") ? unitMarkdown(path.split("/").at(-2) ? "web/core/" + path.split("/").at(-2) : "web/core/unknown") : largeSource,
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
      if (path === "10-applications") return [{ kind: "dir", name: "web" }];
      if (path === "10-applications/web/02-modern") return [{ kind: "dir", name: "core" }];
      if (path === "10-applications/web/02-modern/core") return [{ kind: "dir", name: "task" }];
      return [{ kind: "file", name: "README.md" }];
    },
    readText: async () => markdown,
  } as unknown as DocumentsService;
  const reader = new GitTaskReader(documents);
  const indexed = await reader.readProject("shop", await reader.currentRevision("shop"));
  expect(indexed.tasks).toEqual([]);
  expect(indexed.issues).toEqual([{ path: "10-applications/web/02-modern/core/task/README.md", messages: [field + ": is too long"] }]);
});
