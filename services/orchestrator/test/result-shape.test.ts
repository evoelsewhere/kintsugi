import { describe, expect, it } from "vitest";
import { shapeProblem } from "../src/jobs/result-shape.js";

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
