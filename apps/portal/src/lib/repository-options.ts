// The choices of a project's document repository (ADR-0028): every registered repository, with
// the ones another project uses, or that this project links to an application, shown as in use
// and not selectable. A document repo belongs to one project only and is linked to it once.

import type { SelectOption } from "@/components/ui/select";
import type { GitRepositoryView } from "./api/git";
import type { RepositoryLinkView } from "./api/projects";

/** Why a repository cannot be the document repo of `projectId` (null for a new project), or undefined when it can. */
export function documentRepositoryBlocker(links: readonly RepositoryLinkView[], projectId: string | null): string | undefined {
  const elsewhere = links.find((link) => link.projectId !== projectId);
  if (elsewhere !== undefined) {
    return elsewhere.role === "document"
      ? `In use: document repo of ${elsewhere.projectId}`
      : `In use: ${elsewhere.role} repo of ${elsewhere.projectId}${elsewhere.applicationId === null ? "" : ` / ${elsewhere.applicationId}`}`;
  }
  const here = links.find((link) => link.projectId === projectId && link.role !== "document");
  return here === undefined ? undefined : `In use: ${here.role} repo of ${here.applicationId ?? "this project"}`;
}

/** Repositories that can be chosen first, then those in use (disabled, with why). */
export function documentRepositoryOptions(repositories: readonly GitRepositoryView[], links: readonly RepositoryLinkView[], projectId: string | null): SelectOption[] {
  const options = repositories.map((repository): SelectOption => {
    const blocker = documentRepositoryBlocker(
      links.filter((link) => link.repositoryId === repository.id),
      projectId,
    );
    return blocker === undefined ? { value: repository.id, label: repository.id, hint: repository.url } : { value: repository.id, label: repository.id, hint: blocker, disabled: true };
  });
  return [...options.filter((option) => option.disabled !== true), ...options.filter((option) => option.disabled === true)];
}
