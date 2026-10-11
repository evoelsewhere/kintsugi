// Interface layer: request schemas and HTTP-facing mapping (ADR-0016: Standard
// Schema; validated by `StandardSchemaValidationPipe`).

import { z } from "zod";
import { stringField } from "#common/interface/dto.js";
import type { UpdateProjectBuild } from "../application/project-builds.service.js";
import type { CreateProjectBuild } from "../domain/project-build.js";

export const createProjectBuildSchema = z.object({
  application: stringField(false),
  readiness: stringField(false),
  status: stringField(true),
});
export type CreateProjectBuildInput = z.infer<typeof createProjectBuildSchema>;

export const updateProjectBuildSchema = createProjectBuildSchema.partial();
export type UpdateProjectBuildInput = z.infer<typeof updateProjectBuildSchema>;

export function toCreateCommand(input: CreateProjectBuildInput): CreateProjectBuild {
  return { ...input };
}

export function toUpdateCommand(input: UpdateProjectBuildInput): UpdateProjectBuild {
  return { ...input };
}
