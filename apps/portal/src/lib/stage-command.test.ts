import { describe, expect, it } from "vitest";
import { stageCommand } from "./stage-command";

describe("the command of a stage", () => {
  it("names a member command with its plugin, as the member's client does", () => {
    expect(stageCommand({ audience: "member", command: "build", plugin: "modernize" })).toBe("modernize:build");
  });

  it("names a runtime or portal command by its name", () => {
    expect(stageCommand({ audience: "runtime", command: "design", plugin: "modernize" })).toBe("design");
    expect(stageCommand({ audience: "portal", command: "catalog", plugin: "reverse_engineering" })).toBe("catalog");
    expect(stageCommand({ audience: "member", command: "build" })).toBe("build");
  });
});
