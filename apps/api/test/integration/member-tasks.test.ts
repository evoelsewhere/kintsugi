// CTX-01/03 and AUTH-06: Git unit files are authoritative, readiness is activity-specific,
// assignments resolve by exact username, and current Project Access is checked on every read.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CheckoutStorage, cloneMirror, fetchMirror } from "@kintsugi/git";
import { type GitHttpServer, startGitHttpServer } from "@kintsugi/git/testing";
import type { MemberPrincipal } from "../../src/modules/core/auth/index.js";
import { TaskQueryService } from "../../src/modules/delivery/agent-context/application/task-query.service.js";
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
    "gates:",
    "  G3:",
    "    status: approved",
    "---",
    "Task for " + title + ".",
    "",
  ].join("\n");
}

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
    await remote.commit("docs", "applications/web/units/core/invoice/unit.md", unitMarkdown("web/core/invoice", "Invoice"));
    await remote.commit("docs", "applications/web/units/core/invoice/task.md", "# Task\nCalculate invoice totals.\n");
    await remote.commit("docs", "applications/web/units/core/invoice/as-is.md", "# Current behavior\nTax is calculated per line.\n");
    await remote.commit("docs", "applications/web/units/core/reported/unit.md", unitMarkdown("web/core/reported", "Reported work", "Alice Display"));
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
    expect(task.sourcePath).toBe("applications/web/units/core/invoice/unit.md");
    expect(task.sourceCommit).toMatch(/^[0-9a-f]{40}$/);
    expect(task.readiness.byActivity.design.ready).toBe(true);
    expect(task.readiness.byActivity.implementation.ready).toBe(false);
    expect(task.readiness.blockers.some((item) => item.code === "SOURCE_MISSING" && item.sourceId?.startsWith("basic-design:"))).toBe(true);
    expect(task.readiness.blockers.some((item) => item.code === "GATE_UNKNOWN" && item.gateId === "G3")).toBe(true);
    expect(task.readiness.blockers.some((item) => item.code === "GATE_PENDING")).toBe(false);
    expect(task.assignmentState).toBe("resolved");
    const unresolved = await taskService.get(principal, { projectId: "shop", unitId: "web/core/reported" });
    expect(unresolved.assignmentState).toBe("unresolved");
    expect(unresolved.assignedUserId).toBeUndefined();
  });

  it("rebuilds after the default branch advances and keeps malformed rows out of the index", async () => {
    await remote.commit("docs", "applications/web/units/core/invoice/unit.md", unitMarkdown("web/core/invoice", "Invoice v2"));
    await remote.commit("docs", "applications/web/units/core/bad/unit.md", unitMarkdown("web/core/not-bad", "Invalid identity"));
    await fetchMirror(new CheckoutStorage(dataDir).mirror("local", "docs"), { allowHttp: true });

    const listed = await taskService.list(principal, { projectId: "shop", limit: 10 });
    expect(listed.items.map((task) => task.unitId)).toEqual(["web/core/invoice", "web/core/reported"]);
    expect(listed.items[0]?.title).toBe("Invoice v2");
    const issue = await app.db.query<{ issue_count: number }>(
      "select issue_count from delivery.member_task_index where project_id = 'shop'",
    );
    expect(issue.rows[0]?.issue_count).toBe(1);
  });

  it("rechecks current Project Access before touching the Git index", async () => {
    expect((await admin.request("DELETE", "/admin/project-access/shop/" + principal.userId)).status).toBe(204);
    await expect(taskService.list(principal, { projectId: "shop" })).rejects.toThrow("Project Access is required");
  });
});
