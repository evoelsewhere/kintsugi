// Connection probes per wire protocol: a cheap authenticated read (list models) that
// proves the endpoint is reachable and the key is accepted. The key is only ever sent
// to the endpoint passed in, which is the provider's stored (or catalog) endpoint.

export interface ConnectionProbe {
  url: string;
  headers: Record<string, string>;
}

const trimSlash = (url: string): string => url.replace(/\/+$/, "");

/** The probe request for `api`, or undefined when Kintsugi has no probe for that protocol. */
export function connectionProbe(api: string, baseUrl: string, apiKey: string): ConnectionProbe | undefined {
  // Templated catalog URLs ({account_id}, {location}…) need values only the runtime has.
  if (baseUrl === "" || /[{}]/.test(baseUrl)) return undefined;
  const base = trimSlash(baseUrl);
  const accept = { accept: "application/json" };
  switch (api) {
    case "openai-completions":
    case "openai-responses":
      return { url: `${base}/models`, headers: { ...accept, authorization: `Bearer ${apiKey}` } };
    case "mistral-conversations":
      return { url: `${base.endsWith("/v1") ? base : `${base}/v1`}/models`, headers: { ...accept, authorization: `Bearer ${apiKey}` } };
    case "anthropic-messages":
      return {
        url: `${base.endsWith("/v1") ? base : `${base}/v1`}/models`,
        headers: { ...accept, "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      };
    case "google-generative-ai":
      return { url: `${base}/models`, headers: { ...accept, "x-goog-api-key": apiKey } };
    default:
      return undefined;
  }
}
