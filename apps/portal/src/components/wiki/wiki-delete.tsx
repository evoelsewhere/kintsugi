// Deleting a page (AUT-16): the dialog opens by counting the links into the page and saying they will break, and only then
// asks for a message to confirm. The delete is one write, a pull request or a commit, like a publish; the links into the
// page become broken links, listed in the report.

import { Trash2 } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { Loaded } from "@/components/loaded";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { brainApi } from "@/lib/api/brain";
import { wikiEditApi } from "@/lib/api/wiki-edit";
import { errorText } from "@/lib/format";
import { useLoader } from "@/lib/use-loader";
import { WIKI_BASE, wikiLink, wikiRead } from "@/lib/wiki";
import { defaultDeleteMessage, deleteWarning, messageProblem, publishModeLine, type WriteSummary } from "@/lib/wiki-edit";

export function DeleteButton({ projectId, path, direct }: { projectId: string; path: string; direct: boolean }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="small" variant="danger" onClick={() => setOpen(true)}>
        <Trash2 />
        Delete
      </Button>
      {open ? <DeleteDialog projectId={projectId} path={path} direct={direct} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function DeleteDialog({ projectId, path, direct, onClose }: { projectId: string; path: string; direct: boolean; onClose: () => void }): React.JSX.Element {
  // The number of links into the page: the same count the backlinks panel shows, read before anything can be confirmed.
  const links = useLoader(`wiki/${projectId}/delete/${path}`, () => wikiRead(() => brainApi.backlinks(projectId, path, 0, 1)));
  const [message, setMessage] = useState(() => defaultDeleteMessage(path));
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [done, setDone] = useState<WriteSummary | null>(null);
  const problem = messageProblem(message);

  const confirm = async (): Promise<void> => {
    setBusy(true);
    setRefusal(null);
    try {
      const result = await wikiEditApi.deletePage(projectId, { path, message: message.trim() });
      setDone(result.write);
    } catch (error) {
      setRefusal(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      title="Delete this page"
      {...(done === null ? { description: publishModeLine(direct) } : {})}
      onClose={onClose}
      footer={
        done === null ? (
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="solid" disabled={busy || links.data === undefined || problem !== undefined} onClick={() => void confirm()}>
              {busy ? "Deleting…" : "Delete the page"}
            </Button>
          </>
        ) : undefined
      }
    >
      {done !== null ? (
        <div className="flex flex-col gap-3 text-[13px] text-text-secondary">
          {done.mode === "pull-request" ? (
            <p>
              A pull request was opened for review: the page is deleted once it is merged.
              {done.prUrl === undefined ? null : (
                <>
                  {" "}
                  <a href={done.prUrl} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
                    Open the pull request
                  </a>
                </>
              )}
            </p>
          ) : (
            <p>The page was deleted in one commit to the default branch.</p>
          )}
          <Link to={done.mode === "direct" ? wikiLink(projectId, "") : wikiLink(projectId, path)} className="self-start text-accent hover:underline" onClick={onClose}>
            {done.mode === "direct" ? "Back to the wiki" : "Back to the page"}
          </Link>
        </div>
      ) : (
        <div className="flex flex-col gap-3 text-[13px]">
          <Loaded loader={links} rows={1}>
            {(view) => (
              <p role="status" className={view.total === 0 ? "text-text-secondary" : "text-[var(--ds-status-red)]"}>
                {deleteWarning(view.total)}{" "}
                {view.total === 0 ? null : (
                  <Link to={`${WIKI_BASE}/${path.split("/").map(encodeURIComponent).join("/")}?project=${encodeURIComponent(projectId)}#backlinks`} className="text-accent hover:underline" onClick={onClose}>
                    See them
                  </Link>
                )}
              </p>
            )}
          </Loaded>
          <label className="flex flex-col gap-1">
            <span className="text-text-secondary">Message</span>
            <Input value={message} maxLength={250} onChange={(event) => setMessage(event.target.value)} />
            {problem === undefined ? null : <span className="text-[12px] text-[var(--ds-status-red)]">{problem}</span>}
          </label>
          {refusal === null ? null : (
            <p role="alert" className="text-[var(--ds-status-red)]">
              {refusal}
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}
