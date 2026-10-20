// The kernel ls tool (ADR-0039): pi's flat listing unchanged, plus a guarded `tree`/`depth` mode.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createKernelLsTool } from "../src/kernel/ls.js";
import { PathGuard } from "../src/kernel/paths.js";
import { createWorkspace } from "./helpers.js";

const workspace = createWorkspace();
afterAll(() => workspace.remove());

type Result = { content: Array<{ type: string; text?: string }>; isError?: boolean };

async function ls(params: Record<string, unknown>): Promise<{ text: string; error: boolean }> {
  const tool = createKernelLsTool(workspace.src, new PathGuard([workspace.src]));
  try {
    const result = (await (tool.execute as unknown as (id: string, params: unknown) => Promise<Result>)("call", params)) as Result;
    return { text: result.content.map((part) => part.text ?? "").join(""), error: result.isError === true };
  } catch (error) {
    return { text: String(error), error: true };
  }
}

describe("kernel ls", () => {
  beforeAll(() => {
    mkdirSync(join(workspace.src, "a", "b"), { recursive: true });
    writeFileSync(join(workspace.src, "a", "d.txt"), "d");
    writeFileSync(join(workspace.src, "a", "b", "c.txt"), "c");
    mkdirSync(join(workspace.src, "node_modules", "dep"), { recursive: true });
    writeFileSync(join(workspace.src, "node_modules", "dep", "index.js"), "skip me");
  });

  it("renders an indented tree and skips noise directories", async () => {
    const { text, error } = await ls({ tree: true, path: workspace.src });
    expect(error).toBe(false);
    expect(text).toContain("a/");
    expect(text).toContain("d.txt");
    expect(text).toContain("b/");
    expect(text).toContain("c.txt");
    expect(text).not.toContain("node_modules");
    const depthTwo = text.split("\n").findIndex((line) => line.includes("b/"));
    expect(depthTwo).toBeGreaterThan(-1);
  });

  it("limits depth; depth alone implies tree", async () => {
    const { text } = await ls({ depth: 1, path: workspace.src });
    expect(text).toContain("a/");
    expect(text).toContain("hello.txt");
    expect(text).not.toContain("d.txt");
    expect(text).not.toContain("c.txt");
  });

  it("delegates the flat listing to pi's ls", async () => {
    const { text, error } = await ls({ path: workspace.src });
    expect(error).toBe(false);
    expect(text).toContain("hello.txt");
  });

  it("refuses paths outside the workspace", async () => {
    const { error } = await ls({ tree: true, path: workspace.outside });
    expect(error).toBe(true);
  });
});
