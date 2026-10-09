import { Module } from "@nestjs/common";
import { ReviewsController } from "./reviews.controller.js";
import { ReviewsService } from "./reviews.service.js";

/** governance · review & approval — docs/architecture/05-building-block-view.md. */
@Module({ controllers: [ReviewsController], providers: [ReviewsService], exports: [ReviewsService] })
export class ReviewsModule {}
