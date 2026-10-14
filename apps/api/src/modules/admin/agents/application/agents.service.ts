// Application layer: use cases of the Agent Builder (ADR-0026). Built-in agents come from
// the release and are read-only; custom agents are saved as immutable versions after the
// package format checks (parseAgentPackage) and the installation checks (validateAgent
// against the kernel tools and shared skills). Every problem is reported at once.

import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import {
  type AgentPackage,
  AgentResolutionError,
  type BuiltinCatalog,
  type CustomAgentStore,
  installationSkills,
  parseSkill,
  parseSkillLibrary,
  parseStoredAgent,
  resolveAgentDefinition,
  serializeAgentPackage,
  serializeSkill,
  type SkillPackage,
  toAgentDefinition,
  unzipFiles,
  validateAgent,
  zipFiles,
} from "@kintsugi/agents";
import type { AgentDefinition, AgentModelBinding } from "@kintsugi/runtime-sdk";
import { AUDIT_ACTIONS, AuditTrail, auditRecord } from "#common/audit/audit-trail.js";
import type { Actor } from "#common/auth/decorators.js";
import { LlmProvidersService } from "#modules/admin/llm-providers/index.js";
import type {
  AgentBuilderContext,
  AgentDetail,
  AgentDraft,
  AgentImport,
  AgentPreview,
  AgentSummary,
  AgentVersionDetail,
  AgentVersionView,
  CustomAgentRecord,
  PackageFileMap,
  SharedSkillRecord,
  SharedSkillView,
  SkillDraft,
} from "../domain/agent.js";
import { AgentCatalog, AgentRepository } from "../domain/agent.repository.js";

/** Import limits: a package is a handful of Markdown files. */
const MAX_IMPORT_FILES = 100;
const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

interface Installation {
  builtin: BuiltinCatalog;
  storedSkills: SharedSkillRecord[];
  sharedSkills: Map<string, SkillPackage>;
  knownTools: readonly string[];
}

const filesOf = (agent: AgentPackage): PackageFileMap => Object.fromEntries(serializeAgentPackage(agent));
const problemsError = (problems: string[]): BadRequestException => new BadRequestException(problems);
/** A skill's supporting files together (the table keeps them in one row). */
const MAX_SKILL_BYTES = 1_000_000;
/** The name stored as an agent's or skill's author (`updatedBy`). */
const actorName = (actor: Actor): string => actor.username ?? actor.id;

/** The package an editor draft describes, as files (the same format as import and export). */
export function draftFiles(draft: AgentDraft): PackageFileMap {
  const { audience: _audience, ...metadata } = draft.metadata ?? {};
  return filesOf({
    manifest: {
      name: draft.name,
      audience: draft.audience,
      version: draft.version,
      description: draft.description,
      tools: draft.tools,
      skills: draft.skills,
      ...(draft.thinking === undefined ? {} : { thinking: draft.thinking }),
      ...(draft.denyCommandPatterns === undefined || draft.denyCommandPatterns.length === 0 ? {} : { denyCommandPatterns: draft.denyCommandPatterns }),
      ...(Object.keys(metadata).length === 0 ? {} : { metadata }),
    },
    instructions: draft.instructions,
    localSkills: draft.localSkills.map((skill) => ({ ...skill })),
  });
}

@Injectable()
export class AgentsService {
  constructor(
    private readonly agents: AgentRepository,
    private readonly catalog: AgentCatalog,
    private readonly providers: LlmProvidersService,
    private readonly audit: AuditTrail,
  ) {}

  /** Custom agents and skills as @kintsugi/agents resolves them (the same path as job runs). */
  readonly #store: CustomAgentStore = {
    agent: async (name) => {
      const record = await this.agents.get(name);
      return record === undefined ? undefined : { files: record.files, enabled: record.enabled };
    },
    skills: async () => (await this.agents.listSkills()).map((skill) => ({ name: skill.name, text: skill.content, files: skill.files })),
  };

  async #installation(): Promise<Installation> {
    const [builtin, storedSkills] = await Promise.all([this.catalog.builtin(), this.agents.listSkills()]);
    const sharedSkills = installationSkills(
      builtin,
      storedSkills.map((skill) => ({ name: skill.name, text: skill.content, files: skill.files })),
    );
    return { builtin, storedSkills, sharedSkills, knownTools: this.catalog.kernelTools };
  }

  #validate(agent: AgentPackage, installation: Installation): string[] {
    return validateAgent(agent, { knownTools: installation.knownTools, sharedSkills: installation.sharedSkills });
  }

  // -------------------------------------------------------------------------
  // Catalog and detail
  // -------------------------------------------------------------------------

  async context(): Promise<AgentBuilderContext> {
    const { builtin, sharedSkills, knownTools } = await this.#installation();
    const builtinSkills = new Set(builtin.skills.map((skill) => skill.name));
    return {
      kernelTools: knownTools,
      sharedSkills: [...sharedSkills.values()].map((skill) => ({ name: skill.name, description: skill.description, source: builtinSkills.has(skill.name) ? "builtin" : "custom" })),
      reservedNames: [...builtin.agents.map((agent) => agent.manifest.name), ...builtinSkills].sort(),
    };
  }

  async list(): Promise<AgentSummary[]> {
    const [installation, custom, bindings] = await Promise.all([this.#installation(), this.agents.list(), this.providers.listBindings()]);
    return [
      ...installation.builtin.agents.map((agent) => this.#builtinDetail(agent, installation, bindings)),
      ...custom.map((record) => this.#customDetail(record, installation, bindings)),
    ].map(({ manifest: _manifest, instructions: _instructions, localSkills: _localSkills, files: _files, bindings: _bindings, ...summary }) => summary);
  }

  async get(name: string): Promise<AgentDetail> {
    const [installation, bindings] = await Promise.all([this.#installation(), this.providers.listBindings()]);
    const builtin = installation.builtin.agents.find((agent) => agent.manifest.name === name);
    if (builtin !== undefined) return this.#builtinDetail(builtin, installation, bindings);
    return this.#customDetail(await this.#mustGetCustom(name), installation, bindings);
  }

  #builtinDetail(agent: AgentPackage, installation: Installation, bindings: AgentModelBinding[]): AgentDetail {
    const { manifest } = agent;
    return {
      name: manifest.name,
      source: "builtin",
      audience: manifest.audience,
      version: manifest.version,
      description: manifest.description,
      enabled: true,
      problems: this.#validate(agent, installation),
      ...bindingOf(manifest.name, bindings),
      manifest,
      instructions: agent.instructions,
      localSkills: agent.localSkills,
      files: filesOf(agent),
      bindings: bindings.filter((binding) => binding.agent === manifest.name),
    };
  }

  #customDetail(record: CustomAgentRecord, installation: Installation, bindings: AgentModelBinding[]): AgentDetail {
    const parsed = parseStoredAgent(record.files);
    const base = {
      name: record.name,
      source: "custom" as const,
      audience: record.audience,
      version: record.version,
      enabled: record.enabled,
      ...(record.copiedFrom === undefined ? {} : { copiedFrom: record.copiedFrom }),
      updatedAt: record.updatedAt,
      ...(record.updatedBy === undefined ? {} : { updatedBy: record.updatedBy }),
      ...bindingOf(record.name, bindings),
      files: record.files,
      bindings: bindings.filter((binding) => binding.agent === record.name),
    };
    if (!parsed.ok) return { ...base, description: "", problems: parsed.problems, instructions: "", localSkills: [] };
    const agent = parsed.value;
    return {
      ...base,
      description: agent.manifest.description,
      problems: this.#validate(agent, installation),
      manifest: agent.manifest,
      instructions: agent.instructions,
      localSkills: agent.localSkills,
    };
  }

  async #mustGetCustom(name: string): Promise<CustomAgentRecord> {
    const record = await this.agents.get(name);
    if (record === undefined) throw new NotFoundException(`Agent ${name} not found`);
    return record;
  }

  /** A custom agent to change; built-in agents are read-only. */
  async #mustGetEditable(name: string): Promise<CustomAgentRecord> {
    const builtin = await this.catalog.builtin();
    if (builtin.agents.some((agent) => agent.manifest.name === name)) {
      throw new BadRequestException(`Agent ${name} is built in and read-only; copy it to a custom agent to change it`);
    }
    return this.#mustGetCustom(name);
  }

  // -------------------------------------------------------------------------
  // Create, update, copy, import
  // -------------------------------------------------------------------------

  /** Parses and validates package files for saving; throws with every problem. */
  #accept(files: PackageFileMap, installation: Installation): AgentPackage {
    const parsed = parseStoredAgent(files);
    if (!parsed.ok) throw problemsError(parsed.problems);
    const agent = parsed.value;
    if (installation.builtin.agents.some((entry) => entry.manifest.name === agent.manifest.name)) {
      throw new ConflictException(`The name ${agent.manifest.name} is reserved by a built-in agent; choose another name`);
    }
    const problems = this.#validate(agent, installation);
    if (problems.length > 0) throw problemsError(problems);
    return agent;
  }

  async preview(draft: AgentDraft): Promise<AgentPreview> {
    const installation = await this.#installation();
    const files = draftFiles(draft);
    const parsed = parseStoredAgent(files);
    if (!parsed.ok) return { problems: parsed.problems, files };
    const agent = parsed.value;
    const problems = this.#validate(agent, installation);
    if (installation.builtin.agents.some((entry) => entry.manifest.name === agent.manifest.name)) {
      problems.unshift(`the name ${agent.manifest.name} is reserved by a built-in agent`);
    }
    return {
      problems,
      files: filesOf(agent),
      ...(problems.length === 0 && agent.manifest.audience === "runtime" ? { definition: toAgentDefinition(agent, installation.sharedSkills) } : {}),
    };
  }

  async create(draft: AgentDraft, actor: Actor): Promise<AgentDetail> {
    const agent = this.#accept(draftFiles(draft), await this.#installation());
    await this.#insert(agent, actorName(actor));
    await this.audit.recordChange(auditRecord(actor, AUDIT_ACTIONS.agentCreate, { subject: agent.manifest.name, detail: versionOf(agent) }));
    return this.get(agent.manifest.name);
  }

  async #insert(agent: AgentPackage, actor: string, copiedFrom?: string): Promise<void> {
    const { manifest } = agent;
    const created = await this.agents.create(
      { name: manifest.name, audience: manifest.audience, version: manifest.version, files: filesOf(agent), ...(copiedFrom === undefined ? {} : { copiedFrom }) },
      actor,
    );
    if (!created) throw new ConflictException(`Agent ${manifest.name} already exists`);
  }

  /** Saves the draft as a new version of agent `name`. */
  async update(name: string, draft: AgentDraft, actor: Actor): Promise<AgentDetail> {
    await this.#mustGetEditable(name);
    const agent = this.#accept(draftFiles(draft), await this.#installation());
    if (agent.manifest.name !== name) throw new BadRequestException(`The name cannot change (${name} → ${agent.manifest.name}); copy the agent instead`);
    await this.#saveVersion(agent, actorName(actor));
    await this.audit.recordChange(auditRecord(actor, AUDIT_ACTIONS.agentUpdate, { subject: name, detail: versionOf(agent) }));
    return this.get(name);
  }

  async #saveVersion(agent: AgentPackage, actor: string): Promise<void> {
    const { manifest } = agent;
    const saved = await this.agents.saveVersion({ name: manifest.name, audience: manifest.audience, version: manifest.version, files: filesOf(agent) }, actor);
    if (!saved) throw new ConflictException(`Version ${manifest.version} of ${manifest.name} already exists; save under a new version`);
  }

  /** Copies a built-in or custom agent into a new custom agent ("copy to edit"). */
  async copy(name: string, newName: string, actor: Actor): Promise<AgentDetail> {
    const installation = await this.#installation();
    let source = installation.builtin.agents.find((agent) => agent.manifest.name === name);
    if (source === undefined) {
      const parsed = parseStoredAgent((await this.#mustGetCustom(name)).files);
      if (!parsed.ok) throw problemsError(parsed.problems);
      source = parsed.value;
    }
    const copiedFrom = `${name}@${source.manifest.version}`;
    const copy: AgentPackage = {
      ...source,
      manifest: { ...source.manifest, name: newName, metadata: { ...source.manifest.metadata, "copied-from": copiedFrom } },
    };
    const agent = this.#accept(filesOf(copy), installation);
    await this.#insert(agent, actorName(actor), copiedFrom);
    await this.audit.recordChange(auditRecord(actor, AUDIT_ACTIONS.agentCopy, { subject: newName, detail: { ...versionOf(agent), copiedFrom } }));
    return this.get(newName);
  }

  /** Imports a package: a new custom agent, or a new version of an existing one. */
  async import(input: AgentImport, actor: Actor): Promise<{ created: boolean; agent: AgentDetail }> {
    let files: PackageFileMap;
    if ("zip" in input) {
      try {
        files = Object.fromEntries(unzipFiles(Buffer.from(input.zip, "base64"), { maxEntries: MAX_IMPORT_FILES, maxTotalBytes: MAX_IMPORT_BYTES }));
      } catch (error) {
        throw new BadRequestException(`Cannot read the archive: ${error instanceof Error ? error.message : String(error)}`);
      }
    } else {
      files = input.files;
    }
    const agent = this.#accept(files, await this.#installation());
    const existing = await this.agents.get(agent.manifest.name);
    if (existing === undefined) await this.#insert(agent, actorName(actor));
    else await this.#saveVersion(agent, actorName(actor));
    await this.audit.recordChange(
      auditRecord(actor, AUDIT_ACTIONS.agentImport, {
        subject: agent.manifest.name,
        detail: { ...versionOf(agent), created: existing === undefined, format: "zip" in input ? "zip" : "files" },
      }),
    );
    return { created: existing === undefined, agent: await this.get(agent.manifest.name) };
  }

  /** The package as a ZIP (built-in or custom; a recorded version when given). */
  async export(name: string, version?: string): Promise<{ fileName: string; content: Buffer }> {
    let files: PackageFileMap;
    let exported: string;
    if (version === undefined) {
      const detail = await this.get(name);
      files = detail.files;
      exported = detail.version;
    } else {
      files = (await this.version(name, version)).files;
      exported = version;
    }
    return { fileName: `${name}-${exported}.zip`, content: zipFiles(new Map(Object.entries(files))) };
  }

  // -------------------------------------------------------------------------
  // Lifecycle and versions
  // -------------------------------------------------------------------------

  async setEnabled(name: string, enabled: boolean, actor: Actor): Promise<AgentDetail> {
    await this.#mustGetEditable(name);
    await this.agents.setEnabled(name, enabled, actorName(actor));
    await this.audit.recordChange(auditRecord(actor, enabled ? AUDIT_ACTIONS.agentEnable : AUDIT_ACTIONS.agentDisable, { subject: name }));
    return this.get(name);
  }

  async remove(name: string, actor: Actor): Promise<void> {
    const record = await this.#mustGetEditable(name);
    await this.agents.remove(name);
    await this.audit.recordChange(auditRecord(actor, AUDIT_ACTIONS.agentDelete, { subject: name, detail: { version: record.version, audience: record.audience } }));
  }

  async versions(name: string): Promise<AgentVersionView[]> {
    const record = await this.#mustGetEditable(name);
    return (await this.agents.versions(name)).map(({ files: _files, ...version }) => ({ ...version, current: version.version === record.version }));
  }

  async version(name: string, version: string): Promise<AgentVersionDetail> {
    const record = await this.#mustGetEditable(name);
    const found = await this.agents.version(name, version);
    if (found === undefined) throw new NotFoundException(`Version ${version} of ${name} not found`);
    return { ...found, current: found.version === record.version };
  }

  /** Makes a recorded version current again, if it still validates on this installation. */
  async restore(name: string, version: string, actor: Actor): Promise<AgentDetail> {
    const found = await this.version(name, version);
    const parsed = parseStoredAgent(found.files);
    if (!parsed.ok) throw problemsError(parsed.problems);
    const problems = this.#validate(parsed.value, await this.#installation());
    if (problems.length > 0) throw problemsError(problems);
    await this.agents.restore(name, found, parsed.value.manifest.audience, actorName(actor));
    await this.audit.recordChange(auditRecord(actor, AUDIT_ACTIONS.agentRestore, { subject: name, detail: { version } }));
    return this.get(name);
  }

  /** The AgentDefinition a job would embed for this agent (resolved like the worker does). */
  async definition(name: string): Promise<AgentDefinition> {
    try {
      const resolved = await resolveAgentDefinition(name, { builtin: await this.catalog.builtin(), store: this.#store, knownTools: this.catalog.kernelTools });
      return resolved.definition;
    } catch (error) {
      if (!(error instanceof AgentResolutionError)) throw error;
      if (error.message.startsWith("Unknown agent")) throw new NotFoundException(error.message);
      throw new BadRequestException(error.message);
    }
  }

  // -------------------------------------------------------------------------
  // Shared skills
  // -------------------------------------------------------------------------

  async listSkills(): Promise<SharedSkillView[]> {
    const [installation, custom] = await Promise.all([this.#installation(), this.agents.list()]);
    const users = new Map<string, string[]>();
    const agents = [...installation.builtin.agents, ...custom.flatMap((record) => {
      const parsed = parseStoredAgent(record.files);
      return parsed.ok ? [parsed.value] : [];
    })];
    for (const agent of agents) {
      for (const skill of agent.manifest.skills) users.set(skill, [...(users.get(skill) ?? []), agent.manifest.name]);
    }
    const builtin: SharedSkillView[] = installation.builtin.skills.map((skill) => ({
      name: skill.name,
      source: "builtin",
      description: skill.description,
      content: skill.content,
      files: Object.entries(skill.files ?? {}).map(([path, content]) => ({ path, content })),
      usedBy: users.get(skill.name) ?? [],
      problems: [],
    }));
    const stored: SharedSkillView[] = installation.storedSkills.map((record) => {
      const parsed = parseSkill(record.content, record.name);
      return {
        name: record.name,
        source: "custom",
        description: parsed.ok ? parsed.value.description : "",
        content: parsed.ok ? parsed.value.content : record.content,
        files: Object.entries(record.files).map(([path, content]) => ({ path, content })),
        usedBy: users.get(record.name) ?? [],
        problems: parsed.ok ? [] : parsed.problems,
        updatedAt: record.updatedAt,
        ...(record.updatedBy === undefined ? {} : { updatedBy: record.updatedBy }),
      };
    });
    return [...builtin, ...stored];
  }

  async getSkill(name: string): Promise<SharedSkillView> {
    const skill = (await this.listSkills()).find((entry) => entry.name === name);
    if (skill === undefined) throw new NotFoundException(`Shared skill ${name} not found`);
    return skill;
  }

  /** SKILL.md text for a draft; throws with every format problem. */
  #skillText(draft: SkillDraft): string {
    const text = serializeSkill({ name: draft.name, description: draft.description, content: draft.content, ...(draft.license === undefined ? {} : { license: draft.license }) });
    const parsed = parseSkill(text, draft.name);
    if (!parsed.ok) throw problemsError(parsed.problems);
    return text;
  }

  /** The files beside SKILL.md of a draft, checked with the skill library format (folders, names) and size limits. */
  #skillFiles(draft: SkillDraft, text: string): Record<string, string> {
    const files = draft.files ?? {};
    const bytes = Object.values(files).reduce((sum, content) => sum + Buffer.byteLength(content), 0);
    if (bytes > MAX_SKILL_BYTES) throw new BadRequestException(`A skill's files are limited to ${MAX_SKILL_BYTES / 1_000_000} MB together`);
    const unsafe = Object.keys(files).filter((path) => path.startsWith("/") || path.includes("\\") || path.includes("\0") || path.split("/").some((part) => part === ".." || part === "." || part === ""));
    if (unsafe.length > 0) throw problemsError(unsafe.map((path) => `${path}: not a path inside the skill folder`));
    const library = new Map<string, string>([[`${draft.name}/SKILL.md`, text], ...Object.entries(files).map(([path, content]) => [`${draft.name}/${path}`, content] as const)]);
    const parsed = parseSkillLibrary(library);
    if (!parsed.ok) throw problemsError(parsed.problems);
    return files;
  }

  async #mustNotBeBuiltinSkill(name: string): Promise<void> {
    const builtin = await this.catalog.builtin();
    if (builtin.skills.some((skill) => skill.name === name)) throw new BadRequestException(`Shared skill ${name} is built in and read-only`);
  }

  async createSkill(draft: SkillDraft, actor: Actor): Promise<SharedSkillView> {
    const builtin = await this.catalog.builtin();
    if (builtin.skills.some((skill) => skill.name === draft.name)) throw new ConflictException(`The name ${draft.name} is reserved by a built-in skill`);
    const text = this.#skillText(draft);
    if (!(await this.agents.createSkill(draft.name, text, this.#skillFiles(draft, text), actorName(actor)))) throw new ConflictException(`Shared skill ${draft.name} already exists`);
    await this.audit.recordChange(auditRecord(actor, AUDIT_ACTIONS.skillCreate, { subject: draft.name }));
    return this.getSkill(draft.name);
  }

  async updateSkill(name: string, draft: SkillDraft, actor: Actor): Promise<SharedSkillView> {
    await this.#mustNotBeBuiltinSkill(name);
    if (draft.name !== name) throw new BadRequestException(`The name cannot change (${name} → ${draft.name})`);
    const text = this.#skillText(draft);
    // A draft without `files` (the small edit dialog) keeps the files the skill has.
    const kept = draft.files === undefined ? (await this.agents.getSkill(name))?.files : undefined;
    if (!(await this.agents.updateSkill(name, text, this.#skillFiles(kept === undefined ? draft : { ...draft, files: kept }, text), actorName(actor)))) throw new NotFoundException(`Shared skill ${name} not found`);
    await this.audit.recordChange(auditRecord(actor, AUDIT_ACTIONS.skillUpdate, { subject: name }));
    return this.getSkill(name);
  }

  async removeSkill(name: string, actor: Actor): Promise<void> {
    await this.#mustNotBeBuiltinSkill(name);
    const skill = await this.getSkill(name);
    if (skill.usedBy.length > 0) throw new ConflictException(`Shared skill ${name} is used by ${skill.usedBy.join(", ")}; remove it from those agents first`);
    await this.agents.removeSkill(name);
    await this.audit.recordChange(auditRecord(actor, AUDIT_ACTIONS.skillDelete, { subject: name }));
  }
}

/** Audit detail of a saved package: its version and audience (never its files). */
function versionOf(agent: AgentPackage): { version: string; audience: string } {
  return { version: agent.manifest.version, audience: agent.manifest.audience };
}

function bindingOf(agent: string, bindings: AgentModelBinding[]): { binding?: AgentSummary["binding"] } {
  const binding = bindings.find((entry) => entry.agent === agent && entry.projectId === undefined);
  if (binding === undefined) return {};
  return { binding: { provider: binding.provider, model: binding.model, ...(binding.thinking === undefined ? {} : { thinking: binding.thinking }) } };
}
