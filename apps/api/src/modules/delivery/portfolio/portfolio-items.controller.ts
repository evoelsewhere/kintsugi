import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from "@nestjs/common";
import { ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { PortfolioItemsService } from "./portfolio-items.service.js";
import {
  type CreatePortfolioItemInput,
  createPortfolioItemSchema,
  type UpdatePortfolioItemInput,
  updatePortfolioItemSchema,
  type PortfolioItem,
} from "./portfolio-item.dto.js";

@ApiTags("delivery · portfolio & assessment")
@Controller("delivery/portfolio")
export class PortfolioItemsController {
  constructor(private readonly portfolioItems: PortfolioItemsService) {}

  @Get()
  @ApiOperation({ summary: "List portfolio items" })
  @ApiOkResponse({ description: "The matching portfolio-item records." })
  list(): Promise<PortfolioItem[]> {
    return this.portfolioItems.list();
  }

  @Get(":id")
  @ApiOperation({ summary: "Get one portfolio-item" })
  @ApiOkResponse({ description: "The portfolio-item." })
  get(@Param("id") id: string): Promise<PortfolioItem> {
    return this.portfolioItems.get(id);
  }

  @Post()
  @ApiOperation({ summary: "Create a portfolio-item" })
  @ApiCreatedResponse({ description: "The created portfolio-item." })
  create(@Body({ schema: createPortfolioItemSchema }) input: CreatePortfolioItemInput): Promise<PortfolioItem> {
    return this.portfolioItems.create(input);
  }

  @Patch(":id")
  @ApiOperation({ summary: "Update a portfolio-item" })
  @ApiOkResponse({ description: "The updated portfolio-item." })
  update(@Param("id") id: string, @Body({ schema: updatePortfolioItemSchema }) input: UpdatePortfolioItemInput): Promise<PortfolioItem> {
    return this.portfolioItems.update(id, input);
  }

  @Delete(":id")
  @HttpCode(204)
  @ApiOperation({ summary: "Delete a portfolio-item" })
  @ApiNoContentResponse({ description: "The portfolio-item is deleted." })
  async remove(@Param("id") id: string): Promise<void> {
    await this.portfolioItems.remove(id);
  }
}
