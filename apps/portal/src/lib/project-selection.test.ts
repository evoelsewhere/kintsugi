import { describe, expect, it } from "vitest";
import { resolveProject } from "./project-selection";

const ids = ["billing-qa", "payroll"];

describe("resolveProject", () => {
  it("shows the project the URL names when the person has it", () => {
    expect(resolveProject(ids, "payroll", "billing-qa")).toEqual({ projectId: "payroll" });
  });

  it("rejects a URL project the person does not have, and shows the stored or the first project instead", () => {
    expect(resolveProject(ids, "nope", "payroll")).toEqual({ projectId: "payroll", rejected: "nope" });
    expect(resolveProject(ids, "nope", null)).toEqual({ projectId: "billing-qa", rejected: "nope" });
    expect(resolveProject([], "nope", null)).toEqual({ projectId: undefined, rejected: "nope" });
  });

  it("falls back to the stored, then the first project without a URL project, and rejects nothing", () => {
    expect(resolveProject(ids, null, "payroll")).toEqual({ projectId: "payroll" });
    expect(resolveProject(ids, null, "gone")).toEqual({ projectId: "billing-qa" });
  });

  it("takes the URL as it is while the projects load", () => {
    expect(resolveProject(undefined, "nope", null)).toEqual({ projectId: "nope" });
    expect(resolveProject(undefined, null, "payroll")).toEqual({ projectId: undefined });
  });
});
