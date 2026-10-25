/** Explicit project permission for outbound public-web queries and optional page retrieval. */
export interface WebSearchSettings {
  enabled: boolean;
  fetchEnabled: boolean;
  agents: string[];
}
export const DEFAULT_WEB_SEARCH: Readonly<WebSearchSettings> = { enabled: false, fetchEnabled: false, agents: ["designer"] };
/** Provider throttling is independent of these application budgets. */
export const WEB_SEARCH_LIMITS = { perStep: 20, perRun: 100, results: 10, defaultResults: 10, queryChars: 1000, timeoutMs: 25_000, responseBytes: 64_000 } as const;
export const WEB_FETCH_LIMITS = { perStep: 40, perRun: 200, concurrency: 3, timeoutMs: 30_000, responseBytes: 64_000,
  bodyBytes: 2_000_000, contentChars: 400_000, defaultChars: 16_000, maxChars: 32_000, redirects: 4, links: 20 } as const;
export const WEB_SERVICE_TIMEOUT_MS = 50_000;
export type WebOperation = "search" | "fetch";
export const WEB_TIME_RANGES = ["d", "w", "m", "y"] as const;
export type WebTimeRange = (typeof WEB_TIME_RANGES)[number];
export interface WebSearchInput { query: string; maxResults?: number; site?: string; timeRange?: WebTimeRange; region?: string }
export interface WebSearchResult { title: string; url: string; snippet: string }
export interface WebSearchResponse {
  provider: "duckduckgo";
  query: string;
  retrievedAt: string;
  results: WebSearchResult[];
  truncated: boolean;
  notice: string;
}
export interface WebFetchInput { url: string; offset?: number; maxChars?: number; expectedHash?: string }
export interface WebFetchResponse {
  url: string;
  finalUrl: string;
  title: string;
  contentType: string;
  retrievedAt: string;
  content: string;
  contentHash: string;
  offset: number;
  nextOffset: number | null;
  totalChars: number;
  truncated: boolean;
  sourceTruncated: boolean;
  links: Array<{ title: string; url: string }>;
  notice: string;
}
