// Failures in plain words, and a few that are the provider's, not the step's: worth one more try. The known failures
// and their wording live in @kintsugi/domain, shared with the API.

import { isKnownFailure } from "@kintsugi/domain";

export { explainFailure } from "@kintsugi/domain";

/**
 * Provider failures worth one more try of an agent step: a dropped or refused connection, a rate limit, an overload,
 * a server error, a stalled response or a content filter. A limit the job hit (timeout, turns, budget) and a known
 * failure of the settings are not.
 */
const TRANSIENT =
  /connection error|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|socket hang up|fetch failed|finish_reason|content_filter|provider|rate.?limit|overloaded|\b(429|50[0-4])\b|stalled/i;

export const isTransientFailure = (text: string): boolean => !isKnownFailure(text) && TRANSIENT.test(text);
