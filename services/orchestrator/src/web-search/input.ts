import { WEB_FETCH_LIMITS, WEB_SEARCH_LIMITS, WEB_TIME_RANGES, type WebFetchInput, type WebSearchInput, type WebTimeRange } from "@kintsugi/domain";
import { WebRequestError } from "@kintsugi/runtime-sdk";
import { publicWebUrl } from "../http/public-web.js";

function object(input: unknown, keys: string[]): Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input) || Object.keys(input).some((key) => !keys.includes(key))) throw new WebRequestError(`Use only these arguments: ${keys.join(", ")}.`);
  return input as Record<string, unknown>;
}
function integer(value: unknown, fallback: number, min: number, max: number, name: string): number {
  const number = value === undefined ? fallback : value;
  if (typeof number !== "number" || !Number.isSafeInteger(number) || number < min || number > max) throw new WebRequestError(`${name} must be an integer from ${min} to ${max}.`);
  return number;
}
export function searchInput(input: unknown, sensitive: (text: string) => boolean): WebSearchInput {
  const value = object(input, ["query","maxResults","site","timeRange","region"]);
  if (typeof value["query"] !== "string") throw new WebRequestError("Supply a public technical search query.");
  const query = value["query"].trim();
  if (query.length < 1 || query.length > WEB_SEARCH_LIMITS.queryChars || /[\p{Cc}\p{Cf}]/u.test(query)) throw new WebRequestError(`Use a query of 1–${WEB_SEARCH_LIMITS.queryChars} characters without control characters.`);
  if (sensitive(query)) throw new WebRequestError("The query appears to contain credentials. Use public technical terms only.");
  const result: WebSearchInput = { query, maxResults: integer(value["maxResults"],WEB_SEARCH_LIMITS.defaultResults,1,WEB_SEARCH_LIMITS.results,"maxResults") };
  if (value["site"] !== undefined) {
    if (typeof value["site"] !== "string" || value["site"].length > 253 || !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/i.test(value["site"])) throw new WebRequestError("site must be one public domain, without a scheme, path or wildcard.");
    result.site = publicWebUrl(`https://${value["site"].toLowerCase()}/`).hostname;
  }
  if (value["timeRange"] !== undefined) {
    if (typeof value["timeRange"] !== "string" || !(WEB_TIME_RANGES as readonly string[]).includes(value["timeRange"])) throw new WebRequestError("timeRange must be d, w, m or y.");
    result.timeRange = value["timeRange"] as WebTimeRange;
  }
  if (value["region"] !== undefined) {
    if (typeof value["region"] !== "string" || !/^[a-z]{2}-[a-z]{2}$/.test(value["region"])) throw new WebRequestError("region must be a DuckDuckGo region code such as us-en, vn-vi or wt-wt.");
    result.region = value["region"];
  }
  return result;
}
export function fetchInput(input: unknown, sensitive: (text: string) => boolean): WebFetchInput {
  const value = object(input,["url","offset","maxChars","expectedHash"]);
  if (typeof value["url"] !== "string" || sensitive(value["url"])) throw new WebRequestError("Supply a public URL without credentials or secret parameters.");
  const url = publicWebUrl(value["url"]).href;
  const offset = integer(value["offset"],0,0,WEB_FETCH_LIMITS.contentChars,"offset");
  const maxChars = integer(value["maxChars"],WEB_FETCH_LIMITS.defaultChars,1000,WEB_FETCH_LIMITS.maxChars,"maxChars");
  const expectedHash = value["expectedHash"];
  if ((offset > 0 || expectedHash !== undefined) && (typeof expectedHash !== "string" || !/^[a-f0-9]{64}$/.test(expectedHash))) throw new WebRequestError("For continuation, supply expectedHash from the previous response and its nextOffset.");
  return { url,offset,maxChars,...(typeof expectedHash === "string" ? { expectedHash } : {}) };
}
