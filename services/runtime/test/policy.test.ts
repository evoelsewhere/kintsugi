// The system prompt names a skill's supporting files so the agent can read them on demand.

import { describe, expect, it } from "vitest";
import { composeSystemPrompt, describeWorkspace } from "../src/kernel/policy.js";

describe("composeSystemPrompt", () => {
  it("puts what is specific to a job after what its jobs share, and names a skill's supporting files last", () => {
    const agent = {
      id: "a",
      version: "1",
      instructions: "Be brief.",
      tools: [],
      skills: [
        { name: "diagrams", content: "Draw Mermaid.", supporting: { dir: "/in/.skills/diagrams", paths: ["references/c4.md", "references/er.md"] } },
        { name: "plain", content: "Plain." },
      ],
    };
    const prompt = composeSystemPrompt(agent);
    expect(prompt).toBe(
      [
        "Be brief.",
        '<skill name="diagrams">\nDraw Mermaid.\n</skill>',
        '<skill name="plain">\nPlain.\n</skill>',
        "<skill-files>\nSupporting files of the skills above, read only when you need them (read tool):\ndiagrams (under /in/.skills/diagrams): references/c4.md, references/er.md\n</skill-files>",
      ].join("\n\n"),
    );
    // Two jobs of one agent differ only after the shared part (the paths of their workspaces).
    const first = composeSystemPrompt(agent, { root: "/job-1", readOnly: ["/job-1/as-is"], outDir: "/job-1/out" });
    const second = composeSystemPrompt(agent, { root: "/job-2", readOnly: ["/job-2/as-is"], outDir: "/job-2/out" });
    const shared = [agent.instructions, '<skill name="diagrams">', "Draw Mermaid.", '<skill name="plain">'];
    for (const text of shared) expect(first.indexOf(text)).toBeLessThan(first.indexOf("<workspace>"));
    expect(first.slice(0, first.indexOf("<workspace>"))).toBe(second.slice(0, second.indexOf("<workspace>")));
    expect(first.indexOf("<workspace>")).toBeLessThan(first.indexOf("<skill-files>"));
    // The workspaces are told apart by their paths relative to the root, so the same layout gives the same text.
    expect(first).toBe(second);
  });

  it("tells the agent where reads resolve, what to read first and where writes land", () => {
    const workspace = { root: "/job", readOnly: ["/job/as-is", "/job/to-be", "/job/steps/design/in", "/job/WORKSPACE.md"], outDir: "/job/steps/design/out" };
    const prompt = composeSystemPrompt({ id: "a", version: "1", instructions: "Be brief.", tools: ["read", "write"] }, workspace);
    expect(prompt.startsWith("Be brief.\n\n<workspace>\n")).toBe(true);
    expect(prompt).toContain("resolve a relative path against it; a call without a path looks in as-is.");
    expect(prompt).toContain("Readable locations (relative to the working directory): as-is, to-be, steps/design/in, WORKSPACE.md.");
    expect(prompt).toContain("Read WORKSPACE.md first");
    expect(prompt).toContain("never prefixed with the name of a repository or a workspace folder");
    expect(prompt).not.toContain("/job/");
    expect(prompt).not.toContain("steps/design/out");
  });

  it("leaves out the write rules for an agent that cannot write", () => {
    const note = describeWorkspace({ root: "/job", readOnly: ["/job/as-is"], outDir: "/job/out" }, ["read", "grep"]);
    expect(note).toContain("looks in as-is");
    expect(note).not.toContain("Read WORKSPACE.md");
    expect(note).not.toContain("write and edit");
  });
});
