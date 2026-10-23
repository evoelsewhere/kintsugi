import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runCli, type CliDeps } from "../src/cli.js";
import { FileProfileStore } from "../src/profile.js";

const folders: string[] = [];

function artifactRoot(root: string, harness: string, profileId: string): string {
  const namespace = `profile-${createHash("sha256").update(profileId, "utf8").digest("hex").slice(0, 16)}`;
  return join(root, "Kintsugi config", "plugins", "coding-agent-workflow", namespace, harness);
}

interface SetupState {
  root: string;
  homeDir: string;
  configPath: string;
  stdout: string[];
  stderr: string[];
  profiles: FileProfileStore;
  getClientVersion: ReturnType<typeof vi.fn>;
  getCredential: ReturnType<typeof vi.fn>;
  setCredential: ReturnType<typeof vi.fn>;
  deleteCredential: ReturnType<typeof vi.fn>;
  runClientCommand: ReturnType<typeof vi.fn>;
  deps: CliDeps;
}

async function createState(options: {
  clientVersion?: string;
  commandResults?: Array<{ exitCode: number; stdout: string; stderr: string }>;
  initialConfig?: string;
} = {}): Promise<SetupState> {
  const root = await mkdtemp(join(tmpdir(), "kintsugi-cli-plugins-"));
  folders.push(root);
  const homeDir = join(root, "user home");
  await mkdir(homeDir, { recursive: true });
  const configPath = join(root, "Kintsugi config", "config.json");
  const unrelatedPath = join(root, "unrelated-client-settings.json");
  await mkdir(join(root, "Kintsugi config"), { recursive: true });
  await writeFile(unrelatedPath, '{"preserve":"yes"}\n', "utf8");
  await writeFile(configPath, options.initialConfig ?? JSON.stringify({
    schemaVersion: "1",
    activeProfile: "work",
    profiles: {
      work: { id: "work", baseUrl: "https://old.example", projectId: "old-project", caFile: "C:/certs/tenant-ca.pem" },
      other: { id: "other", baseUrl: "https://other.example", projectId: "other-project" },
    },
  }, null, 2) + "\n", "utf8");
  const stdout: string[] = [];
  const stderr: string[] = [];
  const getCredential = vi.fn(async () => "TEST-never-read");
  const setCredential = vi.fn(async () => undefined);
  const deleteCredential = vi.fn(async () => undefined);
  const getClientVersion = vi.fn(async () => options.clientVersion ?? "2.1.278");
  const commandResults = [...(options.commandResults ?? [])];
  const runClientCommand = vi.fn(async () => commandResults.shift() ?? { exitCode: 0, stdout: "done", stderr: "" });
  const deps = {
    profiles: new FileProfileStore(configPath),
    credentials: { get: getCredential, set: setCredential, delete: deleteCredential },
    fetch: globalThis.fetch,
    serveMcp: async () => undefined,
    cwd: root,
    homeDir,
    env: { KINTSUGI_CONFIG: configPath },
    isTTY: false,
    promptSecret: async () => "TEST-prompt-must-not-run",
    readStdin: async () => "TEST-stdin-must-not-run",
    stdout: { write: (value: string) => { stdout.push(value); } },
    stderr: { write: (value: string) => { stderr.push(value); } },
    sleep: async () => undefined,
    launcher: { launcherPath: process.execPath, cliEntrypointPath: process.execPath, cliVersion: "0.1.0" },
    getClientVersion,
    runClientCommand,
  } as unknown as CliDeps;
  return { root, homeDir, configPath, stdout, stderr, profiles: deps.profiles as FileProfileStore, getClientVersion, getCredential, setCredential, deleteCredential, runClientCommand, deps };
}

afterEach(async () => {
  await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })));
});

describe("plugins setup command", () => {
  it("prepares Codex Desktop's personal marketplace without invoking Codex CLI", async () => {
    const state = await createState();
    const result = await runCli([
      "plugins", "setup", "--install-mode", "desktop-ui", "--harness", "codex", "--url", "https://kintsugi.example", "--project", "billing",
    ], state.deps);

    expect(result, state.stderr.join("")).toBe(0);
    expect(state.getClientVersion).not.toHaveBeenCalled();
    expect(state.runClientCommand).not.toHaveBeenCalled();
    const catalogPath = join(state.homeDir, ".agents", "plugins", "marketplace.json");
    const catalog = JSON.parse(await readFile(catalogPath, "utf8")) as { name: string; plugins: Array<{ name: string; source: { source: string; path: string }; policy: { installation: string; authentication: string } }> };
    expect(catalog.name).toBe("kintsugi-personal");
    expect(catalog.plugins).toHaveLength(1);
    const pluginName = catalog.plugins[0]!.name;
    expect(pluginName).toMatch(/^kintsugi-coding-agent-workflow-[a-f0-9]{12}$/);
    expect(catalog.plugins[0]!.source).toEqual({ source: "local", path: `./.codex/plugins/${pluginName}` });
    expect(catalog.plugins[0]!.policy).toEqual({ installation: "AVAILABLE", authentication: "ON_INSTALL" });
    const pluginRoot = join(state.homeDir, ".codex", "plugins", pluginName);
    const manifest = JSON.parse(await readFile(join(pluginRoot, "plugin.json"), "utf8")) as { name: string; extensions: { "com.openai": { interface: { displayName: string } } } };
    const mcp = JSON.parse(await readFile(join(pluginRoot, "mcp.json"), "utf8")) as { mcpServers: { kintsugi: { command: string; args: string[] } } };
    expect(manifest.name).toBe(pluginName);
    expect(manifest.extensions["com.openai"].interface.displayName).toBe("Kintsugi Workflow · billing");
    const profiles = await state.profiles.load();
    const profile = Object.values(profiles.profiles).find((item) => item.baseUrl === "https://kintsugi.example" && item.projectId === "billing");
    expect(profile).toBeDefined();
    expect(mcp.mcpServers.kintsugi).toMatchObject({ command: "node", args: [process.execPath, "mcp", "serve", "--profile", profile!.id] });
    expect(state.stdout.join("")).toContain("prepared");
    expect(state.stdout.join("")).toContain("Restart Codex Desktop");
    expect(state.stdout.join("")).toContain("Plugins Directory");
    expect(state.stdout.join("")).not.toContain("installation completed");
    expect(state.getCredential).not.toHaveBeenCalled();
    expect(state.setCredential).not.toHaveBeenCalled();
  });

  it("reports desktop marketplace staging honestly in JSON and rejects other UI harnesses", async () => {
    const state = await createState();
    const result = await runCli([
      "plugins", "setup", "--install-mode", "desktop-ui", "--harness", "codex", "--url", "https://kintsugi.example", "--project", "billing", "--json",
    ], state.deps);
    expect(result, state.stderr.join("")).toBe(0);
    const output = JSON.parse(state.stdout.join("")) as { success: boolean; data: { installed: boolean; staged: boolean; marketplacePath: string } };
    expect(output).toMatchObject({ success: true, data: { installed: false, staged: true } });
    expect(output.data.marketplacePath).toBe(join(state.homeDir, ".agents", "plugins", "marketplace.json"));
    expect(state.runClientCommand).not.toHaveBeenCalled();

    const unsupported = await createState();
    expect(await runCli([
      "plugins", "setup", "--install-mode", "desktop-ui", "--harness", "claude-code", "--url", "https://kintsugi.example", "--project", "billing",
    ], unsupported.deps)).toBe(2);
    expect(unsupported.getClientVersion).not.toHaveBeenCalled();
    expect(unsupported.runClientCommand).not.toHaveBeenCalled();
    expect(unsupported.stderr.join("")).toContain("PLUGIN_INSTALL_MODE_UNSUPPORTED");
  });

  it("does not report a staged plugin as ready when it cannot save its local Kintsugi profile", async () => {
    const state = await createState();
    vi.spyOn(state.profiles, "save").mockRejectedValue(new Error("disk full"));
    const result = await runCli([
      "plugins", "setup", "--install-mode", "desktop-ui", "--harness", "codex", "--url", "https://kintsugi.example", "--project", "billing",
    ], state.deps);
    expect(result).toBe(2);
    expect(state.stderr.join("")).toContain("PLUGIN_PROFILE_SAVE_FAILED");
    expect(state.stderr.join("")).toContain("Do not install the plugin yet");
    expect(state.stderr.join("")).toContain(join(state.homeDir, ".codex", "plugins"));
    expect(state.runClientCommand).not.toHaveBeenCalled();
  });

  it("installs the project plugin without credentials and saves only the nonsecret profile fields", async () => {
    const state = await createState();
    const unrelatedPath = join(state.root, "unrelated-client-settings.json");
    const unrelatedBefore = await readFile(unrelatedPath, "utf8");
    const result = await runCli([
      "plugins", "setup", "--harness", "claude-code", "--url", "https://kintsugi.example/", "--project", "shop & payments", "--profile", "work",
    ], state.deps);

    expect(result, state.stderr.join("")).toBe(0);
    expect(state.stderr.join("")).toBe("");
    expect(state.getClientVersion).toHaveBeenCalledWith("claude");
    const marketplace = JSON.parse(await readFile(join(artifactRoot(state.root, "claude-code", "work"), ".claude-plugin", "marketplace.json"), "utf8")) as { name: string };
    expect(state.runClientCommand.mock.calls).toEqual([
      ["claude", ["plugin", "marketplace", "add", "--scope", "user", artifactRoot(state.root, "claude-code", "work")]],
      ["claude", ["plugin", "install", "--scope", "user", "--yes", `kintsugi-coding-agent-workflow@${marketplace.name}`]],
    ]);
    const saved = await state.profiles.load();
    expect(saved).toMatchObject({
      activeProfile: "work",
      profiles: {
        work: { id: "work", baseUrl: "https://kintsugi.example", projectId: "shop & payments", caFile: "C:/certs/tenant-ca.pem" },
        other: { id: "other", baseUrl: "https://other.example", projectId: "other-project" },
      },
    });
    const pluginRoot = join(artifactRoot(state.root, "claude-code", "work"), "plugins", "claude", "kintsugi-coding-agent-workflow");
    const manifest = JSON.parse(await readFile(join(pluginRoot, ".mcp.json"), "utf8")) as { mcpServers: { kintsugi: { command: string; args: string[] } } };
    expect(manifest.mcpServers.kintsugi.command).toBe(process.execPath);
    expect(manifest.mcpServers.kintsugi.args).toEqual([process.execPath, "mcp", "serve", "--profile", "work"]);
    expect(state.stdout.join("")).toContain("Planned native commands:");
    expect(state.stdout.join("")).toContain("Rollback commands:");
    expect(state.stdout.join("")).toContain("Restart or reload Claude Code");
    expect(await readFile(unrelatedPath, "utf8")).toBe(unrelatedBefore);
    expect(state.getCredential).not.toHaveBeenCalled();
    expect(state.setCredential).not.toHaveBeenCalled();
    expect(state.deleteCredential).not.toHaveBeenCalled();
    expect(state.stdout.join("") + state.stderr.join("")).not.toContain("TEST-never-read");
  });

  it("uses a stable project-specific profile when one is not supplied", async () => {
    const state = await createState({ clientVersion: "0.163.0-alpha.10.2", initialConfig: '{"schemaVersion":"1","profiles":{}}\n' });
    const result = await runCli(["plugins", "setup", "--harness", "codex", "--url", "https://kintsugi.example", "--project", "project/with spaces"], state.deps);
    expect(result, state.stderr.join("")).toBe(0);

    const config = await state.profiles.load();
    const [profileId, profile] = Object.entries(config.profiles)[0] ?? [];
    expect(profileId).toMatch(/^kintsugi-[a-f0-9]{12}$/);
    expect(profile).toMatchObject({ id: profileId, baseUrl: "https://kintsugi.example", projectId: "project/with spaces" });
    const pluginRoot = join(artifactRoot(state.root, "codex", profileId!), "plugins", "codex", "kintsugi-coding-agent-workflow");
    const manifest = JSON.parse(await readFile(join(pluginRoot, "mcp.json"), "utf8")) as { mcpServers: { kintsugi: { command: string; args: string[]; type: string } } };
    expect(manifest.mcpServers.kintsugi).toMatchObject({ type: "stdio", command: "node" });
    expect(manifest.mcpServers.kintsugi.args).toEqual([process.execPath, "mcp", "serve", "--profile", profileId]);
    const marketplace = JSON.parse(await readFile(join(artifactRoot(state.root, "codex", profileId!), ".agents", "plugins", "marketplace.json"), "utf8")) as { name: string };
    expect(state.runClientCommand.mock.calls.map(([executable, args]) => [executable, args])).toEqual([
      ["codex", ["--no-daemon", "plugin", "marketplace", "add", artifactRoot(state.root, "codex", profileId!)]],
      ["codex", ["--no-daemon", "plugin", "add", `kintsugi-coding-agent-workflow@${marketplace.name}`]],
    ]);
    expect(config.activeProfile).toBeUndefined();
  });

  it("prints the planned commands before invoking the native client", async () => {
    const state = await createState();
    const outputAtInvocation: string[] = [];
    state.runClientCommand.mockImplementation(async () => {
      outputAtInvocation.push(state.stdout.join(""));
      return { exitCode: 0, stdout: "", stderr: "" };
    });
    expect(await runCli(["plugins", "setup", "--harness", "claude-code", "--url", "https://kintsugi.example", "--project", "shop", "--profile", "work"], state.deps)).toBe(0);
    expect(outputAtInvocation).toHaveLength(2);
    expect(outputAtInvocation.every((output) => output.includes("Planned native commands:") && output.includes("claude plugin install"))).toBe(true);
  });

  it("reports rollback guidance after a partial native install without running destructive rollback commands", async () => {
    const state = await createState({ commandResults: [
      { exitCode: 0, stdout: "", stderr: "" },
      { exitCode: 1, stdout: "", stderr: "native install failed" },
    ] });
    const result = await runCli(["plugins", "setup", "--harness", "claude-code", "--url", "https://kintsugi.example", "--project", "shop", "--profile", "work"], state.deps);
    expect(result).toBe(2);
    expect(state.runClientCommand).toHaveBeenCalledTimes(2);
    expect(state.stderr.join("")).toContain("PLUGIN_SETUP_COMMAND_FAILED");
    expect(state.stderr.join("")).toContain("Completed 1 of 2");
    expect(state.stderr.join("")).toContain("claude plugin marketplace remove");
    expect(state.stderr.join("")).toContain("generated package directory");
    expect(state.stderr.join("")).not.toContain("native install failed");
  });

  it.each([
    ["invalid URL", "--url", "http://remote.example", "--project", "shop"],
    ["credential-bearing URL", "--url", "https://user:pass@kintsugi.example", "--project", "shop"],
    ["empty project", "--url", "https://kintsugi.example", "--project", ""],
    ["control character project", "--url", "https://kintsugi.example", "--project", "shop\n--profile attacker"],
  ])("rejects %s before writing a package or invoking a client", async (_name, urlFlag, url, projectFlag, project) => {
    const state = await createState();
    const result = await runCli(["plugins", "setup", "--harness", "claude-code", urlFlag, url, projectFlag, project, "--profile", "work"], state.deps);
    expect(result).toBe(2);
    expect(state.runClientCommand).not.toHaveBeenCalled();
    expect(state.stderr.join("")).toMatch(/URL|PROJECT/i);
    await expect(stat(artifactRoot(state.root, "claude-code", "work"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects an unsupported harness before checking or writing client setup", async () => {
    const state = await createState();
    expect(await runCli(["plugins", "setup", "--harness", "copilot-cli", "--url", "https://kintsugi.example", "--project", "shop"], state.deps)).toBe(2);
    expect(state.getClientVersion).not.toHaveBeenCalled();
    expect(state.runClientCommand).not.toHaveBeenCalled();
    expect(state.stderr.join("")).toContain("PLUGIN_HARNESS_INVALID");
  });

  it("does not rewrite unchanged package files when setup is repeated", async () => {
    const state = await createState();
    const args = ["plugins", "setup", "--harness", "claude-code", "--url", "https://kintsugi.example", "--project", "shop", "--profile", "work"];
    expect(await runCli(args, state.deps)).toBe(0);
    const pluginRoot = artifactRoot(state.root, "claude-code", "work");
    const manifestPath = join(pluginRoot, "plugins", "claude", "kintsugi-coding-agent-workflow", ".mcp.json");
    const before = await readFile(manifestPath);
    const mtimeBefore = (await stat(manifestPath)).mtimeMs;
    state.stdout.length = 0;
    expect(await runCli(args, state.deps)).toBe(0);
    expect(await readFile(manifestPath)).toEqual(before);
    expect((await stat(manifestPath)).mtimeMs).toBe(mtimeBefore);
    expect(state.stdout.join("")).toContain("No package files needed changes.");
    expect(state.runClientCommand).toHaveBeenCalledTimes(4);
  });

  it("keeps different project profiles in separate package roots and marketplaces", async () => {
    const state = await createState();
    const resultA = await runCli(["plugins", "setup", "--harness", "claude-code", "--url", "https://kintsugi.example", "--project", "shop", "--profile", "work"], state.deps);
    expect(resultA, state.stderr.join("")).toBe(0);
    const workRoot = artifactRoot(state.root, "claude-code", "work");
    const workManifest = JSON.parse(await readFile(join(workRoot, "plugins", "claude", "kintsugi-coding-agent-workflow", ".mcp.json"), "utf8")) as { mcpServers: { kintsugi: { args: string[] } } };
    const workMarketplace = JSON.parse(await readFile(join(workRoot, ".claude-plugin", "marketplace.json"), "utf8")) as { name: string };

    state.stdout.length = 0;
    const resultB = await runCli(["plugins", "setup", "--harness", "claude-code", "--url", "https://kintsugi.example", "--project", "billing", "--profile", "other"], state.deps);
    expect(resultB, state.stderr.join("")).toBe(0);
    const otherRoot = artifactRoot(state.root, "claude-code", "other");
    const otherManifest = JSON.parse(await readFile(join(otherRoot, "plugins", "claude", "kintsugi-coding-agent-workflow", ".mcp.json"), "utf8")) as { mcpServers: { kintsugi: { args: string[] } } };
    const otherMarketplace = JSON.parse(await readFile(join(otherRoot, ".claude-plugin", "marketplace.json"), "utf8")) as { name: string };

    expect(workRoot).not.toBe(otherRoot);
    expect(workManifest.mcpServers.kintsugi.args).toEqual([process.execPath, "mcp", "serve", "--profile", "work"]);
    expect(otherManifest.mcpServers.kintsugi.args).toEqual([process.execPath, "mcp", "serve", "--profile", "other"]);
    expect(workMarketplace.name).not.toBe(otherMarketplace.name);
    expect(await readFile(join(workRoot, ".kintsugi-managed.json"), "utf8")).toContain('"target": "claude"');
    expect(await readFile(join(otherRoot, ".kintsugi-managed.json"), "utf8")).toContain('"target": "claude"');
  });

  it("keeps the same project ID on separate Kintsugi installations in separate profiles", async () => {
    const state = await createState();
    expect(await runCli(["plugins", "setup", "--harness", "claude-code", "--url", "https://one.example", "--project", "shared-project"], state.deps)).toBe(0);
    expect(await runCli(["plugins", "setup", "--harness", "claude-code", "--url", "https://two.example", "--project", "shared-project"], state.deps)).toBe(0);

    const config = await state.profiles.load();
    const generatedProfiles = Object.values(config.profiles).filter((profile) => profile.id.startsWith("kintsugi-"));
    expect(generatedProfiles).toHaveLength(2);
    expect(generatedProfiles.map((profile) => profile.baseUrl).sort()).toEqual(["https://one.example", "https://two.example"]);
    expect(state.runClientCommand).toHaveBeenCalledTimes(4);
  });

  it("keeps an explicit Windows-reserved profile name out of the generated filesystem path", async () => {
    const state = await createState();
    const result = await runCli(["plugins", "setup", "--harness", "claude-code", "--url", "https://kintsugi.example", "--project", "shop", "--profile", "CON"], state.deps);
    expect(result, state.stderr.join("")).toBe(0);
    const root = artifactRoot(state.root, "claude-code", "CON");
    expect(root.toLowerCase()).not.toContain("\\con\\");
    await expect(stat(join(root, ".kintsugi-managed.json"))).resolves.toBeDefined();
  });
});
