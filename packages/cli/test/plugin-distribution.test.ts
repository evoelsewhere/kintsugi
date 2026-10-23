import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runCli, type CliDeps } from "../src/cli.js";
import { bundleContentHash } from "../src/commands/plugin-distribution.js";
import { FileProfileStore } from "../src/profile.js";

const folders: string[] = [];
const sha = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

function artifactRoot(root: string, harness: string, profileId: string): string {
  const namespace = `profile-${createHash("sha256").update(profileId, "utf8").digest("hex").slice(0, 16)}`;
  return join(root, "Kintsugi config", "plugins", "connector", namespace, harness);
}

function bundleOf(name: string, version: string, files: Record<string, string>, tamper = false) {
  const entries = Object.entries(files).sort(([a], [b]) => a.localeCompare(b)).map(([path, content]) => ({ path, content, sha256: sha(content) }));
  return {
    schemaVersion: "1", projectId: "shop", name, title: "Project context", version, description: "d",
    contentHash: bundleContentHash(entries),
    files: tamper ? entries.map((entry, index) => index === 0 ? { ...entry, content: `${entry.content} tampered` } : entry) : entries,
  };
}

async function createState(responses: Record<string, unknown>) {
  const root = await mkdtemp(join(tmpdir(), "kintsugi-cli-distribution-"));
  folders.push(root);
  const configPath = join(root, "Kintsugi config", "config.json");
  await mkdir(join(root, "Kintsugi config"), { recursive: true });
  await writeFile(configPath, `${JSON.stringify({ schemaVersion: "1", activeProfile: "work", profiles: { work: { id: "work", baseUrl: "https://kintsugi.example", projectId: "shop" } } }, null, 2)}\n`, "utf8");
  const stdout: string[] = [];
  const stderr: string[] = [];
  const requested: string[] = [];
  const runClientCommand = vi.fn(async () => ({ exitCode: 0, stdout: "", stderr: "" }));
  const deps = {
    profiles: new FileProfileStore(configPath),
    credentials: { get: vi.fn(), set: vi.fn(), delete: vi.fn() },
    fetch: async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      requested.push(`${url.pathname}${url.search}`);
      const data = responses[url.pathname];
      return data === undefined ? Response.json({ success: false, statusCode: 404, error: "Not Found", message: "no" }, { status: 404 }) : Response.json({ success: true, data });
    },
    serveMcp: async () => undefined,
    cwd: root,
    homeDir: root,
    env: { KINTSUGI_CONFIG: configPath },
    isTTY: false,
    promptSecret: async () => "unused",
    readStdin: async () => "TEST-token",
    stdout: { write: (value: string) => { stdout.push(value); } },
    stderr: { write: (value: string) => { stderr.push(value); } },
    sleep: async () => undefined,
    launcher: { launcherPath: process.execPath, cliEntrypointPath: process.execPath, cliVersion: "0.1.0" },
    getClientVersion: async (target: string) => target === "claude" ? "2.1.278" : "0.163.0-alpha.10.2",
    runClientCommand,
  } as unknown as CliDeps;
  return { root, stdout, stderr, requested, runClientCommand, deps };
}

afterEach(async () => {
  await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })));
});

const FILES = {
  "skills/kintsugi-context/SKILL.md": "---\nname: kintsugi-context\ndescription: d\n---\n# Context\n",
  "agents/helper.md": "# helper\n",
};

const exists = (path: string) => stat(path).then(() => true, () => false);

describe("member plugin distribution", () => {
  it("lists what the member may install and what is installed", async () => {
    const state = await createState({ "/api/member/v1/plugins": { schemaVersion: "1", items: [{ name: "context", title: "Project context", version: "1.0.0", description: "d" }], limit: 100 } });
    expect(await runCli(["plugins", "list", "--token-stdin", "--json"], state.deps), state.stderr.join("")).toBe(0);
    expect(JSON.parse(state.stdout.join(""))).toMatchObject({ harness: "claude-code", items: [{ name: "context", installed: null }] });
    expect(state.requested).toEqual(["/api/member/v1/plugins?projectId=shop"]);
  });

  it("downloads a plugin, verifies it, writes it into the Kintsugi package and installs the package", async () => {
    const state = await createState({ "/api/member/v1/plugins/context": bundleOf("context", "1.0.0", FILES) });
    expect(await runCli(["plugins", "install", "context", "--harness", "claude-code", "--token-stdin"], state.deps), state.stderr.join("")).toBe(0);

    const root = artifactRoot(state.root, "claude-code", "work");
    const pluginRoot = join(root, "plugins", "claude", "kintsugi");
    expect(await readFile(join(pluginRoot, "skills", "kintsugi-context", "SKILL.md"), "utf8")).toBe(FILES["skills/kintsugi-context/SKILL.md"]);
    expect(await readFile(join(pluginRoot, "agents", "helper.md"), "utf8")).toBe(FILES["agents/helper.md"]);
    expect(JSON.parse(await readFile(join(pluginRoot, ".mcp.json"), "utf8")).mcpServers.kintsugi).toBeDefined();
    const record = JSON.parse(await readFile(join(root, ".kintsugi-plugins.json"), "utf8"));
    expect(record.plugins.context).toMatchObject({ version: "1.0.0", files: ["skills/kintsugi-context/SKILL.md", "agents/helper.md"].sort() });
    expect(state.runClientCommand.mock.calls.map((call) => (call as unknown[])[1])).toEqual([
      expect.arrayContaining(["marketplace", "add"]),
      expect.arrayContaining(["install"]),
    ]);
    expect(state.stdout.join("")).toContain("Installed context 1.0.0");
  });

  it("writes nothing when a downloaded file does not match its hash", async () => {
    const state = await createState({ "/api/member/v1/plugins/context": bundleOf("context", "1.0.0", FILES, true) });
    expect(await runCli(["plugins", "install", "context", "--harness", "claude-code", "--token-stdin"], state.deps)).toBe(2);
    expect(state.stderr.join("")).toContain("PLUGIN_BUNDLE_CORRUPT");
    expect(await exists(artifactRoot(state.root, "claude-code", "work"))).toBe(false);
    expect(state.runClientCommand).not.toHaveBeenCalled();
  });

  it("deletes the files an update no longer carries, and everything of a removed plugin", async () => {
    const responses: Record<string, unknown> = { "/api/member/v1/plugins/context": bundleOf("context", "1.0.0", FILES) };
    const state = await createState(responses);
    expect(await runCli(["plugins", "install", "context", "--harness", "claude-code", "--token-stdin"], state.deps)).toBe(0);
    const pluginRoot = join(artifactRoot(state.root, "claude-code", "work"), "plugins", "claude", "kintsugi");

    responses["/api/member/v1/plugins/context"] = bundleOf("context", "1.1.0", { "skills/kintsugi-context/SKILL.md": "# v2\n" });
    expect(await runCli(["plugins", "install", "context", "--harness", "claude-code", "--token-stdin"], state.deps)).toBe(0);
    expect(await readFile(join(pluginRoot, "skills", "kintsugi-context", "SKILL.md"), "utf8")).toBe("# v2\n");
    expect(await exists(join(pluginRoot, "agents", "helper.md"))).toBe(false);
    expect(await exists(join(pluginRoot, "agents"))).toBe(false);

    expect(await runCli(["plugins", "remove", "context", "--harness", "claude-code"], state.deps), state.stderr.join("")).toBe(0);
    expect(await exists(join(pluginRoot, "skills"))).toBe(false);
    expect(await exists(join(pluginRoot, ".mcp.json"))).toBe(true);
    expect(JSON.parse(await readFile(join(artifactRoot(state.root, "claude-code", "work"), ".kintsugi-plugins.json"), "utf8")).plugins).toEqual({});
    expect(await runCli(["plugins", "remove", "context", "--harness", "claude-code"], state.deps)).toBe(2);
    expect(state.stderr.join("")).toContain("PLUGIN_NOT_INSTALLED");
  });

  it("gives Codex the skills only", async () => {
    const state = await createState({ "/api/member/v1/plugins/context": bundleOf("context", "1.0.0", FILES) });
    expect(await runCli(["plugins", "install", "context", "--harness", "codex", "--token-stdin", "--json"], state.deps), state.stderr.join("")).toBe(0);
    const pluginRoot = join(artifactRoot(state.root, "codex", "work"), "plugins", "codex", "kintsugi");
    expect(await exists(join(pluginRoot, "skills", "kintsugi-context", "SKILL.md"))).toBe(true);
    expect(await exists(join(pluginRoot, "agents"))).toBe(false);
    expect(JSON.parse(state.stdout.join(""))).toMatchObject({ files: 1, skipped: 1, installed: true });
  });

  it("records activity through the base and sends it once", async () => {
    const state = await createState({ "/api/member/v1/activity": { schemaVersion: "1", id: "act-1" } });
    const calls: Array<{ method: string; body: string }> = [];
    const original = state.deps.fetch;
    state.deps.fetch = async (input, init) => { calls.push({ method: init?.method ?? "GET", body: String(init?.body ?? "") }); return original(input, init); };
    expect(await runCli(["activity", "record", "result", "--plugin", "context", "--summary", "Reviewed", "--detail", "documents=3", "--detail", "ok=true", "--token-stdin", "--json"], state.deps), state.stderr.join("")).toBe(0);
    expect(JSON.parse(state.stdout.join(""))).toMatchObject({ id: "act-1" });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe("POST");
    expect(JSON.parse(calls[0]!.body)).toEqual({ schemaVersion: "1", projectId: "shop", kind: "result", pluginName: "context", summary: "Reviewed", detail: { documents: 3, ok: true } });
  });
});
