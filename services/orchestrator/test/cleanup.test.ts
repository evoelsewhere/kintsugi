// Job workspace retention (ADR-0029): outputs whose write landed go at once, outputs of failed
// runs or writes after the retention period, active runs and pending writes never.

import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CheckoutStorage } from "@kintsugi/git";
import { afterAll, describe, expect, it } from "vitest";
import { type WorkspaceState, pruneJobWorkspaces, removeWorkspaceOnRequest } from "../src/jobs/cleanup.js";

const DAY = 24 * 60 * 60 * 1000;

describe("job workspace cleanup", () => {
  const root = mkdtempSync(join(tmpdir(), "kintsugi-cleanup-"));
  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("removes expired workspaces and keeps active, pending and recent ones", async () => {
    const storage = new CheckoutStorage(root);
    await storage.prepare();
    const now = new Date("2026-10-11T12:00:00Z");
    const old = new Date(now.getTime() - 8 * DAY);
    const recent = new Date(now.getTime() - DAY);
    const states = new Map<string, WorkspaceState>([
      ["written", { status: "succeeded", finishedAt: recent, writeStatus: "pr-opened" }],
      ["failed-old", { status: "failed", finishedAt: old }],
      ["failed-recent", { status: "failed", finishedAt: recent }],
      ["write-failed-old", { status: "succeeded", finishedAt: old, writeStatus: "failed" }],
      ["write-queued", { status: "succeeded", finishedAt: old, writeStatus: "queued" }],
      ["running", { status: "running" }],
      ["cancelled-old", { status: "cancelled", finishedAt: old }],
    ]);
    for (const id of [...states.keys(), "orphan-old", "orphan-new"]) {
      const out = storage.job(id).out;
      mkdirSync(out, { recursive: true });
      writeFileSync(join(out, "file.md"), "x");
    }
    utimesSync(storage.job("orphan-old").root, old, old);

    const removed = await pruneJobWorkspaces({ storage, store: { workspaceStates: async () => states }, retentionMs: 7 * DAY, now });
    expect(removed.sort()).toEqual(["cancelled-old", "failed-old", "orphan-old", "write-failed-old", "written"]);
    expect((await readdir(join(root, "jobs"))).sort()).toEqual(["failed-recent", "orphan-new", "running", "write-queued"]);
  });

  it("removes one workspace at an admin's request, but never one whose run is active or whose output is not written yet (ADR-0058)", async () => {
    const storage = new CheckoutStorage(root);
    await storage.prepare();
    const states = new Map<string, WorkspaceState>([
      ["asked-failed", { status: "failed", finishedAt: new Date() }],
      ["asked-running", { status: "running" }],
      ["asked-queued", { status: "queued" }],
      ["asked-write-pending", { status: "succeeded", finishedAt: new Date(), writeStatus: "queued" }],
    ]);
    for (const id of [...states.keys(), "asked-orphan"]) {
      mkdirSync(storage.job(id).out, { recursive: true });
      writeFileSync(join(storage.job(id).out, "file.md"), "x");
    }
    const ask = (jobId: string) => removeWorkspaceOnRequest({ storage, store: { workspaceStates: async () => states }, jobId });
    expect(await ask("asked-failed")).toBe("removed");
    expect(await ask("asked-orphan")).toBe("removed");
    expect(await ask("asked-running")).toBe("busy");
    expect(await ask("asked-queued")).toBe("busy");
    expect(await ask("asked-write-pending")).toBe("busy");
    expect(await ask("asked-failed")).toBe("missing");
    expect(await ask("never-existed")).toBe("missing");
    expect((await readdir(join(root, "jobs"))).filter((name) => name.startsWith("asked-")).sort()).toEqual(["asked-queued", "asked-running", "asked-write-pending"]);
  });
});
