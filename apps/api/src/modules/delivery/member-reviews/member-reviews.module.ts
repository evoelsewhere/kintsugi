import { Module } from "@nestjs/common";
import { GitModule } from "#modules/admin/git/index.js";
import { ProjectAccessModule } from "#modules/admin/project-access/index.js";
import { GitHubWebhookService } from "./application/github-webhook.js";
import { MemberAssociationService } from "./application/member-association.service.js";
import { ReviewQueryService } from "./application/review-query.service.js";
import { ProviderDeliveryRepository } from "./domain/provider-delivery.js";
import { MemberAssociationRepository } from "./domain/member-association.js";
import { ReviewReadRepository } from "./domain/review-read.repository.js";
import { GitHubProviderWebhookController } from "./interface/github-webhook.controller.js";
import { MemberAssociationController } from "./interface/member-association.controller.js";
import { PgProviderDeliveryRepository } from "./infrastructure/pg-provider-delivery.repository.js";
import { PgMemberAssociationRepository } from "./infrastructure/pg-member-association.repository.js";
import { PgReviewReader } from "./infrastructure/pg-review.reader.js";

@Module({
  imports: [GitModule, ProjectAccessModule],
  controllers: [GitHubProviderWebhookController, MemberAssociationController],
  providers: [
    GitHubWebhookService,
    MemberAssociationService,
    ReviewQueryService,
    PgProviderDeliveryRepository,
    PgMemberAssociationRepository,
    PgReviewReader,
    { provide: ProviderDeliveryRepository, useExisting: PgProviderDeliveryRepository },
    { provide: MemberAssociationRepository, useExisting: PgMemberAssociationRepository },
    { provide: ReviewReadRepository, useExisting: PgReviewReader },
  ],
  exports: [ReviewQueryService],
})
export class MemberReviewsModule {}
