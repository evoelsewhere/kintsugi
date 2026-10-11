// Application layer: use cases of Reviews. Extends the shared CRUD kernel
// (common/application/crud.service.ts) — add module-specific use cases here.

import { Injectable } from "@nestjs/common";
import { CrudService } from "#common/application/crud.service.js";
import type { CreateReview, Review } from "../domain/review.js";
import { ReviewRepository } from "../domain/review.repository.js";

export type UpdateReview = Partial<CreateReview>;

@Injectable()
export class ReviewsService extends CrudService<Review, CreateReview> {
  constructor(items: ReviewRepository) {
    super(items, "Review");
  }
}
