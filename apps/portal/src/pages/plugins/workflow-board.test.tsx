import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { PluginFlow } from "@/lib/api/plugins";
import { CommandBoard } from "./workflow-board";

const BUILD: PluginFlow = {
  command: "build",
  path: "commands/build.md",
  description: "Implement and test one designed unit",
  audience: "member",
  reads: ["10-applications/<app>/02-modern/<module>/<unit>/"],
  steps: [],
  writes: [],
  gates: ["you approve the plan before any code is written"],
  flow: [
    { kind: "step", label: "Read the unit's rules, merged design and the standards", tool: "document_get" },
    { kind: "gate", label: "you approve the plan before any code is written" },
    { kind: "step", label: "Implement the unit, building after each file", skill: "build-method" },
    { kind: "step", label: "Record the unit, the merge request and its head commit (build.mr)", tool: "activity_record" },
  ],
};

describe("the Runs lane of a command a member's harness carries out", () => {
  it("draws the steps the harness follows, with the tool or skill each uses and where a person decides", () => {
    const html = renderToStaticMarkup(<CommandBoard flow={BUILD} onOpenFile={() => undefined} />);
    expect(html).toContain("Read the unit&#x27;s rules, merged design and the standards");
    expect(html).toContain("tool · document_get");
    expect(html).toContain("skill · build-method");
    expect(html).toContain("tool · activity_record");
    expect(html).toContain("✋ you approve the plan before any code is written");
    expect(html).not.toContain("starts no script or workflow");
  });

  it("says so when a command declares no steps", () => {
    const html = renderToStaticMarkup(<CommandBoard flow={{ ...BUILD, flow: undefined }} onOpenFile={() => undefined} />);
    expect(html).toContain("declares no steps");
  });
});
