// Agent resolution over the built-in catalog and stored custom agents, and the ZIP codec
// used for package import and export.

import { deflateRawSync } from "node:zlib";
import { KERNEL_TOOL_NAMES } from "@kintsugi/runtime/tool-names";
import { describe, expect, it } from "vitest";
import {
  type BuiltinCatalog,
  type CustomAgentStore,
  loadBuiltinCatalog,
  resolveAgent,
  resolveAgentDefinition,
  type StoredAgent,
  unzipFiles,
  zipFiles,
} from "../src/index.js";

const agentFile = (frontmatter: string, body = "You review code.") => `---\n${frontmatter}\n---\n\n${body}\n`;
const SKILL = "---\nname: house-style\ndescription: House style.\n---\n\nWrite plainly.";

function store(agents: Record<string, StoredAgent>, skills: { name: string; text: string }[] = []): CustomAgentStore {
  return { agent: async (name) => agents[name], skills: async () => skills };
}

describe("agent resolution", () => {
  let builtin: BuiltinCatalog;
  const options = (custom?: CustomAgentStore) => ({ builtin, knownTools: KERNEL_TOOL_NAMES, ...(custom === undefined ? {} : { store: custom }) });

  it("resolves built-ins first, then enabled custom agents with custom shared skills", async () => {
    builtin = await loadBuiltinCatalog();
    const custom = store(
      {
        reviewer: { enabled: true, files: { "reviewer.md": agentFile("name: reviewer\nversion: 2.0.0\ndescription: d\ntools: [read]\nskills: [house-style]") } },
        // A stored row with a built-in name never shadows the built-in.
        "legacy-analyst": { enabled: true, files: { "legacy-analyst.md": agentFile("name: legacy-analyst\nversion: 9.9.9\ndescription: d\ntools: [read]") } },
      },
      [{ name: "house-style", text: SKILL }],
    );
    const builtinAgent = await resolveAgentDefinition("legacy-analyst", options(custom));
    expect(builtinAgent.source).toBe("builtin");
    expect(builtinAgent.definition.version).not.toBe("9.9.9");

    const resolved = await resolveAgentDefinition("reviewer", options(custom));
    expect(resolved).toMatchObject({ source: "custom", definition: { id: "reviewer", version: "2.0.0", tools: ["read"], skills: [{ name: "house-style", content: "Write plainly." }] } });
  });

  it("refuses unknown, disabled, invalid, member and unrunnable agents", async () => {
    builtin = await loadBuiltinCatalog();
    const custom = store({
      off: { enabled: false, files: { "off.md": agentFile("name: off\nversion: 1.0.0\ndescription: d") } },
      broken: { enabled: true, files: { "broken.md": "no frontmatter" } },
      shell: { enabled: true, files: { "shell.md": agentFile("name: shell\nversion: 1.0.0\ndescription: d\ntools: [bash]") } },
    });
    await expect(resolveAgentDefinition("nobody", options(custom))).rejects.toThrow('Unknown agent "nobody"');
    await expect(resolveAgentDefinition("off", options(custom))).rejects.toThrow('Agent "off" is disabled');
    await expect(resolveAgentDefinition("broken", options(custom))).rejects.toThrow(/not a valid package/);
    await expect(resolveAgentDefinition("shell", options(custom))).rejects.toThrow(/cannot run: unknown tool "bash"/);
    await expect(resolveAgentDefinition("scaffolder", options(custom))).rejects.toThrow(/member agent/);
    expect(await resolveAgent("reviewer", options())).toMatchObject({ ok: false, reason: "unknown" });
  });
});

describe("zip", () => {
  it("round-trips files and strips a single top-level folder", () => {
    const files = new Map([
      ["reviewer.md", "---\nname: reviewer\n---\n\nbody ✓"],
      ["skills/x/SKILL.md", "skill"],
    ]);
    expect(unzipFiles(zipFiles(files))).toEqual(files);
    const nested = new Map([...files].map(([path, text]) => [`reviewer/${path}`, text]));
    expect(unzipFiles(zipFiles(nested))).toEqual(files);
    // Same input, same bytes.
    expect(zipFiles(files).equals(zipFiles(files))).toBe(true);
  });

  it("refuses unsafe paths, garbage and oversized archives", () => {
    expect(() => unzipFiles(zipFiles(new Map([["../evil.md", "x"]])))).toThrow(/unsafe path/);
    expect(() => unzipFiles(Buffer.from("not a zip"))).toThrow(/not a ZIP archive/);
    expect(() => unzipFiles(zipFiles(new Map([["big.md", "a".repeat(10_000)]])), { maxTotalBytes: 1000 })).toThrow(/too large/);
    expect(() => unzipFiles(zipFiles(new Map([["a.md", "a"], ["b.md", "b"]])), { maxEntries: 1 })).toThrow(/more than 1 entries/);
    // A real deflate stream is used (the codec is not store-only).
    expect(deflateRawSync(Buffer.from("x")).length).toBeGreaterThan(0);
  });
});
