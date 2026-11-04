// "New page" in a folder of the wiki: a title and, when the folder has templates, the template to start from. The API
// makes the page's id and path and answers with its draft; the editor then opens on that draft. Nothing is written to the
// repository until the page is published. The action is offered only where the person may write.

import { FilePlus2 } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { wikiEditApi } from "@/lib/api/wiki-edit";
import { errorText } from "@/lib/format";
import { useLoader } from "@/lib/use-loader";
import { wikiPageLink, wikiRead } from "@/lib/wiki";
import { newPageBody, newPageProbe, newPageProblem } from "@/lib/wiki-edit";

export function NewPageButton({ projectId, folder }: { projectId: string; folder: string }): React.JSX.Element | null {
  const probe = newPageProbe(folder);
  const access = useLoader(`wiki/${projectId}/access/${probe ?? "-"}`, () => (probe === undefined ? Promise.resolve(null) : wikiRead(() => wikiEditApi.access(projectId, probe))));
  const [open, setOpen] = useState(false);
  const view = access.data;
  // A folder where pages cannot be written offers nothing; a refusal says why instead of hiding the action.
  if (view === undefined || view === null || !view.editable) return null;
  return (
    <>
      <Button size="small" disabled={!view.canWrite} title={view.refusal?.message} onClick={() => setOpen(true)}>
        <FilePlus2 />
        New page
      </Button>
      {view.canWrite || view.refusal === null ? null : <span className="text-[12px] text-text-muted">{view.refusal.message}</span>}
      {open ? <NewPageDialog projectId={projectId} folder={folder} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function NewPageDialog({ projectId, folder, onClose }: { projectId: string; folder: string; onClose: () => void }): React.JSX.Element {
  const navigate = useNavigate();
  const templates = useLoader(`wiki/${projectId}/templates/${folder}`, () => wikiRead(() => wikiEditApi.templates(projectId, folder)));
  const [title, setTitle] = useState("");
  const [template, setTemplate] = useState("");
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const problem = newPageProblem(title);

  const create = async (): Promise<void> => {
    setBusy(true);
    setRefusal(null);
    try {
      const draft = await wikiEditApi.createPage(projectId, newPageBody(folder, title, template));
      void navigate(wikiPageLink(projectId, draft.path, { mode: "edit" }));
    } catch (failure) {
      setRefusal(errorText(failure));
      setBusy(false);
    }
  };

  const options = templates.data ?? [];
  return (
    <Modal
      open
      title="New page"
      description={`In ${folder}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="solid" disabled={busy || problem !== undefined} onClick={() => void create()}>
            {busy ? "Creating…" : "Create and edit"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-[13px]">
        <label className="flex flex-col gap-1">
          <span className="text-text-secondary">Title</span>
          <Input value={title} maxLength={250} autoFocus onChange={(event) => setTitle(event.target.value)} aria-invalid={title !== "" && problem !== undefined} />
          {title === "" || problem === undefined ? null : <span className="text-[12px] text-[var(--ds-status-red)]">{problem}</span>}
        </label>
        {options.length === 0 ? null : (
          <div className="flex flex-col gap-1">
            <span className="text-text-secondary">Template</span>
            <Select
              value={template}
              placeholder="No template"
              options={[{ value: "", label: "No template" }, ...options.map((option) => ({ value: option.path, label: option.title, ...(option.summary === "" ? {} : { hint: option.summary }) }))]}
              onChange={setTemplate}
            />
          </div>
        )}
        {refusal === null ? null : (
          <p role="alert" className="text-[var(--ds-status-red)]">
            {refusal}
          </p>
        )}
        <p className="text-text-muted">The page is saved as your draft; it joins the wiki when you publish it.</p>
      </div>
    </Modal>
  );
}
