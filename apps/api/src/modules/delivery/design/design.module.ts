// Wiring of the design module (ADR-0044, ADR-0045): the design sets and the conformance of each
// unit's design documents, read from the document repo. Documents come from their module.

import { Module } from "@nestjs/common";
import { DocumentsModule } from "#modules/delivery/documents/index.js";
import { DesignService } from "./application/design.service.js";
import { DesignController } from "./interface/design.controller.js";

/** delivery · design sets and unit designs. */
@Module({
  imports: [DocumentsModule],
  controllers: [DesignController],
  providers: [DesignService],
  exports: [DesignService],
})
export class DesignModule {}
