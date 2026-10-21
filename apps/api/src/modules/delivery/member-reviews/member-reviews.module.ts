import { Module } from "@nestjs/common";
import { GitModule } from "#modules/admin/git/index.js";
import { GitHubWebhookService } from "./application/github-webhook.js";
import { ProviderDeliveryRepository } from "./domain/provider-delivery.js";
import { GitHubProviderWebhookController } from "./interface/github-webhook.controller.js";
import { PgProviderDeliveryRepository } from "./infrastructure/pg-provider-delivery.repository.js";

@Module({
  imports: [GitModule],
  controllers: [GitHubProviderWebhookController],
  providers: [
    GitHubWebhookService,
    PgProviderDeliveryRepository,
    { provide: ProviderDeliveryRepository, useExisting: PgProviderDeliveryRepository },
  ],
})
export class MemberReviewsModule {}
