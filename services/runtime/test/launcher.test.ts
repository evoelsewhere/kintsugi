// Launcher side of the job workspace (ADR-0029): read-only marking, script steps with a
// cleared environment, limits and process-tree kill. Runs on every OS with the local Python
// (KINTSUGI_PYTHON, else python3 / python on Windows) and this Node.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { interpretersFromEnv, jobEnvironment, lastLine, makeReadOnly, redactText, removeTree, runScript, treeSize, type ScriptSpec } from "../src/launcher/index.js";

const root = mkdtempSync(join(tmpdir(), "kintsugi-launcher-test-"));
afterAll(() => removeTree(root));

const interpreters = interpretersFromEnv();

function workspace(name: string): { dir: string; src: string; in: string; out: string; tmp: string; scripts: string } {
  const dir = join(root, name);
  const paths = { dir, src: join(dir, "src"), in: join(dir, "in"), out: join(dir, "out"), tmp: join(dir, "tmp"), scripts: join(root, `${name}-scripts`) };
  for (const path of [paths.src, paths.in, paths.out, paths.tmp, paths.scripts]) mkdirSync(path, { recursive: true });
  writeFileSync(join(paths.src, "main.c"), "int main() { if (1) return 0; }\n");
  return paths;
}

function spec(ws: ReturnType<typeof workspace>, file: string, args: string[], limits = { timeoutSec: 30, maxOutputBytes: 1024 * 1024 }): ScriptSpec {
  return { file, args, workspace: { cwd: ws.dir, readOnly: [ws.src, ws.in], writable: [ws.out, ws.tmp], tmp: ws.tmp, out: ws.out }, limits, interpreters };
}

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

describe("job environment", () => {
  it("passes no worker variable but PATH and points HOME and TEMP into scratch", () => {
    const env = jobEnvironment("/jobs/1/tmp", { PATH: "/usr/bin", DATABASE_URL: "postgres://u:p@h/db", KINTSUGI_SECRET_KEY: "k", ANTHROPIC_API_KEY: "sk" });
    expect(env).toMatchObject({ PATH: "/usr/bin", HOME: "/jobs/1/tmp", TMPDIR: "/jobs/1/tmp", TEMP: "/jobs/1/tmp" });
    expect(Object.keys(env)).not.toContain("DATABASE_URL");
    expect(Object.keys(env)).not.toContain("KINTSUGI_SECRET_KEY");
    expect(Object.keys(env)).not.toContain("ANTHROPIC_API_KEY");
  });

  it("redacts credential-shaped text in failure reasons", () => {
    expect(redactText("password = hunter2hunter2")).toBe("[redacted]");
    expect(redactText("postgres://alice:s3cret@db/app")).toBe("[redacted]db/app");
    expect(redactText("token ghp_0123456789abcdefghijABCDEFGHIJ0123")).toContain("[redacted]");
    expect(lastLine("line one\ninventory.py: cannot read source file x\n\n")).toBe("inventory.py: cannot read source file x");
  });
});

describe("read-only marking", () => {
  it.skipIf(process.platform !== "win32" && process.getuid?.() === 0)("makes files read-only and removeTree still removes them", async () => {
    const dir = join(root, "ro");
    mkdirSync(join(dir, "nested"), { recursive: true });
    writeFileSync(join(dir, "nested", "a.txt"), "a");
    await makeReadOnly(dir);
    await expect(writeFile(join(dir, "nested", "a.txt"), "changed")).rejects.toThrow();
    expect(await treeSize(dir)).toEqual({ files: 1, bytes: 1 });
    await removeTree(dir);
    expect(existsSync(dir)).toBe(false);
  });
});

describe("script steps", () => {
  it("runs a Python script with explicit paths and a cleared environment, and records its hash", async () => {
    const ws = workspace("py");
    const script = join(ws.scripts, "probe.py");
    writeFileSync(
      script,
      [
        "import json, os, sys",
        "src, out = sys.argv[1], sys.argv[2]",
        "names = sorted(os.listdir(src))",
        "with open(os.path.join(out, 'probe.json'), 'w', encoding='utf-8') as f:",
        "    json.dump({'files': names, 'env': sorted(os.environ), 'cwd': os.getcwd()}, f)",
        "print('ok')",
      ].join("\n"),
    );
    process.env["KINTSUGI_TEST_SECRET"] = "must-not-leak";
    try {
      const result = await runScript(spec(ws, script, [ws.src, ws.out]));
      expect(result.failure).toBeUndefined();
      expect(result.exitCode).toBe(0);
      expect(result.sha256).toMatch(/^[0-9a-f]{64}$/);
      const probe = JSON.parse(readFileSync(join(ws.out, "probe.json"), "utf8")) as { files: string[]; env: string[] };
      expect(probe.files).toEqual(["main.c"]);
      expect(probe.env).not.toContain("KINTSUGI_TEST_SECRET");
      expect(probe.env).not.toContain("DATABASE_URL");
    } finally {
      delete process.env["KINTSUGI_TEST_SECRET"];
    }
  });

  it("runs the built-in inventory script against a fixture checkout", async () => {
    const ws = workspace("inventory");
    const script = join(import.meta.dirname, "../../../packages/agents/builtin/scripts/inventory.py");
    const result = await runScript(spec(ws, script, ["demo", "--source", ws.src, "--out", join(ws.out, "assessment", "demo")]));
    expect(result.failure).toBeUndefined();
    const inventory = JSON.parse(readFileSync(join(ws.out, "assessment", "demo", "inventory.json"), "utf8")) as { sourceFileCount: number };
    expect(inventory.sourceFileCount).toBe(1);
  });

  it("reports a failing script with its exit code and a redacted last stderr line", async () => {
    const ws = workspace("fail");
    const script = join(ws.scripts, "fail.py");
    writeFileSync(script, "import sys\nsys.stderr.write('boom password=hunter2hunter2\\n')\nsys.exit(3)\n");
    const result = await runScript(spec(ws, script, []));
    expect(result.failure).toBe("exited with code 3: boom [redacted]");
  });

  it("kills the whole process tree on timeout", async () => {
    const ws = workspace("timeout");
    const script = join(ws.scripts, "spawn.py");
    const pidFile = join(ws.out, "child.pid");
    writeFileSync(
      script,
      [
        "import subprocess, sys, time",
        "child = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)'])",
        `open(${JSON.stringify(pidFile)}, 'w').write(str(child.pid))`,
        "time.sleep(60)",
      ].join("\n"),
    );
    const result = await runScript(spec(ws, script, [], { timeoutSec: 2, maxOutputBytes: 1024 * 1024 }));
    expect(result.stopped).toBe("timeout");
    expect(result.failure).toBe("timed out after 2s");
    expect(result.durationMs).toBeLessThan(20_000);
    const child = Number(readFileSync(pidFile, "utf8"));
    for (let i = 0; i < 50 && alive(child); i++) await new Promise((resolve) => setTimeout(resolve, 100));
    expect(alive(child)).toBe(false);
  });

  it("stops a script that writes more than the output limit", async () => {
    const ws = workspace("big");
    const script = join(ws.scripts, "big.py");
    writeFileSync(script, "import sys, os\nopen(os.path.join(sys.argv[1], 'big.bin'), 'wb').write(b'x' * 300000)\n");
    const result = await runScript(spec(ws, script, [ws.out], { timeoutSec: 30, maxOutputBytes: 100_000 }));
    expect(result.stopped).toBe("output-limit");
    expect(result.failure).toBe("output exceeded 100000 bytes");
  });

  it("confines a Node script to the workspace with Node's permission model", async () => {
    const ws = workspace("node");
    const outside = join(root, "outside.txt");
    writeFileSync(outside, "secret");
    const script = join(ws.scripts, "probe.mjs");
    writeFileSync(
      script,
      [
        "import { readFileSync, writeFileSync } from 'node:fs';",
        "const [src, out, outside] = process.argv.slice(2);",
        "writeFileSync(out + '/main.copy', readFileSync(src + '/main.c'));",
        "let blocked = false;",
        "try { readFileSync(outside); } catch { blocked = true; }",
        "writeFileSync(out + '/blocked.txt', String(blocked));",
      ].join("\n"),
    );
    const result = await runScript(spec(ws, script, [ws.src, ws.out, outside]));
    expect(result.failure).toBeUndefined();
    expect(readFileSync(join(ws.out, "main.copy"), "utf8")).toContain("int main");
    expect(readFileSync(join(ws.out, "blocked.txt"), "utf8")).toBe("true");
  });

  it("refuses unsupported script types", async () => {
    const ws = workspace("type");
    const script = join(ws.scripts, "run.sh");
    writeFileSync(script, "echo hi");
    await expect(runScript(spec(ws, script, []))).rejects.toThrow(/unsupported script type/);
  });
});
