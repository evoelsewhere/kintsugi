// The selected project of project-scoped pages (Delivery): `?project=<id>` in the URL first
// (links and reloads keep it), then the last choice stored in this browser, then the first
// project. Choosing one updates both, so moving between pages keeps the same project.

import { useCallback, useEffect } from "react";
import { useSearchParams } from "react-router-dom";

const STORAGE_KEY = "kintsugi-project";

export function storedProject(): string | null {
  return localStorage.getItem(STORAGE_KEY);
}

export interface ProjectSelection {
  projectId: string | undefined;
  select: (id: string) => void;
}

export function useProjectSelection(projectIds: readonly string[] | undefined): ProjectSelection {
  const [params, setParams] = useSearchParams();
  const fromUrl = params.get("project");
  const stored = storedProject();
  const projectId =
    projectIds === undefined
      ? (fromUrl ?? undefined)
      : fromUrl !== null && projectIds.includes(fromUrl)
        ? fromUrl
        : stored !== null && projectIds.includes(stored)
          ? stored
          : projectIds[0];

  useEffect(() => {
    if (projectId !== undefined) localStorage.setItem(STORAGE_KEY, projectId);
  }, [projectId]);

  const select = useCallback(
    (id: string) => {
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

  return { projectId, select };
}
