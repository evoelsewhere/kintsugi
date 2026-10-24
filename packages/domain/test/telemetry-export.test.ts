import { describe, expect, it } from "vitest";
import { DEFAULT_TELEMETRY_EXPORT, otlpTracesUrl, resolveTelemetryExport, telemetryExportProblems, telemetryHeaderProblems } from "../src/telemetry-export.js";

describe("telemetry export settings (ADR-0074)", () => {
  it("is off by default and the defaults can be stored", () => {
    expect(DEFAULT_TELEMETRY_EXPORT.enabled).toBe(false);
    expect(telemetryExportProblems(DEFAULT_TELEMETRY_EXPORT)).toEqual([]);
  });

  it("requires an endpoint only while export is on, and refuses anything that is not a plain http(s) URL", () => {
    expect(telemetryExportProblems({ ...DEFAULT_TELEMETRY_EXPORT, enabled: true })).toEqual(["Endpoint is required while export is on"]);
    expect(telemetryExportProblems({ enabled: true, endpoint: "ftp://collector", serviceName: "k" })).toEqual(["Endpoint must start with http:// or https://"]);
    expect(telemetryExportProblems({ enabled: true, endpoint: "https://u:p@collector", serviceName: "k" })).toEqual(["Endpoint must not carry credentials; put them in a header"]);
    expect(telemetryExportProblems({ enabled: true, endpoint: "collector", serviceName: "k" })).toEqual(["Endpoint must be a URL"]);
    expect(telemetryExportProblems({ enabled: true, endpoint: "https://collector:4318", serviceName: "" })).toEqual(["Service name must be 1 to 100 characters"]);
  });

  it("adds /v1/traces to a base URL and keeps a full one", () => {
    expect(otlpTracesUrl("https://collector:4318")).toBe("https://collector:4318/v1/traces");
    expect(otlpTracesUrl("https://collector:4318/")).toBe("https://collector:4318/v1/traces");
    expect(otlpTracesUrl("https://cloud.langfuse.com/api/public/otel/v1/traces")).toBe("https://cloud.langfuse.com/api/public/otel/v1/traces");
  });

  it("checks header names and values", () => {
    expect(telemetryHeaderProblems({ Authorization: "Basic abc", "x-team": "a" })).toEqual([]);
    expect(telemetryHeaderProblems({ "bad name": "v" })).toEqual(['Header name "bad name" is not valid']);
    expect(telemetryHeaderProblems({ a: "line\nbreak" })).toEqual(["Header a needs a value of one line, at most 2000 characters"]);
    expect(telemetryHeaderProblems(Object.fromEntries(Array.from({ length: 21 }, (_, index) => [`h${index}`, "v"])))).toEqual(["At most 20 headers"]);
  });

  it("resolves a stored value field by field, and stays off without a usable endpoint", () => {
    expect(resolveTelemetryExport(undefined)).toEqual(DEFAULT_TELEMETRY_EXPORT);
    expect(resolveTelemetryExport({ enabled: true, endpoint: "not a url", serviceName: "x" })).toEqual({ enabled: false, endpoint: "", serviceName: "x" });
    expect(resolveTelemetryExport({ enabled: true, endpoint: " https://c:4318 ", serviceName: "  " })).toEqual({ enabled: true, endpoint: "https://c:4318", serviceName: "kintsugi-runtime" });
  });
});
