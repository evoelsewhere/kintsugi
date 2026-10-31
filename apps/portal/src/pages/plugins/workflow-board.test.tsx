import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { PluginFlow } from "@/lib/api/plugins";
import { linkLabel } from "./link-label";
import { CommandBoard, PipelineBoard } from "./workflow-board";

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

describe("the pipeline of a plugin", () => {
  const runtime = (command: string): PluginFlow => ({ ...BUILD, command, path: `commands/${command}.md`, audience: "runtime", flow: undefined });

  it("labels a link with the file name it carries, in full, and how many more", () => {
    expect(linkLabel(["10-applications/<app>/01-legacy/inventory.md", "10-applications/<app>/01-legacy/_catalog/"])).toBe("inventory.md +1");
    expect(linkLabel(["10-applications/<app>/01-legacy/_catalog/"])).toBe("_catalog/");
    expect(linkLabel([])).toBe("");
  });

  it("draws the commands in the order given, with the label of the link between neighbours untruncated", () => {
    const html = renderToStaticMarkup(
      <PipelineBoard
        flows={[runtime("assess"), runtime("plan-understand"), runtime("understand")]}
        pipeline={[{ from: "assess", to: "plan-understand", via: ["10-applications/<app>/01-legacy/inventory.md"] }, { from: "understand", to: "plan-understand", via: ["10-applications/<app>/01-legacy/<module>/<unit>/understanding.md"] }]}
        selected="assess"
        onSelect={() => undefined}
      />,
    );
    expect(html.indexOf("/assess")).toBeLessThan(html.indexOf("/plan-understand"));
    expect(html.indexOf("/plan-understand")).toBeLessThan(html.indexOf("/understand<"));
    expect(html).toContain(">inventory.md<");
    expect(html).not.toContain("truncate");
    expect(html).toContain("feeds /plan-understand");
  });
});
