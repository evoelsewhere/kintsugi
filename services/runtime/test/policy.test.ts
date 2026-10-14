// The system prompt names a skill's supporting files so the agent can read them on demand.

import { describe, expect, it } from "vitest";
import { composeSystemPrompt, describeWorkspace } from "../src/kernel/policy.js";

describe("composeSystemPrompt", () => {
  it("lists the supporting files of a skill under its block", () => {
    const prompt = composeSystemPrompt({
      id: "a",
      version: "1",
      instructions: "Be brief.",
      tools: [],
      skills: [
        { name: "diagrams", content: "Draw Mermaid.", supporting: { dir: "/in/.skills/diagrams", paths: ["references/c4.md", "references/er.md"] } },
        { name: "plain", content: "Plain." },
      ],
    });
    expect(prompt).toBe(
      [
        "Be brief.",
        '<skill name="diagrams">\nDraw Mermaid.\n\nSupporting files of this skill, read only when you need them (read tool), under /in/.skills/diagrams:\n- references/c4.md\n- references/er.md\n</skill>',
        '<skill name="plain">\nPlain.\n</skill>',
      ].join("\n\n"),
    );
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
