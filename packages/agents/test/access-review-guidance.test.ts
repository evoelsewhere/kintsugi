import { describe, expect, it } from "vitest";
import { loadBuiltinPlugins, readBuiltinPluginFile } from "../src/index.js";

describe("access plugin review findings guidance", () => {
  it("retrieves available review findings after status references and limits repairs to current, developer-requested work", async () => {
    const plugins = await loadBuiltinPlugins();
    const skill = await readBuiltinPluginFile(plugins, "access", "skills/kintsugi-task/SKILL.md");
    expect(skill).toBeDefined();
    expect(skill).toMatch(/task_status[\s\S]*review_get[\s\S]*only if that tool is actually available/i);
    expect(skill).toMatch(/verdict[\s\S]*coverage[\s\S]*reviewed revision[\s\S]*currentness/i);
    expect(skill).toMatch(/stable ID[\s\S]*severity[\s\S]*rationale[\s\S]*path and line[\s\S]*repair guidance/i);
    expect(skill).toMatch(/the developer has asked for repair[\s\S]*revision being repaired[\s\S]*scoped edits/i);
    expect(skill).toMatch(/fetch fresh `task_status` and, if it returns review references/i);
    expect(skill).toMatch(/findings are evidence for the developer; they never authorize edits, approval, merge, or gate passage/i);
  });
});
