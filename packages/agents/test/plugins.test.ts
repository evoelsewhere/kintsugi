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
    expect(names("agent")).toEqual(["business-rules-extractor", "legacy-analyst", "security-auditor"]);
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

  it("keeps the parts two plugins share identical, and a plugin that needs another says so", async () => {
    const plugins = await loadBuiltinPlugins();
    expect(plugins.map((plugin) => [plugin.name, plugin.requires])).toEqual([
      ["understand", []],
      ["modernize", ["understand"]],
    ]);
    for (const path of ["scripts/paths.py", "scripts/mermaid_lint.py", "skills/mermaid-diagrams/SKILL.md", "skills/mermaid-diagrams/references/c4.md"]) {
      const [first, second] = await Promise.all(plugins.map((plugin) => readBuiltinPluginFile(plugins, plugin.name, path)));
      expect(first, path).toBeDefined();
      expect(second, path).toBe(first);
    }
  });

  it("reads plugin.json from the plugin folder and reads files only from the plugin", async () => {
    const plugins = await loadBuiltinPlugins();
    expect(JSON.parse((await readBuiltinPluginFile(plugins, "understand", PLUGIN_MANIFEST_FILE))!)).toMatchObject({ name: "understand", version: "1.0.0" });
    expect(JSON.parse((await readBuiltinPluginFile(plugins, "modernize", "kintsugi.json"))!)).toMatchObject({ audience: "member", requires: ["understand"] });
    expect(await readBuiltinPluginFile(plugins, "understand", "commands/modernize-verify.md")).toBeUndefined();
    expect(await readBuiltinPluginFile(plugins, "understand", "../package.json")).toBeUndefined();
    expect(await readBuiltinPluginFile(plugins, "modernize", "commands/modernize-verify.md")).toContain("verify");
  });
});

describe("plugin flows", () => {
  it("orders what a command runs by where its text names it and links commands through their artifacts", async () => {
    const plugins = await loadBuiltinPlugins();
    const understand = plugins.find((plugin) => plugin.name === "understand")!;
    const modernize = plugins.find((plugin) => plugin.name === "modernize")!;
    const flow = (plugin: typeof understand, id: string) => plugin!.flows.find((entry) => entry.command === id)!;

    const assess = flow(understand, "assess");
    expect(assess.steps.map((step) => step.name)).toEqual(expect.arrayContaining(["inventory", "legacy-analyst", "catalog_from_topology"]));
    expect(assess.steps.find((step) => step.name === "inventory")).toMatchObject({ kind: "script" });
    expect(assess.writes).toEqual(expect.arrayContaining(["applications/<app>/assessment/catalog.json"]));

    const understandFlow = flow(understand, "understand");
    const rules = understandFlow.steps.find((step) => step.name === "extract-rules");
    expect(rules).toMatchObject({ kind: "workflow", agents: expect.arrayContaining(["business-rules-extractor", "legacy-analyst"]) });
    expect(understandFlow.steps.find((step) => step.name === "harden-scan")?.agents).toEqual(["security-auditor"]);
    expect(understandFlow.gates.length).toBeGreaterThan(0);

    expect(understand!.pipeline).toEqual([{ from: "assess", to: "understand", via: expect.arrayContaining(["applications/<app>/assessment/catalog.json"]) }]);
    expect(modernize!.pipeline.map((link) => `${link.from}>${link.to}`)).not.toContain("preflight>transform");
    expect(modernize!.flows.map((entry) => entry.command)).toEqual(["preflight", "brief", "transform", "uplift", "reimagine", "verify"]);
  });
});
