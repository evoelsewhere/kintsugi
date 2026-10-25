/** Project permission for outbound public-web queries. Never implies permission to send project files. */
export interface WebSearchSettings {
  enabled: boolean;
  agents: string[];
}
export const DEFAULT_WEB_SEARCH: Readonly<WebSearchSettings> = { enabled: false, agents: ["designer"] };
export const WEB_SEARCH_LIMITS = { perStep: 3, perRun: 8, results: 5, timeoutMs: 20_000, responseBytes: 12_000 } as const;
export interface WebSearchInput { query: string; maxResults?: number }
export interface WebSearchResult { title: string; url: string; snippet: string }
export interface WebSearchResponse {
  provider: "duckduckgo";
  retrievedAt: string;
  results: WebSearchResult[];
  notice: string;
}
