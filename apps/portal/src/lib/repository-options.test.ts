import { describe, expect, it } from "vitest";
import type { GitRepositoryView } from "./api/git";
import type { RepositoryLinkView } from "./api/projects";
import { documentRepositoryOptions } from "./repository-options";

const repository = (id: string): GitRepositoryView => ({ id, serverId: "local", url: `https://git.example/${id}.git`, syncStatus: "ready", createdAt: "", updatedAt: "" });
const links: RepositoryLinkView[] = [
  { repositoryId: "billing-docs", projectId: "billing", role: "document", applicationId: null },
  { repositoryId: "billing-legacy", projectId: "billing", role: "legacy", applicationId: "web" },
];
const repositories = [repository("billing-docs"), repository("billing-legacy"), repository("payroll-docs")];

describe("documentRepositoryOptions", () => {
  it("marks the repositories another project uses as in use and lists them last", () => {
    expect(documentRepositoryOptions(repositories, links, null)).toEqual([
      { value: "payroll-docs", label: "payroll-docs", hint: "https://git.example/payroll-docs.git" },
      { value: "billing-docs", label: "billing-docs", hint: "In use: document repo of billing", disabled: true },
      { value: "billing-legacy", label: "billing-legacy", hint: "In use: legacy repo of billing / web", disabled: true },
    ]);
  });

  it("keeps the project's own document repo selectable and blocks what it links to an application", () => {
    const options = documentRepositoryOptions(repositories, links, "billing");
    expect(options.find((option) => option.value === "billing-docs")?.disabled).toBeUndefined();
    expect(options.find((option) => option.value === "billing-legacy")).toMatchObject({ disabled: true, hint: "In use: legacy repo of web" });
  });
});
