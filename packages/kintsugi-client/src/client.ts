import {
  activityInputSchema,
  activityReceiptSchema,
  brainGrepQuerySchema,
  brainGrepSchema,
  brainLookupQuerySchema,
  brainLookupSchema,
  brainReadQuerySchema,
  brainReadSchema,
  brainTreeQuerySchema,
  brainTreeSchema,
  documentFileSchema,
  documentFileQuerySchema,
  documentTreeQuerySchema,
  documentTreeSchema,
  pluginBundleQuerySchema,
  pluginBundleSchema,
  pluginListQuerySchema,
  pluginListResultSchema,
  projectListResultSchema,
  projectQuerySchema,
} from "@kintsugi/harness-sdk";
import type {
  ActivityInput,
  ActivityReceipt,
  BrainGrep,
  BrainGrepQuery,
  BrainLookup,
  BrainLookupQuery,
  BrainRead,
  BrainReadQuery,
  BrainTree,
  BrainTreeQuery,
  DocumentFile,
  DocumentFileQuery,
  DocumentTree,
  DocumentTreeQuery,
  ListResult,
  MemberPort,
  PluginBundle,
  PluginBundleQuery,
  PluginListQuery,
  PluginSummary,
  ProjectQuery,
  ProjectSummary,
} from "@kintsugi/harness-sdk";
import { cancelledError, KintsugiClientError, isAbortError } from "./errors.js";

const API_PREFIX = "/api/member/v1";
const DEFAULT_RETRIES = 2;
const MAX_RETRY_DELAY_MS = 5_000;

type TokenProvider = () => string | undefined | Promise<string | undefined>;
type Sleep = (milliseconds: number, signal?: AbortSignal) => Promise<void>;

export interface MemberClientOptions {
  baseUrl: string;
  tokenProvider: TokenProvider;
  fetch?: typeof globalThis.fetch;
  sleep?: Sleep;
  signal?: AbortSignal;
  signalProvider?: () => AbortSignal | undefined;
  maxRetries?: number;
  now?: () => number;
}

interface ErrorEnvelope {
  success?: unknown;
  statusCode?: unknown;
  error?: unknown;
  message?: unknown;
  details?: unknown;
}

function validateBaseUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError("Installation URL is invalid");
  }
  const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new TypeError("Installation URL must use HTTPS (HTTP is allowed only for loopback)");
  }
  if (url.username || url.password || url.search || url.hash) throw new TypeError("Installation URL cannot contain credentials, query, or fragment");
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url;
}

function appendQuery(url: URL, query: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") continue;
    url.searchParams.set(key, String(value));
  }
}

function retryAfterMilliseconds(response: Response, now: number): number | undefined {
  const raw = response.headers.get("retry-after");
  if (raw === null) return undefined;
  const seconds = Number(raw);
  const delay = Number.isFinite(seconds) ? seconds * 1_000 : Date.parse(raw) - now;
  if (!Number.isFinite(delay)) return undefined;
  return Math.min(MAX_RETRY_DELAY_MS, Math.max(0, delay));
}

function makeSleep(): Sleep {
  return (milliseconds, signal) => new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(cancelledError());
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, milliseconds);
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(cancelledError());
    };
    signal?.addEventListener("abort", abort, { once: true });
    if (signal !== undefined) {
      void Promise.resolve().then(() => {
        if (signal.aborted) abort();
      });
    }
  });
}

function errorFromEnvelope(status: number, body: unknown, secret?: string): KintsugiClientError {
  const envelope = body !== null && typeof body === "object" ? body as ErrorEnvelope : {};
  const nested = envelope.details !== null && typeof envelope.details === "object" ? envelope.details as Record<string, unknown> : undefined;
  const code = typeof nested?.code === "string" ? redactText(nested.code, secret) : typeof envelope.error === "string" ? redactText(envelope.error, secret).toUpperCase().replace(/[^A-Z0-9_]+/g, "_") : `HTTP_${status}`;
  let message = typeof envelope.message === "string" ? envelope.message : `Kintsugi request failed (${status})`;
  if (secret) message = message.split(secret).join("[redacted]");
  return new KintsugiClientError({ code, status, message, details: redactSecret(envelope.details, secret) });
}

function redactText(value: string, secret?: string): string {
  if (secret === undefined || secret.length === 0) return value;
  return value.split(secret).join("[redacted]");
}

function redactSecret(value: unknown, secret?: string): unknown {
  if (typeof value === "string") return redactText(value, secret);
  if (secret === undefined || secret.length === 0) return value;
  if (Array.isArray(value)) return value.map((item) => redactSecret(item, secret));
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactSecret(item, secret)]));
  return value;
}

function parseBody<T>(schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } }, value: unknown, secret?: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new KintsugiClientError({ code: "INVALID_RESPONSE", message: "Kintsugi returned data that does not match the supported response schema" });
  if (secret !== undefined && JSON.stringify(parsed.data).includes(secret)) {
    throw new KintsugiClientError({ code: "INVALID_RESPONSE", message: "Kintsugi response contained unexpected credential data" });
  }
  return parsed.data;
}

export function createMemberClient(options: MemberClientOptions): MemberPort {
  const baseUrl = validateBaseUrl(options.baseUrl);
  const fetcher = options.fetch ?? globalThis.fetch;
  const sleep = options.sleep ?? makeSleep();
  const maxRetries = Math.max(0, Math.min(5, options.maxRetries ?? DEFAULT_RETRIES));
  const now = options.now ?? Date.now;

  async function request<T>(
    endpoint: string,
    query: Record<string, unknown>,
    schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } },
    signalOverride?: AbortSignal,
    payload?: unknown,
  ): Promise<T> {
    // A write is sent once: repeating it after a lost response could record it twice.
    const method = payload === undefined ? "GET" : "POST";
    let signal = signalOverride ?? options.signal;
    let signalResolved = signal !== undefined;
    const basePath = baseUrl.pathname.replace(/\/+$/, "");
    const url = new URL(`${basePath}${API_PREFIX}/${endpoint}`, baseUrl.origin);
    const urlQuery = { ...query };
    delete urlQuery.schemaVersion;
    if (method === "GET") appendQuery(url, urlQuery);
    let retries = 0;

    while (true) {
      if (signal?.aborted) throw cancelledError();
      const token = await options.tokenProvider();
      if (signal?.aborted) throw cancelledError();
      // Browser sign-in can outlast the HTTP request budget, so start it after token acquisition.
      if (!signalResolved) {
        signal = options.signalProvider?.() ?? options.signal;
        signalResolved = true;
      }
      if (signal?.aborted) throw cancelledError();
      if (token === undefined || token.length === 0) throw new KintsugiClientError({ code: "UNAUTHENTICATED", status: 401, message: "No Kintsugi credential is configured for this profile" });
      let response: Response;
      try {
        response = await fetcher(url, {
          method,
          headers: { accept: "application/json", authorization: `Bearer ${token}`, ...(method === "POST" ? { "content-type": "application/json" } : {}) },
          ...(method === "POST" ? { body: JSON.stringify(payload) } : {}),
          redirect: "manual",
          ...(signal === undefined ? {} : { signal }),
        });
      } catch (error) {
        if (isAbortError(error) || signal?.aborted) throw cancelledError();
        if (method === "GET" && retries < maxRetries) {
          retries += 1;
          await sleep(Math.min(250 * 2 ** (retries - 1), MAX_RETRY_DELAY_MS), signal);
          continue;
        }
        throw new KintsugiClientError({ code: "NETWORK_ERROR", message: "Could not reach the Kintsugi installation" });
      }

      if (response.status >= 300 && response.status < 400) {
        throw new KintsugiClientError({ code: "REDIRECT_BLOCKED", status: response.status, message: "Kintsugi redirected the request; credentials were not forwarded" });
      }
      let body: unknown;
      try {
        body = await response.json() as unknown;
      } catch {
        throw new KintsugiClientError({ code: "INVALID_RESPONSE", status: response.status, message: "Kintsugi returned an unreadable response" });
      }

      if (!response.ok) {
        const apiError = errorFromEnvelope(response.status, body, token);
        const retryable = method === "GET" && [429, 502, 503, 504].includes(response.status);
        if (retryable && retries < maxRetries) {
          retries += 1;
          await sleep(retryAfterMilliseconds(response, now()) ?? Math.min(250 * 2 ** (retries - 1), MAX_RETRY_DELAY_MS), signal);
          continue;
        }
        throw apiError;
      }
      if (body === null || typeof body !== "object" || (body as { success?: unknown }).success !== true || !("data" in body)) {
        throw new KintsugiClientError({ code: "INVALID_RESPONSE", status: response.status, message: "Kintsugi returned an unsupported response envelope" });
      }
      return parseBody(schema, (body as { data: unknown }).data, token);
    }
  }

  return {
    listProjects: (query: ProjectQuery): Promise<ListResult<ProjectSummary>> => {
      const parsed = projectQuerySchema.parse(query);
      return request("projects", parsed, projectListResultSchema);
    },
    documentTree: (query: DocumentTreeQuery): Promise<DocumentTree> => {
      const parsed = documentTreeQuerySchema.parse(query);
      return request("documents/tree", parsed, documentTreeSchema);
    },
    documentFile: (query: DocumentFileQuery): Promise<DocumentFile> => {
      const parsed = documentFileQuerySchema.parse(query);
      return request("documents/file", parsed, documentFileSchema);
    },
    listPlugins: (query: PluginListQuery): Promise<ListResult<PluginSummary>> => {
      const parsed = pluginListQuerySchema.parse(query);
      return request("plugins", parsed, pluginListResultSchema);
    },
    pluginBundle: (query: PluginBundleQuery): Promise<PluginBundle> => {
      const { name, ...rest } = pluginBundleQuerySchema.parse(query);
      return request(`plugins/${encodeURIComponent(name)}`, rest, pluginBundleSchema);
    },
    recordActivity: (input: ActivityInput): Promise<ActivityReceipt> => {
      const parsed = activityInputSchema.parse(input);
      return request("activity", {}, activityReceiptSchema, undefined, parsed);
    },
    brainTree: (query: BrainTreeQuery): Promise<BrainTree> => request("brain/tree", brainTreeQuerySchema.parse(query), brainTreeSchema),
    brainRead: (query: BrainReadQuery): Promise<BrainRead> => request("brain/read", brainReadQuerySchema.parse(query), brainReadSchema),
    brainLookup: (query: BrainLookupQuery): Promise<BrainLookup> => request("brain/lookup", brainLookupQuerySchema.parse(query), brainLookupSchema),
    brainGrep: (query: BrainGrepQuery): Promise<BrainGrep> => request("brain/grep", brainGrepQuerySchema.parse(query), brainGrepSchema),
  };
}
