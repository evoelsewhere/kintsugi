import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runCli } from "../src/cli.js";
import { FILES, artifactRoot, bundleOf, createState, exists, temp } from "./support/distribution.js";
import { writeFile } from "node:fs/promises";

describe("member plugin distribution", () => {
  it("lists what the member may install and what is installed", async () => {
    const state = await createState({ "/api/member/v1/plugins": { schemaVersion: "1", items: [{ name: "modernize", title: "Project context", version: "1.0.0", description: "d" }], limit: 100 } });
    expect(await runCli(["plugins", "list", "--token-stdin", "--json"], state.deps), state.stderr.join("")).toBe(0);
    expect(JSON.parse(state.stdout.join(""))).toMatchObject({ items: [{ name: "modernize", installed: null }] });
    expect(state.requested).toEqual(["/api/member/v1/plugins?projectId=shop"]);
  });

  it("downloads a plugin, verifies it, writes it into the Kintsugi package and installs the package", async () => {
    const state = await createState({ "/api/member/v1/plugins/modernize": bundleOf("modernize", "1.0.0", FILES) });
    expect(await runCli(["plugins", "install", "modernize", "--harness", "claude-code", "--token-stdin"], state.deps), state.stderr.join("")).toBe(0);

    const root = artifactRoot(state.root, "claude-code", "work");
    // The plugin is a plugin of its own, named after itself (so its command is /modernize:build); the connector holds the bridge.
    const pluginRoot = join(root, "plugins", "claude", "modernize");
    expect(await readFile(join(pluginRoot, "skills", "build-method", "SKILL.md"), "utf8")).toBe(FILES["skills/build-method/SKILL.md"]);
    expect(await readFile(join(pluginRoot, "commands", "build.md"), "utf8")).toBe(FILES["commands/build.md"]);
    expect(await readFile(join(pluginRoot, "agents", "helper.md"), "utf8")).toBe(FILES["agents/helper.md"]);
    expect(JSON.parse(await readFile(join(pluginRoot, ".claude-plugin", "plugin.json"), "utf8"))).toMatchObject({ name: "modernize", version: expect.stringMatching(/^1\.0\.0-[0-9a-f]{8}$/) });
    expect(await exists(join(pluginRoot, ".mcp.json"))).toBe(false);
    expect(JSON.parse(await readFile(join(root, "plugins", "claude", "kintsugi", ".mcp.json"), "utf8")).mcpServers.kintsugi).toBeDefined();
    const record = JSON.parse(await readFile(join(root, ".kintsugi-plugins.json"), "utf8"));
    expect(record.plugins.modernize).toMatchObject({ version: "1.0.0", files: ["agents/helper.md", "commands/build.md", "skills/build-method/SKILL.md"] });
    expect(state.runClientCommand.mock.calls.map((call) => (call as unknown[])[1])).toEqual([
      ["plugin", "marketplace", "add", "--scope", "user", root],
      ["plugin", "install", "--scope", "user", "--yes", expect.stringMatching(/^kintsugi@/)],
      ["plugin", "install", "--scope", "user", "--yes", expect.stringMatching(/^modernize@/)],
    ]);
    expect(state.stdout.join("")).toContain("Installed modernize 1.0.0");
  });

  it("writes nothing when a downloaded file does not match its hash", async () => {
    const state = await createState({ "/api/member/v1/plugins/modernize": bundleOf("modernize", "1.0.0", FILES, true) });
    expect(await runCli(["plugins", "install", "modernize", "--harness", "claude-code", "--token-stdin"], state.deps)).toBe(2);
    expect(state.stderr.join("")).toContain("PLUGIN_BUNDLE_CORRUPT");
    expect(await exists(artifactRoot(state.root, "claude-code", "work"))).toBe(false);
    expect(state.runClientCommand).not.toHaveBeenCalled();
  });

  it("deletes the files an update no longer carries, and everything of a removed plugin", async () => {
    const responses: Record<string, unknown> = { "/api/member/v1/plugins/modernize": bundleOf("modernize", "1.0.0", FILES) };
    const state = await createState(responses);
    expect(await runCli(["plugins", "install", "modernize", "--harness", "claude-code", "--token-stdin"], state.deps)).toBe(0);
    const pluginRoot = join(artifactRoot(state.root, "claude-code", "work"), "plugins", "claude", "modernize");

    responses["/api/member/v1/plugins/modernize"] = bundleOf("modernize", "1.1.0", { "skills/build-method/SKILL.md": "# v2\n" });
    state.runClientCommand.mockClear();
    expect(await runCli(["plugins", "install", "modernize", "--harness", "claude-code", "--token-stdin"], state.deps)).toBe(0);
    // An installed plugin is updated with the client's update command, not installed again.
    expect(state.runClientCommand.mock.calls.map((call) => (call as unknown[])[1] as string[]).map((args) => args.slice(0, 2).join(" "))).toEqual(["plugin marketplace", "plugin marketplace", "plugin install", "plugin update"]);
    expect(await readFile(join(pluginRoot, "skills", "build-method", "SKILL.md"), "utf8")).toBe("# v2\n");
    expect(await exists(join(pluginRoot, "agents", "helper.md"))).toBe(false);
    expect(await exists(join(pluginRoot, "agents"))).toBe(false);

    expect(await runCli(["plugins", "remove", "modernize", "--harness", "claude-code"], state.deps), state.stderr.join("")).toBe(0);
    expect(await exists(pluginRoot)).toBe(false);
    expect(await exists(join(artifactRoot(state.root, "claude-code", "work"), "plugins", "claude", "kintsugi", ".mcp.json"))).toBe(true);
    expect(JSON.parse(await readFile(join(artifactRoot(state.root, "claude-code", "work"), ".kintsugi-plugins.json"), "utf8")).plugins).toEqual({});
    expect(await runCli(["plugins", "remove", "modernize", "--harness", "claude-code"], state.deps)).toBe(2);
    expect(state.stderr.join("")).toContain("PLUGIN_NOT_INSTALLED");
  });

  it("gives Codex skills only: the command becomes a skill, the agent is left out, and the member is told to trust the hook", async () => {
    const state = await createState({ "/api/member/v1/plugins/modernize": bundleOf("modernize", "1.0.0", FILES) });
    (state.deps as { getClientVersion: (target: string) => Promise<string> }).getClientVersion = async () => "0.148.0-alpha.9";
    expect(await runCli(["plugins", "install", "modernize", "--harness", "codex", "--token-stdin", "--json"], state.deps), state.stderr.join("")).toBe(0);
    const pluginRoot = join(artifactRoot(state.root, "codex", "work"), "plugins", "codex", "modernize");
    expect(await exists(join(pluginRoot, "skills", "build-method", "SKILL.md"))).toBe(true);
    expect(await exists(join(pluginRoot, "skills", "build", "SKILL.md"))).toBe(true);
    expect(JSON.parse(await readFile(join(pluginRoot, "hooks", "hooks.json"), "utf8")).hooks.Stop[0].hooks[0].command).toBe("kintsugi activity hook stop --plugin modernize --command build --harness codex");
    expect(await exists(join(pluginRoot, "agents"))).toBe(false);
    expect(await exists(join(pluginRoot, "commands"))).toBe(false);
    expect(JSON.parse(state.stdout.join(""))).toMatchObject({ files: 2, skipped: 1, installed: true });
    // A Codex that does not know --no-daemon (the app's 0.148) is not given it.
    expect(state.runClientCommand.mock.calls.map((call) => (call as unknown[])[1] as string[]).flat()).not.toContain("--no-daemon");
  });

  it("installs into GitHub Copilot with the command as a skill and the generated hook file, and updates it with Copilot's own command", async () => {
    const responses: Record<string, unknown> = { "/api/member/v1/plugins/modernize": bundleOf("modernize", "1.0.0", FILES) };
    const state = await createState(responses);
    (state.deps as { getClientVersion: (target: string) => Promise<string> }).getClientVersion = async () => "1.0.63";
    expect(await runCli(["plugins", "install", "modernize", "--harness", "copilot", "--token-stdin"], state.deps), state.stderr.join("")).toBe(0);
    const pluginRoot = join(artifactRoot(state.root, "copilot", "work"), "plugins", "copilot", "modernize");
    expect(await exists(join(pluginRoot, ".claude-plugin", "plugin.json"))).toBe(true);
    expect(await exists(join(pluginRoot, "skills", "build", "SKILL.md"))).toBe(true);
    expect(await exists(join(pluginRoot, "commands"))).toBe(false);
    expect(JSON.parse(await readFile(join(pluginRoot, "hooks", "hooks.json"), "utf8")).hooks.agentStop[0].bash).toBe("kintsugi activity hook stop --plugin modernize --command build --harness copilot");
    expect(state.stdout.join("")).not.toContain("/hooks");

    responses["/api/member/v1/plugins/modernize"] = bundleOf("modernize", "1.0.1", FILES);
    state.runClientCommand.mockClear();
    expect(await runCli(["install", "fetch", "modernize", "--harness", "copilot", "--token-stdin"], state.deps), state.stderr.join("")).toBe(0);
    expect(state.runClientCommand.mock.calls.map((call) => (call as unknown[])[1] as string[]).some((args) => args[0] === "plugin" && args[1] === "update")).toBe(true);
  });

  it("records activity through the base and sends it once", async () => {
    const state = await createState({ "/api/member/v1/activity": { schemaVersion: "1", id: "act-1" } });
    const calls: Array<{ method: string; body: string }> = [];
    const original = state.deps.fetch;
    state.deps.fetch = async (input, init) => { calls.push({ method: init?.method ?? "GET", body: String(init?.body ?? "") }); return original(input, init); };
    expect(await runCli(["activity", "record", "result", "--plugin", "modernize", "--summary", "Reviewed", "--detail", "documents=3", "--detail", "ok=true", "--token-stdin", "--json"], state.deps), state.stderr.join("")).toBe(0);
    expect(JSON.parse(state.stdout.join(""))).toMatchObject({ id: "act-1" });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe("POST");
    expect(JSON.parse(calls[0]!.body)).toEqual({ schemaVersion: "1", projectId: "shop", kind: "result", pluginName: "modernize", summary: "Reviewed", detail: { documents: 3, ok: true } });
  });
});

describe("short commands", () => {
  it("connects a client to a project with the installation recorded by the installer, then adds a plugin to it", async () => {
    const home = await temp();
    await writeFile(join(home, "install.json"), JSON.stringify({ baseUrl: "https://kintsugi.example" }));
    const state = await createState({ "/api/member/v1/plugins/modernize": bundleOf("modernize", "1.0.0", FILES) }, { signedUp: false, env: { KINTSUGI_HOME: home } });

    expect(await runCli(["connect", "claude", "shop"], state.deps), state.stderr.join("")).toBe(0);
    expect(state.stdout.join("")).toBe("Connected Claude Code to project shop. Restart it to load Kintsugi; the first use opens browser sign-in.\n");
    const config = JSON.parse(await readFile(join(state.root, "Kintsugi config", "config.json"), "utf8")) as { activeProfile: string; profiles: Record<string, { baseUrl: string; projectId: string }> };
    expect(config.profiles[config.activeProfile]).toMatchObject({ baseUrl: "https://kintsugi.example", projectId: "shop" });

    state.stdout.length = 0;
    expect(await runCli(["add", "modernize", "--token-stdin"], state.deps), state.stderr.join("")).toBe(0);
    expect(state.stdout.join("")).toContain("Installed modernize 1.0.0 for claude-code");
    expect(await runCli(["remove", "modernize"], state.deps), state.stderr.join("")).toBe(0);
  });

  it("asks for the installation when it is not known, and for the client when it is not clear", async () => {
    const state = await createState({}, { signedUp: false, env: { KINTSUGI_HOME: join(tmpdir(), "kintsugi-no-install-json") } });
    expect(await runCli(["connect", "claude", "shop"], state.deps)).toBe(2);
    expect(state.stderr.join("")).toContain("URL_REQUIRED");
    expect(await runCli(["connect", "emacs", "shop", "--url", "https://kintsugi.example"], state.deps)).toBe(2);
    expect(state.stderr.join("")).toContain("PLUGIN_HARNESS_INVALID");
    const unconnected = await createState({ "/api/member/v1/plugins/modernize": bundleOf("modernize", "1.0.0", FILES) });
    expect(await runCli(["add", "modernize", "--token-stdin"], unconnected.deps)).toBe(2);
    expect(unconnected.stderr.join("")).toContain("PLUGIN_HARNESS_REQUIRED");
  });
});
