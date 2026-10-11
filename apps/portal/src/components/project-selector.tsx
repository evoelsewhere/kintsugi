// Project selector of project-scoped pages: the projects as a Select; the choice is kept in the
// URL and in this browser (lib/project-selection.ts).

import { FolderKanban } from "lucide-react";
import { Select } from "@/components/ui/select";
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
