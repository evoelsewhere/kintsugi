// Port of Reviews — the DI token of this module (shared kernel: common/domain/repository.ts).

import { Repository } from "../../../../common/domain/repository.js";
import type { CreateReview, Review } from "./review.js";

export abstract class ReviewRepository extends Repository<Review, CreateReview> {}
