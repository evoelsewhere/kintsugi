// Publishing a draft (ADR-0098): Project Access on the project, as every project route, and `wiki.write` and the page's
// restrictions, which the service checks (a refusal is audited there).

import { Body, Controller, HttpCode, Param, Post, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { type Actor, CurrentActor } from "#common/auth/decorators.js";
import { ProjectAccessGuard } from "#modules/admin/project-access/index.js";
import { type WikiDeleteResult, WikiDeleteService } from "../application/wiki-delete.service.js";
import { WikiPublishService } from "../application/wiki-publish.service.js";
import type { WikiPublishResult } from "../domain/wiki.js";
import { type DeletePageBody, type PublishBody, deletePageSchema, publishSchema } from "./wiki.dto.js";

@ApiTags("delivery · wiki")
@Controller("projects/:id/wiki")
@UseGuards(ProjectAccessGuard)
export class WikiPublishController {
  constructor(
    private readonly publishing: WikiPublishService,
    private readonly deleting: WikiDeleteService,
  ) {}

  @Post("publish")
  @HttpCode(200)
  @ApiOperation({
    summary: "Publish the caller's draft of a page: a pull request, or the default branch where the manifest allows it",
    description:
      "unchanged: the draft equals the page. published: a write was queued. merge-preview: the page moved since the draft started and the merge is clean; nothing was written; send the same request with mergedFrom = the head of the preview to publish it. 409 details.code: conflict (the three texts and the regions; resolve and send resolvedText with mergedFrom), open-write (the page has a write open), draft-revision.",
  })
  publish(@Param("id") id: string, @Body({ schema: publishSchema }) body: PublishBody, @CurrentActor() actor: Actor): Promise<WikiPublishResult> {
    return this.publishing.publish(id, actor, body);
  }

  @Post("delete")
  @HttpCode(200)
  @ApiOperation({
    summary: "Delete a page: one write that removes the file and its name from the folder's order list, by pull request or directly",
    description: "The answer carries brokenLinks, the number of links into the page that will be left broken; a page with a write open is a 409 open-write.",
  })
  delete(@Param("id") id: string, @Body({ schema: deletePageSchema }) body: DeletePageBody, @CurrentActor() actor: Actor): Promise<WikiDeleteResult> {
    return this.deleting.delete(id, actor, body);
  }
}
