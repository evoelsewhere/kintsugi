import { describe, expect, it } from "vitest";
import { clientSetupCommands, safeProfileName } from "./handoff.js";
import { createTaskHandoffPrompt } from "./handoff.js";

describe("Coding Agent Workflow handoff", () => {
  it("names the selected task and activity and asks the AI to retrieve cited, complete context", () => {
    const prompt = createTaskHandoffPrompt("shop", "web/core/invoice", "implementation");
    expect(prompt).toContain("Project: shop");
    expect(prompt).toContain("Unit: web/core/invoice");
    expect(prompt).toContain("Activity: implementation");
    expect(prompt).toContain("every required context section");
    expect(prompt).toContain("unresolved decisions instead of guessing");
    expect(prompt).toContain("evidence record merged and became effective");
    expect(prompt).not.toContain("knt_pat_");
  });

  it("creates safe distinct CLI profiles and keeps secrets out of copyable setup commands", () => {
    expect(safeProfileName("Shop Modernization / API")).toBe("kintsugi-shop-modernization-api");
    expect(safeProfileName("!!!")).toBe("kintsugi");
    const commands = clientSetupCommands("https://kintsugi.example", safeProfileName("shop"), "codex");
    expect(commands).toContain("kintsugi auth login --url https://kintsugi.example --profile kintsugi-shop");
    expect(commands).toContain("kintsugi plugins setup --client codex --profile kintsugi-shop");
    expect(commands).not.toContain("token");
  });
});
