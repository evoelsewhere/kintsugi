import { Module } from "@nestjs/common";
import { FactorySetupsController } from "./factory-setups.controller.js";
import { FactorySetupsService } from "./factory-setups.service.js";

/** delivery · factory setup — docs/architecture/05-building-block-view.md. */
@Module({ controllers: [FactorySetupsController], providers: [FactorySetupsService], exports: [FactorySetupsService] })
export class FactorySetupsModule {}
