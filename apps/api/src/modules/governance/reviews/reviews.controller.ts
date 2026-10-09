import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from "@nestjs/common";
import { ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { ReviewsService } from "./reviews.service.js";
import {
  type CreateReviewInput,
  createReviewSchema,
  type UpdateReviewInput,
  updateReviewSchema,
  type Review,
} from "./review.dto.js";

@ApiTags("governance · review & approval")
@Controller("governance/reviews")
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Get()
  @ApiOperation({ summary: "List reviews" })
  @ApiOkResponse({ description: "The matching review records." })
  list(): Promise<Review[]> {
    return this.reviews.list();
  }

  @Get(":id")
  @ApiOperation({ summary: "Get one review" })
  @ApiOkResponse({ description: "The review." })
  get(@Param("id") id: string): Promise<Review> {
    return this.reviews.get(id);
  }

  @Post()
  @ApiOperation({ summary: "Create a review" })
  @ApiCreatedResponse({ description: "The created review." })
  create(@Body({ schema: createReviewSchema }) input: CreateReviewInput): Promise<Review> {
    return this.reviews.create(input);
  }

  @Patch(":id")
  @ApiOperation({ summary: "Update a review" })
  @ApiOkResponse({ description: "The updated review." })
  update(@Param("id") id: string, @Body({ schema: updateReviewSchema }) input: UpdateReviewInput): Promise<Review> {
    return this.reviews.update(id, input);
  }

  @Delete(":id")
  @HttpCode(204)
  @ApiOperation({ summary: "Delete a review" })
  @ApiNoContentResponse({ description: "The review is deleted." })
  async remove(@Param("id") id: string): Promise<void> {
    await this.reviews.remove(id);
  }
}
