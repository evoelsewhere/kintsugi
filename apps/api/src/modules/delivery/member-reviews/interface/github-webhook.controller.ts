import { BadRequestException, Controller, Headers, HttpCode, Param, Post, Req } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { SignedWebhook } from "#common/auth/decorators.js";
import { GitHubWebhookService } from "../application/github-webhook.js";

@ApiTags("provider webhooks")
@Controller("webhooks/github")
export class GitHubProviderWebhookController {
  constructor(private readonly webhooks: GitHubWebhookService) {}

  @Post(":serverId")
  @SignedWebhook()
  @HttpCode(202)
  @ApiOperation({ summary: "Accept a signed GitHub change notification into the durable provider inbox" })
  accept(
    @Param("serverId") serverId: string,
    @Headers("x-github-delivery") deliveryId: string | undefined,
    @Headers("x-github-event") eventName: string | undefined,
    @Headers("x-hub-signature-256") signature: string | undefined,
    @Req() request: Request,
  ) {
    if (!Buffer.isBuffer(request.body)) throw new BadRequestException("GitHub webhook request body was not captured as raw bytes");
    return this.webhooks.accept({ serverId, deliveryId, eventName, signature, rawBody: request.body });
  }
}
