import { describe, expect, it } from "vitest";
import { getCodingAgentWorkflowToolNames } from "../src/tool-map.js";

describe("Coding Agent Workflow MCP tool catalog", () => {
  it("registers six read-only tools when review retrieval is unavailable", () => {
    expect(getCodingAgentWorkflowToolNames({ reviews: false })).toEqual([
      "project_list",
      "task_list",
      "task_brief",
      "document_get",
      "document_search",
      "task_status",
    ]);
  });

  it("adds review_get only when a review reader is available", () => {
    expect(getCodingAgentWorkflowToolNames({ reviews: true })).toEqual([
      "project_list",
      "task_list",
      "task_brief",
      "document_get",
      "document_search",
      "review_get",
      "task_status",
    ]);
  });
});
