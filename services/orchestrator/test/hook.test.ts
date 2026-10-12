// The JobOutput hook as the worker runs it: diagram lint warnings never block, credentials do.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { interpretersFromEnv } from "@kintsugi/runtime/launcher";
import { afterEach, describe, expect, it } from "vitest";
import { runJobOutputHook } from "../src/jobs/hook.js";

const dirs: string[] = [];

function workspace(files: Record<string, string>): { root: string; out: string; tmp: string } {
  const root = mkdtempSync(join(tmpdir(), "kintsugi-hook-"));
  dirs.push(root);
  const out = join(root, "out");
  const tmp = join(root, "tmp");
  mkdirSync(tmp, { recursive: true });
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(out, path, ".."), { recursive: true });
    writeFileSync(join(out, path), text, "utf8");
  }
  mkdirSync(out, { recursive: true });
  return { root, out, tmp };
}

const run = (ws: { root: string; out: string; tmp: string }) => runJobOutputHook({ outDir: ws.out, cwd: ws.root, tmp: ws.tmp, interpreters: interpretersFromEnv() });

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("JobOutput hook", () => {
  it("passes output with diagram problems and reports them as redacted warnings", async () => {
    const ws = workspace({
      "assessment/demo/ARCHITECTURE.mmd": 'flowchart TB\n    svc_a["A"] --> end\n',
      "assessment/demo/call-graph.mmd": 'flowchart TD\n    svc_a["A"] --> svc_b["B"]\n',
    });
    const outcome = await run(ws);
    expect(outcome).toMatchObject({ ok: true, findings: 0, warnings: { count: 1, first: ["reserved-id at assessment/demo/ARCHITECTURE.mmd:2"] } });
  });

  it("still blocks credentials, whatever the diagrams say", async () => {
    const ws = workspace({ "assessment/demo/ARCHITECTURE.mmd": 'flowchart TB\n    svc_a["password=TEST_ONLY_NOT_A_SECRET_42"]\n' });
    const outcome = await run(ws);
    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toMatch(/credential-shaped values found/);
    expect(outcome.reason).not.toContain("TEST_ONLY_NOT_A_SECRET_42");
  });
});
