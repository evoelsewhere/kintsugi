// The design sets of a project on its page (ADR-0045): how many the document repo defines, whether
// their definitions have faults, and the way to the Design view. Read only: templates are changed
// by a pull request to standards/design/.

import { Link } from "react-router-dom";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loaded } from "@/components/loaded";
import { designApi } from "@/lib/api/design";
import type { ProjectDetail } from "@/lib/api/projects";
import { useLoader } from "@/lib/use-loader";

export function DesignSetsCard({ project }: { project: ProjectDetail }): React.JSX.Element | null {
  const first = project.applications[0];
  const sets = useLoader(`project-design-sets/${project.id}`, () => (project.documentRepository === null ? Promise.resolve(null) : designApi.sets(project.id).catch(() => null)));
  if (project.documentRepository === null) return null;
  const link = `/delivery/design?project=${encodeURIComponent(project.id)}${first === undefined ? "" : `&app=${encodeURIComponent(first.id)}`}&tab=sets`;
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Design sets</CardTitle>
          <CardDescription>The format of the design documents of every unit, defined in standards/design/ of the document repo.</CardDescription>
        </div>
        <Link to={link} className="shrink-0 text-[13px] text-accent hover:underline">
          Open the Design view
        </Link>
      </CardHeader>
      <div className="mt-3 text-[13px] text-text-secondary">
        <Loaded loader={sets} rows={1}>
          {(view) =>
            view === null ? (
              <p>The design sets could not be read: the document repo is not mirrored yet.</p>
            ) : view.sets.length === 0 ? (
              <p>No design sets yet. Copy the starter from standards/design/ of the starter template and adapt it.</p>
            ) : (
              <p>
                {view.sets.map((set) => `${set.title} (${set.id}@${set.version})`).join(", ")}
                {view.problems.length === 0 ? "." : ` — ${view.problems.length} problem${view.problems.length === 1 ? "" : "s"} in the definitions.`}
              </p>
            )
          }
        </Loaded>
      </div>
    </Card>
  );
}
