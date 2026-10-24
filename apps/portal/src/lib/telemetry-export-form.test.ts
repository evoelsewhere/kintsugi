import { describe, expect, it } from "vitest";
import type { TelemetryExportView } from "./api/telemetry-export";
import { formProblems, isUnchanged, parseHeaders, toForm, toInput } from "./telemetry-export-form";

const view = (overrides: Partial<TelemetryExportView> = {}): TelemetryExportView => ({ enabled: false, endpoint: "", serviceName: "kintsugi-runtime", headerNames: [], isDefault: true, ...overrides });

describe("telemetry export form (ADR-0074)", () => {
  it("parses one header per line and names a line that is not Name: value", () => {
    expect(parseHeaders("Authorization: Basic a:b\n\n x-team : core ")).toEqual({ headers: { Authorization: "Basic a:b", "x-team": "core" }, problems: [] });
    expect(parseHeaders("nope").problems).toEqual(['"nope" is not Name: value']);
  });

  it("is unchanged until something is edited, and holds no header value", () => {
    const form = toForm(view({ headerNames: ["Authorization"] }));
    expect(form.headers).toBe("");
    expect(isUnchanged(form, view({ headerNames: ["Authorization"] }))).toBe(true);
    expect(isUnchanged({ ...form, enabled: true }, view())).toBe(false);
  });

  it("sends headers only when typed or cleared, so the stored ones are kept otherwise", () => {
    const base = { ...toForm(view()), enabled: true, endpoint: "https://c:4318" };
    expect(toInput(base)).toEqual({ enabled: true, endpoint: "https://c:4318", serviceName: "kintsugi-runtime" });
    expect(toInput({ ...base, headers: "A: b" })?.headers).toEqual({ A: "b" });
    expect(toInput({ ...base, clearHeaders: true })?.headers).toEqual({});
  });

  it("reports the problems of the API and sends nothing while there are any", () => {
    const bad = { ...toForm(view()), enabled: true };
    expect(formProblems(bad)).toEqual(["Endpoint is required while export is on"]);
    expect(toInput(bad)).toBeUndefined();
  });
});
