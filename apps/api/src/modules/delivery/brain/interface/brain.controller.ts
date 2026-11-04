// The Brain of a project in the portal (ADR-0091). Every route needs Project Access on the project, as document reads
// do (ADR-0099 decision 4); choosing the branch, rebuilding and turning the index off need `project.brain.manage` too.

import { Body, Controller, Get, HttpCode, Param, Post, Put, Query, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { BrainBacklinksView, BrainBrokenView, BrainChangesView, BrainGrepView, BrainLookupView, BrainReadView, BrainStatusView, BrainTreeView } from "@kintsugi/domain";
import { type Actor, CurrentActor, RequirePermission } from "#common/auth/decorators.js";
import { ProjectAccessGuard } from "#modules/admin/project-access/index.js";
import { BrainService } from "../application/brain.service.js";
import type { BrainSearchView } from "../domain/brain.search.js";
import {
  type BrainBacklinksQueryDto,
  type BrainChangesQueryDto,
  type BrainConfigureBody,
  type BrainGrepQueryDto,
  type BrainLookupQueryDto,
  type BrainReadQueryDto,
  type BrainSearchQueryDto,
  type BrainTreeQueryDto,
  brainBacklinksQuerySchema,
  brainChangesQuerySchema,
  brainConfigureSchema,
  brainGrepQuerySchema,
  brainLookupQuerySchema,
  brainReadQuerySchema,
  brainSearchQuerySchema,
  brainTreeQuerySchema,
} from "./brain.dto.js";

/** What the portal shows of a node at once; a member's agent reads less per call. */
const PORTAL_READ_CHARS = 200_000;

@ApiTags("delivery · brain")
@Controller("projects/:id/brain")
@UseGuards(ProjectAccessGuard)
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

  @Get("backlinks")
  @ApiOperation({ summary: "The pages that link to a page, a heading or a card, a window of them in path order" })
  backlinks(@Param("id") id: string, @Query({ schema: brainBacklinksQuerySchema }) query: BrainBacklinksQueryDto): Promise<BrainBacklinksView> {
    return this.brain.backlinks(id, query);
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

  @Get("search")
  @ApiOperation({
    summary: "Ranked search of the indexed pages: the nodes that best answer the words, each with its breadcrumb, summary, matching line and citation",
    description:
      "The words are searched in titles, headings, labels and text (the simple configuration: no stemming, no stop words); websearch syntax (quotes, -, or) is understood and odd syntax never fails. Best first, ties by path. Archived pages and templates are left out and counted in leftOut unless archived=true. limit is at most 20. For people in the portal only: the member API and the MCP bridge do not offer it.",
  })
  search(@Param("id") id: string, @Query({ schema: brainSearchQuerySchema }) query: BrainSearchQueryDto): Promise<BrainSearchView> {
    return this.brain.search(id, query);
  }

  @Get("broken")
  @ApiOperation({ summary: "The links of the indexed documents to Markdown files the repository does not have" })
  broken(@Param("id") id: string): Promise<BrainBrokenView> {
    return this.brain.broken(id);
  }

  @Get("changes")
  @ApiOperation({ summary: "What changed in the indexed documents since an earlier commit, by document and by section" })
  changes(@Param("id") id: string, @Query({ schema: brainChangesQuerySchema }) query: BrainChangesQueryDto): Promise<BrainChangesView> {
    return this.brain.changes(id, query);
  }
}
