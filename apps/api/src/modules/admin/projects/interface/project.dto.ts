// Interface layer: request schemas and HTTP-facing mapping (ADR-0016: Standard
// Schema; validated by `StandardSchemaValidationPipe`).

import { z } from "zod";
import { stringField } from "../../../../common/interface/dto.js";
import type { UpdateProject } from "../application/projects.service.js";
import type { CreateProject } from "../domain/project.js";

export const createProjectSchema = z.object({
  name: stringField(false),
  code: stringField(false),
  status: stringField(true),
});
export type CreateProjectInput = z.infer<typeof createProjectSchema>;

export const updateProjectSchema = createProjectSchema.partial();
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;

export function toCreateCommand(input: CreateProjectInput): CreateProject {
  return { ...input };
}

export function toUpdateCommand(input: UpdateProjectInput): UpdateProject {
  return { ...input };
}
