import { lstat, mkdtemp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import * as hub from "../src/index.js";
import type { SetupFileDeps } from "../src/index.js";

const temporary: string[] = [];
const launcher = {
  launcherPath: process.execPath,
  cliEntrypointPath: join(tmpdir(), "kintsugi", "dist", "main.js"),
  profileId: "work",
  cliVersion: "0.1.0",
};
const getGenerate = () => (hub as unknown as { generateConnectorPlugin?: (input: typeof launcher & { target: "claude" | "codex" | "copilot" }) => { pluginName: string; files: Record<string, string> } }).generateConnectorPlugin;
const getMarketplace = () => (hub as unknown as { generateConnectorMarketplace?: (target: "claude" | "codex" | "copilot", version: string, profileId?: string) => { path: string; content: string } }).generateConnectorMarketplace;
const getPlan = () => (hub as unknown as { planClientSetup?: (input: typeof launcher & { target: "claude" | "codex" | "copilot"; clientVersion: string; artifactRoot: string }) => Array<{ root: string; relativePath: string; content: string; target: string; pluginName: string; marketplaceName: string }> }).planClientSetup;
type NativeCommand = { executable: "claude" | "codex" | "copilot"; args: string[] };
const getApply = () => (hub as unknown as { applyClientSetup?: (changes: Array<{ root: string; relativePath: string; content: string }>) => Promise<{ artifactRoot: string; pluginRoot: string; marketplaceName: string; unchanged: string[]; written: string[]; installCommands: string[]; rollbackCommands: string[]; installSteps: NativeCommand[]; rollbackSteps: NativeCommand[] }> }).applyClientSetup;
const getDesktopName = () => (hub as unknown as { codexDesktopPluginName?: (profileId: string) => string }).codexDesktopPluginName;
const getDesktopSetup = () => (hub as unknown as { stageCodexDesktopPlugin?: (input: typeof launcher & { homeDir: string }, deps?: SetupFileDeps) => Promise<{ pluginRoot: string; marketplacePath: string; pluginName: string; written: string[]; unchanged: string[]; installCommands: string[]; rollbackCommands: string[] }> }).stageCodexDesktopPlugin;
async function temp(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "kintsugi-plugins-"));
  temporary.push(path);
  return path;
}
afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("connector plugin generation", () => {
  it("exports a generator for Claude, Codex, and Copilot target layouts", () => {
    expect(getGenerate()).toBeTypeOf("function");
    expect(getMarketplace()).toBeTypeOf("function");
  });

  it("ships the connector without a skill and the Kintsugi brand assets to Codex only", async () => {
    const generate = getGenerate();
    if (generate === undefined) { expect(generate).toBeTypeOf("function"); return; }
    const outputs = (["claude", "codex", "copilot"] as const).map((target) => generate({ ...launcher, target }));
    for (const output of outputs) {
      expect(output.pluginName).toBe("kintsugi");
      expect(Object.keys(output.files).some((path) => path.startsWith("skills/"))).toBe(false);
      expect(Object.keys(output.files).some((path) => /hooks|modernize|workflow\.json/i.test(path))).toBe(false);
    }
    const [claude, codex, copilot] = outputs;
    const lightLogo = await readFile(new URL("../../../assets/brand/kintsugi-mark-light.svg", import.meta.url), "utf8");
    const darkLogo = await readFile(new URL("../../../assets/brand/kintsugi-mark-dark.svg", import.meta.url), "utf8");
    expect(codex!.files["assets/kintsugi-mark-light.svg"]).toBe(lightLogo);
    expect(codex!.files["assets/kintsugi-mark-dark.svg"]).toBe(darkLogo);
    expect(Object.keys(claude!.files).some((path) => path.startsWith("assets/"))).toBe(false);
    expect(Object.keys(copilot!.files).some((path) => path.startsWith("assets/"))).toBe(false);
  });

  it("emits native manifests with a client-compatible local launcher and profile", () => {
    const generate = getGenerate();
    if (generate === undefined) { expect(generate).toBeTypeOf("function"); return; }
    const claude = generate({ ...launcher, target: "claude" });
    const codex = generate({ ...launcher, target: "codex" });
    const copilot = generate({ ...launcher, target: "copilot" });
    expect(Object.keys(claude.files)).toContain(".claude-plugin/plugin.json");
    expect(Object.keys(claude.files)).toContain(".mcp.json");
    expect(Object.keys(codex.files)).toContain("plugin.json");
    expect(Object.keys(codex.files)).toContain("mcp.json");
    expect(Object.keys(copilot.files)).toContain("plugin.json");
    expect(Object.keys(copilot.files)).toContain("mcp.json");
    for (const [target, output] of [["claude", claude], ["codex", codex], ["copilot", copilot]] as const) {
      const manifestPath = target === "claude" ? ".claude-plugin/plugin.json" : "plugin.json";
      const mcpPath = target === "claude" ? ".mcp.json" : "mcp.json";
      const manifest = JSON.parse(output.files[manifestPath]!) as { version: string; extensions?: { "com.openai"?: { interface?: { displayName?: string; composerIcon?: string; composerIconDark?: string; logo?: string; logoDark?: string; brandColor?: string; brandColorDark?: string } } } };
      const mcp = JSON.parse(output.files[mcpPath]!) as { mcpServers: { kintsugi: { command: string; args: string[]; type?: string } } };
      expect(manifest.version).toBe("0.1.0");
      if (target === "codex") {
        expect(manifest.extensions?.["com.openai"]?.interface).toMatchObject({
          displayName: "Kintsugi",
          composerIcon: "./assets/kintsugi-mark-light.svg",
          composerIconDark: "./assets/kintsugi-mark-dark.svg",
          logo: "./assets/kintsugi-mark-light.svg",
          logoDark: "./assets/kintsugi-mark-dark.svg",
          brandColor: "#1E2A44",
          brandColorDark: "#F4EFE6",
        });
      }
      expect(mcp.mcpServers.kintsugi).toMatchObject({
        command: target === "codex" ? "node" : process.execPath,
        args: [launcher.cliEntrypointPath, "mcp", "serve", "--profile", "work"],
      });
      if (target !== "claude") expect(mcp.mcpServers.kintsugi.type).toBe("stdio");
      expect(JSON.stringify(output.files)).not.toContain("TEST-SECRET");
      expect(JSON.stringify(output.files)).not.toContain("modernize");
    }
  });

  it("generates each client marketplace layout from the same plugin identity", () => {
    const generateMarketplace = getMarketplace();
    if (generateMarketplace === undefined) { expect(generateMarketplace).toBeTypeOf("function"); return; }
    const claude = generateMarketplace("claude", "0.1.0", "work");
    const codex = generateMarketplace("codex", "0.1.0", "work");
    const copilot = generateMarketplace("copilot", "0.1.0", "work");
    const secondProfile = generateMarketplace("claude", "0.1.0", "other");
    expect(claude.path).toBe(".claude-plugin/marketplace.json");
    expect(codex.path).toBe(".agents/plugins/marketplace.json");
    expect(copilot.path).toBe(".github/plugin/marketplace.json");
    for (const marketplace of [claude, codex, copilot]) {
      const parsed = JSON.parse(marketplace.content) as { name: string; plugins: Array<{ name: string; version?: string; source?: unknown }> };
      expect(parsed.name).toMatch(/^kintsugi-work-[a-f0-9]{12}$/);
      expect(parsed.plugins[0]).toMatchObject({ name: "kintsugi", version: "0.1.0" });
    }
    expect(JSON.parse(secondProfile.content).name).not.toBe(JSON.parse(claude.content).name);
    expect(JSON.parse(claude.content).plugins[0].source).toBe("./plugins/claude/kintsugi");
    expect(JSON.parse(codex.content).plugins[0].source.path).toBe("./plugins/codex/kintsugi");
    expect(JSON.parse(copilot.content).plugins[0].source).toBe("./plugins/copilot/kintsugi");
    expect(() => generateMarketplace("claude", "../outside")).toThrow(/version/i);
  });

  it("rejects an untested client version before creating setup files", async () => {
    const plan = getPlan();
    if (plan === undefined) { expect(plan).toBeTypeOf("function"); return; }
    const root = join(await temp(), "client");
    expect(() => plan({ ...launcher, target: "claude", clientVersion: "99.0.0", artifactRoot: root })).toThrow(/tested|compatible/i);
    const { access } = await import("node:fs/promises");
    await expect(access(root)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("applies the generated package idempotently without changing sibling settings", async () => {
    const plan = getPlan();
    const apply = getApply();
    if (plan === undefined || apply === undefined) { expect([plan, apply].every((value) => typeof value === "function")).toBe(true); return; }
    const parent = await temp();
    const root = join(parent, "claude");
    await mkdir(root, { recursive: true });
    const settings = join(root, "settings.json");
    await writeFile(settings, '{"unrelated":true}\n');
    const changes = plan({ ...launcher, target: "claude", clientVersion: "2.1.278", artifactRoot: root });
    const first = await apply(changes);
    const firstBytes = await Promise.all(first.written.map((path) => readFile(path)));
    const second = await apply(changes);
    const secondBytes = await Promise.all([...first.written, ...second.unchanged].slice(0, firstBytes.length).map((path) => readFile(path)));
    expect(await readFile(settings, "utf8")).toBe('{"unrelated":true}\n');
    expect(second.unchanged.length).toBeGreaterThan(0);
    expect(firstBytes.map((bytes) => bytes.toString("utf8"))).toEqual(secondBytes.map((bytes) => bytes.toString("utf8")));
    expect(first.installCommands.join(" ")).toContain("claude plugin marketplace add");
    expect(first.rollbackCommands.join(" ")).toContain("claude plugin marketplace remove");
    await apply(plan({ ...launcher, cliVersion: "0.1.1", target: "claude", clientVersion: "2.1.278", artifactRoot: root }));
    const updatedManifest = JSON.parse(await readFile(join(first.pluginRoot, ".claude-plugin", "plugin.json"), "utf8")) as { version: string };
    expect(updatedManifest.version).toBe("0.1.1");
    expect(await readFile(settings, "utf8")).toBe('{"unrelated":true}\n');
  });

  it("quotes setup roots with spaces and apostrophes in native commands", async () => {
    const plan = getPlan();
    const apply = getApply();
    if (plan === undefined || apply === undefined) { expect([plan, apply].every((value) => typeof value === "function")).toBe(true); return; }
    const cases = [
      {
        target: "claude",
        clientVersion: "2.1.278",
        marketplaceAdd: "claude plugin marketplace add --scope user ",
        install: "claude plugin install --scope user --yes ",
        rollback: [
          "claude plugin uninstall --scope user kintsugi@kintsugi",
          "claude plugin marketplace remove --scope user kintsugi",
        ],
      },
      {
        target: "codex",
        clientVersion: "0.163.0-alpha.10.2",
        marketplaceAdd: "codex --no-daemon plugin marketplace add ",
        install: "codex --no-daemon plugin add ",
        rollback: ["codex --no-daemon plugin remove kintsugi@kintsugi", "codex --no-daemon plugin marketplace remove kintsugi"],
      },
    ] as const;
    const quotePath = (value: string) => process.platform === "win32"
      ? "'" + value.replace(/'/g, "''") + "'"
      : "'" + value.replace(/'/g, "'\\''") + "'";

    for (const testCase of cases) {
      const root = join(await temp(), "Kintsugi artifacts O'Brien " + testCase.target);
      const report = await apply(plan({
        ...launcher,
        target: testCase.target,
        clientVersion: testCase.clientVersion,
        artifactRoot: root,
      }));

      expect(report.artifactRoot).toContain(" ");
      expect(report.artifactRoot).toContain("'");
      expect(report.installCommands).toEqual([
        testCase.marketplaceAdd + quotePath(report.artifactRoot),
        testCase.install + `kintsugi@${report.marketplaceName}`,
      ]);
      expect(report.rollbackCommands).toEqual([
        testCase.rollback[0]!.replace("kintsugi@kintsugi", `kintsugi@${report.marketplaceName}`),
        testCase.rollback[1]!.replace("kintsugi", report.marketplaceName),
      ]);
      for (const command of report.rollbackCommands) {
        expect(command).not.toContain(report.artifactRoot);
        expect(command).not.toContain("O'Brien");
      }
    }
  });

  it("returns allowlisted native commands as literal argv and renders shell-safe Windows and POSIX previews", async () => {
    const plan = getPlan();
    const apply = getApply();
    const setupModule = await import("../src/plugins/setup.js");
    const format = (setupModule as unknown as { formatNativeCommand?: (command: NativeCommand, platform: NodeJS.Platform) => string }).formatNativeCommand;
    expect([plan, apply, format].every((value) => typeof value === "function")).toBe(true);
    if (plan === undefined || apply === undefined || format === undefined) return;

    const root = join(await temp(), "Kintsugi artifacts O'Brien & $HOME");
    const claude = await apply(plan({ ...launcher, target: "claude", clientVersion: "2.1.278", artifactRoot: root }));
    expect(claude.installSteps).toEqual([
      { executable: "claude", args: ["plugin", "marketplace", "add", "--scope", "user", root] },
      { executable: "claude", args: ["plugin", "install", "--scope", "user", "--yes", `kintsugi@${claude.marketplaceName}`] },
    ]);
    expect(claude.rollbackSteps).toEqual([
      { executable: "claude", args: ["plugin", "uninstall", "--scope", "user", `kintsugi@${claude.marketplaceName}`] },
      { executable: "claude", args: ["plugin", "marketplace", "remove", "--scope", "user", claude.marketplaceName] },
    ]);
    expect(format(claude.installSteps[0]!, "win32")).toContain(`'${root.replace(/'/g, "''")}'`);
    expect(format(claude.installSteps[0]!, "linux")).toContain(`'${root.replace(/'/g, "'\\''")}'`);

    const codex = await apply(plan({ ...launcher, target: "codex", clientVersion: "0.163.0-alpha.10.2", artifactRoot: root + " codex" }));
    expect(codex.installSteps).toEqual([
      { executable: "codex", args: ["--no-daemon", "plugin", "marketplace", "add", root + " codex"] },
      { executable: "codex", args: ["--no-daemon", "plugin", "add", `kintsugi@${codex.marketplaceName}`] },
    ]);
    expect(codex.rollbackSteps).toEqual([
      { executable: "codex", args: ["--no-daemon", "plugin", "remove", `kintsugi@${codex.marketplaceName}`] },
      { executable: "codex", args: ["--no-daemon", "plugin", "marketplace", "remove", codex.marketplaceName] },
    ]);
  });
  it("refuses to replace an unowned native marketplace file", async () => {
    const plan = getPlan();
    const apply = getApply();
    if (plan === undefined || apply === undefined) { expect([plan, apply].every((value) => typeof value === "function")).toBe(true); return; }
    const root = join(await temp(), "claude");
    const marketplace = join(root, ".claude-plugin", "marketplace.json");
    await mkdir(join(root, ".claude-plugin"), { recursive: true });
    await writeFile(marketplace, '{"owner":"developer"}\n');
    const changes = plan({ ...launcher, target: "claude", clientVersion: "2.1.278", artifactRoot: root });
    await expect(apply(changes)).rejects.toMatchObject({ code: "SETUP_UNOWNED_FILE_EXISTS" });
    expect(await readFile(marketplace, "utf8")).toBe('{"owner":"developer"}\n');
    await expect(readFile(join(root, ".kintsugi-managed.json"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("stages a profile-specific Codex Desktop plugin and merges the personal marketplace idempotently", async () => {
    const name = getDesktopName();
    const stage = getDesktopSetup();
    expect([name, stage].every((value) => typeof value === "function")).toBe(true);
    if (name === undefined || stage === undefined) return;
    expect(name("work")).toMatch(/^kintsugi-[a-f0-9]{12}$/);
    expect(name("work")).not.toBe(name("other"));

    const homeDir = await temp();
    const catalogPath = join(homeDir, ".agents", "plugins", "marketplace.json");
    await mkdir(join(homeDir, ".agents", "plugins"), { recursive: true });
    await writeFile(catalogPath, JSON.stringify({
      name: "developer-marketplace",
      interface: { displayName: "Developer local plugins", customLabel: true },
      custom: { preserve: true },
      plugins: [{ name: "existing-plugin", source: { source: "local", path: "./existing" } }],
    }, null, 2) + "\n");

    const first = await stage({ ...launcher, homeDir });
    const catalogAfterFirst = JSON.parse(await readFile(catalogPath, "utf8")) as { name: string; interface: { displayName?: string; customLabel?: boolean }; custom: { preserve: boolean }; plugins: Array<{ name: string; source: { path: string }; policy: { installation: string; authentication: string } }> };
    expect(first.pluginRoot).toBe(join(homeDir, ".codex", "plugins", name("work")));
    expect(catalogAfterFirst.name).toBe("developer-marketplace");
    expect(catalogAfterFirst.custom).toEqual({ preserve: true });
    expect(catalogAfterFirst.interface).toEqual({ displayName: "Developer local plugins", customLabel: true });
    expect(catalogAfterFirst.plugins).toHaveLength(2);
    expect(catalogAfterFirst.plugins[1]).toMatchObject({ name: name("work"), source: { path: `./.codex/plugins/${name("work")}` } });
    expect(catalogAfterFirst.plugins[1]!.policy).toEqual({ installation: "AVAILABLE", authentication: "ON_INSTALL" });
    expect(resolve(homeDir, catalogAfterFirst.plugins[1]!.source.path)).toBe(first.pluginRoot);
    const manifest = JSON.parse(await readFile(join(first.pluginRoot, "plugin.json"), "utf8")) as { name: string; extensions: { "com.openai": { interface: { displayName: string } } } };
    const mcp = JSON.parse(await readFile(join(first.pluginRoot, "mcp.json"), "utf8")) as { mcpServers: { kintsugi: { command: string; args: string[] } } };
    expect(manifest.name).toBe(name("work"));
    expect(manifest.extensions["com.openai"].interface.displayName).toBe("Kintsugi");
    expect(await readFile(join(first.pluginRoot, "assets", "kintsugi-mark-light.svg"), "utf8")).toBe(await readFile(new URL("../../../assets/brand/kintsugi-mark-light.svg", import.meta.url), "utf8"));
    expect(await readFile(join(first.pluginRoot, "assets", "kintsugi-mark-dark.svg"), "utf8")).toBe(await readFile(new URL("../../../assets/brand/kintsugi-mark-dark.svg", import.meta.url), "utf8"));
    expect(mcp.mcpServers.kintsugi.args).toEqual([launcher.cliEntrypointPath, "mcp", "serve", "--profile", "work"]);
    expect(JSON.stringify([manifest, mcp])).not.toMatch(/TEST-SECRET|knt_(?:caw|crt)_/);

    const firstCatalogBytes = await readFile(catalogPath, "utf8");
    const second = await stage({ ...launcher, homeDir });
    expect(second.unchanged.length).toBeGreaterThan(0);
    expect(await readFile(catalogPath, "utf8")).toBe(firstCatalogBytes);
    expect(JSON.parse(await readFile(catalogPath, "utf8")).plugins).toHaveLength(2);

    await stage({ ...launcher, cliVersion: "0.1.1", homeDir });
    const updated = JSON.parse(await readFile(catalogPath, "utf8")) as { plugins: Array<{ name: string; version?: string }> };
    expect(updated.plugins[1]).toMatchObject({ name: name("work"), version: "0.1.1" });
  });

  it("rejects a symlinked personal plugin directory before writing there", async () => {
    const name = getDesktopName();
    const stage = getDesktopSetup();
    expect([name, stage].every((value) => typeof value === "function")).toBe(true);
    if (name === undefined || stage === undefined) return;
    const homeDir = await temp();
    const realPluginRoot = join(homeDir, ".codex", "plugins");
    const deps = {
      mkdir: (path: string, options: { recursive: true }) => mkdir(path, options),
      lstat: async (path: string) => path === realPluginRoot
        ? { isSymbolicLink: () => true, isFile: () => false, isDirectory: () => false }
        : lstat(path),
      readFile: (path: string) => readFile(path),
      writeFile: async (path: string, data: string, options: { flag: "wx"; mode: number }) => { await writeFile(path, data, options); },
      rename,
      rm: (path: string, options: { force: true }) => rm(path, options),
    };
    await expect(stage({ ...launcher, homeDir }, deps)).rejects.toMatchObject({ code: "SETUP_PATH_UNSAFE" });
    await expect(readFile(join(homeDir, ".agents", "plugins", "marketplace.json"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(join(homeDir, ".codex", "plugins", name("work"), "plugin.json"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects malformed and conflicting Codex personal marketplace catalogs before staging files", async () => {
    const name = getDesktopName();
    const stage = getDesktopSetup();
    expect([name, stage].every((value) => typeof value === "function")).toBe(true);
    if (name === undefined || stage === undefined) return;
    const malformedHome = await temp();
    const catalogPath = join(malformedHome, ".agents", "plugins", "marketplace.json");
    await mkdir(join(malformedHome, ".agents", "plugins"), { recursive: true });
    await writeFile(catalogPath, "not-json\n");
    await expect(stage({ ...launcher, homeDir: malformedHome })).rejects.toMatchObject({ code: "CODEX_MARKETPLACE_INVALID" });
    await expect(readFile(join(malformedHome, ".codex", "plugins", name("work"), "plugin.json"))).rejects.toMatchObject({ code: "ENOENT" });

    const invalidShapeHome = await temp();
    const invalidShapeCatalog = join(invalidShapeHome, ".agents", "plugins", "marketplace.json");
    await mkdir(join(invalidShapeHome, ".agents", "plugins"), { recursive: true });
    await writeFile(invalidShapeCatalog, JSON.stringify({ name: "broken", plugins: [null] }));
    await expect(stage({ ...launcher, homeDir: invalidShapeHome })).rejects.toMatchObject({ code: "CODEX_MARKETPLACE_INVALID" });

    const conflictHome = await temp();
    const conflictCatalog = join(conflictHome, ".agents", "plugins", "marketplace.json");
    await mkdir(join(conflictHome, ".agents", "plugins"), { recursive: true });
    await writeFile(conflictCatalog, JSON.stringify({ name: "developer-marketplace", plugins: [{ name: name("work"), source: { source: "local", path: "./someone-elses-plugin" } }] }));
    await expect(stage({ ...launcher, homeDir: conflictHome })).rejects.toMatchObject({ code: "CODEX_MARKETPLACE_CONFLICT" });
    await expect(readFile(join(conflictHome, ".codex", "plugins", name("work"), "plugin.json"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});
