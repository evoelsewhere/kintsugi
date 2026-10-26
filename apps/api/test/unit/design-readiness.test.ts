import { describe, expect, it, vi } from "vitest";
import { DesignRunsService } from "../../src/modules/delivery/design/application/design-runs.service.js";
import type { Actor } from "../../src/common/auth/decorators.js";

const actor = { id: "alice", username: "alice" } as Actor;
const commit = "a".repeat(40);
const files = { total: 1, conformant: 0, problems: 0, missing: 1, stale: 0, waived: 0 };
const make = (blockers: string[] = [], written = false) => {
  const summary = { set: "basic", version: 1, state: written ? "conformant" : "missing", files: { ...files, ...(written ? { conformant: 1, missing: 0 } : {}) }, ready: !written && blockers.length === 0, blockers };
  const design = {
    overview: vi.fn().mockResolvedValue({ ref: { ref: "refs/heads/main", commit }, units: [{ key: "tax/calc", sets: { basic: summary } }], application: { sets: {} }, sets: [{ id: "basic", needs: [] }] }),
    sets: vi.fn().mockResolvedValue({ sets: [{ id: "basic", scope: "unit" }], problems: [] }),
  };
  const runs = { startRun: vi.fn().mockResolvedValue({ id: "new-run" }) };
  const service = new DesignRunsService(design as never, {} as never, runs as never);
  vi.spyOn(service, "activity").mockResolvedValue({ items: [] });
  return { service, design, runs };
};

describe("final design versus explicit draft", () => {
  it("rejects insufficient evidence before queuing, and exposes the reason", async () => {
    const { service, runs } = make(["Resolve GAP-M101-0001 in the specification"]);
    await expect(service.start("shop", "web", { set: "basic", units: ["tax/calc"] }, actor)).rejects.toMatchObject({ response: { details: { conflicts: [{ unit: "tax/calc", state: "not-ready", reasons: ["Resolve GAP-M101-0001 in the specification"] }] } } });
    expect(runs.startRun).not.toHaveBeenCalled();
  });

  it("allows a consciously requested draft and pins the definitions and evidence to one commit", async () => {
    const { service, design, runs } = make(["Understand the unit first"]);
    await service.start("shop", "web", { set: "basic", units: ["tax/calc"], draft: true }, actor);
    expect(design.sets).toHaveBeenCalledWith("shop", commit, "web");
    expect(runs.startRun).toHaveBeenCalledWith("shop", "web", "design", actor, { inputs: { documentsCommit: commit, scope: { items: ["tax/calc"], files: [], set: "basic", draft: true } } });
  });

  it("does not let regeneration evade the same readiness guard", async () => {
    const { service, runs } = make(["Needs the merged, conformant architecture first"], true);
    await expect(service.start("shop", "web", { set: "basic", units: ["tax/calc"], regenerate: true }, actor)).rejects.toMatchObject({ status: 409 });
    expect(runs.startRun).not.toHaveBeenCalled();
    await service.start("shop", "web", { set: "basic", units: ["tax/calc"], regenerate: true, draft: true }, actor);
    expect(runs.startRun).toHaveBeenCalledOnce();
  });

  it("never bypasses ownership or invalid templates for a draft", async () => {
    const { service, design, runs } = make();
    vi.mocked(service.activity).mockResolvedValue({ items: [{ unit: "tax/calc", set: "basic", state: "running", runId: "existing" }] });
    await expect(service.start("shop", "web", { set: "basic", units: ["tax/calc"], draft: true }, actor)).rejects.toMatchObject({ status: 409 });
    design.sets.mockResolvedValue({ sets: [{ id: "basic", scope: "unit" }], problems: [{ path: "01-standards/templates/basic/set.md", message: "cycle" }] });
    await expect(service.start("shop", "web", { set: "basic", units: ["tax/calc"], draft: true }, actor)).rejects.toMatchObject({ status: 409 });
    expect(runs.startRun).not.toHaveBeenCalled();
  });
});
