// Skill page (Administration → Plugins → Agent Builder → /plugins/builder/skills/:name): a skill is a
// folder, shown like an editor shows a project — the file tree beside a code view. Built-in skills
// are read-only. A custom skill can be edited by someone with agents.manage: change the files in the
// editor, add or delete files under references/, scripts/ and assets/, and save them together.

import { ArrowLeft, FilePlus2, Pencil, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { FileBrowser } from "@/components/file-browser";
import { Loaded } from "@/components/loaded";
import { PageHeading } from "@/components/page-heading";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { agentsApi, type SharedSkillView } from "@/lib/api/agents";
import { useAuth } from "@/lib/auth";
import { useLoader } from "@/lib/use-loader";

const SKILL_FILE = "SKILL.md";
/** Where a skill's extra files may live (the Agent Skills layout). */
const FOLDERS = ["references/", "scripts/", "assets/"];

export function SkillPage(): React.JSX.Element {
  const { name = "" } = useParams();
  const skill = useLoader(`skill:${name}`, () => agentsApi.getSkill(name));
  return (
    <div className="flex flex-col gap-5">
      <Breadcrumbs items={["Administration", "Plugins", "Agent Builder", name]} />
      <Loaded loader={skill}>{(data) => <SkillFiles key={`${data.name}:${data.updatedAt ?? ""}`} skill={data} onSaved={() => skill.reload()} />}</Loaded>
    </div>
  );
}

function SkillFiles({ skill, onSaved }: { skill: SharedSkillView; onSaved: () => Promise<void> }): React.JSX.Element {
  const { can } = useAuth();
  const toast = useToast();
  const canEdit = skill.source === "custom" && can("agents.manage");
  const initial = useMemo(() => new Map<string, string>([[SKILL_FILE, skill.content], ...skill.files.map((file) => [file.path, file.content] as const)]), [skill]);
  const [files, setFiles] = useState<ReadonlyMap<string, string>>(initial);
  const [description, setDescription] = useState(skill.description);
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState(SKILL_FILE);
  const [newPath, setNewPath] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const text = files.get(selected) ?? "";

  const setText = (path: string, content: string): void => setFiles((current) => new Map(current).set(path, content));

  function addFile(): void {
    const path = newPath.trim();
    if (!FOLDERS.some((folder) => path.startsWith(folder) && path.length > folder.length) || path.includes("..") || files.has(path)) {
      setError(`A new file goes under ${FOLDERS.join(", ")} and must not exist yet.`);
      return;
    }
    setError(null);
    setText(path, "");
    setSelected(path);
    setNewPath("");
  }

  function deleteFile(path: string): void {
    setFiles((current) => {
      const next = new Map(current);
      next.delete(path);
      return next;
    });
    setSelected(SKILL_FILE);
  }

  function cancel(): void {
    setFiles(initial);
    setDescription(skill.description);
    setSelected(SKILL_FILE);
    setError(null);
    setEditing(false);
  }

  async function save(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const extra = Object.fromEntries([...files].filter(([path]) => path !== SKILL_FILE));
      await agentsApi.updateSkill(skill.name, { name: skill.name, description, content: files.get(SKILL_FILE) ?? "", files: extra });
      toast.success("Skill saved", skill.name);
      setEditing(false);
      await onSaved();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeading
        title={skill.name}
        description={editing ? undefined : skill.description}
        actions={
          <>
            {skill.source === "builtin" ? <Badge>Built-in · read-only</Badge> : null}
            {canEdit && !editing ? (
              <Button size="small" variant="solid" onClick={() => setEditing(true)}>
                <Pencil className="size-4" />
                Edit
              </Button>
            ) : null}
            {editing ? (
              <>
                <Button size="small" variant="ghost" disabled={busy} onClick={cancel}>
                  Cancel
                </Button>
                <Button size="small" variant="solid" disabled={busy} onClick={() => void save()}>
                  {busy ? "Saving…" : "Save"}
                </Button>
              </>
            ) : null}
            <Link to="/plugins/builder" className="inline-flex items-center gap-1.5 text-[13px] text-text-secondary hover:text-text">
              <ArrowLeft className="size-4" />
              Agents
            </Link>
          </>
        }
      />
      {editing ? (
        <label className="-mt-3 flex flex-col gap-1 text-[12px] text-text-secondary">
          Description (the skill's one-line summary, in SKILL.md's frontmatter)
          <Input value={description} onChange={(event) => setDescription(event.target.value)} />
        </label>
      ) : skill.usedBy.length === 0 ? null : (
        <p className="-mt-3 text-[12px] text-text-muted">Used by {skill.usedBy.join(", ")}</p>
      )}
      {error === null ? null : (
        <p role="alert" className="text-[13px] text-[var(--ds-status-red)]">
          {error}
        </p>
      )}
      <FileBrowser
        title={skill.name}
        paths={[...files.keys()]}
        selected={selected}
        onSelect={setSelected}
        text={text}
        {...(editing ? { onChange: (content: string) => setText(selected, content) } : {})}
        treeActions={
          editing ? (
            <form
              className="mb-2 flex gap-1 px-1"
              onSubmit={(event) => {
                event.preventDefault();
                addFile();
              }}
            >
              <Input value={newPath} placeholder="references/notes.md" aria-label="New file path" onChange={(event) => setNewPath(event.target.value)} />
              <Button type="submit" size="icon" variant="ghost" aria-label="Add file">
                <FilePlus2 className="size-4" />
              </Button>
            </form>
          ) : null
        }
        fileActions={
          editing && selected !== SKILL_FILE ? (
            <button type="button" className="inline-flex items-center gap-1 text-[12px] text-[var(--ds-status-red)] hover:underline" onClick={() => deleteFile(selected)}>
              <Trash2 className="size-3.5" />
              Delete file
            </button>
          ) : null
        }
      />
    </>
  );
}
