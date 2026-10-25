import { randomUUID } from "node:crypto";
import type { WebOperation } from "@kintsugi/domain";
import { WebRequestError, type JobServices } from "@kintsugi/runtime-sdk";
import { searchDuckDuckGo } from "./duckduckgo.js";
import { fetchWebPage } from "./fetch.js";
import { searchInput, fetchInput } from "./input.js";
import type { PgWebSearch, WebSearchContext } from "./store.js";
export { PgWebSearch, type WebSearchContext } from "./store.js";

export function bindWebTools(store: PgWebSearch, context: WebSearchContext, sensitive: (text: string) => boolean): Pick<JobServices,"webSearch"|"webFetch"> {
  const call = async (operation: WebOperation, input: unknown, signal?: AbortSignal): Promise<unknown> => {
    // Validate before reserving quota or resolving any caller-controlled hostname.
    const validated = operation === "search" ? searchInput(input,sensitive) : fetchInput(input,sensitive);
    signal?.throwIfAborted();
    const id = randomUUID();
    const reservation = await store.reserve(context,id,operation);
    try {
      signal?.throwIfAborted();
      const result = operation === "search" ? await searchDuckDuckGo(validated as ReturnType<typeof searchInput>,signal) : await fetchWebPage(validated as ReturnType<typeof fetchInput>,signal);
      if (!(await store.allowed(context.projectId,context.agent,reservation.epoch,operation))) throw new WebRequestError("Web access policy changed while the request was running. Continue without this result.");
      return { ...result, budget: { remainingForStep: reservation.remainingForStep, remainingForRun: reservation.remainingForRun } };
    } catch (error) {
      if (error instanceof WebRequestError) throw error;
      throw new WebRequestError(`Web ${operation} failed, timed out or was cancelled. Continue with other sources; do not repeatedly retry.`);
    } finally { await store.release(context.projectId,id); }
  };
  return { webSearch: (input,signal) => call("search",input,signal), webFetch: (input,signal) => call("fetch",input,signal) };
}
