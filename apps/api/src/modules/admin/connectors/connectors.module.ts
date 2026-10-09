import { Module } from "@nestjs/common";
import { ConnectorsController } from "./connectors.controller.js";
import { ConnectorsService } from "./connectors.service.js";

/** admin · connectors — docs/architecture/05-building-block-view.md. */
@Module({ controllers: [ConnectorsController], providers: [ConnectorsService], exports: [ConnectorsService] })
export class ConnectorsModule {}
