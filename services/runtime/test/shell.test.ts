// The kernel shell tool (ADR-0040): command execution through runProcess — the job's cleared
// environment, a timeout that kills the process tree, and no state between calls.

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createKernelShellTool } from "../src/kernel/shell.js";
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
