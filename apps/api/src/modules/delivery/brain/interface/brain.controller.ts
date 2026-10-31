// The Brain of a project in the portal (ADR-0091). Reads need a session only, as document reads do; choosing the
// branch, rebuilding and turning the index off need `project.brain.manage`.

import { Body, Controller, Get, HttpCode, Param, Post, Put, Query } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { BrainGrepView, BrainLookupView, BrainReadView, BrainStatusView, BrainTreeView } from "@kintsugi/domain";
import { type Actor, CurrentActor, RequirePermission } from "#common/auth/decorators.js";
import { BrainService } from "../application/brain.service.js";
import {
  type BrainConfigureBody,
  type BrainGrepQueryDto,
  type BrainLookupQueryDto,
  type BrainReadQueryDto,
  type BrainTreeQueryDto,
  brainConfigureSchema,
  brainGrepQuerySchema,
  brainLookupQuerySchema,
  brainReadQuerySchema,
  brainTreeQuerySchema,
} from "./brain.dto.js";

/** What the portal shows of a node at once; a member's agent reads less per call. */
const PORTAL_READ_CHARS = 200_000;

@ApiTags("delivery · brain")
@Controller("projects/:id/brain")
export class BrainController {
  constructor(private readonly brain: BrainService) {}

  @Get()
  @ApiOperation({ summary: "The Brain's index state, its branch and the branches it can follow" })
  status(@Param("id") id: string): Promise<BrainStatusView> {
    return this.brain.status(id);
  }

  @Put()
  @RequirePermission("project.brain.manage")
  @ApiOperation({ summary: "Choose the branch the Brain indexes and turn it on or off; an enabled index is built at once" })
  configure(@Param("id") id: string, @Body({ schema: brainConfigureSchema }) body: BrainConfigureBody, @CurrentActor() actor: Actor): Promise<BrainStatusView> {
    return this.brain.configure(id, body, actor);
  }

  @Post("rebuild")
  @HttpCode(202)
  @RequirePermission("project.brain.manage")
  @ApiOperation({ summary: "Build the Brain again from the tip of its branch" })
  rebuild(@Param("id") id: string, @CurrentActor() actor: Actor): Promise<BrainStatusView> {
    return this.brain.rebuild(id, actor);
  }

  @Get("tree")
  @ApiOperation({ summary: "One level of the tree under a node (the root by default), with summaries" })
  tree(@Param("id") id: string, @Query({ schema: brainTreeQuerySchema }) query: BrainTreeQueryDto): Promise<BrainTreeView> {
    return this.brain.tree(id, query);
  }

  @Get("node")
  @ApiOperation({ summary: "A node's text at the indexed commit, its citation, children and links" })
  node(@Param("id") id: string, @Query({ schema: brainReadQuerySchema }) query: BrainReadQueryDto): Promise<BrainReadView> {
    return this.brain.read(id, { ...query, maxChars: PORTAL_READ_CHARS });
  }

  @Get("lookup")
  @ApiOperation({ summary: "The nodes a reference id, node id or repository path names" })
  lookup(@Param("id") id: string, @Query({ schema: brainLookupQuerySchema }) query: BrainLookupQueryDto): Promise<BrainLookupView> {
    return this.brain.lookup(id, query.q);
  }

  @Get("grep")
  @ApiOperation({ summary: "The nodes whose text holds a fixed string" })
  grep(@Param("id") id: string, @Query({ schema: brainGrepQuerySchema }) query: BrainGrepQueryDto): Promise<BrainGrepView> {
    return this.brain.grep(id, query);
  }
}
