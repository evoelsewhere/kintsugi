// The selected project of project-scoped pages (Delivery): `?project=<id>` in the URL first
// (links and reloads keep it), then the last choice stored in this browser, then the first
// project. Choosing one updates both, so moving between pages keeps the same project. A URL
// that names no project the person can see is said so, and rewritten to the project shown:
// a shared link must never quietly open another project with its Run buttons.

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";

const STORAGE_KEY = "kintsugi-project";

export function storedProject(): string | null {
  return localStorage.getItem(STORAGE_KEY);
}

export interface ProjectSelection {
  projectId: string | undefined;
  select: (id: string) => void;
  /** The project the URL asked for when it is none of the person's projects; shown until another project is chosen. */
  notFound: string | undefined;
}

/**
 * The project to show: the URL's when it is one of `projectIds` (undefined while they load), else the stored one, else
 * the first. `rejected` is the URL's id when it is none of them.
 */
export function resolveProject(projectIds: readonly string[] | undefined, fromUrl: string | null, stored: string | null): { projectId: string | undefined; rejected?: string } {
  if (projectIds === undefined) return { projectId: fromUrl ?? undefined };
  if (fromUrl !== null && projectIds.includes(fromUrl)) return { projectId: fromUrl };
  const projectId = stored !== null && projectIds.includes(stored) ? stored : projectIds[0];
  return fromUrl === null ? { projectId } : { projectId, rejected: fromUrl };
}

export function useProjectSelection(projectIds: readonly string[] | undefined): ProjectSelection {
  const [params, setParams] = useSearchParams();
  const { projectId, rejected } = resolveProject(projectIds, params.get("project"), storedProject());
  const [notFound, setNotFound] = useState<{ requested: string; shown: string | undefined } | undefined>(undefined);
  // Kept across the rewrite of the URL below, which ends the rejection itself.
  if (rejected !== undefined && (notFound?.requested !== rejected || notFound.shown !== projectId)) setNotFound({ requested: rejected, shown: projectId });

  // Only a project checked against the person's projects is kept: a link's unknown id must not replace their last choice.
  const checked = projectIds !== undefined;
  useEffect(() => {
    if (checked && projectId !== undefined) localStorage.setItem(STORAGE_KEY, projectId);
  }, [checked, projectId]);

  useEffect(() => {
    if (rejected === undefined) return;
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        if (projectId === undefined) next.delete("project");
        else next.set("project", projectId);
        // An application or a run of the project asked for is none of the project shown.
        next.delete("app");
        next.delete("run");
        return next;
      },
      { replace: true },
    );
  }, [rejected, projectId, setParams]);

  const select = useCallback(
    (id: string) => {
      setNotFound(undefined);
      localStorage.setItem(STORAGE_KEY, id);
      setParams(
        (previous) => {
          const next = new URLSearchParams(previous);
          next.set("project", id);
          // Application and run belong to the previous project.
          next.delete("app");
          next.delete("run");
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  return { projectId, select, notFound: notFound !== undefined && notFound.shown === projectId ? notFound.requested : undefined };
}
