// `kintsugi update [plugin]` and its alias `kintsugi install fetch [plugin]` are one command (review of 484457c6):
// the same output and exit code in every case, both helps name the other, and `--json` is `--format json`.

import { describe, expect, it, vi } from "vitest";
import { runCli } from "../src/cli.js";

function harness(signedIn: boolean) {
  let stdout = "";
  let stderr = "";
  const profiles = {
    value: signedIn
      ? { schemaVersion: "1", activeProfile: "work", profiles: { work: { id: "work", baseUrl: "https://kintsugi.example", projectId: "shop" } } }
      : { schemaVersion: "1", profiles: {} },
    async load() { return structuredClone(this.value); },
    async save(value: unknown) { this.value = structuredClone(value) as typeof this.value; },
  };
  const deps = {
    profiles,
    credentials: { set: vi.fn(async () => undefined), get: vi.fn(async () => undefined), delete: vi.fn(async () => undefined) },
    fetch: vi.fn(async () => Response.json({ success: false, statusCode: 404, error: "Not Found", message: "No such plugin" }, { status: 404 })),
    cwd: process.cwd(), signal: undefined, env: {}, isTTY: false,
    serveMcp: async () => undefined,
    promptSecret: vi.fn(async () => ""),
    readStdin: vi.fn(async () => ""),
    stdout: { write: (value: string) => { stdout += value; } },
    stderr: { write: (value: string) => { stderr += value; } },
    sleep: vi.fn(async () => undefined),
  };
  return { deps, output: () => ({ stdout, stderr }) };
}

async function run(argv: string[], signedIn: boolean): Promise<{ code: number; stdout: string; stderr: string }> {
  const state = harness(signedIn);
  const code = await runCli(argv, state.deps as never);
  return { code, ...state.output() };
}

describe("kintsugi update and install fetch", () => {
  it.each([
    ["not signed in, every plugin", [], false],
    ["not signed in, one plugin", ["modernize"], false],
    ["no client set up", ["modernize"], true],
    ["an invalid plugin name", ["Bad Name!"], true],
  ])("answer the same: %s", async (_case, rest, signedIn) => {
    const update = await run(["update", ...rest], signedIn);
    const fetch = await run(["install", "fetch", ...rest], signedIn);
    expect(fetch).toEqual(update);
    expect(update.code).not.toBe(0);
  });

  it("answer the same as JSON, with --json or --format json", async () => {
    const short = await run(["--json", "update", "modernize"], true);
    expect(await run(["--format", "json", "update", "modernize"], true)).toEqual(short);
    expect(await run(["--json", "install", "fetch", "modernize"], true)).toEqual(short);
    expect(JSON.parse(short.stderr)).toMatchObject({ success: false });
  });

  it("name each other in their help", async () => {
    expect((await run(["update", "--help"], false)).stdout).toContain("alias: kintsugi install fetch");
    expect((await run(["install", "fetch", "--help"], false)).stdout).toContain("Alias of kintsugi update");
  });
});
