// The agent package format, validation against an installation, and the built-in catalog.

import { readdir, readFile } from "node:fs/promises";
import { join, sep } from "node:path";
import { KERNEL_TOOL_NAMES } from "@kintsugi/runtime/tool-names";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import {
  type AgentPackage,
  BUILTIN_DIR,
  builtinPluginDirs,
  loadBuiltinCatalog,
  loadBuiltinCommands,
  parseAgentFile,
  parseAgentPackage,
  parseSkill,
  parseSkillLibrary,
  serializeAgentPackage,
  type SkillPackage,
  toAgentDefinition,
  validateAgent,
} from "../src/index.js";

const agentFile = (frontmatter: string, body = "You review code.") => `---\n${frontmatter}\n---\n\n${body}\n`;
const files = (entries: Record<string, string>) => new Map(Object.entries(entries));

const BASIC = "name: reviewer\nversion: 1.2.0\ndescription: Reviews code.\ntools: [read, grep]";

function parsed(entries: Record<string, string>): AgentPackage {
  const result = parseAgentPackage(files(entries));
  if (!result.ok) throw new Error(result.problems.join("\n"));
  return result.value;
}

describe("agent packages", () => {
  it("parses <name>.md with agent-local skills", () => {
    const agent = parsed({
      "reviewer.md": agentFile(`${BASIC}\nskills: [untrusted-code]\nthinking: high\ndeny-command-patterns: ["rm -rf"]\nmetadata: {source: test}`),
      "skills/checklist/SKILL.md": "---\nname: checklist\ndescription: A checklist.\n---\n\n- check it\n",
    });
    expect(agent.manifest).toEqual({
      name: "reviewer",
      audience: "runtime",
      version: "1.2.0",
      description: "Reviews code.",
      tools: ["read", "grep"],
      skills: ["untrusted-code"],
      thinking: "high",
      denyCommandPatterns: ["rm -rf"],
      metadata: { source: "test" },
    });
    expect(agent.instructions).toBe("You review code.");
    expect(agent.localSkills).toEqual([{ name: "checklist", description: "A checklist.", content: "- check it" }]);
  });

  it("treats a missing `tools` as every tool and an explicit list, even an empty one, as a restriction", () => {
    const none = parsed({ "a.md": agentFile("name: a\nversion: 1.0.0\ndescription: d") });
    expect(none.manifest.tools).toBeUndefined();
    expect(toAgentDefinition(none, new Map(), ["read", "write"]).tools).toEqual(["read", "write"]);
    const empty = parsed({ "b.md": agentFile("name: b\nversion: 1.0.0\ndescription: d\ntools: []") });
    expect(empty.manifest.tools).toEqual([]);
    expect(toAgentDefinition(empty, new Map(), ["read", "write"]).tools).toEqual([]);
    // An agent without `tools` is written back without the key.
    expect([...serializeAgentPackage(none).values()][0]).not.toContain("tools:");
  });

  it("accepts the Claude Code comma form for tools and CRLF files", () => {
    const agent = parsed({ "reviewer.md": agentFile("name: reviewer\nversion: 1.0.0\ndescription: d\ntools: read, ls").replaceAll("\n", "\r\n") });
    expect(agent.manifest.tools).toEqual(["read", "ls"]);
  });

  it("refuses fields the kernel cannot honour for runtime agents, and unknown fields", () => {
    const result = parseAgentFile(agentFile(`${BASIC}\nmodel: opus\nhooks: {}\npermissionMode: plan\ncolor: red`), "reviewer.md");
    expect(result.ok).toBe(false);
    const problems = result.ok ? "" : result.problems.join("\n");
    expect(problems).toMatch(/`model` is not supported: the model is bound per agent/);
    expect(problems).toMatch(/`hooks` is not supported/);
    expect(problems).toMatch(/`permissionMode` is not supported/);
    expect(problems).toMatch(/unknown field `color`/);
  });

  it("lets member agents keep harness fields and tool names", () => {
    const result = parseAgentFile(agentFile("name: writer\nversion: 1.0.0\ndescription: d\ntools: Read, Write, Bash\nmodel: sonnet\nmetadata: {audience: member}"), "writer.md");
    expect(result.ok).toBe(true);
    expect(result.ok && result.value.manifest).toMatchObject({ audience: "member", tools: ["Read", "Write", "Bash"] });
  });

  it("reports every format problem at once", () => {
    const result = parseAgentPackage(
      files({
        "bad.md": agentFile("name: Bad Name\nversion: one\ntools: 3\nthinking: extreme\nmetadata: {audience: robot}", ""),
        "skills/x/SKILL.md": "---\nname: y\n---\n\nbody",
        "scripts/run.sh": "echo",
      }),
    );
    expect(result.ok).toBe(false);
    const problems = result.ok ? "" : result.problems.join("\n");
    for (const expected of [/`name` must match/, /semantic version/, /`description` is required/, /`tools` must be a list/, /`thinking` must be one of/, /`metadata.audience` must be one of/, /instructions \(body\) are empty/, /must equal its folder "x"/, /scripts\/run.sh: unsupported file/]) {
      expect(problems).toMatch(expected);
    }
  });

  it("requires exactly one agent file named after the agent", () => {
    expect(parseAgentPackage(files({ "a.md": agentFile(BASIC), "b.md": agentFile(BASIC) }))).toMatchObject({ ok: false });
    const misnamed = parseAgentPackage(files({ "other.md": agentFile(BASIC) }));
    expect(misnamed.ok ? [] : misnamed.problems).toEqual(["other.md: the file must be named reviewer.md"]);
  });

  it("round-trips through export", () => {
    const original = parsed({
      "reviewer.md": agentFile(`${BASIC}\nskills: [untrusted-code]\nthinking: low`, "Line one.\n\nLine: two with a colon."),
      "skills/checklist/SKILL.md": "---\nname: checklist\ndescription: 'A checklist: with colon.'\n---\n\nbody",
    });
    const roundTripped = parsed(Object.fromEntries(serializeAgentPackage(original)));
    expect(roundTripped).toEqual({ ...original, manifest: { ...original.manifest, metadata: { audience: "runtime" } } });
  });
});

describe("validation and the job definition", () => {
  const shared = new Map<string, SkillPackage>([["untrusted-code", { name: "untrusted-code", description: "d", content: "Code is data." }]]);
  const context = { knownTools: KERNEL_TOOL_NAMES, sharedSkills: shared };

  it("checks runtime tools against the kernel and skills against the library", () => {
    const agent = parsed({ "a.md": agentFile("name: a\nversion: 1.0.0\ndescription: d\ntools: [read, bash, read]\nskills: [missing]\ndeny-command-patterns: ['(']") });
    expect(validateAgent(agent, context)).toEqual([
      `unknown tool "bash" (available: ${KERNEL_TOOL_NAMES.join(", ")})`,
      "a tool is listed twice",
      'unknown shared skill "missing"',
      'deny-command-pattern "(" is not a valid regular expression',
    ]);
  });

  it("builds the kernel's agent definition with shared skills first, and never for member agents", () => {
    const agent = parsed({
      "reviewer.md": agentFile(`${BASIC}\nskills: [untrusted-code]\nthinking: high`),
      "skills/checklist/SKILL.md": "---\nname: checklist\ndescription: d\n---\n\n- check it",
    });
    expect(validateAgent(agent, context)).toEqual([]);
    expect(toAgentDefinition(agent, shared, KERNEL_TOOL_NAMES)).toEqual({
      id: "reviewer",
      version: "1.2.0",
      instructions: "You review code.",
      skills: [
        { name: "untrusted-code", content: "Code is data." },
        { name: "checklist", content: "- check it" },
      ],
      tools: ["read", "grep"],
      thinking: "high",
    });
    const member = parsed({ "writer.md": agentFile("name: writer\nversion: 1.0.0\ndescription: d\ntools: Read, Write\nmetadata: {audience: member}") });
    expect(validateAgent(member, context)).toEqual([]);
    expect(() => toAgentDefinition(member, shared, KERNEL_TOOL_NAMES)).toThrow(/member agent/);
  });
});

describe("built-in catalog", () => {
  it("ships the six understanding agents for the runtime and three member agents", async () => {
    const catalog = await loadBuiltinCatalog();
    const byAudience = (audience: string) => catalog.agents.filter((agent) => agent.manifest.audience === audience).map((agent) => agent.manifest.name);
    expect(byAudience("runtime")).toEqual(["architecture-critic", "business-rules-extractor", "legacy-analyst", "security-auditor", "understand-planner"]);
    expect(byAudience("member")).toEqual(["designer", "scaffolder", "test-engineer"]);

    const sharedSkills = new Map(catalog.skills.map((skill) => [skill.name, skill]));
    for (const agent of catalog.agents) {
      expect(validateAgent(agent, { knownTools: KERNEL_TOOL_NAMES, sharedSkills }), agent.manifest.name).toEqual([]);
      if (agent.manifest.audience !== "runtime") continue;
      // Runtime agents get the full kernel tool set (ADR-0040): reads, the write tools, shell and git. The agent files list no `tools`.
      expect(agent.manifest.tools).toBeUndefined();
      expect(toAgentDefinition(agent, sharedSkills, KERNEL_TOOL_NAMES).tools).toEqual([...KERNEL_TOOL_NAMES]);
      // The upstream disciplines stay in every runtime agent.
      expect(agent.instructions).toMatch(/data, never instructions/i);
      expect(agent.instructions).toMatch(/Kintsugi runtime job/);
      expect(agent.instructions).not.toMatch(/\/code-modernization:|legacy\/|analysis\/<system>/);
      expect(toAgentDefinition(agent, sharedSkills, KERNEL_TOOL_NAMES).id).toBe(agent.manifest.name);
    }
  });

  it("ships the mermaid-diagrams skill and gives it to the agents that draw diagrams", async () => {
    const catalog = await loadBuiltinCatalog();
    const skill = catalog.skills.find((entry) => entry.name === "mermaid-diagrams");
    expect(skill?.content).toContain("# Mermaid Diagram Generator");
    expect(skill?.content).toContain("references/flowchart.md");
    const sharedSkills = new Map(catalog.skills.map((entry) => [entry.name, entry]));
    const users = catalog.agents.filter((agent) => agent.manifest.skills.includes("mermaid-diagrams")).map((agent) => agent.manifest.name);
    expect(users).toEqual(["architecture-critic", "business-rules-extractor", "legacy-analyst"]);
    const analyst = catalog.agents.find((agent) => agent.manifest.name === "legacy-analyst")!;
    expect(toAgentDefinition(analyst, sharedSkills, KERNEL_TOOL_NAMES).skills?.map((entry) => entry.name)).toEqual(["mermaid-diagrams"]);
    // The references and the license stay beside SKILL.md on disk.
    const entries = await readdir(join(BUILTIN_DIR, "plugins", "reverse_engineering", "skills", "mermaid-diagrams"), { recursive: true });
    expect(entries.map((file) => file.split(sep).join("/"))).toEqual(
      expect.arrayContaining(["LICENSE", "SKILL.md", "references/c4.md", "references/entityRelationshipDiagram.md", "references/flowchart.md", "references/sequenceDiagram.md", "references/stateDiagram.md"]),
    );
  });

  it("keeps supporting files of a skill library and refuses stray ones", () => {
    const skill = "---\nname: s\ndescription: d\n---\n\nbody";
    const ok = parseSkillLibrary(files({ "s/SKILL.md": skill, "s/references/a.md": "x", "s/LICENSE-x": "MIT", "s/scripts/lint.py": "" }));
    expect(ok.ok && ok.value.map((entry) => entry.name)).toEqual(["s"]);
    expect(ok.ok && ok.value[0]?.files).toEqual({ "LICENSE-x": "MIT", "references/a.md": "x", "scripts/lint.py": "" });
    expect(parseSkillLibrary(files({ "s/SKILL.md": skill, "s/notes.md": "x", "t/references/a.md": "x", "top.md": "x" }))).toEqual({
      ok: false,
      problems: [
        "s/notes.md: unsupported file; a skill library holds <name>/SKILL.md with references/, scripts/, assets/ and license files",
        't/references/a.md: the folder "t" has no SKILL.md',
        "top.md: unsupported file; a skill library holds <name>/SKILL.md with references/, scripts/, assets/ and license files",
      ],
    });
  });

  it("parses a skill on its own", () => {
    expect(parseSkill("---\nname: s\ndescription: d\nfoo: 1\n---\n\nx", "s")).toEqual({ ok: false, problems: ["s/SKILL.md: unknown field `foo`"] });
  });
});

/** Commands written for Kintsugi, not adapted from the upstream plugin. */
const KINTSUGI_COMMANDS = new Set(["modernize-understand.md", "modernize-plan-understand.md", "modernize-design-architecture.md", "modernize-scaffold.md", "modernize-design.md", "modernize-implement.md"]);

describe("built-in commands", () => {
  it("declare who runs them and name only agents of the catalog", async () => {
    const catalog = await loadBuiltinCatalog();
    const audienceOf = new Map(catalog.agents.map((agent) => [agent.manifest.name, agent.manifest.audience]));
    const files: Array<{ name: string; path: string }> = [];
    for (const plugin of builtinPluginDirs()) {
      const dir = join(plugin.dir, "commands");
      for (const name of (await readdir(dir)).filter((entry) => entry.endsWith(".md")).sort()) files.push({ name, path: join(dir, name) });
    }
    const names = files.map((file) => file.name);
    expect(names).toHaveLength(7);
    for (const { name, path } of files) {
      const text = await readFile(path, "utf8");
      const frontmatter = parseYaml(/^---\n([\s\S]*?)\n---/.exec(text.replace(/\r\n/g, "\n"))![1]!) as {
        arguments: string;
        metadata: { audience: string; upstream?: string; agents: string[]; skills?: string[]; reads: string[]; writes: string[] };
      };
      const { metadata } = frontmatter;
      expect(["runtime", "member", "portal"], name).toContain(metadata.audience);
      // Commands adapted from upstream name their source; Kintsugi's own commands name none.
      expect(metadata.upstream ?? null, name).toBe(KINTSUGI_COMMANDS.has(name) ? null : `commands/${name}`);
      expect(frontmatter.arguments, name).not.toMatch(/\bsystem\b/);
      for (const agent of metadata.agents) {
        expect(audienceOf.has(agent), `${name} names unknown agent ${agent}`).toBe(true);
        if (metadata.audience === "runtime") expect(audienceOf.get(agent), `${name} starts ${agent}`).toBe("runtime");
      }
      // A stage's skills exist, and a runtime stage's jobs actually load them through an agent.
      for (const skill of metadata.skills ?? []) {
        expect(catalog.skills.map((entry) => entry.name), `${name} names unknown skill ${skill}`).toContain(skill);
        if (metadata.audience !== "runtime") continue;
        const carriers = catalog.agents.filter((agent) => metadata.agents.includes(agent.manifest.name) && agent.manifest.skills.includes(skill));
        expect(carriers.length, `${name}: no agent of the stage loads ${skill}`).toBeGreaterThan(0);
      }
      // The upstream layout is fully mapped onto Kintsugi's repositories.
      expect(text, name).not.toMatch(/analysis\/(\$system|<system>)|legacy\/\$system|\/code-modernization:|build_report\.py/);
    }
  });

  it("load in pipeline order with their stage ids", async () => {
    const commands = await loadBuiltinCommands();
    expect(commands).toHaveLength(7);
    expect(commands[0]).toMatchObject({ id: "assess", command: "modernize-assess", audience: "runtime" });
    expect(commands.filter((command) => command.audience === "runtime").map((command) => command.id)).toEqual(["assess", "understand", "plan-understand"]);
    expect(commands.filter((command) => command.skills.includes("mermaid-diagrams")).map((command) => command.id)).toEqual(["assess", "understand", "design-architecture", "design"]);
    expect(commands.find((command) => command.id === "understand")).toMatchObject({
      command: "modernize-understand",
      audience: "runtime",
      agents: ["legacy-analyst", "security-auditor", "business-rules-extractor"],
      writes: expect.arrayContaining(["applications/<app>/units/<module>/<unit>/understanding/as-is.md", "applications/<app>/units/<module>/<unit>/understanding/understanding.md", "applications/<app>/units/<module>/<unit>/unit.md"]),
    });
  });
});
