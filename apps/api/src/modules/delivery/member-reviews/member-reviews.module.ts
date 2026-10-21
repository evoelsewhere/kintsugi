import { Module } from "@nestjs/common";
import { GitModule } from "#modules/admin/git/index.js";
import { ProjectAccessModule } from "#modules/admin/project-access/index.js";
import { GitHubWebhookService } from "./application/github-webhook.js";
import { MemberAssociationService } from "./application/member-association.service.js";
import { ProviderDeliveryRepository } from "./domain/provider-delivery.js";
import { MemberAssociationRepository } from "./domain/member-association.js";
import { GitHubProviderWebhookController } from "./interface/github-webhook.controller.js";
import { MemberAssociationController } from "./interface/member-association.controller.js";
import { PgProviderDeliveryRepository } from "./infrastructure/pg-provider-delivery.repository.js";
import { PgMemberAssociationRepository } from "./infrastructure/pg-member-association.repository.js";

@Module({
  imports: [GitModule, ProjectAccessModule],
  controllers: [GitHubProviderWebhookController, MemberAssociationController],
  providers: [
    GitHubWebhookService,
    MemberAssociationService,
    PgProviderDeliveryRepository,
    PgMemberAssociationRepository,
    { provide: ProviderDeliveryRepository, useExisting: PgProviderDeliveryRepository },
    { provide: MemberAssociationRepository, useExisting: PgMemberAssociationRepository },
  ],
})
export class MemberReviewsModule {}
