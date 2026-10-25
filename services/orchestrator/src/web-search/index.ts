import { randomUUID } from "node:crypto";
import { WEB_SEARCH_LIMITS } from "@kintsugi/domain";
import { WebSearchRequestError, type JobServices } from "@kintsugi/runtime-sdk";
import { searchDuckDuckGo } from "./duckduckgo.js";
import type { PgWebSearch, WebSearchContext } from "./store.js";
export { PgWebSearch, type WebSearchContext } from "./store.js";

export function bindWebSearch(store: PgWebSearch, context: WebSearchContext, sensitive: (text: string) => boolean): NonNullable<JobServices["webSearch"]> {
  return async (input, signal) => {
    if (typeof input !== "object" || input === null || Array.isArray(input)) throw new WebSearchRequestError("Expected a search query.");
    const value = input as Record<string, unknown>;
    if (Object.keys(value).some((key) => !["query", "maxResults"].includes(key)) || typeof value["query"] !== "string") throw new WebSearchRequestError("Expected query and optional maxResults only.");
    const query = value["query"].trim();
    const maxResults = value["maxResults"] ?? WEB_SEARCH_LIMITS.results;
    if (query.length < 1 || query.length > 300 || /[\p{Cc}\p{Cf}]/u.test(query) || !Number.isInteger(maxResults) || (maxResults as number) < 1 || (maxResults as number) > WEB_SEARCH_LIMITS.results) throw new WebSearchRequestError("Use a query of 1–300 characters and maxResults of 1–5.");
    if (sensitive(query)) throw new WebSearchRequestError("The query appears to contain credentials. Use public technical terms only.");
    signal?.throwIfAborted();
    const id = randomUUID();
    const epoch = await store.reserve(context, id);
    try {
      signal?.throwIfAborted();
      const result = await searchDuckDuckGo({ query, maxResults: maxResults as number }, signal);
      if (!(await store.allowed(context.projectId, context.agent, epoch))) throw new WebSearchRequestError("Web search policy changed while the request was running. Continue without this result.");
      return result;
    } catch (error) {
      if (error instanceof WebSearchRequestError) throw error;
      throw new WebSearchRequestError("DuckDuckGo search failed or timed out. Continue without web search; do not repeatedly retry.");
    } finally { await store.release(context.projectId, id); }
  };
}
