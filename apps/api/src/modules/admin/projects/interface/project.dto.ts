// Interface layer: request schemas and HTTP-facing mapping for projects, applications and
// their repositories (ADR-0016: Standard Schema; validated by `StandardSchemaValidationPipe`).

import { APPLICATION_REPOSITORY_ROLES, DISPOSITIONS } from "@kintsugi/domain";
import { z } from "zod";
import { idSchema, stringField } from "../../../../common/interface/dto.js";
import type { CreateApplication, CreateProject, LinkRepository, UpdateApplication, UpdateProject } from "../domain/project.js";

const description = z.string().trim().max(2000);

export const createProjectSchema = z.object({
  id: idSchema,
  name: stringField(false),
  description: description.optional(),
  /** Registered Git repository (Settings -> Git) holding everything except code. */
  documentRepositoryId: idSchema,
});
export type CreateProjectInput = z.infer<typeof createProjectSchema>;

export const updateProjectSchema = z.object({
  name: stringField(false).optional(),
  /** null or "" clears the description. */
  description: description.nullable().optional(),
  documentRepositoryId: idSchema.optional(),
});
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;

export const createApplicationSchema = z.object({
  id: idSchema,
  name: stringField(false),
  disposition: z.enum(DISPOSITIONS),
  /** A built-in pipeline id, or the id of a pipeline declared in kintsugi.yaml. */
  pipeline: idSchema.optional(),
});
export type CreateApplicationInput = z.infer<typeof createApplicationSchema>;

export const updateApplicationSchema = z.object({
  name: stringField(false).optional(),
  disposition: z.enum(DISPOSITIONS).optional(),
  /** null clears the pipeline. */
  pipeline: idSchema.nullable().optional(),
});
export type UpdateApplicationInput = z.infer<typeof updateApplicationSchema>;

export const linkRepositorySchema = z.object({
  repositoryId: idSchema,
  /** AS-IS: legacy, legacy-data. TO-BE: target (the document repo is set on the project). */
  role: z.enum(APPLICATION_REPOSITORY_ROLES),
  /** Architecture component a target repo implements; required for target, rejected otherwise. */
  component: z.string().trim().min(1).max(100).optional(),
});
export type LinkRepositoryInput = z.infer<typeof linkRepositorySchema>;

const blankToUndefined = (value: string | undefined): string | undefined => (value === undefined || value === "" ? undefined : value);

export function toCreateProject(input: CreateProjectInput): CreateProject {
  const text = blankToUndefined(input.description);
  return { id: input.id, name: input.name, documentRepositoryId: input.documentRepositoryId, ...(text === undefined ? {} : { description: text }) };
}

export function toUpdateProject(input: UpdateProjectInput): UpdateProject {
  return {
    ...(input.name === undefined ? {} : { name: input.name }),
    ...(input.description === undefined ? {} : { description: blankToUndefined(input.description ?? undefined) ?? null }),
    ...(input.documentRepositoryId === undefined ? {} : { documentRepositoryId: input.documentRepositoryId }),
  };
}

export function toCreateApplication(input: CreateApplicationInput): CreateApplication {
  return { id: input.id, name: input.name, disposition: input.disposition, ...(input.pipeline === undefined ? {} : { pipeline: input.pipeline }) };
}

export function toUpdateApplication(input: UpdateApplicationInput): UpdateApplication {
  return {
    ...(input.name === undefined ? {} : { name: input.name }),
    ...(input.disposition === undefined ? {} : { disposition: input.disposition }),
    ...(input.pipeline === undefined ? {} : { pipeline: input.pipeline }),
  };
}

export function toLinkRepository(input: LinkRepositoryInput): LinkRepository {
  return { repositoryId: input.repositoryId, role: input.role, ...(input.component === undefined ? {} : { component: input.component }) };
}
