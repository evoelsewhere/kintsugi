// Agent package format (ADR-0026, ADR-0027). An agent is a Claude Code style agent file
// plus optional agent-local skills:
//
//   <name>.md                   frontmatter + body (the instructions, i.e. the system prompt)
//   skills/<name>/SKILL.md      optional agent-local skills (Agent Skills specification)
//
// `metadata.audience` says who runs it: `runtime` agents run in the Kintsugi kernel (tools
// are kernel tools; fields the locked-down kernel cannot honour, such as hooks, MCP
// servers, permission modes or a model, are refused); `member` agents run in members'
// harnesses (tools are harness tool names) and are never run by the kernel.
// Shared skills live in a skill library and are referenced by name from `skills:`.
// Parsing never touches the filesystem: packages arrive as a map of relative POSIX paths
// to file contents.

import { THINKING_LEVELS, type ThinkingLevel } from "@kintsugi/domain";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

/** Relative POSIX path → file content (UTF-8). */
export type PackageFiles = ReadonlyMap<string, string>;

export type Parsed<T> = { ok: true; value: T } | { ok: false; problems: string[] };

/** An Agent Skills skill: SKILL.md frontmatter (`name`, `description`) and its body. */
export interface SkillPackage {
  name: string;
  description: string;
  /** The SKILL.md body: the instructions loaded into the agent's system prompt. */
  content: string;
  license?: string;
  metadata?: Record<string, string>;
  /** Supporting files beside SKILL.md (`references/…`, `scripts/…`, `assets/…`, licenses), by path relative to the skill folder. */
  files?: Record<string, string>;
}

export type AgentAudience = "runtime" | "member";
export const AGENT_AUDIENCES: readonly AgentAudience[] = ["runtime", "member"];

export interface AgentManifest {
  /** Agent id: lowercase kebab-case. */
  name: string;
  /** `metadata.audience`; `runtime` when absent. */
  audience: AgentAudience;
  /** Semantic version of this definition. */
  version: string;
  description: string;
  /**
   * Runtime: kernel tool allowlist; absent = every kernel tool, [] = no tools. Member: harness tool names;
   * absent = all the harness offers (Claude Code's own rule for an agent file without `tools`).
   */
  tools?: string[];
  /** Shared skills from the skill library, by name. */
  skills: string[];
  thinking?: ThinkingLevel;
  /** Regular expressions; matching shell commands are blocked. */
  denyCommandPatterns?: string[];
  /** Free-form string metadata (e.g. source, attribution). */
  metadata?: Record<string, string>;
}

export interface AgentPackage {
  manifest: AgentManifest;
  /** The agent file's body: the system prompt, used verbatim. */
  instructions: string;
  /** Agent-local skills (skills/<name>/SKILL.md inside the package). */
  localSkills: SkillPackage[];
}

export const SKILL_FILE = "SKILL.md";

/** The agent file of a package: `<name>.md`. */
export const agentFileName = (name: string): string => `${name}.md`;

const AGENT_NAME = /^[a-z][a-z0-9-]{0,63}$/;
/** Agent Skills: lowercase letters, digits and hyphens, at most 64 characters (matches the kernel). */
const SKILL_NAME = /^[a-z][a-z0-9-]{0,63}$/;
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const MAX_INSTRUCTIONS = 100_000;
const MAX_DESCRIPTION = 1024;

/** Claude Code / GitHub agent fields with no meaning in the kernel, and why. */
const REFUSED_AGENT_FIELDS: Record<string, string> = {
  model: "the model is bound per agent in Settings → Providers",
  hooks: "the runtime kernel runs no hooks",
  mcpServers: "the runtime kernel connects to no MCP servers",
  "mcp-servers": "the runtime kernel connects to no MCP servers",
  permissionMode: "the kernel has no permission modes; use the tools allowlist",
  "permission-mode": "the kernel has no permission modes; use the tools allowlist",
  disallowedTools: "list the allowed tools instead",
  maxTurns: "limits are set per pipeline stage",
};
const AGENT_FIELDS = new Set(["name", "version", "description", "tools", "skills", "thinking", "deny-command-patterns", "metadata"]);
const SKILL_FIELDS = new Set(["name", "description", "license", "compatibility", "metadata", "allowed-tools"]);

// ---------------------------------------------------------------------------
// Frontmatter
// ---------------------------------------------------------------------------

export interface Document {
  data: Record<string, unknown>;
  body: string;
}

export function splitFrontmatter(text: string, file: string): Document | string {
  const normalized = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(normalized);
  if (match === null) return `${file}: missing YAML frontmatter (--- … ---)`;
  let data: unknown;
  try {
    data = parseYaml(match[1]!);
  } catch (error) {
    return `${file}: invalid YAML frontmatter: ${error instanceof Error ? error.message : String(error)}`;
  }
  if (data === null || typeof data !== "object" || Array.isArray(data)) return `${file}: frontmatter must be a mapping`;
  return { data: data as Record<string, unknown>, body: match[2]!.trim() };
}

function joinFrontmatter(data: Record<string, unknown>, body: string): string {
  return `---\n${stringifyYaml(data, { lineWidth: 0 }).trimEnd()}\n---\n\n${body.trim()}\n`;
}

const isString = (value: unknown): value is string => typeof value === "string";

/** `tools: [read, grep]`, or the Claude Code comma form `tools: read, grep`. */
function stringList(value: unknown, field: string, file: string, problems: string[]): string[] {
  if (value === undefined || value === null) return [];
  if (isString(value)) return value.split(",").map((entry) => entry.trim()).filter((entry) => entry !== "");
  if (Array.isArray(value) && value.every(isString)) return value.map((entry) => entry.trim());
  problems.push(`${file}: \`${field}\` must be a list of strings`);
  return [];
}

function stringMap(value: unknown, field: string, file: string, problems: string[]): Record<string, string> | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "object" && !Array.isArray(value) && Object.values(value).every(isString)) return value as Record<string, string>;
  problems.push(`${file}: \`${field}\` must map strings to strings`);
  return undefined;
}

// ---------------------------------------------------------------------------
// Skills
// ---------------------------------------------------------------------------

/** Parses one SKILL.md. `folder` is the skill's directory name, which must equal its name. */
export function parseSkill(text: string, folder: string, file = `${folder}/${SKILL_FILE}`): Parsed<SkillPackage> {
  const document = splitFrontmatter(text, file);
  if (typeof document === "string") return { ok: false, problems: [document] };
  const { data, body } = document;
  const problems: string[] = [];
  for (const key of Object.keys(data)) if (!SKILL_FIELDS.has(key)) problems.push(`${file}: unknown field \`${key}\``);

  const name = data["name"];
  if (!isString(name) || !SKILL_NAME.test(name)) problems.push(`${file}: \`name\` must match ${SKILL_NAME.source}`);
  else if (name !== folder) problems.push(`${file}: \`name\` "${name}" must equal its folder "${folder}"`);
  const description = data["description"];
  if (!isString(description) || description.trim() === "") problems.push(`${file}: \`description\` is required`);
  else if (description.length > MAX_DESCRIPTION) problems.push(`${file}: \`description\` is longer than ${MAX_DESCRIPTION} characters`);
  if (body === "") problems.push(`${file}: the skill body is empty`);
  const license = data["license"];
  if (license !== undefined && !isString(license)) problems.push(`${file}: \`license\` must be a string`);
  const metadata = stringMap(data["metadata"], "metadata", file, problems);

  if (problems.length > 0) return { ok: false, problems };
  return {
    ok: true,
    value: {
      name: name as string,
      description: (description as string).trim(),
      content: body,
      ...(isString(license) ? { license } : {}),
      ...(metadata === undefined ? {} : { metadata }),
    },
  };
}

export function serializeSkill(skill: SkillPackage): string {
  return joinFrontmatter(
    {
      name: skill.name,
      description: skill.description,
      ...(skill.license === undefined ? {} : { license: skill.license }),
      ...(skill.metadata === undefined ? {} : { metadata: skill.metadata }),
    },
    skill.content,
  );
}

/**
 * Parses a skill library folder: `<name>/SKILL.md` per skill. A skill folder may also carry
 * supporting files (Agent Skills `references/`, `scripts/`, `assets/`, license texts); they are
 * kept with the skill (`SkillPackage.files`): the Agent Builder shows them, and a runtime job gets
 * the references, scripts and assets as read-only files its agent reads on demand (the system prompt
 * carries SKILL.md and lists them); a skill's SKILL.md still has to make sense on its own.
 */
export function parseSkillLibrary(files: PackageFiles): Parsed<SkillPackage[]> {
  const problems: string[] = [];
  const skills: SkillPackage[] = [];
  const folders = new Set([...files.keys()].flatMap((path) => /^([^/]+)\/SKILL\.md$/.exec(path)?.[1] ?? []));
  for (const [path, text] of files) {
    const match = /^([^/]+)\/SKILL\.md$/.exec(path);
    if (match === null) {
      const folder = /^([^/]+)\/(?:(?:references|scripts|assets)\/[^/].*|LICENSE[^/]*|NOTICE[^/]*)$/.exec(path)?.[1];
      if (folder === undefined) problems.push(`${path}: unsupported file; a skill library holds <name>/SKILL.md with references/, scripts/, assets/ and license files`);
      else if (!folders.has(folder)) problems.push(`${path}: the folder "${folder}" has no ${SKILL_FILE}`);
      continue;
    }
    const parsed = parseSkill(text, match[1]!, path);
    if (!parsed.ok) {
      problems.push(...parsed.problems);
      continue;
    }
    const prefix = `${match[1]!}/`;
    const supporting = [...files].filter(([other]) => other.startsWith(prefix) && other !== path).map(([other, content]) => [other.slice(prefix.length), content] as const);
    skills.push(supporting.length === 0 ? parsed.value : { ...parsed.value, files: Object.fromEntries(supporting.sort(([a], [b]) => a.localeCompare(b))) });
  }
  return problems.length > 0 ? { ok: false, problems } : { ok: true, value: skills.sort((a, b) => a.name.localeCompare(b.name)) };
}

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------

/**
 * Parses one agent file (`<name>.md`). Checks the format only; whether its tools exist
 * and its shared skills resolve is checked by validateAgent against the installation.
 */
export function parseAgentFile(text: string, file: string, localSkills: SkillPackage[] = []): Parsed<AgentPackage> {
  const problems: string[] = [];
  const document = splitFrontmatter(text, file);
  if (typeof document === "string") return { ok: false, problems: [document] };
  const { data, body } = document;

  const metadata = stringMap(data["metadata"], "metadata", file, problems);
  const audienceValue = metadata?.["audience"] ?? "runtime";
  const audience = (AGENT_AUDIENCES as readonly string[]).includes(audienceValue) ? (audienceValue as AgentAudience) : undefined;
  if (audience === undefined) problems.push(`${file}: \`metadata.audience\` must be one of ${AGENT_AUDIENCES.join(", ")}`);

  for (const key of Object.keys(data)) {
    const refused = REFUSED_AGENT_FIELDS[key];
    if (refused !== undefined && audience !== "member") problems.push(`${file}: \`${key}\` is not supported: ${refused}`);
    else if (refused === undefined && !AGENT_FIELDS.has(key)) problems.push(`${file}: unknown field \`${key}\``);
  }

  const name = data["name"];
  if (!isString(name) || !AGENT_NAME.test(name)) problems.push(`${file}: \`name\` must match ${AGENT_NAME.source}`);
  const version = data["version"];
  if (!isString(version) || !SEMVER.test(version)) problems.push(`${file}: \`version\` must be a semantic version (e.g. 1.0.0)`);
  const description = data["description"];
  if (!isString(description) || description.trim() === "") problems.push(`${file}: \`description\` is required`);
  else if (description.length > MAX_DESCRIPTION) problems.push(`${file}: \`description\` is longer than ${MAX_DESCRIPTION} characters`);
  // No `tools` key: every tool. An explicit list, even an empty one, restricts.
  const tools = data["tools"] === undefined || data["tools"] === null ? undefined : stringList(data["tools"], "tools", file, problems);
  const skills = stringList(data["skills"], "skills", file, problems);
  const thinking = data["thinking"];
  if (thinking !== undefined && !(isString(thinking) && (THINKING_LEVELS as readonly string[]).includes(thinking))) {
    problems.push(`${file}: \`thinking\` must be one of ${THINKING_LEVELS.join(", ")}`);
  }
  const denyCommandPatterns = stringList(data["deny-command-patterns"], "deny-command-patterns", file, problems);
  if (body === "") problems.push(`${file}: the instructions (body) are empty`);
  if (body.length > MAX_INSTRUCTIONS) problems.push(`${file}: the instructions are longer than ${MAX_INSTRUCTIONS} characters`);

  if (problems.length > 0) return { ok: false, problems };
  return {
    ok: true,
    value: {
      manifest: {
        name: name as string,
        audience: audience as AgentAudience,
        version: version as string,
        description: (description as string).trim(),
        ...(tools === undefined ? {} : { tools }),
        skills,
        ...(thinking === undefined ? {} : { thinking: thinking as ThinkingLevel }),
        ...(denyCommandPatterns.length === 0 ? {} : { denyCommandPatterns }),
        ...(metadata === undefined ? {} : { metadata }),
      },
      instructions: body,
      localSkills: [...localSkills].sort((a, b) => a.name.localeCompare(b.name)),
    },
  };
}

/** Parses an agent package: one `<name>.md` at the root plus optional `skills/<name>/SKILL.md`. */
export function parseAgentPackage(files: PackageFiles): Parsed<AgentPackage> {
  const problems: string[] = [];
  const agentFiles = [...files.keys()].filter((path) => !path.includes("/") && path.endsWith(".md"));
  if (agentFiles.length !== 1) {
    return { ok: false, problems: [`a package holds exactly one <name>.md agent file at its root (found ${agentFiles.length})`] };
  }
  const agentPath = agentFiles[0]!;

  const localSkills: SkillPackage[] = [];
  for (const [path, text] of files) {
    if (path === agentPath) continue;
    const match = /^skills\/([^/]+)\/SKILL\.md$/.exec(path);
    if (match === null) {
      // Agent Skills folders may carry scripts and references; the kernel prompt carries SKILL.md only; the other files are written beside the job inputs.
      problems.push(`${path}: unsupported file; a package holds <name>.md and skills/<name>/${SKILL_FILE}`);
      continue;
    }
    const parsed = parseSkill(text, match[1]!, path);
    if (parsed.ok) localSkills.push(parsed.value);
    else problems.push(...parsed.problems);
  }
  const agent = parseAgentFile(files.get(agentPath)!, agentPath, localSkills);
  if (!agent.ok) return { ok: false, problems: [...agent.problems, ...problems] };
  if (agentPath !== agentFileName(agent.value.manifest.name)) {
    problems.push(`${agentPath}: the file must be named ${agentFileName(agent.value.manifest.name)}`);
  }
  return problems.length > 0 ? { ok: false, problems } : agent;
}

/** The package as files, ready to zip or write out (export). */
export function serializeAgentPackage(agent: AgentPackage): Map<string, string> {
  const { manifest } = agent;
  const files = new Map<string, string>();
  files.set(
    agentFileName(manifest.name),
    joinFrontmatter(
      {
        name: manifest.name,
        version: manifest.version,
        description: manifest.description,
        ...(manifest.tools === undefined ? {} : { tools: manifest.tools }),
        ...(manifest.skills.length === 0 ? {} : { skills: manifest.skills }),
        ...(manifest.thinking === undefined ? {} : { thinking: manifest.thinking }),
        ...(manifest.denyCommandPatterns === undefined ? {} : { "deny-command-patterns": manifest.denyCommandPatterns }),
        metadata: { ...manifest.metadata, audience: manifest.audience },
      },
      agent.instructions,
    ),
  );
  for (const skill of agent.localSkills) files.set(`skills/${skill.name}/${SKILL_FILE}`, serializeSkill(skill));
  return files;
}
