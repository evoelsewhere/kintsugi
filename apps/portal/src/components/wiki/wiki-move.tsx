// Moving or renaming a page (ADR-0098 decision 5): one commit that moves the file and rewrites the links to it. The person
// first sees what will change (the page and each page whose links are rewritten) and only then confirms; changing the target
// puts the preview out of date. The result is a pull request or a commit, as when publishing.

import { ArrowRightLeft } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { brainApi } from "@/lib/api/brain";
import { wikiEditApi } from "@/lib/api/wiki-edit";
import { cn } from "@/lib/utils";
import { wikiPageLink } from "@/lib/wiki";
import {
  classifyMoveFailure,
  defaultMoveMessage,
  folderOfPath,
  messageProblem,
  type MoveFailure,
  type MovePreview,
  moveTargetProblem,
  previewIsCurrent,
  publishModeLine,
  type WriteSummary,
} from "@/lib/wiki-edit";

export function MoveButton({ projectId, path, direct }: { projectId: string; path: string; direct: boolean }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="small" onClick={() => setOpen(true)}>
        <ArrowRightLeft />
        Move or rename
      </Button>
      {open ? <MoveDialog projectId={projectId} path={path} direct={direct} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function MoveDialog({ projectId, path, direct, onClose }: { projectId: string; path: string; direct: boolean; onClose: () => void }): React.JSX.Element {
  const [target, setTarget] = useState(path);
  const [message, setMessage] = useState(() => defaultMoveMessage(path, path));
  const [preview, setPreview] = useState<{ target: string; result: MovePreview; otherSpace: boolean } | null>(null);
  const [failure, setFailure] = useState<MoveFailure | null>(null);
  const [done, setDone] = useState<WriteSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const problem = moveTargetProblem(path, target);
  const messageIssue = messageProblem(message);
  const current = preview !== null && previewIsCurrent(preview.target, target);

  const showPreview = async (): Promise<void> => {
    const to = target.trim();
    setBusy(true);
    setFailure(null);
    try {
      const result = await wikiEditApi.movePreview(projectId, { from: path, to, message: message.trim() });
      // The page keeps its id wherever it goes; say so when the target is in another space.
      const [here, there] = await Promise.all([brainApi.lookup(projectId, path).catch(() => null), brainApi.lookup(projectId, folderOfPath(to)).catch(() => null)]);
      const spaceHere = here?.matches.find((match) => match.kind === "document")?.space ?? null;
      const spaceThere = there?.matches.find((match) => match.kind === "folder")?.space ?? null;
      setPreview({ target: to, result, otherSpace: spaceHere !== spaceThere });
    } catch (error) {
      setPreview(null);
      setFailure(classifyMoveFailure(error));
    } finally {
      setBusy(false);
    }
  };

  const confirm = async (): Promise<void> => {
    if (preview === null) return;
    setBusy(true);
    setFailure(null);
    try {
      const result = await wikiEditApi.move(projectId, { from: path, to: preview.target, message: message.trim() });
      if (result.outcome === "published") setDone(result.write);
    } catch (error) {
      setFailure(classifyMoveFailure(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      size="wide"
      title="Move or rename this page"
      {...(done === null ? { description: publishModeLine(direct) } : {})}
      onClose={onClose}
      footer={
        done === null ? (
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button disabled={busy || problem !== undefined} onClick={() => void showPreview()}>
              {busy && !current ? "Checking…" : "Preview the changes"}
            </Button>
            <Button variant="solid" disabled={busy || !current || messageIssue !== undefined} onClick={() => void confirm()}>
              Confirm
            </Button>
          </>
        ) : undefined
      }
    >
      {done !== null ? (
        <div className="flex flex-col gap-3 text-[13px] text-text-secondary">
          {done.mode === "pull-request" ? (
            <p>
              A pull request was opened for review: the page moves once it is merged.
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
            <p>The page was moved and the links to it were rewritten, in one commit to the default branch.</p>
          )}
          <Link to={wikiPageLink(projectId, done.mode === "direct" ? preview?.target ?? path : path)} className="self-start text-accent hover:underline" onClick={onClose}>
            {done.mode === "direct" ? "Open the page at its new path" : "Back to the page"}
          </Link>
        </div>
      ) : (
        <div className="flex flex-col gap-3 text-[13px]">
          <label className="flex flex-col gap-1">
            <span className="text-text-secondary">New path</span>
            <Input
              value={target}
              spellCheck={false}
              className="font-mono"
              onChange={(event) => {
                setTarget(event.target.value);
                setMessage(defaultMoveMessage(path, event.target.value.trim()));
              }}
              aria-invalid={problem !== undefined && target !== path}
            />
            {problem === undefined || target === path ? null : <span className="text-[12px] text-[var(--ds-status-red)]">{problem}</span>}
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-text-secondary">Message</span>
            <Input value={message} maxLength={250} onChange={(event) => setMessage(event.target.value)} />
            {messageIssue === undefined ? null : <span className="text-[12px] text-[var(--ds-status-red)]">{messageIssue}</span>}
          </label>
          {failure === null ? null : (
            <div role="alert" className="flex flex-col gap-1 rounded-lg bg-recessed p-3 text-[var(--ds-status-red)]">
              <p>{failure.message}</p>
              {failure.kind === "open-write" ? (
                <p className="text-text-secondary">
                  {failure.author} has a change waiting for review.
                  {failure.prUrl === null ? null : (
                    <>
                      {" "}
                      <a href={failure.prUrl} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
                        Open the pull request
                      </a>
                    </>
                  )}
                </p>
              ) : null}
            </div>
          )}
          {preview === null ? null : (
            <section aria-label="Changes of the move" className={cn("flex flex-col gap-2", !current && "opacity-50")}>
              <p className="text-text-secondary">
                {current ? "" : "This preview is of another target: preview again. "}
                {preview.result.rewrittenLinks} {preview.result.rewrittenLinks === 1 ? "link is" : "links are"} rewritten in {preview.result.entries.filter((entry) => entry.kind === "rewritten").length}{" "}
                {preview.result.entries.filter((entry) => entry.kind === "rewritten").length === 1 ? "page" : "pages"}.
              </p>
              {preview.otherSpace ? <p className="text-text-muted">The page moves to another space and keeps its id.</p> : null}
              <ul className="flex max-h-56 flex-col gap-0.5 overflow-auto rounded-lg bg-recessed p-2 font-mono text-[12px]">
                {preview.result.entries.map((entry) => (
                  <li key={`${entry.kind}:${entry.path}`} className="flex flex-wrap gap-x-2">
                    <span className="w-20 shrink-0 text-text-muted">{entry.kind === "moved" ? "moved" : "rewritten"}</span>
                    <span className="break-all text-text-secondary">
                      {entry.renameFrom === undefined ? entry.path : `${entry.renameFrom} → ${entry.path}`}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </Modal>
  );
}
