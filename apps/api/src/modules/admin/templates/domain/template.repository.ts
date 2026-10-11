// Port of Templates — the DI token of this module (shared kernel: common/domain/repository.ts).

import { Repository } from "#common/domain/repository.js";
import type { CreateTemplate, Template } from "./template.js";

export abstract class TemplateRepository extends Repository<Template, CreateTemplate> {}
