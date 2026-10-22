// CTX-01/03 and AUTH-06: Git unit files are authoritative, readiness is activity-specific,
// assignments resolve by exact username, and current Project Access is checked on every read.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CheckoutStorage, cloneMirror, fetchMirror } from "@kintsugi/git";
import { type GitHttpServer, startGitHttpServer } from "@kintsugi/git/testing";
import type { MemberPrincipal } from "../../src/modules/core/auth/index.js";
import { TaskQueryService } from "../../src/modules/delivery/agent-context/application/task-query.service.js";
import { GitTaskReader } from "../../src/modules/delivery/agent-context/infrastructure/git-task.reader.js";
import { contextSourceId } from "../../src/modules/delivery/agent-context/domain/snapshot.js";
import { taskListResultSchema } from "@kintsugi/harness-sdk";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hasDatabase } from "../support/database.js";
import { adminClient, memberClient, startTestApp, type TestApp } from "../support/app.js";

function unitMarkdown(id: string, title: string, assignee = "alice"): string {
  return [
    "---",
    "id: " + id,
    "application: web",
    "module: core",
    "kind: module",
    "title: " + title,
    "phase: migrate",
    "status: pending",
    "assignee: " + assignee,
    "---",
    "Task for " + title + ".",
    "",
  ].join("\n");
}

const applicationSet = [
  "---",
  "id: architecture",
  "title: Application architecture",
  "version: 1",
  "scope: application",
  "needs: []",
  "---",
  "| Path | Template | Required | When |",
  "| --- | --- | --- | --- |",
  "| overview.md | overview.md | yes | |",
].join("\n");
describe.skipIf(!hasDatabase)("Coding Agent Workflow task index (integration)", () => {
  let app: TestApp;
  let remote: GitHttpServer;
  let dataDir: string;
  let admin: Awaited<ReturnType<typeof adminClient>>;
  let taskService: TaskQueryService;
  let principal: MemberPrincipal;
  const previousDataDir = process.env["KINTSUGI_DATA_DIR"];

  beforeAll(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "kintsugi-member-tasks-"));
    process.env["KINTSUGI_DATA_DIR"] = dataDir;
    remote = await startGitHttpServer();
    await remote.createRepository("docs");
    await remote.commit("docs", "01-standards/templates/architecture/set.md", applicationSet);
    await remote.commit("docs", "01-standards/templates/architecture/overview.md", "# Architecture overview\n");
    await remote.commit("docs", "10-applications/web/02-modern/core/invoice/README.md", unitMarkdown("web/core/invoice", "Invoice"));
    await remote.commit("docs", "10-applications/web/02-modern/core/invoice/task.md", "# Task\nCalculate invoice totals.\n");
    await remote.commit("docs", "10-applications/web/01-legacy/core/invoice/spec.md", "# Current behavior\nTax is calculated per line.\n");
    await remote.commit("docs", "10-applications/web/02-modern/core/reported/README.md", unitMarkdown("web/core/reported", "Reported work", "Alice Display"));
    await cloneMirror(
      remote.baseUrl + "/docs.git",
      new CheckoutStorage(dataDir).mirror("local", "docs"),
      { allowHttp: true },
    );

    app = await startTestApp();
    admin = await adminClient(app);
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

    const alice = await memberClient(app, admin, "alice", ["user"]);
    expect((await admin.request("PUT", "/admin/project-access/shop/" + alice.id, { body: {} })).status).toBe(204);
    principal = {
      userId: alice.id,
      tokenId: "integration-token",
      projectIds: ["shop"],
      credentialKind: "coding-agent-read",
    };
    taskService = app.nest.get(TaskQueryService);
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await remote?.close();
    if (dataDir !== undefined) await rm(dataDir, { recursive: true, force: true });
    if (previousDataDir === undefined) delete process.env["KINTSUGI_DATA_DIR"];
    else process.env["KINTSUGI_DATA_DIR"] = previousDataDir;
  });

  it("indexes a validated Git task, resolves its exact username, and computes draft readiness", async () => {
    const mine = await taskService.list(principal, {
      projectId: "shop",
      mine: true,
      limit: 10,
    });
    expect(mine.items.map((task) => task.unitId)).toEqual(["web/core/invoice"]);
    expect(mine.items[0]?.assignee).toBe("alice");
    const readyForDesign = await taskService.list(principal, { projectId: "shop", readyFor: "design", limit: 10 });
    expect(readyForDesign.items.map((task) => task.unitId)).toEqual(["web/core/invoice"]);

    const task = await taskService.get(principal, { projectId: "shop", unitId: "web/core/invoice" });
    expect(task.sourcePath).toBe("10-applications/web/02-modern/core/invoice/README.md");
    expect(task.sourceCommit).toMatch(/^[0-9a-f]{40}$/);
    expect(task.readiness.byActivity.design.ready).toBe(true);
    expect(task.readiness.byActivity.implementation.ready).toBe(false);
    expect(task.readiness.blockers.some((item) => item.code === "SOURCE_MISSING" && item.sourceId === contextSourceId("docs", "basic-design", "10-applications/web/02-modern/_design/architecture/overview.md"))).toBe(true);
    expect(task.readiness.blockers.some((item) => item.code === "GATE_UNKNOWN" && item.gateId === "G3")).toBe(true);
    expect(task.readiness.blockers.some((item) => item.code === "GATE_PENDING")).toBe(false);
    expect(task.assignmentState).toBe("resolved");
    const unresolved = await taskService.get(principal, { projectId: "shop", unitId: "web/core/reported" });
    expect(unresolved.assignmentState).toBe("unresolved");
    expect(unresolved.assignedUserId).toBeUndefined();
  });

  it("rebuilds after the default branch advances and keeps malformed rows out of the index", async () => {
    await remote.commit("docs", "10-applications/web/02-modern/core/invoice/README.md", unitMarkdown("web/core/invoice", "Invoice v2"));
    await remote.commit("docs", "10-applications/web/02-modern/core/bad/README.md", unitMarkdown("web/core/not-bad", "Invalid identity"));
    await fetchMirror(new CheckoutStorage(dataDir).mirror("local", "docs"), { allowHttp: true });

    const listed = await taskService.list(principal, { projectId: "shop", limit: 10 });
    expect(listed.items.map((task) => task.unitId)).toEqual(["web/core/invoice", "web/core/reported"]);
    expect(listed.items[0]?.title).toBe("Invoice v2");
    const issue = await app.db.query<{ issue_count: number }>(
      "select issue_count from delivery.member_task_index where project_id = 'shop'",
    );
    expect(issue.rows[0]?.issue_count).toBe(1);
  });

  it("includes a newly registered application's existing Git unit without moving the branch", async () => {
    await remote.commit("docs", "10-applications/mobile/02-modern/core/app/README.md",
      unitMarkdown("mobile/core/app", "Mobile").replace("application: web", "application: mobile"));
    await fetchMirror(new CheckoutStorage(dataDir).mirror("local", "docs"), { allowHttp: true });
    expect((await taskService.list(principal, { projectId: "shop" })).items).toHaveLength(2);
    const before = await app.db.query<{ source_commit: string; application_ids_fingerprint: string }>(
      "select source_commit, application_ids_fingerprint from delivery.member_task_index where project_id = 'shop'");
    await app.db.query("insert into admin.application (project_id, id, name, disposition) values ('shop', 'mobile', 'Mobile', 'refactor')");
    expect((await taskService.list(principal, { projectId: "shop" })).items.map(({ unitId }) => unitId)).toEqual([
      "mobile/core/app", "web/core/invoice", "web/core/reported",
    ]);
    const after = await app.db.query<{ source_commit: string; application_ids_fingerprint: string }>(
      "select source_commit, application_ids_fingerprint from delivery.member_task_index where project_id = 'shop'");
    expect(after.rows[0]?.source_commit).toBe(before.rows[0]?.source_commit);
    expect(after.rows[0]?.application_ids_fingerprint).not.toBe(before.rows[0]?.application_ids_fingerprint);
    await app.db.query("delete from admin.application where project_id = 'shop' and id = 'mobile'");
  });

  it("refreshes registered applications without a Git commit change, including delete and recreate", async () => {
    const before = await taskService.get(principal, { projectId: "shop", unitId: "web/core/invoice" });
    await app.db.query("delete from admin.application where project_id = 'shop' and id = 'web'");
    await app.db.query("insert into admin.application (project_id, id, name, disposition) values ('shop', 'web', 'Web', 'refactor')");
    const recreated = await taskService.get(principal, { projectId: "shop", unitId: "web/core/invoice" });
    expect(recreated.sourceCommit).toBe(before.sourceCommit);
    await app.db.query("delete from admin.application where project_id = 'shop' and id = 'web'");
    expect((await taskService.list(principal, { projectId: "shop" })).items).toEqual([]);
    await app.db.query("insert into admin.application (project_id, id, name, disposition) values ('shop', 'web', 'Web', 'refactor')");
    expect((await taskService.list(principal, { projectId: "shop" })).items.map(({ unitId }) => unitId)).toEqual(["web/core/invoice", "web/core/reported"]);
  });

  it("returns bounded source identities for long missing paths and rejects oversized linked paths", async () => {
    const longPath = "standards/" + "x".repeat(600) + ".md";
    const markdown = unitMarkdown("web/core/invoice", "Invoice with mapping")
      .replace("assignee: alice", "links:\n  mappings: [\"" + longPath + "\"]\nassignee: alice");
    await remote.commit("docs", "10-applications/web/02-modern/core/invoice/README.md", markdown);
    await fetchMirror(new CheckoutStorage(dataDir).mirror("local", "docs"), { allowHttp: true });
    const listed = await taskService.list(principal, { projectId: "shop" });
    expect(taskListResultSchema.safeParse(listed).success).toBe(true);
    const blocker = listed.items.find(({ unitId }) => unitId === "web/core/invoice")?.readiness.blockers
      .find(({ code, sourceId }) => code === "SOURCE_MISSING" && sourceId !== undefined);
    expect(blocker?.sourceId).toMatch(/^src_[a-f0-9]{24}$/);
    const reader = app.nest.get(GitTaskReader);
    const snapshot = await reader.readProject("shop", await reader.currentRevision("shop"));
    const mapping = snapshot.tasks.find(({ unitId }) => unitId === "web/core/invoice")?.sourceReferences.find(({ role }) => role === "mapping");
    expect(mapping?.sourceId).toMatch(/^src_[a-f0-9]{24}$/);

    await remote.commit("docs", "10-applications/web/02-modern/core/invoice/README.md", markdown.replace(longPath, "x".repeat(1001)));
    await fetchMirror(new CheckoutStorage(dataDir).mirror("local", "docs"), { allowHttp: true });
    expect((await taskService.list(principal, { projectId: "shop" })).items.map(({ unitId }) => unitId)).toEqual(["web/core/reported"]);
  });

  it("rechecks current Project Access before touching the Git index", async () => {
    expect((await admin.request("DELETE", "/admin/project-access/shop/" + principal.userId)).status).toBe(204);
    await expect(taskService.list(principal, { projectId: "shop" })).rejects.toThrow("Project Access is required");
  });
});
