import { describe, expect, it } from "vitest";
import type { WorkItemFile } from "../src/index.js";
import { evaluateReadiness, parseWorkItemFile, type TaskReadinessInput } from "../src/index.js";

const workItem: WorkItemFile = {
  id: "billing/invoices/tax",
  application: "billing",
  module: "invoices",
  kind: "calculation",
  title: "Invoice tax calculation",
  phase: "migrate",
  stage: "implement",
  status: "approved",
};

const designFixture: TaskReadinessInput = {
  workItem,
  requiredInputs: [
    {
      sourceId: "src-basic",
      role: "basic-design",
      requiredFor: ["design", "implementation"],
      availability: "present",
      publication: "published",
      approval: "approved",
    },
    {
      sourceId: "src-detail",
      role: "detailed-design",
      requiredFor: ["implementation"],
      producedBy: "design",
      availability: "missing",
      publication: "unknown",
      approval: "unknown",
    },
    {
      sourceId: "src-standards",
      role: "typescript-conventions",
      requiredFor: ["implementation"],
      availability: "present",
      publication: "published",
      approval: "approved",
    },
  ],
  predecessorGates: [
    { gateId: "G3", status: "approved", requiredFor: ["design", "implementation"] },
    { gateId: "G4", status: "pending", requiredFor: ["verification"] },
  ],
};

describe("member task contract", () => {
  it("rejects short and foreign unit identities", () => {
    const short = parseWorkItemFile({ ...workItem, id: "tax" });
    const foreign = parseWorkItemFile({ ...workItem, id: "other/invoices/tax" });

    expect(short.ok).toBe(false);
    expect(foreign.ok).toBe(false);
    if (!short.ok && !foreign.ok) {
      expect(short.issues.some((issue) => issue.path === "id")).toBe(true);
      expect(foreign.issues.some((issue) => issue.path === "id")).toBe(true);
    }
  });

  it("allows a design task to produce its missing detailed-design output", () => {
    const result = evaluateReadiness(designFixture);

    expect(result.readyFor).toContain("design");
    expect(result.byActivity.design.ready).toBe(true);
  });

  it("does not infer implementation approval from a published task or pending gate", () => {
    const result = evaluateReadiness({
      ...designFixture,
      requiredInputs: designFixture.requiredInputs.map((input) =>
        input.sourceId === "src-detail"
          ? { ...input, availability: "present" as const, publication: "published" as const, approval: "approved" as const }
          : input,
      ),
      predecessorGates: [
        { gateId: "G3", status: "pending", requiredFor: ["implementation"] },
        { gateId: "G4", status: "pending", requiredFor: ["verification"] },
      ],
    });

    expect(result.readyFor).not.toContain("implementation");
    expect(result.blockers.some((blocker) => blocker.code === "GATE_PENDING" && blocker.gateId === "G3")).toBe(true);
  });

  it("reports source approval separately from publication", () => {
    const result = evaluateReadiness({
      ...designFixture,
      requiredInputs: designFixture.requiredInputs.map((input) =>
        input.sourceId === "src-standards" ? { ...input, approval: "pending" as const } : input,
      ),
    });

    expect(result.readyFor).not.toContain("implementation");
    expect(result.blockers.some((blocker) => blocker.code === "SOURCE_APPROVAL_PENDING" && blocker.sourceId === "src-standards")).toBe(true);
  });
});
