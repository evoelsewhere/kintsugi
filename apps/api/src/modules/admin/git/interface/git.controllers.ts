// Interface layer: Git servers and repositories (Settings → Git). Thin HTTP adapters —
// validate input, map DTOs to commands, delegate to GitService.

import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from "@nestjs/common";
import { ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Page, PageQuery } from "../../../../common/application/pagination.js";
import { RequirePermission } from "../../../../common/auth/decorators.js";
import { pageQuerySchema } from "../../../../common/interface/pagination.js";
import { GitService, type TestAccessResult } from "../application/git.service.js";
import type { GitRepositoryRecord, GitServerRecord } from "../domain/git.js";
import {
  type CreateGitRepositoryInput,
  type CreateGitServerInput,
  type ReplaceGitServerInput,
  type TestAccessInput,
  createGitRepositorySchema,
  createGitServerSchema,
  replaceGitServerSchema,
  testAccessSchema,
  toServerCommand,
} from "./git.dto.js";

@ApiTags("admin · git")
@Controller("admin/git-servers")
@RequirePermission("git.manage")
export class GitServersController {
  constructor(private readonly git: GitService) {}

  @Get()
  @ApiOperation({ summary: "List Git servers" })
  @ApiOkResponse({ description: "Servers without credentials (hasCredential tells whether one is stored)." })
  list(@Query({ schema: pageQuerySchema }) query: PageQuery): Promise<Page<GitServerRecord>> {
    return this.git.listServers(query);
  }

  @Get(":id")
  @ApiOperation({ summary: "Get one Git server" })
  @ApiOkResponse({ description: "The server, without its credential." })
  get(@Param("id") id: string): Promise<GitServerRecord> {
    return this.git.getServer(id);
  }

  @Post()
  @ApiOperation({ summary: "Register a Git server with its credential (stored encrypted, never returned)" })
  @ApiCreatedResponse({ description: "The registered server." })
  create(@Body({ schema: createGitServerSchema }) input: CreateGitServerInput): Promise<GitServerRecord> {
    const { id, ...fields } = input;
    return this.git.createServer(toServerCommand(id, fields));
  }

  @Patch(":id")
  @ApiOperation({ summary: "Replace a Git server; omit the credential to keep the stored one (same host only)" })
  @ApiOkResponse({ description: "The updated server." })
  replace(@Param("id") id: string, @Body({ schema: replaceGitServerSchema }) input: ReplaceGitServerInput): Promise<GitServerRecord> {
    return this.git.replaceServer(id, toServerCommand(id, input));
  }

  @Delete(":id")
  @HttpCode(204)
  @ApiOperation({ summary: "Remove a Git server that has no repositories" })
  @ApiNoContentResponse({ description: "The server and its credential are removed." })
  async remove(@Param("id") id: string): Promise<void> {
    await this.git.removeServer(id);
  }

  @Post(":id/test")
  @HttpCode(200)
  @ApiOperation({ summary: "Test access: list a repository's branches with the server's credential" })
  @ApiOkResponse({ description: "Whether the repository is reachable, with its default branch." })
  test(@Param("id") id: string, @Body({ schema: testAccessSchema }) input: TestAccessInput): Promise<TestAccessResult> {
    return this.git.testAccess(id, input.url);
  }
}

@ApiTags("admin · git")
@Controller("admin/git-repositories")
@RequirePermission("git.manage")
export class GitRepositoriesController {
  constructor(private readonly git: GitService) {}

  @Get()
  @ApiOperation({ summary: "List registered repositories with their sync status" })
  @ApiOkResponse({ description: "Repositories; the worker clones them into Kintsugi's storage (ADR-0025)." })
  list(@Query({ schema: pageQuerySchema }) query: PageQuery): Promise<Page<GitRepositoryRecord>> {
    return this.git.listRepositories(query);
  }

  @Get(":id")
  @ApiOperation({ summary: "Get one repository" })
  @ApiOkResponse({ description: "The repository with its sync status." })
  get(@Param("id") id: string): Promise<GitRepositoryRecord> {
    return this.git.getRepository(id);
  }

  @Post()
  @ApiOperation({ summary: "Register a repository; it must be reachable with its server's credential" })
  @ApiCreatedResponse({ description: "The repository, pending its first clone." })
  create(@Body({ schema: createGitRepositorySchema }) input: CreateGitRepositoryInput): Promise<GitRepositoryRecord> {
    return this.git.createRepository(input);
  }

  @Delete(":id")
  @HttpCode(204)
  @ApiOperation({ summary: "Remove a repository" })
  @ApiNoContentResponse({ description: "The repository is removed." })
  async remove(@Param("id") id: string): Promise<void> {
    await this.git.removeRepository(id);
  }
}
