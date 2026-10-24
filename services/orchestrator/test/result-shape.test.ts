import { describe, expect, it } from "vitest";
import { exampleOf, keysOf, looksLikeSchema, shapeProblem, unwrapResult } from "../src/jobs/result-shape.js";

const schema = {
  type: "object",
  required: ["depManifest", "docCoveragePct"],
  properties: { depManifest: { type: "string" }, docCoveragePct: { type: "integer" }, riskNotes: { type: "array" }, owner: { type: ["string", "null"] } },
};

describe("shapeProblem", () => {
  it("accepts a value that has the required properties with the right types", () => {
    expect(shapeProblem(schema, { depManifest: "none", docCoveragePct: 50, riskNotes: [], owner: null })).toBeUndefined();
  });

  it("names what is missing or of the wrong type", () => {
    expect(shapeProblem(schema, {})).toBe("missing depManifest, docCoveragePct");
    expect(shapeProblem(schema, { depManifest: "none", docCoveragePct: 50.5 })).toBe("docCoveragePct should be integer, got number");
    expect(shapeProblem(schema, { depManifest: 1, docCoveragePct: 5 })).toBe("depManifest should be string, got number");
    expect(shapeProblem(schema, [])).toBe("expected object, got array");
    expect(shapeProblem(schema, null)).toBe("expected object, got null");
  });

  it("checks nothing it cannot read", () => {
    expect(shapeProblem(undefined, 1)).toBeUndefined();
    expect(shapeProblem({}, "anything")).toBeUndefined();
    expect(shapeProblem({ type: "array", items: { type: "string" } }, ["a"])).toBeUndefined();
  });
});

describe("unwrapResult", () => {
  const verdict = { type: "object", required: ["verdict", "reason"], properties: { verdict: { type: "string", enum: ["confirmed", "refuted"] }, reason: { type: "string" } } };

  it("takes the only property when that is the result", () => {
    expect(unwrapResult(verdict, { result: { verdict: "confirmed", reason: "x" } })).toEqual({ verdict: "confirmed", reason: "x" });
  });

  it("leaves a fitting value, and anything that does not unwrap into one, as it is", () => {
    const fits = { verdict: "refuted", reason: "x" };
    expect(unwrapResult(verdict, fits)).toBe(fits);
    const wrong = { result: { verdict: "confirmed" } };
    expect(unwrapResult(verdict, wrong)).toBe(wrong);
    const two = { a: fits, b: fits };
    expect(unwrapResult(verdict, two)).toBe(two);
    expect(unwrapResult(verdict, "text")).toBe("text");
  });
});

describe("keysOf and exampleOf", () => {
  it("names the properties of a value, bounded and on one line", () => {
    expect(keysOf({ confirmed: true, why: "x" })).toBe("confirmed, why");
    expect(keysOf({})).toBe("no properties");
    expect(keysOf([1])).toBe("array");
    expect(keysOf({ "a\nb": 1 })).toBe("a?b");
  });

  it("builds a minimal example of the required properties", () => {
    const schema = { type: "object", required: ["real", "reason", "level"], properties: { real: { type: "boolean" }, reason: { type: "string" }, level: { type: "string", enum: ["High", "Low"] } } };
    expect(exampleOf(schema)).toBe('{"real":false,"reason":"...","level":"High"}');
    expect(exampleOf({ type: "object" })).toBeUndefined();
    expect(exampleOf(undefined)).toBeUndefined();
  });
});

describe("looksLikeSchema", () => {
  it("tells a result that is the schema itself from a real result", () => {
    const verdict = { type: "object", required: ["real", "reason"], properties: { real: { type: "boolean" }, reason: { type: "string" } } };
    expect(looksLikeSchema(verdict, verdict)).toBe(true);
    expect(looksLikeSchema(verdict, { real: true, reason: "x" })).toBe(false);
    expect(looksLikeSchema(verdict, [])).toBe(false);
    // A schema that really has a field called "properties" is not mistaken for a copy of itself.
    const odd = { type: "object", required: ["properties"], properties: { properties: { type: "object" } } };
    expect(looksLikeSchema(odd, { type: "x", properties: {} })).toBe(false);
  });
});
