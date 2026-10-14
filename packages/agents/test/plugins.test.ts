// The built-in plugins: every member the manifest names exists, plugins can stand alone and the
// generated plugin.json follows the Claude plugin format.

import { describe, expect, it } from "vitest";
import { loadBuiltinPlugins, PLUGIN_MANIFEST_FILE, readBuiltinPluginFile } from "../src/index.js";

describe("built-in plugins", () => {
  it("splits the modernization content into understand and modernize", async () => {
    const plugins = await loadBuiltinPlugins();
    expect(plugins.map((plugin) => [plugin.name, plugin.audience])).toEqual([
      ["understand", "runtime"],
      ["modernize", "member"],
    ]);
    const understand = plugins[0]!;
    const names = (kind: string): string[] => understand.components.filter((component) => component.kind === kind).map((component) => component.name);
    expect(names("agent")).toEqual(["legacy-analyst", "business-rules-extractor", "security-auditor"]);
    expect(names("command")).toEqual(["assess", "understand"]);
    expect(names("workflow")).toContain("harden-scan");
    expect(understand.components.find((component) => component.name === "extract-rules")?.description).not.toBe("");
    expect(understand.files.map((file) => file.path)).toEqual(
      expect.arrayContaining([PLUGIN_MANIFEST_FILE, "skills/mermaid-diagrams/references/c4.md", "hooks/job_output.py", "scripts/inventory.py"]),
    );
    expect(plugins[1]!.components.filter((component) => component.kind === "command").map((component) => component.name)).toEqual([
      "preflight",
      "brief",
      "transform",
      "uplift",
      "reimagine",
      "verify",
    ]);
  });

  it("covers every agent, command and workflow exactly once", async () => {
    const plugins = await loadBuiltinPlugins();
    for (const [kind, count] of [["agent", 8], ["command", 8], ["workflow", 6]] as const) {
      const all = plugins.flatMap((plugin) => plugin.components.filter((component) => component.kind === kind).map((component) => component.path));
      expect(all.length, kind).toBe(count);
      expect(new Set(all).size, kind).toBe(count);
    }
  });

  it("generates plugin.json and reads files only from the plugin", async () => {
    const plugins = await loadBuiltinPlugins();
    expect(JSON.parse((await readBuiltinPluginFile(plugins, "understand", PLUGIN_MANIFEST_FILE))!)).toMatchObject({ name: "understand", version: "1.0.0" });
    expect(await readBuiltinPluginFile(plugins, "understand", "commands/modernize-verify.md")).toBeUndefined();
    expect(await readBuiltinPluginFile(plugins, "understand", "../package.json")).toBeUndefined();
    expect(await readBuiltinPluginFile(plugins, "modernize", "commands/modernize-verify.md")).toContain("verify");
  });
});
