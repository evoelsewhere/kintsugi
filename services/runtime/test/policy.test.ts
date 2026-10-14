// The system prompt names a skill's supporting files so the agent can read them on demand.

import { describe, expect, it } from "vitest";
import { composeSystemPrompt } from "../src/kernel/policy.js";

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
});
