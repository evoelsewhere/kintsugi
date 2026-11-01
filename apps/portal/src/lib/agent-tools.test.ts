import { describe, expect, it } from "vitest";
import { toolWarnings } from "./agent-tools";

describe("tool warnings of the Agent Builder", () => {
  it("warns for every tool that runs commands with the job's account, and says when shell is not offered", () => {
    const warnings = toolWarnings(["read", "shell", "git", "codemode"]);
    expect(warnings.map((warning) => warning.tool)).toEqual(["shell", "git", "codemode"]);
    for (const warning of warnings) {
      expect(warning.text).toContain("with the job's account (the worker's own account unless job isolation is turned on, ADR-0093)");
      expect(warning.text).toContain("ADR-0093");
      expect(warning.text).toContain("Built-in agents do not get it.");
    }
    expect(warnings[0]?.text).toContain("On a worker without bash the shell tool is not offered to the agent.");
    expect(warnings[1]?.text).toContain("repository history");
  });

  it("shows nothing for read-only tools", () => {
    expect(toolWarnings(["read", "ls", "grep", "find", "write", "edit"])).toEqual([]);
  });
});
