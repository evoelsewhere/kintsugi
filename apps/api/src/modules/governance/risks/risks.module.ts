import { Module } from "@nestjs/common";
import { RisksController } from "./risks.controller.js";
import { RisksService } from "./risks.service.js";

/** governance · risk & change — docs/architecture/05-building-block-view.md. */
@Module({ controllers: [RisksController], providers: [RisksService], exports: [RisksService] })
export class RisksModule {}
