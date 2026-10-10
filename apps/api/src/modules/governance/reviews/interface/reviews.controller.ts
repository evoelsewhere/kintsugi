// Interface layer: thin HTTP adapter — validates input, maps DTOs to application
// commands, delegates to the use cases. No business logic here.

import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from "@nestjs/common";
import { ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { RequirePermission } from "../../../../common/auth/decorators.js";
import type { Review } from "../domain/review.js";
import { ReviewsService } from "../application/reviews.service.js";
import {
  type CreateReviewInput,
  createReviewSchema,
  type UpdateReviewInput,
  updateReviewSchema,
  toCreateCommand,
  toUpdateCommand,
} from "./review.dto.js";

@ApiTags("governance · review & approval")
@Controller("governance/reviews")
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Get()
  @ApiOperation({ summary: "List reviews" })
  @ApiOkResponse({ description: "The matching records." })
  list(): Promise<Review[]> {
    return this.reviews.list();
  }

  @Get(":id")
  @ApiOperation({ summary: "Get one review" })
  @ApiOkResponse({ description: "The record." })
  get(@Param("id") id: string): Promise<Review> {
    return this.reviews.get(id);
  }

  @RequirePermission("governance.manage")
  @Post()
  @ApiOperation({ summary: "Create a review" })
  @ApiCreatedResponse({ description: "The created record." })
  create(@Body({ schema: createReviewSchema }) input: CreateReviewInput): Promise<Review> {
    return this.reviews.create(toCreateCommand(input));
  }

  @RequirePermission("governance.manage")
  @Patch(":id")
  @ApiOperation({ summary: "Update a review" })
  @ApiOkResponse({ description: "The updated record." })
  update(@Param("id") id: string, @Body({ schema: updateReviewSchema }) input: UpdateReviewInput): Promise<Review> {
    return this.reviews.update(id, toUpdateCommand(input));
  }

  @RequirePermission("governance.manage")
  @Delete(":id")
  @HttpCode(204)
  @ApiOperation({ summary: "Delete a review" })
  @ApiNoContentResponse({ description: "The record is deleted." })
  async remove(@Param("id") id: string): Promise<void> {
    await this.reviews.remove(id);
  }
}
