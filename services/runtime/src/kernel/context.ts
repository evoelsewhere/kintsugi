// What keeps a long job inside its model's context window (ADR-0048), and what keeps its prompt
// cacheable. pi compacts a conversation when it passes `contextWindow - reserveTokens`; its default
// reserve (16k) is right for a 200k window and far too small for a 1M one, where the summary request
// itself can overflow. Both numbers scale with the window instead.

import { createHash } from "node:crypto";
import type { JobSpec } from "@kintsugi/runtime-sdk";
import { normalizeTools } from "./tool-names.js";

const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max);

export interface CompactionBudget {
  /** Tokens kept free for the next prompt and answer: compaction starts when less than this is left. */
  reserveTokens: number;
  /** Tokens of the most recent conversation kept verbatim when it is summarised. */
  keepRecentTokens: number;
}

/** 15% of the window kept free (16k to 64k) and 10% kept verbatim (20k to 40k), never more than half and a quarter of a small window. */
export function compactionBudget(contextWindow: number): CompactionBudget {
  const window = Number.isFinite(contextWindow) && contextWindow > 0 ? contextWindow : 128_000;
  return {
    reserveTokens: Math.min(clamp(Math.round(window * 0.15), 16_384, 65_536), Math.floor(window * 0.5)),
    keepRecentTokens: Math.min(clamp(Math.round(window * 0.1), 20_000, 40_000), Math.floor(window * 0.25)),
  };
}

/**
 * One id for every job of the same agent, model and tool set. pi uses it to route requests to a cache
 * (`prompt_cache_key` on OpenAI-style APIs), so jobs that share a prompt prefix share a cache, and a
 * repair attempt, which restarts the conversation, still finds the first one's prefix.
 */
export function stableSessionId(spec: JobSpec): string {
  const fingerprint = JSON.stringify([
    spec.agent.version,
    spec.agent.instructions,
    (spec.agent.skills ?? []).map((skill) => [skill.name, skill.content]),
    normalizeTools(spec.agent.tools),
    spec.model.provider,
    spec.model.id,
    spec.model.thinking ?? spec.agent.thinking ?? "off",
  ]);
  const slug = spec.agent.id.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 48);
  return `${slug}-${createHash("sha256").update(fingerprint).digest("hex").slice(0, 16)}`;
}
