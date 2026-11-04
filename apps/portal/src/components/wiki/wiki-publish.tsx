// Publishing a page from the editor (ADR-0098 decision 3): a dialog for the message, then whatever the API answers. The
// page is published as a pull request for review, or as a commit when the person may publish straight away; when the page
// moved in the repository meanwhile the person first sees the merged result, or settles the conflict in a Git style box.
// Nothing is overwritten silently, and the draft stays in the editor whatever the answer is.

import { GitMerge, GitPullRequest, TriangleAlert } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Textarea } from "@/components/ui/textarea";
import { wikiEditApi } from "@/lib/api/wiki-edit";
import { documentsApi } from "@/lib/api/documents";
import { useLoader } from "@/lib/use-loader";
import { cn } from "@/lib/utils";
import { wikiPageLink, wikiRead } from "@/lib/wiki";
import {
  classifyPublishFailure,
  type ConflictBody,
  defaultPublishMessage,
  hasConflictMarkers,
  lineDiff,
  messageProblem,
  publishModeLine,
  type PublishFailure,
  type PublishRequest,
  type PublishResult,
  withConflictMarkers,
  withoutEnding,
  type WriteSummary,
} from "@/lib/wiki-edit";

export interface PublishFlowProps {
  projectId: string;
  path: string;
  /** The page's title, for the default message. */
  title: string;
  /** Whether the result is a commit to the default branch rather than a pull request (`GET wiki/access` `direct`). */
  direct: boolean;
  /** Saves what is typed and gives the revision of the draft to publish. */
  saveDraft: () => Promise<number>;
  open: boolean;
  onClose: () => void;
}

type Stage =
  | { kind: "form"; failure?: Exclude<PublishFailure, { kind: "conflict" }> | undefined }
  | { kind: "preview"; merged: string; head: { commit: string; hash: string | null } }
  | { kind: "conflict"; body: ConflictBody }
  | { kind: "done"; write: WriteSummary }
  | { kind: "unchanged" };

export function PublishFlow({ projectId, path, title, direct, saveDraft, open, onClose }: PublishFlowProps): React.JSX.Element | null {
  const [message, setMessage] = useState(() => defaultPublishMessage(title));
  const [minor, setMinor] = useState(false);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<Stage>({ kind: "form" });
  const [revision, setRevision] = useState<number | null>(null);

  if (!open) return null;

  const send = async (extra: Pick<PublishRequest, "mergedFrom" | "resolvedText"> = {}): Promise<void> => {
    setBusy(true);
    try {
      // The server publishes the revision it holds: what is typed is saved first, and the page waits for it.
      const saved = revision !== null && extra.mergedFrom !== undefined ? revision : await saveDraft();
      setRevision(saved);
      const result: PublishResult = await wikiEditApi.publish(projectId, { path, revision: saved, message: message.trim(), minor, ...extra });
      if (result.outcome === "published") setStage({ kind: "done", write: result.write });
      else if (result.outcome === "unchanged") setStage({ kind: "unchanged" });
      else setStage({ kind: "preview", merged: result.merged, head: result.head });
    } catch (error) {
      const failure = classifyPublishFailure(error);
      if (failure.kind === "conflict") setStage({ kind: "conflict", body: failure.body });
      else setStage({ kind: "form", failure });
    } finally {
      setBusy(false);
    }
  };

  const problem = messageProblem(message);
  const finished = stage.kind === "done" || stage.kind === "unchanged";

  return (
    <Modal
      open
      size={stage.kind === "form" || finished ? "default" : "wide"}
      title={stage.kind === "preview" ? "The page changed meanwhile" : stage.kind === "conflict" ? "Settle the changes" : finished ? (stage.kind === "done" ? "Published" : "Nothing to publish") : "Publish this page"}
      {...(stage.kind === "form" ? { description: publishModeLine(direct) } : {})}
      onClose={onClose}
      footer={
        stage.kind === "form" ? (
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="solid" disabled={busy || problem !== undefined} onClick={() => void send()}>
              {busy ? "Publishing…" : direct ? "Commit" : "Open pull request"}
            </Button>
          </>
        ) : undefined
      }
    >
      {stage.kind === "form" ? (
        <div className="flex flex-col gap-3 text-[13px]">
          <label className="flex flex-col gap-1">
            <span className="text-text-secondary">Message</span>
            <Input value={message} maxLength={250} onChange={(event) => setMessage(event.target.value)} aria-invalid={problem !== undefined} />
            {problem === undefined ? null : <span className="text-[12px] text-[var(--ds-status-red)]">{problem}</span>}
          </label>
          <Checkbox checked={minor} onChange={setMinor} label="Minor edit" />
          <p className="flex items-center gap-2 text-text-muted">
            <GitPullRequest className="size-4" strokeWidth={1.5} aria-hidden="true" />
            {publishModeLine(direct)}
          </p>
          {stage.failure === undefined ? null : <FailureNotice failure={stage.failure} />}
        </div>
      ) : stage.kind === "preview" ? (
        <MergePreview
          projectId={projectId}
          path={path}
          head={stage.head}
          merged={stage.merged}
          busy={busy}
          onConfirm={() => void send({ mergedFrom: stage.head })}
          onBack={() => setStage({ kind: "form" })}
        />
      ) : stage.kind === "conflict" ? (
        <ConflictView
          body={stage.body}
          busy={busy}
          onPublish={(resolvedText) => void send({ resolvedText, mergedFrom: stage.body.head })}
          onBack={() => setStage({ kind: "form" })}
        />
      ) : stage.kind === "unchanged" ? (
        <div className="flex flex-col gap-3 text-[13px] text-text-secondary">
          <p>The page is the same as the one in the repository: there is no change to publish.</p>
          <Button className="self-start" onClick={onClose}>
            Close
          </Button>
        </div>
      ) : (
        <Published projectId={projectId} path={path} write={stage.write} onClose={onClose} />
      )}
    </Modal>
  );
}

/** What was refused, in the API's words; an open write names who and where. */
function FailureNotice({ failure }: { failure: Exclude<PublishFailure, { kind: "conflict" }> }): React.JSX.Element {
  return (
    <div role="alert" className="flex flex-col gap-1 rounded-lg bg-recessed p-3 text-[13px] text-[var(--ds-status-red)]">
      <p className="flex items-center gap-2">
        <TriangleAlert className="size-4" strokeWidth={1.75} aria-hidden="true" />
        {failure.message}
      </p>
      {failure.kind === "open-write" ? (
        <p className="text-text-secondary">
          {failure.author} has a change of this page waiting for review.
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
      <p className="text-text-muted">Your draft is kept in the editor.</p>
    </div>
  );
}

function Published({ projectId, path, write, onClose }: { projectId: string; path: string; write: WriteSummary; onClose: () => void }): React.JSX.Element {
  return (
    <div className="flex flex-col gap-3 text-[13px] text-text-secondary">
      {write.mode === "pull-request" ? (
        <p>
          A pull request was opened for review.
          {write.prUrl === undefined ? null : (
            <>
              {" "}
              <a href={write.prUrl} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
                Open the pull request
              </a>
            </>
          )}
        </p>
      ) : (
        <p>The page was committed to the default branch.</p>
      )}
      <div className="flex gap-2">
        <Link to={wikiPageLink(projectId, path)} className="text-accent hover:underline" onClick={onClose}>
          Back to the page
        </Link>
      </div>
    </div>
  );
}

/** The merged result of a page that changed meanwhile, with what the merge changes in the repository's version. */
function MergePreview({ projectId, path, head, merged, busy, onConfirm, onBack }: { projectId: string; path: string; head: { commit: string }; merged: string; busy: boolean; onConfirm: () => void; onBack: () => void }): React.JSX.Element {
  const headFile = useLoader(`wiki/${projectId}/${head.commit}/preview/${path}`, () => wikiRead(() => documentsApi.file(projectId, path, head.commit)));
  const changes = headFile.data === undefined ? null : lineDiff(headFile.data.content, merged);
  return (
    <div className="flex flex-col gap-3 text-[13px]">
      <p className="flex items-center gap-2 text-text-secondary">
        <GitMerge className="size-4" strokeWidth={1.5} aria-hidden="true" />
        Someone else changed this page while you were editing. Your changes and theirs do not overlap, so they were merged. Read the result, then confirm.
      </p>
      {changes === null ? (
        <pre aria-label="The merged page" className="max-h-[50vh] overflow-auto rounded-lg bg-recessed p-3 font-mono text-[12px] leading-5 whitespace-pre-wrap text-text-secondary">
          {merged}
        </pre>
      ) : (
        <>
          <p className="text-[12px] text-text-muted">What publishing changes in the repository’s current version:</p>
          <pre aria-label="Changes to the repository’s version" className="max-h-[50vh] overflow-auto rounded-lg bg-recessed p-3 font-mono text-[12px] leading-5 text-text-secondary">
            {changes.map((line, index) => (
              <span key={index} className={cn("block", line.type === "add" && "text-[var(--ds-status-green-dark)]", line.type === "del" && "text-[var(--ds-status-red)]")}>
                {line.type === "add" ? "+ " : line.type === "del" ? "− " : "  "}
                {withoutEnding(line.text)}
              </span>
            ))}
          </pre>
        </>
      )}
      <div className="flex flex-wrap gap-2">
        <Button variant="solid" disabled={busy} onClick={onConfirm}>
          {busy ? "Publishing…" : "Confirm and publish"}
        </Button>
        <Button disabled={busy} onClick={onBack}>
          Back
        </Button>
      </div>
    </div>
  );
}

/** The three texts of a conflict beside a box holding the merge with its conflict markers, to be settled by hand. */
function ConflictView({ body, busy, onPublish, onBack }: { body: ConflictBody; busy: boolean; onPublish: (text: string) => void; onBack: () => void }): React.JSX.Element {
  const start = useMemo(() => withConflictMarkers(body.base, body.ours, body.theirs), [body]);
  const [text, setText] = useState(start.text);
  const open = hasConflictMarkers(text);
  const changes = useMemo(() => lineDiff(body.theirs, text), [body.theirs, text]);
  return (
    <div className="flex flex-col gap-3 text-[13px]">
      <p className="text-text-secondary">
        Someone else changed the same lines. {start.conflicts === 0 ? "" : `${start.conflicts} ${start.conflicts === 1 ? "place needs" : "places need"} your decision. `}
        Edit the result below: keep one side or both, and remove the lines that start with <code className="font-mono">&lt;&lt;&lt;&lt;&lt;&lt;&lt;</code>, <code className="font-mono">=======</code> and{" "}
        <code className="font-mono">&gt;&gt;&gt;&gt;&gt;&gt;&gt;</code>.
      </p>
      <div className="grid gap-2 md:grid-cols-3">
        <Reference title="Base" text={body.base} />
        <Reference title="Yours" text={body.ours} />
        <Reference title="Theirs" text={body.theirs} />
      </div>
      <label className="flex flex-col gap-1">
        <span className="text-text-secondary">Result</span>
        <Textarea value={text} onChange={(event) => setText(event.target.value)} spellCheck={false} className="h-64 font-mono text-[12px]" aria-label="Result" />
      </label>
      {open ? (
        <p role="status" className="text-[12px] text-[var(--ds-status-red)]">
          A conflict marker is left in the result: remove it to publish.
        </p>
      ) : (
        <details className="text-[12px] text-text-muted">
          <summary className="cursor-pointer">What changes in the repository’s version</summary>
          <pre className="mt-1 max-h-48 overflow-auto rounded-lg bg-recessed p-2 font-mono text-[11px] leading-5">
            {changes.map((line, index) => (
              <span key={index} className={cn("block", line.type === "add" && "text-[var(--ds-status-green-dark)]", line.type === "del" && "text-[var(--ds-status-red)]")}>
                {line.type === "add" ? "+ " : line.type === "del" ? "− " : "  "}
                {withoutEnding(line.text)}
              </span>
            ))}
          </pre>
        </details>
      )}
      <div className="flex flex-wrap gap-2">
        <Button variant="solid" disabled={busy || open} onClick={() => onPublish(text)}>
          {busy ? "Publishing…" : "Publish the settled page"}
        </Button>
        <Button disabled={busy} onClick={onBack}>
          Back
        </Button>
      </div>
    </div>
  );
}

function Reference({ title, text }: { title: string; text: string }): React.JSX.Element {
  return (
    <section aria-label={title} className="flex min-w-0 flex-col gap-1">
      <h3 className="text-[12px] text-text-muted">{title}</h3>
      <pre className="h-40 overflow-auto rounded-lg bg-recessed p-2 font-mono text-[11px] leading-5 whitespace-pre-wrap text-text-secondary">{text}</pre>
    </section>
  );
}
