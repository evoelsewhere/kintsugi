import { Module } from "@nestjs/common";
import { HarnessesController } from "./harnesses.controller.js";
import { HarnessesService } from "./harnesses.service.js";

/** admin · harness registry — docs/architecture/05-building-block-view.md. */
@Module({ controllers: [HarnessesController], providers: [HarnessesService], exports: [HarnessesService] })
export class HarnessesModule {}
