// Setting a client up again, and an install the client refused (ADR-0072): neither may leave the package saying something false.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runCli } from "../src/cli.js";
import { stableProjectProfileId } from "../src/profile.js";
import { FILES, artifactRoot, bundleOf, createState, temp } from "./support/distribution.js";

const PROFILE = stableProjectProfileId("https://kintsugi.example", "shop");

async function ready(client: "claude" | "copilot") {
  const home = await temp();
  await writeFile(join(home, "install.json"), JSON.stringify({ baseUrl: "https://kintsugi.example" }));
  const state = await createState({ "/api/member/v1/plugins/modernize": bundleOf("modernize", "1.0.0", FILES) }, { signedUp: false, env: { KINTSUGI_HOME: home } });
  await mkdir(join(state.root, ".codex"), { recursive: true });
  (state.deps as { getClientVersion: (target: string) => Promise<string> }).getClientVersion = async (target) => {
    if (target !== client) throw new Error("not installed");
    return client === "copilot" ? "1.0.63" : "2.1.278";
  };
  return state;
}

describe("setting a client up again", () => {
  it("keeps the plugins already installed in the package's marketplace", async () => {
    const state = await ready("copilot");
    expect(await runCli(["init", "shop", "-H", "copilot"], state.deps), state.stderr.join("")).toBe(0);
    expect(await runCli(["install", "plugin", "modernize", "-H", "copilot", "--token-stdin"], state.deps), state.stderr.join("")).toBe(0);
    expect(await runCli(["init", "shop", "-H", "copilot"], state.deps), state.stderr.join("")).toBe(0);
    const marketplace = JSON.parse(await readFile(join(artifactRoot(state.root, "copilot", PROFILE), ".github", "plugin", "marketplace.json"), "utf8")) as { plugins: Array<{ name: string; version: string }> };
    expect(marketplace.plugins.map((plugin) => plugin.name)).toEqual(["kintsugi", "modernize"]);
    expect(marketplace.plugins[1]!.version).toMatch(/^1\.0\.0-[0-9a-f]{8}$/);
  });

  it("refreshes a Copilot marketplace that is registered already, because Copilot refuses to add it twice", async () => {
    const state = await ready("copilot");
    expect(await runCli(["init", "shop", "-H", "copilot"], state.deps)).toBe(0);
    state.runClientCommand.mockClear();
    expect(await runCli(["init", "shop", "-H", "copilot"], state.deps)).toBe(0);
    const steps = state.runClientCommand.mock.calls.map((call) => (call as unknown[])[1] as string[]);
    expect(steps[0]).toEqual(["plugin", "marketplace", "update", expect.stringMatching(/^kintsugi-/)]);
    expect(steps.flat()).not.toContain("add");
  });
});

describe("an install the client refused", () => {
  it("does not leave the plugin recorded as installed, so the next try installs it instead of updating it", async () => {
    const state = await ready("claude");
    expect(await runCli(["init", "shop", "-H", "claude"], state.deps)).toBe(0);
    let calls = 0;
    state.runClientCommand.mockImplementation(async () => ({ exitCode: calls++ === 1 ? 1 : 0, stdout: "", stderr: "" }));
    expect(await runCli(["install", "plugin", "modernize", "-H", "claude", "--token-stdin"], state.deps)).toBe(2);
    expect(state.stderr.join("")).toContain("PLUGIN_SETUP_COMMAND_FAILED");
    const record = JSON.parse(await readFile(join(artifactRoot(state.root, "claude-code", PROFILE), ".kintsugi-plugins.json"), "utf8")) as { plugins: Record<string, unknown> };
    expect(record.plugins).toEqual({});

    state.runClientCommand.mockImplementation(async () => ({ exitCode: 0, stdout: "", stderr: "" }));
    state.runClientCommand.mockClear();
    expect(await runCli(["install", "plugin", "modernize", "-H", "claude", "--token-stdin"], state.deps), state.stderr.join("")).toBe(0);
    const verbs = state.runClientCommand.mock.calls.map((call) => (call as unknown[])[1] as string[]).map((args) => args[1]);
    expect(verbs).toEqual(["marketplace", "install", "install"]);
  });
});
