// Attachments of a draft (ADR-0098 decisions 2 and 9): every route needs Project Access, and acts on the caller's own
// draft only; adding and removing also need `wiki.write`, which the service checks.

import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query, Res, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiProduces, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { type Actor, CurrentActor } from "#common/auth/decorators.js";
import { ProjectAccessGuard } from "#modules/admin/project-access/index.js";
import { WikiAttachmentService } from "../application/wiki-attachment.service.js";
import type { WikiAttachmentView } from "../domain/wiki.js";
import { type AttachBody, type AttachmentQuery, type WikiPathQuery, attachSchema, attachmentQuerySchema, wikiPathQuerySchema } from "./wiki.dto.js";

@ApiTags("delivery · wiki")
@Controller("projects/:id/wiki/draft/attachments")
@UseGuards(ProjectAccessGuard)
export class WikiAttachmentController {
  constructor(private readonly attachments: WikiAttachmentService) {}

  @Post()
  @ApiOperation({
    summary: "Keep a file or image for the caller's draft of a page; it is published with the page",
    description:
      "JSON { path, name, contentType, contentBase64 }; png, jpg, jpeg, gif, webp or pdf only (never SVG), the bytes must be that type, at most 5 MiB a file and 20 MiB a draft. The name is made safe and unique and the answer holds the final one and the Markdown to insert. The body may be 8 MB.",
  })
  add(@Param("id") id: string, @Body({ schema: attachSchema }) body: AttachBody, @CurrentActor() actor: Actor): Promise<WikiAttachmentView> {
    return this.attachments.add(id, actor, body);
  }

  @Get()
  @ApiOperation({ summary: "The files kept for the caller's draft of a page" })
  list(@Param("id") id: string, @Query({ schema: wikiPathQuerySchema }) query: WikiPathQuery, @CurrentActor() actor: Actor): Promise<WikiAttachmentView[]> {
    return this.attachments.list(id, actor, query.path);
  }

  @Delete()
  @HttpCode(204)
  @ApiOperation({ summary: "Remove a file from the caller's draft of a page" })
  async remove(@Param("id") id: string, @Query({ schema: attachmentQuerySchema }) query: AttachmentQuery, @CurrentActor() actor: Actor): Promise<void> {
    await this.attachments.remove(id, actor, query.path, query.name);
  }

  @Get("file")
  @ApiProduces("image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf")
  @ApiOperation({
    summary: "The bytes of a file of the caller's own draft, for the editor's preview",
    description: "The content type is the one stored, never sniffed (X-Content-Type-Options: nosniff); images are inline, a PDF is a download; the Content-Security-Policy forbids scripts. Nobody else's draft is reachable.",
  })
  async file(@Param("id") id: string, @Query({ schema: attachmentQuerySchema }) query: AttachmentQuery, @CurrentActor() actor: Actor, @Res() response: Response): Promise<void> {
    const file = await this.attachments.file(id, actor, query.path, query.name);
    response.setHeader("Content-Type", file.contentType);
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Content-Disposition", `${file.contentType === "application/pdf" ? "attachment" : "inline"}; filename="${query.name}"`);
    response.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
    response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    response.setHeader("Cache-Control", "private, no-cache");
    response.send(file.bytes);
  }
}
