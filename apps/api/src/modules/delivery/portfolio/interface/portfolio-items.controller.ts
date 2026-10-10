// Interface layer: thin HTTP adapter — validates input, maps DTOs to application
// commands, delegates to the use cases. No business logic here.

import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from "@nestjs/common";
import { ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { RequirePermission } from "../../../../common/auth/decorators.js";
import type { PortfolioItem } from "../domain/portfolio-item.js";
import { PortfolioItemsService } from "../application/portfolio-items.service.js";
import {
  type CreatePortfolioItemInput,
  createPortfolioItemSchema,
  type UpdatePortfolioItemInput,
  updatePortfolioItemSchema,
  toCreateCommand,
  toUpdateCommand,
} from "./portfolio-item.dto.js";

@ApiTags("delivery · portfolio & assessment")
@Controller("delivery/portfolio")
export class PortfolioItemsController {
  constructor(private readonly portfolioItems: PortfolioItemsService) {}

  @Get()
  @ApiOperation({ summary: "List portfolio items" })
  @ApiOkResponse({ description: "The matching records." })
  list(): Promise<PortfolioItem[]> {
    return this.portfolioItems.list();
  }

  @Get(":id")
  @ApiOperation({ summary: "Get one portfolio item" })
  @ApiOkResponse({ description: "The record." })
  get(@Param("id") id: string): Promise<PortfolioItem> {
    return this.portfolioItems.get(id);
  }

  @RequirePermission("workitems.manage")
  @Post()
  @ApiOperation({ summary: "Create a portfolio item" })
  @ApiCreatedResponse({ description: "The created record." })
  create(@Body({ schema: createPortfolioItemSchema }) input: CreatePortfolioItemInput): Promise<PortfolioItem> {
    return this.portfolioItems.create(toCreateCommand(input));
  }

  @RequirePermission("workitems.manage")
  @Patch(":id")
  @ApiOperation({ summary: "Update a portfolio item" })
  @ApiOkResponse({ description: "The updated record." })
  update(@Param("id") id: string, @Body({ schema: updatePortfolioItemSchema }) input: UpdatePortfolioItemInput): Promise<PortfolioItem> {
    return this.portfolioItems.update(id, toUpdateCommand(input));
  }

  @RequirePermission("workitems.manage")
  @Delete(":id")
  @HttpCode(204)
  @ApiOperation({ summary: "Delete a portfolio item" })
  @ApiNoContentResponse({ description: "The record is deleted." })
  async remove(@Param("id") id: string): Promise<void> {
    await this.portfolioItems.remove(id);
  }
}
