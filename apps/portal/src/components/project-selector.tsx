// Project selector of project-scoped pages: the projects as a Select; the choice is kept in the
// URL and in this browser (lib/project-selection.ts).

import { FolderKanban } from "lucide-react";
import { Select } from "@/components/ui/select";
import { StatusDot } from "@/components/ui/status-dot";
import type { ProjectView } from "@/lib/api/projects";

export function ProjectSelector({ projects, value, onChange }: { projects: ProjectView[]; value: string | undefined; onChange: (id: string) => void }): React.JSX.Element {
  return (
    <div className="w-64">
      <Select
        value={value ?? ""}
        placeholder="Choose a project"
        options={projects.map((project) => ({ value: project.id, label: project.name, hint: project.id, icon: <FolderKanban className="size-4 shrink-0 text-text-muted" strokeWidth={1.5} /> }))}
        onChange={onChange}
      />
    </div>
  );
}

/** Says that the project a link asked for is not one the person can see, and which project is shown instead. */
export function ProjectNotFound({ requested, shown }: { requested: string; shown: string | undefined }): React.JSX.Element {
  return (
    <p role="status" className="flex items-start gap-2 rounded-[var(--geist-radius)] bg-recessed px-3 py-2 text-[13px] text-text">
      <StatusDot tone="orange" className="mt-1.5 size-2 shrink-0" />
      <span>
        Project &ldquo;{requested}&rdquo; was not found, or you have no access to it{shown === undefined ? "." : `: showing ${shown} instead.`}
      </span>
    </p>
  );
}
