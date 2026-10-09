// Wiring of the reviews module: interface + application + the
// infrastructure adapter bound to the domain port.

import { Module } from "@nestjs/common";
import { ReviewsService } from "./application/reviews.service.js";
import { ReviewRepository } from "./domain/review.repository.js";
import { InMemoryReviewRepository } from "./infrastructure/in-memory-review.repository.js";
import { ReviewsController } from "./interface/reviews.controller.js";

/** governance · review & approval — docs/architecture/05-building-block-view.md. */
@Module({
  controllers: [ReviewsController],
  providers: [ReviewsService, { provide: ReviewRepository, useClass: InMemoryReviewRepository }],
  exports: [ReviewsService, ReviewRepository],
})
export class ReviewsModule {}
