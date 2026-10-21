import { describe, expect, it } from "vitest";
import { loadBuiltinPlugins, readBuiltinPluginFile } from "../src/index.js";

describe("access plugin handoff guidance", () => {
  async function readSkill() {
    const plugins = await loadBuiltinPlugins();
    return readBuiltinPluginFile(plugins, "access", "skills/kintsugi-task/SKILL.md");
  }

  it("retrieves available review evidence and limits repair use to current, requested findings", async () => {
    const skill = await readSkill();
    expect(skill).toBeDefined();
    expect(skill).toMatch(/task_status[\s\S]*review_get[\s\S]*only if that tool is actually available/i);
    expect(skill).toMatch(/verdict[\s\S]*coverage[\s\S]*reviewed revision[\s\S]*currentness/i);
    expect(skill).toMatch(/stable ID[\s\S]*severity[\s\S]*rationale[\s\S]*path and line[\s\S]*repair guidance/i);
    expect(skill).toMatch(/the developer has asked for repair[\s\S]*revision being repaired[\s\S]*scoped edits/i);
    expect(skill).toMatch(/fetch fresh `task_status` and, if it returns review references/i);
    expect(skill).toMatch(/findings are evidence for the developer; they never authorize edits, approval, merge, or gate passage/i);
  });

  it("separates CLI setup and watch from the chosen AI's read-only MCP role", async () => {
    const skill = await readSkill();
    expect(skill).toContain("local Kintsugi CLI owns plugin setup, local MCP configuration, and authentication");
    expect(skill).toContain("configured local MCP connection to read task briefs, cited standards and context, and review evidence");
    expect(skill).toContain("does not run or operate the assistant");
    expect(skill).toContain("MCP access is read-only and has no watch tool or gate-write operation");
    expect(skill).toContain("use `kintsugi task watch` only when that command is supported by the installed CLI");
    expect(skill).toContain("This preview may report streaming as unsupported");
    expect(skill).toContain("in that case, refresh `task_status`");
  });

  it("hands implementation and PR creation to the chosen AI and reports only Kintsugi-observed provider state", async () => {
    const skill = await readSkill();
    expect(skill).toContain("work in the developer's repository using the chosen AI's coding tools");
    expect(skill).toContain("open a PR for a registered GitHub/GHES repository, use provider tools available to that AI");
    expect(skill).toContain("Kintsugi does not create the pull request");
    expect(skill).toContain("configured provider integration observes and reconciles an opened PR");
    expect(skill).toContain("report that state only when `task_status` returns it");
    expect(skill).toContain("say so if PR evidence is unavailable");
  });
});
