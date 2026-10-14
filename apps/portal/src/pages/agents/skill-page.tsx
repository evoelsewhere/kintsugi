// Skill page (Administration → Agents → /skills/:name): a skill is a folder, shown like an editor
// shows a project — the file tree beside a read-only code view. Built-in skills carry SKILL.md plus
// references, scripts, assets and licenses; custom skills are SKILL.md alone.

import { ArrowLeft } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { CodeView } from "@/components/code/code-view";
import { FileTree } from "@/components/file-tree";
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
      <Breadcrumbs items={["Administration", "Agents", name]} />
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
            <Link to="/agents" className="inline-flex items-center gap-1.5 text-[13px] text-text-secondary hover:text-text">
              <ArrowLeft className="size-4" />
              Agents
            </Link>
          </>
        }
      />
      {skill.usedBy.length === 0 ? null : <p className="-mt-3 text-[12px] text-text-muted">Used by {skill.usedBy.join(", ")}</p>}
      <div className="flex h-[calc(100vh-17rem)] min-h-96 overflow-hidden rounded-[var(--geist-radius)] shadow-border">
        <nav aria-label="Skill files" className="w-60 shrink-0 overflow-auto p-2 [box-shadow:1px_0_0_rgba(0,0,0,0.08)]">
          <p className="px-2 pb-1.5 text-[11px] tracking-wide text-text-muted uppercase">{skill.name}</p>
          <FileTree paths={[...files.keys()]} selected={selected} onSelect={setSelected} />
        </nav>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center justify-between gap-3 px-3 py-1.5 font-mono text-[12px] text-text-secondary [box-shadow:0_1px_0_rgba(0,0,0,0.08)]">
            <span className="truncate">{selected}</span>
            <span className="shrink-0 text-text-muted">{text.split("\n").length} lines</span>
          </div>
          <div className="min-h-0 flex-1">
            <CodeView text={text} path={selected} />
          </div>
        </div>
      </div>
    </>
  );
}
