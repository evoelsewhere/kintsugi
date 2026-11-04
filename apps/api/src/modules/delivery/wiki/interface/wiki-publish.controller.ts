// Publishing a draft (ADR-0098): Project Access on the project, as every project route, and `wiki.write` and the page's
// restrictions, which the service checks (a refusal is audited there).

import { Body, Controller, HttpCode, Param, Post, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { type Actor, CurrentActor } from "#common/auth/decorators.js";
import { ProjectAccessGuard } from "#modules/admin/project-access/index.js";
import { WikiPublishService } from "../application/wiki-publish.service.js";
import type { WikiPublishResult } from "../domain/wiki.js";
import { type PublishBody, publishSchema } from "./wiki.dto.js";

@ApiTags("delivery · wiki")
@Controller("projects/:id/wiki/publish")
@UseGuards(ProjectAccessGuard)
export class WikiPublishController {
  constructor(private readonly publishing: WikiPublishService) {}

  @Post()
  @HttpCode(200)
  @ApiOperation({
    summary: "Publish the caller's draft of a page: a pull request, or the default branch where the manifest allows it",
    description:
      "unchanged: the draft equals the page. published: a write was queued. merge-preview: the page moved since the draft started and the merge is clean; nothing was written; send the same request with mergedFrom = the head of the preview to publish it. 409 details.code: conflict (the three texts and the regions; resolve and send resolvedText with mergedFrom), open-write (the page has a write open), draft-revision.",
  })
  publish(@Param("id") id: string, @Body({ schema: publishSchema }) body: PublishBody, @CurrentActor() actor: Actor): Promise<WikiPublishResult> {
    return this.publishing.publish(id, actor, body);
  }
}
