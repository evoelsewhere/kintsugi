// Interface layer: request schemas and HTTP-facing mapping. Schemas are Standard
// Schema (ADR-0016): they validate via `StandardSchemaValidationPipe` and feed
// OpenAPI generation. Domain commands are built here — the application layer never
// sees transport shapes.

import { THINKING_LEVELS, type ThinkingLevel } from "@kintsugi/domain";
import type { AgentModelBinding } from "@kintsugi/runtime-sdk";
import { z } from "zod";
import { idSchema } from "#common/interface/dto.js";
import type { RegisterLlmProvider } from "../domain/llm-provider.js";

const providerIdSchema = idSchema;

export const customModelSchema = z.object({
  id: z.string().min(1).max(200),
  name: z.string().min(1).max(200).optional(),
  input: z.array(z.enum(["text", "image"])).min(1).optional(),
  reasoning: z.boolean().optional(),
  contextWindow: z.number().int().positive().optional(),
  maxTokens: z.number().int().positive().optional(),
  cost: z
    .object({
      input: z.number().nonnegative(),
      output: z.number().nonnegative(),
      cacheRead: z.number().nonnegative().optional(),
      cacheWrite: z.number().nonnegative().optional(),
    })
    .optional(),
  compat: z.record(z.string(), z.boolean()).optional(),
});

const authFields = {
  /** Write-only credential. Stored encrypted; references travel as { secretId }. */
  apiKey: z.string().min(1).max(8192).optional(),
  /** Provider-specific environment (Bedrock region, Azure deployment map, …). Values are never returned. */
  env: z.record(z.string(), z.string()).optional(),
};

const builtinProviderSchema = z.object({
  kind: z.literal("builtin"),
  id: providerIdSchema,
  /** pi provider id from the pinned catalog, e.g. "anthropic", "openai", "amazon-bedrock". */
  piProvider: z.string().min(1).max(100),
  modelOverrides: z.record(z.string(), z.unknown()).optional(),
  enabledModels: z.array(z.string().min(1)).optional(),
  enabled: z.boolean().optional(),
  ...authFields,
});

const customProviderSchema = z.object({
  kind: z.literal("custom"),
  id: providerIdSchema,
  /** pi wire protocol, e.g. "openai-completions", "anthropic-messages", "bedrock-converse-stream". */
  api: z.string().min(1).max(100),
  baseUrl: z.string().min(1).max(2000),
  /** Write-only, stored encrypted; names are case-insensitive. On replace, `null` keeps the stored value. */
  headers: z
    .record(z.string().min(1).max(200), z.string().nullable())
    .refine((headers) => new Set(Object.keys(headers).map((name) => name.toLowerCase())).size === Object.keys(headers).length, {
      message: "Header names must be unique (case-insensitive).",
    })
    .optional(),
  models: z.array(customModelSchema).min(1),
  enabled: z.boolean().optional(),
  ...authFields,
});

export const createProviderSchema = z.discriminatedUnion("kind", [builtinProviderSchema, customProviderSchema]).superRefine((input, context) => {
  if (input.kind === "custom" && Object.values(input.headers ?? {}).some((value) => value === null)) {
    context.addIssue({
      code: "custom",
      path: ["headers"],
      message: "Header values can only be null when preserving existing headers during replacement.",
    });
  }
});
export type CreateProviderInput = z.infer<typeof createProviderSchema>;

export const replaceProviderSchema = z.discriminatedUnion("kind", [
  builtinProviderSchema.omit({ id: true }),
  customProviderSchema.omit({ id: true }),
]);
export type ReplaceProviderInput = z.infer<typeof replaceProviderSchema>;

export const agentModelBindingSchema = z.object({
  /** Runtime agent id (ADR-0023: agents are data, so any well-formed id). */
  agent: idSchema,
  /** Undefined = installation default. */
  projectId: z.string().min(1).max(200).optional(),
  provider: providerIdSchema,
  model: z.string().min(1).max(200),
  thinking: z.enum(THINKING_LEVELS).optional(),
});
export type AgentModelBindingInput = z.infer<typeof agentModelBindingSchema>;
export type { AgentModelBinding, ThinkingLevel };

export const replaceBindingsSchema = z.array(agentModelBindingSchema);

/** Maps the create request to the application command. */
export function toCreateCommand(input: CreateProviderInput): RegisterLlmProvider {
  return toCommand(input.id, input);
}

/** Maps the replace request to the application command. */
export function toReplaceCommand(id: string, input: ReplaceProviderInput): RegisterLlmProvider {
  return toCommand(id, { ...input, id });
}

function toCommand(id: string, input: CreateProviderInput): RegisterLlmProvider {
  const { apiKey, env, enabled, ...config } = input;
  return {
    id,
    enabled: enabled ?? true,
    config: config as RegisterLlmProvider["config"],
    credentials: { apiKey, env },
  };
}
