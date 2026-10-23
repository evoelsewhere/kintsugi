import { describe, expect, it } from "vitest";
import { markdownBullets, markdownHeading, memberTaskSummary } from "../src/member-task-summary.js";

describe("member task summary extraction", () => {
  it("extracts objective and acceptance criteria from the pinned task pack", () => {
    const taskPack = "# Tax task\n\n## Objective\nUse decimal arithmetic.\n\n## Acceptance criteria\n- Round half up\n2. Keep the API stable\n\n## Notes\nDo not include notes in the summary.\n";

    expect(memberTaskSummary(taskPack, "Fallback title")).toEqual({
      objective: "Use decimal arithmetic.",
      acceptanceCriteria: ["Round half up", "Keep the API stable"],
    });
  });

  it("uses the title when the task pack has no non-empty objective and bounds criteria", () => {
    const markdown = "## Objective\n\n## Acceptance criteria\n" +
      Array.from({ length: 105 }, (_, index) => `- ${String(index).padStart(3, "0")}: ${"x".repeat(2_100)}`).join("\n");

    const summary = memberTaskSummary(markdown, "Correct tax rounding");

    expect(summary.objective).toBe("Correct tax rounding");
    expect(summary.acceptanceCriteria).toHaveLength(100);
    expect(summary.acceptanceCriteria[0]).toBe(`000: ${"x".repeat(1_995)}`);
  });

  it("stops heading extraction at the next heading of the same or higher level", () => {
    expect(markdownHeading("### Objective\nKeep this.\n#### Detail\nKeep this too.\n### Next\nStop.", "objective"))
      .toBe("Keep this.\n#### Detail\nKeep this too.");
    expect(markdownBullets("- first\nplain text\n1) second\n+ third")).toEqual(["first", "second", "third"]);
  });
});
