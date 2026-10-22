// Agent Builder use cases over an in-memory repository (no database): validation with every
// problem as 400, reserved names, versions and restore, copy, import/export, shared skills.

import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { unzipFiles, zipFiles } from "@kintsugi/agents";
import type { AgentModelBinding } from "@kintsugi/runtime-sdk";
import { KERNEL_TOOL_NAMES } from "@kintsugi/runtime/tool-names";
import { describe, expect, it } from "vitest";
import { AgentsService } from "#modules/admin/agents/application/agents.service.js";
import type { AgentDraft, AgentVersionRecord, CustomAgentRecord, SaveAgent, SharedSkillRecord } from "#modules/admin/agents/domain/agent.js";
import { AgentRepository } from "#modules/admin/agents/domain/agent.repository.js";
import { PackagedAgentCatalog } from "#modules/admin/agents/infrastructure/packaged-agent.catalog.js";
import type { LlmProvidersService } from "#modules/admin/llm-providers/index.js";
import { MemoryAuditTrail, testAdmin as admin } from "../support/audit.js";

class MemoryAgents extends AgentRepository {
  agents = new Map<string, CustomAgentRecord>();
  history = new Map<string, AgentVersionRecord[]>();
  skills = new Map<string, SharedSkillRecord>();
  #clock = 0;
  #now = (): string => new Date(Date.UTC(2026, 0, 1, 0, 0, this.#clock++)).toISOString();

  async list() {
    return [...this.agents.values()];
  }
  async get(name: string) {
    return this.agents.get(name);
  }
  async create(agent: SaveAgent, actor: string) {
    if (this.agents.has(agent.name)) return false;
    const at = this.#now();
    this.agents.set(agent.name, { ...agent, enabled: true, createdBy: actor, createdAt: at, updatedBy: actor, updatedAt: at });
    this.history.set(agent.name, [{ version: agent.version, files: agent.files, createdBy: actor, createdAt: at }]);
    return true;
  }
  async saveVersion(agent: SaveAgent, actor: string) {
    const versions = this.history.get(agent.name)!;
    if (versions.some((entry) => entry.version === agent.version)) return false;
    const at = this.#now();
    versions.unshift({ version: agent.version, files: agent.files, createdBy: actor, createdAt: at });
    this.agents.set(agent.name, { ...this.agents.get(agent.name)!, ...agent, updatedBy: actor, updatedAt: at });
    return true;
  }
  async restore(name: string, version: AgentVersionRecord, audience: CustomAgentRecord["audience"], actor: string) {
    this.agents.set(name, { ...this.agents.get(name)!, audience, version: version.version, files: version.files, updatedBy: actor });
  }
  async setEnabled(name: string, enabled: boolean) {
    const record = this.agents.get(name);
    if (record === undefined) return false;
    record.enabled = enabled;
    return true;
  }
  async remove(name: string) {
    this.history.delete(name);
    return this.agents.delete(name);
  }
  async versions(name: string) {
    return this.history.get(name) ?? [];
  }
  async version(name: string, version: string) {
    return this.history.get(name)?.find((entry) => entry.version === version);
  }
  async listSkills() {
    return [...this.skills.values()];
  }
  async getSkill(name: string) {
    return this.skills.get(name);
  }
  async createSkill(name: string, content: string, files: Record<string, string>, actor: string) {
    if (this.skills.has(name)) return false;
    this.skills.set(name, { name, content, files, createdBy: actor, updatedAt: this.#now() });
    return true;
  }
  async updateSkill(name: string, content: string, files: Record<string, string>, actor: string) {
    if (!this.skills.has(name)) return false;
    this.skills.set(name, { name, content, files, updatedBy: actor, updatedAt: this.#now() });
    return true;
  }
  async removeSkill(name: string) {
    return this.skills.delete(name);
  }
}

const draft = (overrides: Partial<AgentDraft> = {}): AgentDraft => ({
  name: "house-reviewer",
  audience: "runtime",
  version: "1.0.0",
  description: "Reviews code against the house rules.",
  tools: ["read", "grep"],
  skills: [],
  thinking: "medium",
  instructions: "You review code.",
  localSkills: [{ name: "checklist", description: "The checklist.", content: "- cite file:line" }],
  ...overrides,
});

function setup(bindings: AgentModelBinding[] = []) {
  const repository = new MemoryAgents();
  const providers = { listBindings: async () => bindings } as unknown as LlmProvidersService;
  const audit = new MemoryAuditTrail();
  return { repository, audit, service: new AgentsService(repository, new PackagedAgentCatalog(), providers, audit) };
}

async function rejection(promise: Promise<unknown>): Promise<{ type: unknown; messages: string[] }> {
  try {
    await promise;
  } catch (error) {
    const response = (error as BadRequestException).getResponse() as { message: string | string[] };
    return { type: (error as object).constructor, messages: ([] as string[]).concat(response.message) };
  }
  throw new Error("expected a rejection");
}

describe("agents service", () => {
  it("lists built-in agents as valid, read-only and with their binding", async () => {
    const { service } = setup([{ agent: "legacy-analyst", provider: "gateway", model: "m1" }]);
    const list = await service.list();
    expect(list.find((agent) => agent.name === "legacy-analyst")).toMatchObject({ source: "builtin", audience: "runtime", enabled: true, problems: [], binding: { provider: "gateway", model: "m1" } });
    expect(list.find((agent) => agent.name === "scaffolder")).toMatchObject({ source: "builtin", audience: "member" });
    expect((await service.context()).kernelTools).toEqual(KERNEL_TOOL_NAMES);
    expect(await rejection(service.remove("legacy-analyst", admin))).toMatchObject({ type: BadRequestException });
    expect(await rejection(service.setEnabled("legacy-analyst", false, admin))).toMatchObject({ type: BadRequestException });
  });

  it("refuses invalid drafts with every problem, and reserved or taken names", async () => {
    const { service } = setup();
    const format = await rejection(service.create(draft({ name: "Bad Name", version: "one", instructions: "" }), admin));
    expect(format.type).toBe(BadRequestException);
    expect(format.messages.join("\n")).toMatch(/`name` must match[\s\S]*semantic version[\s\S]*instructions \(body\) are empty/);

    const installation = await rejection(service.create(draft({ tools: ["read", "bash"], skills: ["missing"] }), admin));
    expect(installation.messages).toEqual([`unknown tool "bash" (available: ${KERNEL_TOOL_NAMES.join(", ")}, or an MCP tool such as mcp__<server>__*)`, 'unknown shared skill "missing"']);

    expect(await rejection(service.create(draft({ name: "legacy-analyst" }), admin))).toMatchObject({ type: ConflictException });
    await service.create(draft(), admin);
    expect(await rejection(service.create(draft(), admin))).toMatchObject({ type: ConflictException });
    // Member agents name harness tools; they are not checked against the kernel.
    await service.create(draft({ name: "member-writer", audience: "member", tools: ["Read", "Write", "Bash"] }), admin);
  });

  it("previews the job definition of a draft without saving", async () => {
    const { service, repository } = setup();
    const preview = await service.preview(draft());
    expect(preview.problems).toEqual([]);
    expect(preview.definition).toMatchObject({ id: "house-reviewer", version: "1.0.0", tools: ["read", "grep"], skills: [{ name: "checklist" }] });
    expect(Object.keys(preview.files).sort()).toEqual(["house-reviewer.md", "skills/checklist/SKILL.md"]);
    expect((await service.preview(draft({ name: "legacy-analyst", tools: ["bash"] }))).problems).toHaveLength(2);
    expect((await service.preview(draft({ audience: "member" }))).definition).toBeUndefined();
    expect(repository.agents.size).toBe(0);
  });

  it("saves new versions, refuses reused versions and renames, and restores", async () => {
    const { service } = setup();
    await service.create(draft(), admin);
    expect((await service.update("house-reviewer", draft({ version: "1.1.0", instructions: "Version two." }), admin)).version).toBe("1.1.0");
    expect(await rejection(service.update("house-reviewer", draft({ version: "1.1.0" }), admin))).toMatchObject({ type: ConflictException });
    expect(await rejection(service.update("house-reviewer", draft({ name: "renamed", version: "2.0.0" }), admin))).toMatchObject({ type: BadRequestException });
    expect(await rejection(service.update("nobody", draft({ name: "nobody" }), admin))).toMatchObject({ type: NotFoundException });

    expect((await service.versions("house-reviewer")).map((entry) => [entry.version, entry.current])).toEqual([
      ["1.1.0", true],
      ["1.0.0", false],
    ]);
    const restored = await service.restore("house-reviewer", "1.0.0", admin);
    expect(restored).toMatchObject({ version: "1.0.0", instructions: "You review code." });
  });

  it("copies a built-in agent with provenance", async () => {
    const { service } = setup();
    const copy = await service.copy("legacy-analyst", "my-analyst", admin);
    expect(copy).toMatchObject({ name: "my-analyst", source: "custom", problems: [] });
    expect(copy.copiedFrom).toMatch(/^legacy-analyst@/);
    expect(copy.manifest!.metadata!["copied-from"]).toBe(copy.copiedFrom);
    expect(await rejection(service.copy("legacy-analyst", "security-auditor", admin))).toMatchObject({ type: ConflictException });
  });

  it("exports a ZIP and imports files or a ZIP as a new agent or a new version", async () => {
    const { service } = setup();
    await service.create(draft(), admin);
    const exported = await service.export("house-reviewer");
    expect(exported.fileName).toBe("house-reviewer-1.0.0.zip");
    const files = unzipFiles(exported.content);

    const renamed = Object.fromEntries([...files].map(([path, text]) => [path.replace("house-reviewer.md", "other.md"), text.replace("name: house-reviewer", "name: other")]));
    expect(await service.import({ files: renamed }, admin)).toMatchObject({ created: true, agent: { name: "other" } });

    const bumped = new Map([...files].map(([path, text]) => [path, text.replace("version: 1.0.0", "version: 2.0.0")]));
    expect(await service.import({ zip: zipFiles(bumped).toString("base64") }, admin)).toMatchObject({ created: false, agent: { version: "2.0.0" } });
    expect(await rejection(service.import({ zip: Buffer.from("garbage").toString("base64") }, admin))).toMatchObject({ type: BadRequestException });
    expect((await service.export("legacy-analyst")).fileName).toMatch(/^legacy-analyst-/);
  });

  it("keeps the files beside SKILL.md of a custom skill, refuses stray or unsafe ones, and hands them to jobs", async () => {
    const { service } = setup();
    const files = { "references/style.md": "# Style", "scripts/lint.py": "print('x')" };
    const view = await service.createSkill({ name: "house-style", description: "House style.", content: "Write plainly.", files }, admin);
    expect(view.files).toEqual([
      { path: "references/style.md", content: "# Style" },
      { path: "scripts/lint.py", content: "print('x')" },
    ]);
    expect(await rejection(service.createSkill({ name: "bad-one", description: "d", content: "c", files: { "notes.md": "x" } }, admin))).toMatchObject({ type: BadRequestException });
    expect(await rejection(service.createSkill({ name: "bad-two", description: "d", content: "c", files: { "references/../../x": "x" } }, admin))).toMatchObject({ type: BadRequestException });
    expect(await rejection(service.createSkill({ name: "bad-three", description: "d", content: "c", files: { "/references/x.md": "x" } }, admin))).toMatchObject({ type: BadRequestException });
    await service.create(draft({ skills: ["house-style"] }), admin);
    const definition = await service.definition("house-reviewer");
    expect(definition.skills?.[0]).toMatchObject({ name: "house-style", files });
    const updated = await service.updateSkill("house-style", { name: "house-style", description: "House style.", content: "Write plainly.", files: { "references/style.md": "# Style 2" } }, admin);
    expect(updated.files).toEqual([{ path: "references/style.md", content: "# Style 2" }]);
    // An update without `files` keeps them.
    const renamed = await service.updateSkill("house-style", { name: "house-style", description: "New summary.", content: "Write plainly." }, admin);
    expect(renamed.description).toBe("New summary.");
    expect(renamed.files).toEqual([{ path: "references/style.md", content: "# Style 2" }]);
  });

  it("manages shared skills, refuses deleting used ones, and resolves custom agents", async () => {
    const { service, audit } = setup();
    await service.createSkill({ name: "house-style", description: "House style.", content: "Write plainly." }, admin);
    expect(await rejection(service.createSkill({ name: "Bad", description: "", content: "" }, admin))).toMatchObject({ type: BadRequestException });
    await service.create(draft({ skills: ["house-style"] }), admin);
    expect((await service.getSkill("house-style")).usedBy).toEqual(["house-reviewer"]);
    expect(await rejection(service.removeSkill("house-style", admin))).toMatchObject({ type: ConflictException });

    expect(await service.definition("house-reviewer")).toMatchObject({ id: "house-reviewer", skills: [{ name: "house-style", content: "Write plainly." }, { name: "checklist" }] });
    await service.setEnabled("house-reviewer", false, admin);
    expect(await rejection(service.definition("house-reviewer"))).toMatchObject({ type: BadRequestException, messages: ['Agent "house-reviewer" is disabled'] });
    expect(await rejection(service.definition("nobody"))).toMatchObject({ type: NotFoundException });
    expect(await rejection(service.definition("scaffolder"))).toMatchObject({ type: BadRequestException });

    await service.remove("house-reviewer", admin);
    await service.removeSkill("house-style", admin);
    // Only the built-in shared skills remain, used by the built-in agents that draw diagrams and plan.
    expect((await service.listSkills()).map((skill) => [skill.name, skill.source, skill.usedBy])).toEqual([
      ["mermaid-diagrams", "builtin", ["architecture-critic", "business-rules-extractor", "designer", "legacy-analyst"]],
      ["understand-planning", "builtin", ["understand-planner"]],
    ]);

    // Each successful change is audited once; refused ones are not.
    expect(audit.actions()).toEqual(["skill.create", "agent.create", "agent.disable", "agent.delete", "skill.delete"]);
    expect(audit.entries[1]).toMatchObject({ actor: "u-admin", subject: "house-reviewer", detail: { version: "1.0.0", audience: "runtime", username: "admin" } });
  });
});
