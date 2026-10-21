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

  it("matches task-status fields and keeps gate publication separate from effectiveness", async () => {
    const skill = await readSkill();
    expect(skill).toMatch(/interpret `evidenceAvailability` before interpreting empty pull-request or review lists/i);
    expect(skill).toMatch(/when a source is unavailable, say that its evidence could not be retrieved rather than claiming none exists/i);
    expect(skill).toMatch(/gate decision status and gate publication status as separate facts/i);
    expect(skill).toMatch(/an approval or a published record alone does not prove that a gate is effective or that the workflow advanced/i);
    expect(skill).toMatch(/only advancement and next steps supported by the returned status and `nextAction`/i);
    expect(skill).toMatch(/task-status gate entries expose `status` \(`pending`, `approved`, `rejected`, or `unknown`\) and `publication` \(`pending`, `published`, or `unknown`\)/i);
    expect(skill).toMatch(/does not expose effective, stale, or failed publication states/i);
    expect(skill).toMatch(/same selected `projectId`/i);
    expect(skill).toMatch(/when PR evidence or its head revision is unavailable, do not claim a revision match/i);
  });

  it("separates CLI setup and optional SSE watch from the chosen AI's read-only MCP role", async () => {
    const skill = await readSkill();
    expect(skill).toContain("local Kintsugi CLI owns plugin setup, local MCP configuration, and authentication");
    expect(skill).toContain("configured local MCP connection to read task briefs, cited standards and context, review evidence, and task status");
    expect(skill).toContain("does not run or operate the assistant");
    expect(skill).toContain("current adapter exposes `project_list`, `task_list`, `task_brief`, `document_get`, `document_search`, and `task_status`");
    expect(skill).toContain("`review_get` is exposed only when the review capability is enabled");
    expect(skill).toContain("All MCP tools are read-only. There is no MCP watch tool or gate-write operation");
    expect(skill).toContain("only when the developer asks to monitor, use `kintsugi task watch <unitId>`");
    expect(skill).toContain("subscribes to durable task events over SSE");
    expect(skill).toContain("`--after-event-id` to resume, and `--limit` to bound the stream");
    expect(skill).toContain("Do not start an unbounded watch by default");
    expect(skill).toContain("call `task_status` to inspect current task, review, and gate facts");
    expect(skill).toContain("Reading context through MCP does not require starting a watch");
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
