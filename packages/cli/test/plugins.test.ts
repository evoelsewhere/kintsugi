import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runCli, type CliDeps } from "../src/cli.js";

const folders: string[] = [];
async function createDeps(version = "2.1.278") {
  const root = await mkdtemp(join(tmpdir(), "kintsugi-cli-plugins-"));
  folders.push(root);
  const stdout: string[] = [];
  const stderr: string[] = [];
  const getClientVersion = vi.fn(async () => version);
  const deps = {
    profiles: {
      load: async () => ({
        schemaVersion: "1" as const,
        profiles: { work: { id: "work", baseUrl: "https://kintsugi.example" } },
      }),
    },
    cwd: root,
    env: { KINTSUGI_CONFIG: "config.json" },
    launcher: { launcherPath: process.execPath, cliEntrypointPath: process.execPath, cliVersion: "0.1.0" },
    getClientVersion,
    stdout: { write: (value: string) => { stdout.push(value); } },
    stderr: { write: (value: string) => { stderr.push(value); } },
  } as unknown as CliDeps;
  return { root, stdout, stderr, getClientVersion, deps };
}

afterEach(async () => {
  await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })));
});

describe("plugins setup command", () => {
  it("generates a local Claude package and prints native install and rollback commands", async () => {
    const state = await createDeps();
    const result = await runCli(["plugins", "setup", "--client", "claude", "--profile", "work"], state.deps);
    expect(result).toBe(0);
    expect(state.getClientVersion).toHaveBeenCalledWith("claude");
    const packageRoot = join(state.root, "plugins", "coding-agent-workflow", "claude", "plugins", "claude", "kintsugi-coding-agent-workflow");
    const config = JSON.parse(await readFile(join(packageRoot, ".mcp.json"), "utf8")) as { mcpServers: { kintsugi: { args: string[] } } };
    expect(config.mcpServers.kintsugi.args).toEqual([process.execPath, "mcp", "serve", "--profile", "work"]);
    expect(state.stdout.join("")).toContain("claude plugin marketplace add");
    expect(state.stdout.join("")).toContain("claude plugin uninstall");
    expect(state.stderr.join("")).toBe("");
  });

  it("renders package setup commands as Markdown when requested globally", async () => {
    const state = await createDeps();
    const result = await runCli(["plugins", "setup", "--client", "claude", "--profile", "work", "--format", "markdown"], state.deps);
    expect(result).toBe(0);
    expect(state.stdout.join("")).toContain("# Coding Agent Workflow plugin");
    expect(state.stdout.join("")).toContain("## Install");
    expect(state.stdout.join("")).toContain("claude plugin marketplace add");
    expect(state.stdout.join("")).toContain("## Remove");
  });

  it("rejects an untested native version before writing package files", async () => {
    const state = await createDeps("99.0.0");
    const result = await runCli(["plugins", "setup", "--client", "claude", "--profile", "work"], state.deps);
    expect(result).toBe(2);
    await expect(stat(join(state.root, "plugins", "coding-agent-workflow", "claude"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(state.stderr.join(" ")).toMatch(/untested/i);
  });

  it("does not guess support for a client without a native probe", async () => {
    const state = await createDeps("1.0.0");
    const result = await runCli(["plugins", "setup", "--client", "copilot", "--profile", "work"], state.deps);
    expect(result).toBe(2);
    await expect(stat(resolve(state.root, "plugins", "coding-agent-workflow", "copilot"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(state.stderr.join(" ")).toMatch(/not enabled until an exact client version is tested/i);
  });
});
