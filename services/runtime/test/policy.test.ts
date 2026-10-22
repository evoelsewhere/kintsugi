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
    const first = composeSystemPrompt(agent, { readOnly: ["/job-1/src"], outDir: "/job-1/out" });
    const second = composeSystemPrompt(agent, { readOnly: ["/job-2/src"], outDir: "/job-2/out" });
    const shared = [agent.instructions, '<skill name="diagrams">', "Draw Mermaid.", '<skill name="plain">'];
    for (const text of shared) expect(first.indexOf(text)).toBeLessThan(first.indexOf("<workspace>"));
    expect(first.slice(0, first.indexOf("<workspace>"))).toBe(second.slice(0, second.indexOf("<workspace>")));
    expect(first.indexOf("<workspace>")).toBeLessThan(first.indexOf("<skill-files>"));
  });

  it("tells the agent where reads resolve and where writes land", () => {
    const workspace = { readOnly: ["/job/src", "/job/in"], outDir: "/job/out" };
    const prompt = composeSystemPrompt({ id: "a", version: "1", instructions: "Be brief.", tools: ["read", "write"] }, workspace);
    expect(prompt.startsWith("Be brief.\n\n<workspace>\n")).toBe(true);
    expect(prompt).toContain("resolve a relative path against the source checkout (/job/src)");
    expect(prompt).toContain("Other readable locations, by absolute path: /job/in.");
    expect(prompt).toContain("never prefixed with the checkout's name or `src/`");
    expect(prompt).not.toContain("/job/out");
  });

  it("leaves out the write rules for an agent that cannot write", () => {
    const note = describeWorkspace({ readOnly: ["/job/src"], outDir: "/job/out" }, ["read", "grep"]);
    expect(note).toContain("/job/src");
    expect(note).not.toContain("write and edit");
  });
});
