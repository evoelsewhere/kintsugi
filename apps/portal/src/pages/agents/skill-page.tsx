// Skill page (Administration → Plugins → Agent Builder → /plugins/builder/skills/:name): a skill is a folder, shown like an editor
// shows a project — the file tree beside a read-only code view. Built-in skills carry SKILL.md plus
// references, scripts, assets and licenses; custom skills are SKILL.md alone.

import { ArrowLeft } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { FileBrowser } from "@/components/file-browser";
import { Loaded } from "@/components/loaded";
import { PageHeading } from "@/components/page-heading";
import { Badge } from "@/components/ui/badge";
import { agentsApi, type SharedSkillView } from "@/lib/api/agents";
import { useLoader } from "@/lib/use-loader";

export function SkillPage(): React.JSX.Element {
  const { name = "" } = useParams();
  const skill = useLoader(`skill:${name}`, () => agentsApi.getSkill(name));
  return (
    <div className="flex flex-col gap-5">
      <Breadcrumbs items={["Administration", "Plugins", "Agent Builder", name]} />
      <Loaded loader={skill}>{(data) => <SkillFiles key={data.name} skill={data} />}</Loaded>
    </div>
  );
}

function SkillFiles({ skill }: { skill: SharedSkillView }): React.JSX.Element {
  const files = useMemo(() => new Map([["SKILL.md", skill.content], ...skill.files.map((file) => [file.path, file.content] as const)]), [skill]);
  const [selected, setSelected] = useState("SKILL.md");
  const text = files.get(selected) ?? "";
  return (
    <>
      <PageHeading
        title={skill.name}
        description={skill.description}
        actions={
          <>
            {skill.source === "builtin" ? <Badge>Built-in · read-only</Badge> : null}
            <Link to="/plugins/builder" className="inline-flex items-center gap-1.5 text-[13px] text-text-secondary hover:text-text">
              <ArrowLeft className="size-4" />
              Agents
            </Link>
          </>
        }
      />
      {skill.usedBy.length === 0 ? null : <p className="-mt-3 text-[12px] text-text-muted">Used by {skill.usedBy.join(", ")}</p>}
      <FileBrowser title={skill.name} paths={[...files.keys()]} selected={selected} onSelect={setSelected} text={text} />
    </>
  );
}
