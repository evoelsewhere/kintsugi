import { describe, expect, it } from "vitest";
import type { AgentSummary } from "./api/agents";
import type { StageView } from "./api/job-runs";
import { agentBindingLabel, agentProblems } from "./stages";

const agent = (name: string, overrides: Partial<AgentSummary> = {}): AgentSummary => ({
  name,
  source: "builtin",
  audience: "runtime",
  version: "1.0.0",
  description: "",
  enabled: true,
  problems: [],
  ...overrides,
});

const stage = { id: "design", agents: ["designer", "design-reviewer", "contract-reviewer", "gone", "off"] } as unknown as StageView;

describe("agentProblems", () => {
  it("counts a project binding and the installation default alike, and names what is missing", () => {
    const agents = [
      agent("designer", { binding: { provider: "gw", model: "flash", scope: "project" } }),
      agent("design-reviewer", { binding: { provider: "gw", model: "pro", scope: "installation" } }),
      agent("contract-reviewer"),
      agent("off", { enabled: false, binding: { provider: "gw", model: "pro", scope: "installation" } }),
    ];
    expect(agentProblems(stage, agents)).toEqual(["contract-reviewer has no model binding", "gone is not in the agent catalog", "off is disabled"]);
  });

  it("reports nothing while the catalog loads", () => {
    expect(agentProblems(stage, undefined)).toEqual([]);
  });
});

describe("agentBindingLabel", () => {
  it("says the model and where the binding comes from", () => {
    expect(agentBindingLabel({ provider: "xiaomi", model: "mimo-v2.6-flash", scope: "project" })).toBe("xiaomi · mimo-v2.6-flash · project binding");
    expect(agentBindingLabel({ provider: "xiaomi", model: "mimo-v2.5-pro", thinking: "off", scope: "installation" })).toBe("xiaomi · mimo-v2.5-pro · thinking off · installation default");
  });
});
