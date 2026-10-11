// Projects, applications and their repositories (ADR-0028). Pure types and rules: the API
// persists them, the portal shows them, kintsugi.yaml declares them.
//
// Runtime values of index.ts (DISPOSITIONS, REPOSITORY_ROLES, …) are only read inside
// functions: index.ts re-exports this module, so top-level reads would hit the import cycle.

import { type Disposition, REPOSITORY_ROLES, type RepositoryRole } from "./index.js";

/** One problem found by a validator; `path` locates it (e.g. `applications[0].repos[1].component`). */
export interface ValidationProblem {
  path: string;
  message: string;
}

/** A migration project. Its document repo is declared once, at project level. */
export interface Project {
  id: string;
  name: string;
  description?: string;
  /** Registered Git repository holding everything except code. */
  documentRepositoryId: string;
}

/** An application in scope of a project, with its 7R strategy and pipeline. */
export interface Application {
  id: string;
  projectId: string;
  name: string;
  disposition: Disposition;
  /** A built-in pipeline id, or the id of a pipeline declared in kintsugi.yaml. */
  pipeline?: string;
}

/**
 * A registered Git repository used by a project. `applicationId` is null only for the
 * `document` repo; `legacy`, `legacy-data` and `target` repos belong to an application.
 */
export interface ProjectRepositoryLink {
  projectId: string;
  applicationId: string | null;
  repositoryId: string;
  role: RepositoryRole;
  /** Architecture component a `target` repo implements; required for targets, absent otherwise. */
  component?: string;
}

/** Roles a repository can have inside an application: AS-IS (`legacy`, `legacy-data`) and TO-BE (`target`). */
export const APPLICATION_REPOSITORY_ROLES = ["legacy", "legacy-data", "target"] as const satisfies readonly RepositoryRole[];
export type ApplicationRepositoryRole = (typeof APPLICATION_REPOSITORY_ROLES)[number];

export interface ProjectRepositoryRulesInput {
  projectId: string;
  /** Ids of the project's applications. */
  applicationIds: readonly string[];
  /** Every repository link of the project, as it would be after the change. */
  links: readonly ProjectRepositoryLink[];
  /** Links of other projects to any of the same repositories. */
  otherProjectLinks?: readonly ProjectRepositoryLink[];
}

/**
 * Checks a project's repository links (ADR-0028):
 * - exactly one `document` repo, at project level;
 * - `legacy`, `legacy-data` and `target` repos belong to one of the project's applications;
 * - `component` is required for `target` and forbidden otherwise, and unique among an application's targets;
 * - a Git repository is linked at most once per project;
 * - a document repo belongs to one project only: it is not linked to any other project, in any role.
 *   Legacy and target repos may be shared between projects.
 * Returns every problem found; an empty list means the links are valid.
 */
export function projectRepositoryProblems(input: ProjectRepositoryRulesInput): ValidationProblem[] {
  const problems: ValidationProblem[] = [];
  const add = (path: string, message: string): void => {
    problems.push({ path, message });
  };
  const applications = new Set(input.applicationIds);

  const documents = input.links.filter((link) => link.role === "document");
  if (documents.length !== 1) add("links", `A project has exactly one document repository (found ${documents.length}).`);

  const seenRepositories = new Set<string>();
  const seenComponents = new Set<string>();
  input.links.forEach((link, index) => {
    const at = `links[${index}]`;
    if (link.projectId !== input.projectId) add(`${at}.projectId`, `Link belongs to project ${link.projectId}, not ${input.projectId}.`);
    if (!(REPOSITORY_ROLES as readonly string[]).includes(link.role)) {
      add(`${at}.role`, `Unknown repository role "${String(link.role)}"; expected one of ${REPOSITORY_ROLES.join(", ")}.`);
    }

    if (link.role === "document") {
      if (link.applicationId !== null) add(`${at}.applicationId`, "The document repository belongs to the project, not to an application.");
    } else if (link.applicationId === null) {
      add(`${at}.applicationId`, `A ${link.role} repository belongs to an application.`);
    } else if (!applications.has(link.applicationId)) {
      add(`${at}.applicationId`, `Unknown application ${link.applicationId}.`);
    }

    const component = link.component?.trim();
    if (link.role === "target") {
      if (component === undefined || component === "") {
        add(`${at}.component`, "A target repository needs the architecture component it implements.");
      } else {
        const key = `${link.applicationId ?? ""}\u0000${component}`;
        if (seenComponents.has(key)) add(`${at}.component`, `Application ${link.applicationId} already has a target repository for component ${component}.`);
        seenComponents.add(key);
      }
    } else if (link.component !== undefined) {
      add(`${at}.component`, "Only target repositories have a component.");
    }

    if (seenRepositories.has(link.repositoryId)) add(`${at}.repositoryId`, `Repository ${link.repositoryId} is linked to this project more than once.`);
    seenRepositories.add(link.repositoryId);

    for (const other of input.otherProjectLinks ?? []) {
      if (other.repositoryId !== link.repositoryId || other.projectId === input.projectId) continue;
      if (other.role === "document") {
        add(`${at}.repositoryId`, `Repository ${link.repositoryId} is the document repository of project ${other.projectId}.`);
      } else if (link.role === "document") {
        add(`${at}.repositoryId`, `Repository ${link.repositoryId} is already linked to project ${other.projectId}; a document repository belongs to one project only.`);
      }
    }
  });
  return problems;
}

/** An application's repositories, grouped as the portal shows them (ADR-0028). */
export interface RepositoryGroups<R> {
  /** Read-only for Kintsugi. */
  asIs: { legacy: R[]; legacyData: R[] };
  /** The document repo (shared by every application of the project) and the target repos. */
  toBe: { document: R | null; targets: R[] };
}

/** Groups one application's repositories into AS-IS and TO-BE; `document` is the project's document repo. */
export function groupRepositories<R extends { role: RepositoryRole }>(repositories: readonly R[], document: R | null): RepositoryGroups<R> {
  return {
    asIs: {
      legacy: repositories.filter((repository) => repository.role === "legacy"),
      legacyData: repositories.filter((repository) => repository.role === "legacy-data"),
    },
    toBe: { document, targets: repositories.filter((repository) => repository.role === "target") },
  };
}
