import { Module } from "@nestjs/common";
import { PoliciesController } from "./policies.controller.js";
import { PoliciesService } from "./policies.service.js";

/** governance · policy engine — docs/architecture/05-building-block-view.md. */
@Module({ controllers: [PoliciesController], providers: [PoliciesService], exports: [PoliciesService] })
export class PoliciesModule {}
