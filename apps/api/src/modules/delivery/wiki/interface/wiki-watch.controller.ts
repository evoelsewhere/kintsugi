// Watches (ADR-0099 decision 3): a person's own list of pages, folders and spaces they want to hear about. Project Access
// on the project, as every project route; no permission code: they are the caller's, and nobody else's are reachable.

import { Body, Controller, Delete, Get, HttpCode, Param, Put, Query, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { type Actor, CurrentActor } from "#common/auth/decorators.js";
import { ProjectAccessGuard } from "#modules/admin/project-access/index.js";
import { WikiWatchService } from "../application/wiki-watch.service.js";
import type { WikiPageWatch, WikiWatchView } from "../domain/wiki.js";
import { type WatchBody, type WatchQuery, type WatchesQuery, watchQuerySchema, watchSchema, watchesQuerySchema } from "./wiki.dto.js";

@ApiTags("delivery · wiki")
@Controller("projects/:id/wiki/watches")
@UseGuards(ProjectAccessGuard)
export class WikiWatchController {
  constructor(private readonly watches: WikiWatchService) {}

  @Get()
  @ApiOperation({
    summary: "The caller's watches in the project, or with ?path= whether that page is watched, directly or through a folder or space",
    description: "A watch lists its scopeKind (page, folder or space), the target as stored (a page id, path:<path>, a folder path or a space key) and the path and title the Brain gives it. With ?path= the answer is { path, watched, direct, via }.",
  })
  list(@Param("id") id: string, @Query({ schema: watchesQuerySchema }) query: WatchesQuery, @CurrentActor() actor: Actor): Promise<WikiWatchView[] | WikiPageWatch> {
    return query.path === undefined ? this.watches.list(id, actor) : this.watches.ofPage(id, actor, query.path);
  }

  @Put()
  @ApiOperation({
    summary: "Watch a page (by path or id), a folder or a space",
    description: "A page with an id is watched by its id, so a move keeps the watch. 400 for a folder or space the wiki does not know; 409 at 500 watches. Watching what is watched already is not an error.",
  })
  watch(@Param("id") id: string, @Body({ schema: watchSchema }) body: WatchBody, @CurrentActor() actor: Actor): Promise<WikiWatchView> {
    return this.watches.watch(id, actor, body);
  }

  @Delete()
  @HttpCode(204)
  @ApiOperation({ summary: "Stop watching (404 when the caller did not watch it)" })
  async unwatch(@Param("id") id: string, @Query({ schema: watchQuerySchema }) query: WatchQuery, @CurrentActor() actor: Actor): Promise<void> {
    await this.watches.unwatch(id, actor, query);
  }
}
