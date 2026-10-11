// Interface layer: Administration → Agents (the Agent Builder, ADR-0026). Reading the
// catalog needs a session; every change needs agents.manage. Model bindings stay on the
// LLM provider endpoints (providers.manage) and are shown on the agent detail.

import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query, Res } from "@nestjs/common";
import { ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiProduces, ApiTags } from "@nestjs/swagger";
import type { AgentDefinition } from "@kintsugi/runtime-sdk";
import type { Response } from "express";
import { type Actor, CurrentActor, RequirePermission } from "#common/auth/decorators.js";
import { AgentsService } from "../application/agents.service.js";
import type { AgentBuilderContext, AgentDetail, AgentPreview, AgentSummary, AgentVersionDetail, AgentVersionView, SharedSkillView } from "../domain/agent.js";
import {
  type AgentDraftInput,
  agentDraftSchema,
  type CopyAgentInput,
  copyAgentSchema,
  type ExportQuery,
  exportQuerySchema,
  type ImportAgentInput,
  importAgentSchema,
  type SetEnabledInput,
  setEnabledSchema,
  skillDraftSchema,
  toDraft,
  toImport,
  toSkillDraft,
} from "./agent.dto.js";
import type { z } from "zod";

const MANAGE = "agents.manage";
const actorName = (actor: Actor): string => actor.username ?? actor.id;

@ApiTags("admin · agents")
@Controller("admin/agents")
export class AgentsController {
  constructor(private readonly agents: AgentsService) {}

  @Get()
  @ApiOperation({ summary: "List built-in and custom agents with audience, version, validity and model binding" })
  @ApiOkResponse({ description: "The agent catalog." })
  list(): Promise<AgentSummary[]> {
    return this.agents.list();
  }

  @Get("context")
  @ApiOperation({ summary: "Kernel tools, shared skills and reserved names for the editor" })
  @ApiOkResponse({ description: "The editor context." })
  context(): Promise<AgentBuilderContext> {
    return this.agents.context();
  }

  @Post("preview")
  @HttpCode(200)
  @RequirePermission(MANAGE)
  @ApiOperation({ summary: "Validate a draft and show the job definition it would produce (dry run, nothing is saved)" })
  @ApiOkResponse({ description: "The problems, the package files and, for valid runtime agents, the AgentDefinition." })
  preview(@Body({ schema: agentDraftSchema }) input: AgentDraftInput): Promise<AgentPreview> {
    return this.agents.preview(toDraft(input));
  }

  @Post("import")
  @RequirePermission(MANAGE)
  @ApiOperation({ summary: "Import a package (files, or a base64 ZIP): a new agent or a new version of a custom one" })
  @ApiCreatedResponse({ description: "Whether it was created, and the agent." })
  import(@Body({ schema: importAgentSchema }) input: ImportAgentInput, @CurrentActor() actor: Actor): Promise<{ created: boolean; agent: AgentDetail }> {
    return this.agents.import(toImport(input), actorName(actor));
  }

  @Post()
  @RequirePermission(MANAGE)
  @ApiOperation({ summary: "Create a custom agent" })
  @ApiCreatedResponse({ description: "The created agent." })
  create(@Body({ schema: agentDraftSchema }) input: AgentDraftInput, @CurrentActor() actor: Actor): Promise<AgentDetail> {
    return this.agents.create(toDraft(input), actorName(actor));
  }

  @Get(":name")
  @ApiOperation({ summary: "Get an agent: manifest, instructions, skills, package files and model bindings" })
  @ApiOkResponse({ description: "The agent." })
  get(@Param("name") name: string): Promise<AgentDetail> {
    return this.agents.get(name);
  }

  @Put(":name")
  @RequirePermission(MANAGE)
  @ApiOperation({ summary: "Save a custom agent as a new version" })
  @ApiOkResponse({ description: "The agent at its new version." })
  update(@Param("name") name: string, @Body({ schema: agentDraftSchema }) input: AgentDraftInput, @CurrentActor() actor: Actor): Promise<AgentDetail> {
    return this.agents.update(name, toDraft(input), actorName(actor));
  }

  @Patch(":name")
  @RequirePermission(MANAGE)
  @ApiOperation({ summary: "Enable or disable a custom agent" })
  @ApiOkResponse({ description: "The agent." })
  setEnabled(@Param("name") name: string, @Body({ schema: setEnabledSchema }) input: SetEnabledInput, @CurrentActor() actor: Actor): Promise<AgentDetail> {
    return this.agents.setEnabled(name, input.enabled, actorName(actor));
  }

  @Delete(":name")
  @HttpCode(204)
  @RequirePermission(MANAGE)
  @ApiOperation({ summary: "Delete a custom agent and its versions" })
  @ApiNoContentResponse({ description: "The agent is deleted." })
  async remove(@Param("name") name: string): Promise<void> {
    await this.agents.remove(name);
  }

  @Post(":name/copy")
  @RequirePermission(MANAGE)
  @ApiOperation({ summary: "Copy a built-in or custom agent into a new custom agent" })
  @ApiCreatedResponse({ description: "The new agent." })
  copy(@Param("name") name: string, @Body({ schema: copyAgentSchema }) input: CopyAgentInput, @CurrentActor() actor: Actor): Promise<AgentDetail> {
    return this.agents.copy(name, input.name, actorName(actor));
  }

  @Get(":name/definition")
  @ApiOperation({ summary: "The AgentDefinition a job would embed for this agent (runtime agents)" })
  @ApiOkResponse({ description: "The job definition." })
  definition(@Param("name") name: string): Promise<AgentDefinition> {
    return this.agents.definition(name);
  }

  @Get(":name/export")
  @ApiProduces("application/zip")
  @ApiOperation({ summary: "Export the package as a ZIP (current version, or ?version=)" })
  @ApiOkResponse({ description: "The ZIP archive." })
  async export(@Param("name") name: string, @Query({ schema: exportQuerySchema }) query: ExportQuery, @Res() response: Response): Promise<void> {
    const { fileName, content } = await this.agents.export(name, query.version);
    response.setHeader("content-type", "application/zip");
    response.setHeader("content-disposition", `attachment; filename="${fileName}"`);
    response.send(content);
  }

  @Get(":name/versions")
  @ApiOperation({ summary: "Version history of a custom agent, newest first" })
  @ApiOkResponse({ description: "The versions." })
  versions(@Param("name") name: string): Promise<AgentVersionView[]> {
    return this.agents.versions(name);
  }

  @Get(":name/versions/:version")
  @ApiOperation({ summary: "One recorded version with its package files" })
  @ApiOkResponse({ description: "The version." })
  version(@Param("name") name: string, @Param("version") version: string): Promise<AgentVersionDetail> {
    return this.agents.version(name, version);
  }

  @Post(":name/versions/:version/restore")
  @HttpCode(200)
  @RequirePermission(MANAGE)
  @ApiOperation({ summary: "Make a recorded version current again" })
  @ApiOkResponse({ description: "The agent at the restored version." })
  restore(@Param("name") name: string, @Param("version") version: string, @CurrentActor() actor: Actor): Promise<AgentDetail> {
    return this.agents.restore(name, version, actorName(actor));
  }
}

type SkillDraftInput = z.infer<typeof skillDraftSchema>;

/** Shared skills referenced by name from agents' `skills:` lists. */
@ApiTags("admin · agents")
@Controller("admin/agent-skills")
export class AgentSkillsController {
  constructor(private readonly agents: AgentsService) {}

  @Get()
  @ApiOperation({ summary: "List built-in and custom shared skills with the agents that use them" })
  @ApiOkResponse({ description: "The shared skills." })
  list(): Promise<SharedSkillView[]> {
    return this.agents.listSkills();
  }

  @Get(":name")
  @ApiOperation({ summary: "Get a shared skill" })
  @ApiOkResponse({ description: "The skill." })
  get(@Param("name") name: string): Promise<SharedSkillView> {
    return this.agents.getSkill(name);
  }

  @Post()
  @RequirePermission(MANAGE)
  @ApiOperation({ summary: "Create a custom shared skill" })
  @ApiCreatedResponse({ description: "The skill." })
  create(@Body({ schema: skillDraftSchema }) input: SkillDraftInput, @CurrentActor() actor: Actor): Promise<SharedSkillView> {
    return this.agents.createSkill(toSkillDraft(input), actorName(actor));
  }

  @Put(":name")
  @RequirePermission(MANAGE)
  @ApiOperation({ summary: "Replace a custom shared skill (agents that use it pick it up at their next job)" })
  @ApiOkResponse({ description: "The skill." })
  update(@Param("name") name: string, @Body({ schema: skillDraftSchema }) input: SkillDraftInput, @CurrentActor() actor: Actor): Promise<SharedSkillView> {
    return this.agents.updateSkill(name, toSkillDraft(input), actorName(actor));
  }

  @Delete(":name")
  @HttpCode(204)
  @RequirePermission(MANAGE)
  @ApiOperation({ summary: "Delete a custom shared skill no agent uses" })
  @ApiNoContentResponse({ description: "The skill is deleted." })
  async remove(@Param("name") name: string): Promise<void> {
    await this.agents.removeSkill(name);
  }
}
