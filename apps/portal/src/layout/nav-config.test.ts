import { describe, expect, it } from "vitest";
import { NAV_SECTIONS } from "./nav-config";

describe("Coding Agent Workflow navigation", () => {
  it("makes the developer documents hub discoverable from Workspace", () => {
    const guide = NAV_SECTIONS.find((section) => section.id === "workspace")?.items.find((item) => item.id === "coding-agent-guide");

    expect(guide).toMatchObject({ label: "Developer docs", to: "/developer" });
  });
});
