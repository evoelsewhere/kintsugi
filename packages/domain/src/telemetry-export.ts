// Export of job spans to an OpenTelemetry backend (ADR-0074): off by default, set by an administrator in the portal
// (Settings → Telemetry export) and stored in admin.installation_setting under `telemetry-export`. The worker reads it
// when it hands a batch of spans over, so a change applies without a restart. The headers (usually an API key) are
// stored encrypted next to this value and never returned. Pure: the API validates with the rules the worker applies.

export const TELEMETRY_EXPORT_SETTING = "telemetry-export";

export interface TelemetryExportSettings {
  enabled: boolean;
  /** OTLP/HTTP endpoint: the base URL of the collector, or the full `.../v1/traces` URL of the backend. */
  endpoint: string;
  /** `service.name` of the exported spans. */
  serviceName: string;
}

export const DEFAULT_TELEMETRY_EXPORT: TelemetryExportSettings = {
  enabled: false,
  endpoint: "",
  serviceName: "kintsugi-runtime",
};

export const MAX_EXPORT_HEADERS = 20;
const HEADER_NAME = /^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,100}$/;

/** The traces URL of an endpoint: a base URL gets `/v1/traces`, a URL that already ends in it is kept. */
export function otlpTracesUrl(endpoint: string): string {
  const trimmed = endpoint.trim().replace(/\/+$/, "");
  return trimmed.endsWith("/v1/traces") ? trimmed : `${trimmed}/v1/traces`;
}

function endpointProblem(endpoint: string): string | undefined {
  let url: URL;
  try {
    url = new URL(endpoint.trim());
  } catch {
    return "Endpoint must be a URL";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return "Endpoint must start with http:// or https://";
  if (url.username !== "" || url.password !== "") return "Endpoint must not carry credentials; put them in a header";
  return undefined;
}

/** What is wrong with a settings object; empty when it can be stored. An endpoint is only required once export is on. */
export function telemetryExportProblems(input: Partial<Record<keyof TelemetryExportSettings, unknown>>): string[] {
  const problems: string[] = [];
  if (typeof input.enabled !== "boolean") problems.push("Export must be on or off");
  const endpoint = typeof input.endpoint === "string" ? input.endpoint.trim() : "";
  if (endpoint === "") {
    if (input.enabled === true) problems.push("Endpoint is required while export is on");
  } else {
    const problem = endpointProblem(endpoint);
    if (problem !== undefined) problems.push(problem);
  }
  const serviceName = typeof input.serviceName === "string" ? input.serviceName.trim() : "";
  if (serviceName === "" || serviceName.length > 100) problems.push("Service name must be 1 to 100 characters");
  return problems;
}

/** What is wrong with the headers to send along (names and values); empty when they can be stored. */
export function telemetryHeaderProblems(headers: Readonly<Record<string, string>>): string[] {
  const problems: string[] = [];
  const names = Object.keys(headers);
  if (names.length > MAX_EXPORT_HEADERS) problems.push(`At most ${MAX_EXPORT_HEADERS} headers`);
  for (const name of names) {
    if (!HEADER_NAME.test(name)) problems.push(`Header name "${name.slice(0, 40)}" is not valid`);
    const value = headers[name] ?? "";
    if (value === "" || value.length > 2000 || /[\r\n\0]/.test(value)) problems.push(`Header ${name.slice(0, 40)} needs a value of one line, at most 2000 characters`);
  }
  return problems;
}

/** The settings in effect from a stored value: any field that is not valid is the default, so export never starts from a broken value. */
export function resolveTelemetryExport(stored: unknown): TelemetryExportSettings {
  const value = typeof stored === "object" && stored !== null ? (stored as Record<string, unknown>) : {};
  const endpoint = typeof value["endpoint"] === "string" && endpointProblem(value["endpoint"]) === undefined ? value["endpoint"].trim() : "";
  const serviceName = typeof value["serviceName"] === "string" && value["serviceName"].trim() !== "" && value["serviceName"].trim().length <= 100 ? value["serviceName"].trim() : DEFAULT_TELEMETRY_EXPORT.serviceName;
  // Off unless an endpoint that can be used is stored.
  return { enabled: value["enabled"] === true && endpoint !== "", endpoint, serviceName };
}
