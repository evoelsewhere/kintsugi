import { describe, expect, it } from "vitest";
import { MEMBER_TOOL_NAMES } from "../src/tool-map.js";

describe("member MCP tool catalog", () => {
  it("registers the common tools", () => {
    expect(MEMBER_TOOL_NAMES).toEqual(["project_list", "document_tree", "document_get", "plugin_list", "activity_record"]);
  });
});
