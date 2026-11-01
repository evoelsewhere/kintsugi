// The kernel shell tool (ADR-0040): command execution through runProcess — the job's cleared
// environment, a timeout that kills the process tree, and no state between calls.

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { findBash } from "../src/launcher/bash.js";
import { createKernelShellTool, withAvailableShell } from "../src/kernel/shell.js";
import { createWorkspace } from "./helpers.js";

const workspace = createWorkspace();
const tmp = join(workspace.root, "tmp");
afterAll(() => workspace.remove());

type Result = { content: Array<{ type: string; text?: string }>; isError?: boolean };

async function shell(params: Record<string, unknown>): Promise<string> {
  const tool = createKernelShellTool(workspace.src, tmp);
  try {
    const result = (await (tool.execute as unknown as (id: string, params: unknown) => Promise<Result>)("call", params)) as Result;
    return result.content.map((part) => part.text ?? "").join("");
  } catch (error) {
    return String(error);
  }
}

describe("the bash behind shell (T2-010)", () => {
  it("finds Git for Windows' bash next to git, else a bash on the PATH, else none", () => {
    const files = new Set([String.raw`C:\Program Files\Git\cmd\git.exe`, String.raw`C:\Program Files\Git\bin\bash.exe`]);
    const exists = (path: string): boolean => files.has(path);
    expect(findBash({ Path: String.raw`C:\Windows;C:\Program Files\Git\cmd` }, "win32", exists)).toBe(String.raw`C:\Program Files\Git\bin\bash.exe`);
    expect(findBash({ Path: String.raw`C:\Windows` }, "win32", exists)).toBeUndefined();
    expect(findBash({ PATH: "/usr/local/bin:/usr/bin" }, "linux", (path) => path === "/usr/bin/bash")).toBe("/usr/bin/bash");
    expect(findBash({ PATH: "/usr/local/bin" }, "linux", () => false)).toBeUndefined();
    // Under Node's permission model a folder it may not read throws: that is no bash, not a crash of the job.
    const denied = (): boolean => {
      throw new Error("Access to this API has been restricted. Use --allow-fs-read to manage permissions.");
    };
    expect(findBash({ PATH: "/usr/bin" }, "linux", denied)).toBeUndefined();
  });

  it("is not offered to a job when the host has none, and is when it has one", () => {
    expect(withAvailableShell(["read", "shell", "git"], false)).toEqual(["read", "git"]);
    expect(withAvailableShell(["read", "shell", "git"], true)).toEqual(["read", "shell", "git"]);
  });
});

describe("kernel shell", () => {
  beforeAll(() => {
    mkdirSync(tmp, { recursive: true });
  });

  it("keeps the start of a very long output and says it cut the rest", async () => {
    const text = await shell({ command: "seq 1 100000" });
    expect(text.startsWith("1\n2\n3\n")).toBe(true);
    expect(text).toMatch(/output cut to the first .*lines/);
    expect(text.length).toBeLessThan(60_000);
  });

  it("runs a command and returns its output", async () => {
    expect(await shell({ command: "echo hello" })).toContain("hello");
  });

  it("runs in the workspace root and keeps no state between calls", async () => {
    expect(await shell({ command: "cd / && pwd" })).toContain("/");
    expect((await shell({ command: "pwd" })).trim().endsWith("src")).toBe(true);
  });

  it("runs with the job environment: HOME at the job's scratch", async () => {
    const text = (await shell({ command: 'echo "home=$HOME"' })).trim();
    expect(text.startsWith("home=")).toBe(true);
    expect(text.endsWith("tmp")).toBe(true);
    expect(text).toContain("kintsugi-runtime-test-");
  });

  it("reports a non-zero exit", async () => {
    expect(await shell({ command: "exit 3" })).toContain("[Command exited with code 3]");
  });

  it("times out and kills the command", async () => {
    const text = await shell({ command: "sleep 10", timeout: 1 });
    expect(text).toContain("Command timed out after 1s");
  });
});
