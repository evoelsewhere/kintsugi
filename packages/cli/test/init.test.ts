// `kintsugi init`, `kintsugi install plugin|fetch` and the activity hook of a plugin command (ADR-0072).

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runCli } from "../src/cli.js";
import { summarizeTranscript } from "../src/commands/activity-hook.js";
import { parseChoice } from "../src/prompt.js";
import { stableProjectProfileId } from "../src/profile.js";
import { FILES, artifactRoot, bundleOf, createState, exists, temp } from "./support/distribution.js";

const PROFILE = stableProjectProfileId("https://kintsugi.example", "shop");

async function initialised(options: { clients?: string[] } = {}) {
  const home = await temp();
  await writeFile(join(home, "install.json"), JSON.stringify({ baseUrl: "https://kintsugi.example" }));
  const responses: Record<string, unknown> = { "/api/member/v1/plugins/modernize": bundleOf("modernize", "1.0.0", FILES) };
  const state = await createState(responses, { signedUp: false, env: { KINTSUGI_HOME: home } });
  await mkdir(join(state.root, ".codex"), { recursive: true });
  const found = new Set(options.clients ?? ["claude", "codex"]);
  (state.deps as { getClientVersion: (target: string) => Promise<string> }).getClientVersion = async (target) => {
    if (!found.has(target)) throw new Error("not installed");
    return target === "claude" ? "2.1.260" : target === "copilot" ? "1.0.63" : "0.163.0-alpha.10.2";
  };
  return { state, responses };
}

describe("kintsugi init", () => {
  it("sets up every client it finds without asking, for the user, and says which version it has not tested", async () => {
    const { state } = await initialised();
    expect(await runCli(["init", "shop", "--all"], state.deps), state.stderr.join("")).toBe(0);
    expect(state.stdout.join("")).toContain("✓ Claude Code — global");
    expect(state.stdout.join("")).toContain("✓ Codex CLI — global");
    expect(state.stderr.join("")).toContain("has not been tested");
    expect(await exists(artifactRoot(state.root, "claude-code", PROFILE))).toBe(true);
    expect(await exists(artifactRoot(state.root, "codex", PROFILE))).toBe(true);
    const scoped = state.runClientCommand.mock.calls.map((call) => (call as unknown[])[1] as string[]).filter((args) => args.includes("--scope"));
    expect(scoped.length).toBeGreaterThan(0);
    expect(scoped.every((args) => args[args.indexOf("--scope") + 1] === "user")).toBe(true);
    const config = JSON.parse(await readFile(join(state.root, "Kintsugi config", "config.json"), "utf8")) as { activeProfile: string };
    expect(config.activeProfile).toBe(PROFILE);
  });

  it("asks which clients and whether global or this workspace when it can ask", async () => {
    const { state } = await initialised();
    const asked: string[] = [];
    // Already signed in: init must not open a browser here.
    (state.deps.credentials as unknown as { get: () => Promise<string> }).get = async () => "signed-in";
    Object.assign(state.deps, {
      isTTY: true,
      choose: async (input: { message: string }) => {
        asked.push(input.message);
        return input.message.startsWith("Which") ? ["claude"] : ["workspace"];
      },
    });
    expect(await runCli(["init", "shop"], state.deps), state.stderr.join("")).toBe(0);
    expect(asked).toEqual(["Which AI clients should Kintsugi set up?", "Install for all your workspaces, or only for this one?"]);
    expect(await exists(artifactRoot(state.root, "codex", PROFILE))).toBe(false);
    const scope = JSON.parse(await readFile(join(artifactRoot(state.root, "claude-code", PROFILE), ".kintsugi-scope.json"), "utf8")) as { scope: string; workspace: string };
    expect(scope).toEqual({ scope: "local", workspace: state.root });
    expect(state.runClientCommand.mock.calls.map((call) => (call as unknown[])[1] as string[])[0]).toEqual(["plugin", "marketplace", "add", "--scope", "local", artifactRoot(state.root, "claude-code", PROFILE)]);
    expect(state.stdout.join("")).toContain(`workspace ${state.root}`);
  });

  it("shares one profile between login and init, so signing in and setting up meet", async () => {
    const { state } = await initialised({ clients: ["claude"] });
    expect(await runCli(["login", "shop", "--token-stdin"], state.deps), state.stderr.join("")).toBe(0);
    const config = JSON.parse(await readFile(join(state.root, "Kintsugi config", "config.json"), "utf8")) as { activeProfile: string };
    expect(config.activeProfile).toBe(PROFILE);
    expect(await runCli(["init", "--all"], state.deps), state.stderr.join("")).toBe(0);
    expect(await exists(artifactRoot(state.root, "claude-code", PROFILE))).toBe(true);
  });

  it("sets up GitHub Copilot like the others: found, listed, installed with Copilot's own plugin commands, no scope", async () => {
    const { state } = await initialised({ clients: ["copilot"] });
    expect(await runCli(["init", "shop", "--all"], state.deps), state.stderr.join("")).toBe(0);
    expect(state.stdout.join("")).toContain("✓ GitHub Copilot CLI — global");
    const steps = state.runClientCommand.mock.calls.map((call) => (call as unknown[])[1] as string[]);
    expect(steps).toEqual([
      ["plugin", "marketplace", "add", artifactRoot(state.root, "copilot", PROFILE)],
      ["plugin", "install", expect.stringMatching(/^kintsugi@/)],
    ]);
    expect(steps.flat()).not.toContain("--scope");
  });

  it("reports when no supported client is on the machine", async () => {
    const { state } = await initialised({ clients: [] });
    await expect(mkdir(join(state.root, "none"))).resolves.toBeUndefined();
    (state.deps as { homeDir: string }).homeDir = join(state.root, "none");
    expect(await runCli(["init", "shop", "--all"], state.deps)).toBe(2);
    expect(state.stderr.join("")).toContain("No supported AI client");
  });
});

describe("kintsugi install", () => {
  it("installs a plugin into every client that was set up, then updates it and leaves an unchanged one alone", async () => {
    const { state, responses } = await initialised();
    expect(await runCli(["init", "shop", "--all"], state.deps)).toBe(0);
    state.stdout.length = 0;
    state.runClientCommand.mockClear();
    expect(await runCli(["install", "plugin", "modernize", "--all", "--token-stdin"], state.deps), state.stderr.join("")).toBe(0);
    expect(state.stdout.join("")).toContain("Installed modernize 1.0.0 for claude-code");
    expect(state.stdout.join("")).toContain("Installed modernize 1.0.0 for codex");
    expect(await exists(join(artifactRoot(state.root, "claude-code", PROFILE), "plugins", "claude", "modernize", "commands", "build.md"))).toBe(true);
    expect(await exists(join(artifactRoot(state.root, "codex", PROFILE), "plugins", "codex", "modernize", "skills", "build-method", "SKILL.md"))).toBe(true);

    state.stdout.length = 0;
    state.runClientCommand.mockClear();
    expect(await runCli(["update", "modernize", "--token-stdin"], state.deps), state.stderr.join("")).toBe(0);
    expect(state.stdout.join("")).toContain("up to date in Claude Code");
    expect(state.runClientCommand).not.toHaveBeenCalled();

    responses["/api/member/v1/plugins/modernize"] = bundleOf("modernize", "1.1.0", FILES);
    state.stdout.length = 0;
    expect(await runCli(["update", "--token-stdin"], state.deps), state.stderr.join("")).toBe(0);
    expect(state.stdout.join("")).toContain("Updated modernize 1.1.0 for claude-code");
    expect(state.stdout.join("")).toContain("Updated modernize 1.1.0 for codex");
    expect(state.runClientCommand.mock.calls.map((call) => (call as unknown[])[1] as string[]).some((args) => args[1] === "update")).toBe(true);
  });

  it("asks which clients when several are set up and it cannot ask, and refuses a workspace it was not set up for", async () => {
    const { state } = await initialised();
    expect(await runCli(["init", "shop", "--all"], state.deps)).toBe(0);
    expect(await runCli(["install", "plugin", "modernize", "--token-stdin"], state.deps)).toBe(2);
    expect(state.stderr.join("")).toContain("use --all");

    await writeFile(join(artifactRoot(state.root, "claude-code", PROFILE), ".kintsugi-scope.json"), JSON.stringify({ scope: "local", workspace: join(state.root, "elsewhere") }));
    state.stderr.length = 0;
    expect(await runCli(["install", "plugin", "modernize", "-H", "claude", "--token-stdin"], state.deps)).toBe(2);
    expect(state.stderr.join("")).toContain("PLUGIN_WORKSPACE_MISMATCH");
  });
});

describe("the activity hook of a plugin command", () => {
  const assistant = (id: string, usage: Record<string, number>, timestamp: string) => JSON.stringify({ type: "assistant", timestamp, message: { id, role: "assistant", model: "claude-opus-5-5", content: [], usage } });
  const user = (text: string, timestamp: string) => JSON.stringify({ type: "user", timestamp, message: { role: "user", content: text } });

  it("counts a command from its invocation on, once per model message", () => {
    const transcript = [
      user("earlier work", "2026-10-24T10:00:00Z"),
      assistant("m0", { input_tokens: 999, output_tokens: 999 }, "2026-10-24T10:00:05Z"),
      user("<command-name>/modernize:build</command-name> billing/tax shop", "2026-10-24T10:10:00Z"),
      assistant("m1", { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 20 }, "2026-10-24T10:10:30Z"),
      assistant("m1", { input_tokens: 10, output_tokens: 7, cache_read_input_tokens: 100, cache_creation_input_tokens: 20 }, "2026-10-24T10:10:31Z"),
      assistant("m2", { input_tokens: 4, output_tokens: 3 }, "2026-10-24T10:12:00Z"),
      "{ not json",
    ].join("\n");
    expect(summarizeTranscript(transcript, "modernize", "build")).toEqual({
      inputTokens: 14, outputTokens: 10, cacheReadTokens: 100, cacheCreationTokens: 20, turns: 2, durationSeconds: 120, model: "claude-opus-5-5",
    });
    expect(summarizeTranscript("", "modernize", "build")).toMatchObject({ turns: 0, inputTokens: 0 });
  });

  it("records one factual note with numbers and names only, and never fails the session", async () => {
    const state = await createState({ "/api/member/v1/activity": { schemaVersion: "1", id: "act-1" } });
    const transcript = join(state.root, "session.jsonl");
    await writeFile(transcript, [user("/modernize:build billing/tax", "2026-10-24T10:10:00Z"), assistant("m1", { input_tokens: 10, output_tokens: 5 }, "2026-10-24T10:11:00Z")].join("\n"));
    const calls: string[] = [];
    const original = state.deps.fetch;
    state.deps.fetch = async (input, init) => { calls.push(String(init?.body ?? "")); return original(input, init); };
    state.deps.readStdin = async () => JSON.stringify({ session_id: "abc123", transcript_path: transcript });
    expect(await runCli(["activity", "hook", "stop", "--plugin", "modernize", "--command", "build", "--token-stdin"], state.deps), state.stderr.join("")).toBe(0);
    const body = JSON.parse(calls[0]!) as Record<string, unknown>;
    expect(body).toMatchObject({ kind: "command.run", pluginName: "modernize", summary: "modernize:build", projectId: "shop", detail: { inputTokens: 10, outputTokens: 5, turns: 1, durationSeconds: 60, session: "abc123", event: "stop" } });
    expect(JSON.stringify(body)).not.toContain("billing/tax");

    // Not signed in, or nothing to read: silent success.
    const lonely = await createState({}, { signedUp: false });
    lonely.deps.readStdin = async () => "not json";
    expect(await runCli(["activity", "hook", "stop", "--plugin", "modernize", "--command", "build"], lonely.deps)).toBe(0);
  });
});

describe("a numbered choice", () => {
  const options = [{ value: "claude", label: "Claude Code" }, { value: "codex", label: "Codex" }];
  it("reads numbers, names, all and the defaults, and refuses what is not an option", () => {
    expect(parseChoice("", options, true, ["claude"])).toEqual(["claude"]);
    expect(parseChoice("2, 1", options, true, [])).toEqual(["codex", "claude"]);
    expect(parseChoice("all", options, true, [])).toEqual(["claude", "codex"]);
    expect(parseChoice("codex", options, false, [])).toEqual(["codex"]);
    expect(() => parseChoice("3", options, true, [])).toThrow("not one of the options");
    expect(() => parseChoice("1 2", options, false, [])).toThrow("Choose one option");
  });
});
