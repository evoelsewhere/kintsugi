// CTX-02/04/05/07/08: fixed Git revisions, bounded cited sections, persistent handles and access checks.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CheckoutStorage, cloneMirror, fetchMirror } from "@kintsugi/git";
import type { GitHttpServer } from "@kintsugi/git/testing";
import { SnapshotService } from "../../src/modules/delivery/agent-context/application/snapshot.service.js";
import { DocumentQueryService } from "../../src/modules/delivery/agent-context/application/document-query.service.js";
import type { MemberPrincipal } from "../../src/modules/core/auth/index.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startGitHttpServer } from "@kintsugi/git/testing";
import { createTestDatabase, hasDatabase, type TestDatabase } from "../support/database.js";
import { adminClient, memberClient, startTestAppWithDatabase, type TestApp } from "../support/app.js";

const unit = [
  "---",
  "id: web/core/invoice",
  "application: web",
  "module: core",
  "kind: module",
  "title: Invoice",
  "phase: migrate",
  "status: pending",
  "---",
  "Task unit.",
  "",
].join("\n");

function taskPack(revision: string): string {
  return [
    "# Task",
    "",
    "## Objective",
    "Calculate invoice tax. " + revision + " task context phrase.",
    "",
    "## Acceptance criteria",
    "- Use a consistent rounding rule.",
    "",
    "## Large mandatory design",
    "The verified rounding details for " + revision + ":",
    "x".repeat(36 * 1024),
    "",
  ].join("\n");
}

describe.skipIf(!hasDatabase)("Coding Agent Workflow immutable member context (integration)", () => {
  let app: TestApp;
  let database: TestDatabase;
  let remote: GitHttpServer;
  let worker: { stop(): Promise<void> } | undefined;
  let dataDir: string;
  let commitA: string;
  let principal: MemberPrincipal;
  let snapshotService: SnapshotService;
  let documentQuery: DocumentQueryService;
  const previousDataDir = process.env["KINTSUGI_DATA_DIR"];
  const taskPath = "applications/web/units/core/invoice/task.md";

  beforeAll(async () => {
    database = await createTestDatabase();
    dataDir = await mkdtemp(join(tmpdir(), "kintsugi-member-context-"));
    process.env["KINTSUGI_DATA_DIR"] = dataDir;
    remote = await startGitHttpServer();
    await remote.createRepository("docs");
    await remote.commit("docs", "applications/web/units/core/invoice/unit.md", unit);
    await remote.commit("docs", taskPath, taskPack("snapshot A"));
    commitA = await remote.commit("docs", "applications/web/units/core/invoice/as-is.md", "# Current behavior\nInvoices round per line.\n");
    await cloneMirror(remote.baseUrl + "/docs.git", new CheckoutStorage(dataDir).mirror("local", "docs"), { allowHttp: true });

    app = await startTestAppWithDatabase(database);
    const admin = await adminClient(app);
    await app.db.query(
      "insert into admin.git_server (id, kind, name, base_url, auth_type) values ('local', 'plain-git', 'Local', $1, 'none')",
      [remote.baseUrl],
    );
    await app.db.query(
      "insert into admin.git_repository (id, server_id, url, default_branch) values ('docs', 'local', $1, 'main')",
      [remote.baseUrl + "/docs.git"],
    );
    expect((await admin.request("POST", "/admin/projects", {
      body: { id: "shop", name: "Shop", documentRepositoryId: "docs" },
    })).status).toBe(201);
    expect((await admin.request("POST", "/admin/projects/shop/applications", {
      body: { id: "web", name: "Web", disposition: "refactor" },
    })).status).toBe(201);
    const member = await memberClient(app, admin, "alice", ["user"]);
    expect((await admin.request("PUT", "/admin/project-access/shop/" + member.id, { body: {} })).status).toBe(204);
    principal = {
      userId: member.id,
      tokenId: "context-integration-token",
      projectIds: ["shop"],
      credentialKind: "coding-agent-read",
    };

    const { getPool } = await import("../../src/common/db/pool.js");
    const { startWorker } = await import("@kintsugi/orchestrator");
    worker = await startWorker({
      databaseUrl: database.url,
      pool: getPool(),
      storage: new CheckoutStorage(dataDir),
      pollIntervalSeconds: 3600,
      cleanupIntervalSeconds: 3600,
      log: () => undefined,
    });
    snapshotService = app.nest.get(SnapshotService);
    documentQuery = app.nest.get(DocumentQueryService);
  }, 180_000);

  afterAll(async () => {
    await worker?.stop();
    await app?.close();
    if (database !== undefined) await database.drop();
    await remote?.close();
    if (dataDir !== undefined) await rm(dataDir, { recursive: true, force: true });
    if (previousDataDir === undefined) delete process.env["KINTSUGI_DATA_DIR"];
    else process.env["KINTSUGI_DATA_DIR"] = previousDataDir;
  });

  it("keeps a paged task brief and search on commit A after Git and the API move to B", async () => {
    const brief = await snapshotService.brief(principal, {
      projectId: "shop",
      unitId: "web/core/invoice",
      activity: "design",
      maxBytes: 32 * 1024,
    });
    const source = brief.sources.find((item) => item.role === "task-pack");
    expect(source).toBeDefined();
    expect(brief.documentRepoCommit).toBe(commitA);
    expect(brief.requiredContextStatus).toBe("partial");
    expect(brief.omittedSections).toHaveLength(1);
    expect(brief.nextCursor).toBeDefined();
    const briefTextBytes = Buffer.byteLength(brief.objective, "utf8")
      + brief.acceptanceCriteria.reduce((total, item) => total + Buffer.byteLength(item, "utf8"), 0)
      + brief.sections.reduce((total, section) => total + Buffer.byteLength(section.text, "utf8"), 0);
    expect(briefTextBytes).toBeLessThanOrEqual(32 * 1024);

    const page = await documentQuery.get(principal, {
      projectId: brief.projectId,
      unitId: brief.unitId,
      snapshotId: brief.snapshotId,
      sourceId: source!.sourceId,
      sectionId: brief.omittedSections[0]!.sectionId,
      cursor: brief.nextCursor,
      maxBytes: 32 * 1024,
    });
    expect(page.commit).toBe(commitA);
    expect(page.text).toContain("snapshot A");

    const commitB = await remote.commit("docs", taskPath, taskPack("snapshot B"));
    await fetchMirror(new CheckoutStorage(dataDir).mirror("local", "docs"), { allowHttp: true });
    expect(commitB).not.toBe(commitA);
    await worker?.stop();
    worker = undefined;
    await app.close();

    app = await startTestAppWithDatabase(database);
    documentQuery = app.nest.get(DocumentQueryService);
    snapshotService = app.nest.get(SnapshotService);
    const refreshed = await snapshotService.brief(principal, {
      projectId: brief.projectId,
      unitId: brief.unitId,
      activity: "design",
      snapshotId: brief.snapshotId,
      maxBytes: 32 * 1024,
    });
    expect(refreshed.snapshotId).toBe(brief.snapshotId);
    expect(refreshed.freshness.isCurrent).toBe(false);
    expect(refreshed.freshness.newerContextRevision).toBeDefined();
    const afterRestart = await documentQuery.get(principal, {
      projectId: brief.projectId,
      unitId: brief.unitId,
      snapshotId: brief.snapshotId,
      sourceId: source!.sourceId,
      sectionId: brief.omittedSections[0]!.sectionId,
      cursor: brief.nextCursor,
      maxBytes: 32 * 1024,
    });
    expect(afterRestart.commit).toBe(commitA);
    expect(afterRestart.text).toContain("snapshot A");
    await expect(documentQuery.get(principal, {
      projectId: brief.projectId,
      unitId: brief.unitId,
      snapshotId: brief.snapshotId,
      sourceId: source!.sourceId,
      cursor: "invalid",
    })).rejects.toThrow("cursor is invalid");

    const search = await documentQuery.search(principal, {
      projectId: brief.projectId,
      unitId: brief.unitId,
      snapshotId: brief.snapshotId,
      query: "snapshot A task context phrase",
      limit: 10,
    });
    expect(search.items.some((hit) => hit.excerpt.includes("snapshot A"))).toBe(true);
    await expect(documentQuery.get(principal, {
      projectId: brief.projectId,
      unitId: brief.unitId,
      snapshotId: brief.snapshotId,
      sourceId: "../../restricted/secret.md",
    })).rejects.toThrow("sourceId is not part of this snapshot");
    await app.db.query("delete from admin.project_access where project_id = $1 and user_id = $2", ["shop", principal.userId]);
    await expect(documentQuery.get(principal, {
      projectId: brief.projectId,
      unitId: brief.unitId,
      snapshotId: brief.snapshotId,
      sourceId: source!.sourceId,
    })).rejects.toThrow("Project Access is required");
    await expect(documentQuery.get({ ...principal, projectIds: [] }, {
      projectId: brief.projectId,
      unitId: brief.unitId,
      snapshotId: brief.snapshotId,
      sourceId: source!.sourceId,
    })).rejects.toThrow("token is not scoped to this project");
  });
});
