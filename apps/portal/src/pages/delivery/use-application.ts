// The application a Delivery stage page works on: ?app= in the URL, the project's first
// application otherwise. Choosing another one keeps the project and drops the open run.

import { useSearchParams } from "react-router-dom";
import type { ApplicationView, ProjectDetail } from "@/lib/api/projects";

export function useApplication(project: ProjectDetail): { application: ApplicationView | undefined; choose: (id: string) => void } {
  const [params, setParams] = useSearchParams();
  const appId = params.get("app");
  const application = project.applications.find((entry) => entry.id === appId) ?? project.applications[0];
  const choose = (id: string): void =>
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        next.set("app", id);
        next.delete("run");
        return next;
      },
      { replace: true },
    );
  return { application, choose };
}
