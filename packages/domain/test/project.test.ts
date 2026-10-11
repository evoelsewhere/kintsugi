import { describe, expect, it } from "vitest";
import { groupRepositories, type ProjectRepositoryLink, projectRepositoryProblems } from "../src/index.js";

const doc: ProjectRepositoryLink = { projectId: "billing", applicationId: null, repositoryId: "billing-docs", role: "document" };
const legacy: ProjectRepositoryLink = { projectId: "billing", applicationId: "web", repositoryId: "web-legacy", role: "legacy" };
const data: ProjectRepositoryLink = { projectId: "billing", applicationId: "web", repositoryId: "web-db", role: "legacy-data" };
const target: ProjectRepositoryLink = { projectId: "billing", applicationId: "web", repositoryId: "web-api", role: "target", component: "api" };

const check = (links: ProjectRepositoryLink[], otherProjectLinks: ProjectRepositoryLink[] = []) =>
  projectRepositoryProblems({ projectId: "billing", applicationIds: ["web"], links, otherProjectLinks });

describe("project repository rules", () => {
  it("accepts a document repo and AS-IS / TO-BE repos per application", () => {
    expect(check([doc, legacy, data, target])).toEqual([]);
  });

  it("requires exactly one document repo, at project level", () => {
    expect(check([legacy])).toEqual([{ path: "links", message: "A project has exactly one document repository (found 0)." }]);
    const second = { ...doc, repositoryId: "other-docs" };
    expect(check([doc, second]).map((p) => p.path)).toEqual(["links"]);
    expect(check([{ ...doc, applicationId: "web" }])).toEqual([
      { path: "links[0].applicationId", message: "The document repository belongs to the project, not to an application." },
    ]);
  });

  it("puts legacy, legacy-data and target repos in a known application", () => {
    const problems = check([doc, { ...legacy, applicationId: null }, { ...data, applicationId: "batch" }]);
    expect(problems.map((p) => p.message)).toEqual(["A legacy repository belongs to an application.", "Unknown application batch."]);
  });

  it("requires a component for targets only, unique per application", () => {
    const problems = check([
      doc,
      { ...target, repositoryId: "web-ui", component: undefined },
      { ...legacy, component: "web" },
      target,
      { ...target, repositoryId: "web-api-2" },
    ]);
    expect(problems.map((p) => p.path)).toEqual(["links[1].component", "links[2].component", "links[4].component"]);
  });

  it("links a repository at most once per project", () => {
    expect(check([doc, legacy, { ...legacy, role: "legacy-data" }])).toEqual([
      { path: "links[2].repositoryId", message: "Repository web-legacy is linked to this project more than once." },
    ]);
  });

  it("keeps a document repo to one project, while legacy and target repos may be shared", () => {
    const elsewhere = (link: Partial<ProjectRepositoryLink>): ProjectRepositoryLink => ({ ...legacy, projectId: "payroll", applicationId: "batch", ...link });
    expect(check([doc, legacy], [elsewhere({ repositoryId: "web-legacy" })])).toEqual([]);
    expect(check([doc, legacy], [elsewhere({ repositoryId: "web-legacy", role: "document", applicationId: null })])[0]?.message).toBe(
      "Repository web-legacy is the document repository of project payroll.",
    );
    expect(check([doc], [elsewhere({ repositoryId: "billing-docs" })])[0]?.message).toMatch(/document repository belongs to one project only/);
  });

  it("groups an application's repositories into AS-IS and TO-BE", () => {
    expect(groupRepositories([legacy, data, target], doc)).toEqual({
      asIs: { legacy: [legacy], legacyData: [data] },
      toBe: { document: doc, targets: [target] },
    });
  });
});
