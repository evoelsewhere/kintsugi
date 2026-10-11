// Job workspace retention (ADR-0029): outputs whose write landed go at once, outputs of failed
// runs or writes after the retention period, active runs and pending writes never.

import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CheckoutStorage } from "@kintsugi/git";
import { afterAll, describe, expect, it } from "vitest";
import { type WorkspaceState, pruneJobWorkspaces } from "../src/jobs/cleanup.js";

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
});
