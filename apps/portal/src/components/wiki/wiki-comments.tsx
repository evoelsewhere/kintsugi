// The comments of a page, beside it: the open count, each comment with its answers, a box to write one on the page as a whole
// and, when a passage of the page is selected, a button to comment on that passage. A comment on a passage is marked on the
// page while the passage is still there; one whose passage is gone is listed under Orphaned with its quote, never lost.
// Bodies are Markdown shown by the reader's renderer (no raw HTML, no remote image loaded, links open with noopener).

import { MessageSquareText, TextSelect } from "lucide-react";
import { type RefObject, useState } from "react";
import { Loaded } from "@/components/loaded";
import { Markdown } from "@/components/results/lazy-markdown";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { wikiCommentsApi } from "@/lib/api/wiki-comments";
import { errorText, formatRelative } from "@/lib/format";
import { useLoader } from "@/lib/use-loader";
import { wikiRead } from "@/lib/wiki";
import { commentProblem, type CommentView, threadsOf, type Thread } from "@/lib/wiki-comments";
import { showPassage, type SelectedPassage, useCommentHighlights, useSelectedPassage } from "./use-comment-anchors";

export interface WikiCommentsProps {
  projectId: string;
  /** The commit the Brain indexed: the passages are placed at it. */
  commit: string;
  path: string;
  /** The rendered page: where passages are selected and marked. */
  page: RefObject<HTMLElement | null>;
}

export function WikiComments({ projectId, commit, path, page }: WikiCommentsProps): React.JSX.Element {
  // An API without the comments route (or a page the head does not have) answers 404: the page shows no panel then.
  const list = useLoader(`wiki/${projectId}/${commit}/comments/${path}`, () =>
    wikiRead(() => wikiCommentsApi.list(projectId, path)).catch((failure: unknown) => {
      if ((failure as { status?: unknown }).status === 404) return null;
      throw failure;
    }),
  );
  const selected = useSelectedPassage(page);
  const comments = list.data?.comments ?? [];
  useCommentHighlights(page, comments, list.data !== undefined);
  const grouped = threadsOf(comments);
  if (list.data === null) return <></>;
  return (
    <aside aria-label="Comments" className="flex flex-col gap-3 text-[13px]">
      <h2 className="flex items-center gap-1.5 text-[13px] font-medium text-text">
        <MessageSquareText className="size-3.5 text-text-muted" strokeWidth={1.75} aria-hidden="true" />
        Comments{list.data === undefined ? "" : ` (${grouped.open} open)`}
      </h2>
      <Loaded loader={list} rows={2}>
        {() => (
          <>
            <Composer projectId={projectId} path={path} selected={selected} onPosted={() => void list.reload()} />
            {grouped.threads.length === 0 && grouped.orphaned.length === 0 ? <p className="text-text-muted">No comments yet.</p> : null}
            <ul className="flex flex-col gap-2">
              {grouped.threads.map((thread) => (
                <ThreadView key={thread.comment.id} projectId={projectId} path={path} thread={thread} page={page} onPosted={() => void list.reload()} />
              ))}
            </ul>
            {grouped.orphaned.length === 0 ? null : (
              <section aria-label="Orphaned comments" className="flex flex-col gap-2">
                <h3 className="text-[12px] tracking-wide text-text-muted uppercase">Orphaned</h3>
                <p className="text-[12px] text-text-muted">The passage these comments were written on is no longer in the page.</p>
                <ul className="flex flex-col gap-2">
                  {grouped.orphaned.map((thread) => (
                    <ThreadView key={thread.comment.id} projectId={projectId} path={path} thread={thread} page={page} onPosted={() => void list.reload()} />
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </Loaded>
    </aside>
  );
}

/** The box that writes a comment on the page, or on the selected passage when there is one. */
function Composer({ projectId, path, selected, onPosted }: { projectId: string; path: string; selected: ReturnType<typeof useSelectedPassage>; onPosted: () => void }): React.JSX.Element {
  const [body, setBody] = useState("");
  // The passage the comment is about is the one that was selected when the person chose to comment on it.
  const [passage, setPassage] = useState<SelectedPassage | null>(null);
  const { send, busy, failure } = useSend(projectId, path, onPosted, () => {
    setBody("");
    setPassage(null);
  });
  const problem = commentProblem(body);
  return (
    <div className="flex flex-col gap-1.5">
      {selected === null || passage !== null ? null : "refusal" in selected ? (
        <p role="status" className="text-[12px] text-text-muted">
          {selected.refusal}
        </p>
      ) : (
        <Button size="small" className="self-start" onMouseDown={(event) => event.preventDefault()} onClick={() => setPassage(selected.passage)}>
          <TextSelect />
          Comment on the selection
        </Button>
      )}
      {passage === null ? null : (
        <p className="flex items-start gap-1.5 rounded-lg bg-recessed px-2 py-1.5 text-[12px] text-text-secondary">
          <span className="min-w-0 flex-1 break-words">On “{passage.exact}”</span>
          <button type="button" className="shrink-0 text-accent hover:underline" onClick={() => setPassage(null)}>
            Clear
          </button>
        </p>
      )}
      <Textarea value={body} onChange={(event) => setBody(event.target.value)} placeholder={passage === null ? "Comment on this page" : "Comment on the passage"} aria-label="Write a comment" className="min-h-16 text-[13px]" />
      {failure === null ? null : (
        <p role="alert" className="text-[12px] text-[var(--ds-status-red)]">
          {failure}
        </p>
      )}
      <Button
        size="small"
        variant="solid"
        className="self-start"
        disabled={busy || problem !== undefined}
        onClick={() =>
          void send({
            path,
            body: body.trim(),
            ...(passage !== null ? { anchor: { node: passage.node ?? path, exact: passage.exact, ...(passage.prefix === "" ? {} : { prefix: passage.prefix }), ...(passage.suffix === "" ? {} : { suffix: passage.suffix }) } } : {}),
          })
        }
      >
        {busy ? "Sending…" : "Comment"}
      </Button>
    </div>
  );
}

function useSend(projectId: string, path: string, onPosted: () => void, onSent: () => void): { send: (draft: Parameters<typeof wikiCommentsApi.post>[1]) => Promise<void>; busy: boolean; failure: string | null } {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const send = async (draft: Parameters<typeof wikiCommentsApi.post>[1]): Promise<void> => {
    setBusy(true);
    setFailure(null);
    try {
      await wikiCommentsApi.post(projectId, { ...draft, path });
      onSent();
      onPosted();
    } catch (error) {
      // The API's own words: a refusal (no right to comment), a passage the page does not hold, too many comments.
      setFailure(errorText(error));
    } finally {
      setBusy(false);
    }
  };
  return { send, busy, failure };
}

function ThreadView({ projectId, path, thread, page, onPosted }: { projectId: string; path: string; thread: Thread; page: RefObject<HTMLElement | null>; onPosted: () => void }): React.JSX.Element {
  const [replying, setReplying] = useState(false);
  const [body, setBody] = useState("");
  const { send, busy, failure } = useSend(projectId, path, onPosted, () => {
    setBody("");
    setReplying(false);
  });
  const { comment } = thread;
  const problem = commentProblem(body);
  return (
    <li className="flex flex-col gap-1.5 rounded-[var(--geist-radius)] p-2.5 shadow-border">
      {comment.quote === null ? null : (
        <button
          type="button"
          className="flex items-start gap-1 text-left text-[12px] text-text-muted hover:text-text focus-visible:outline-none focus-visible:[box-shadow:var(--ds-focus-ring)]"
          onClick={() => showPassage(page.current, comment)}
          disabled={comment.status === "orphaned"}
          title={comment.status === "orphaned" ? "The passage is no longer in the page" : "Show the passage"}
        >
          <span className="min-w-0 flex-1 border-l-2 border-[rgba(0,0,0,0.15)] pl-2 break-words">{comment.quote}</span>
        </button>
      )}
      {comment.status === "moved" ? <p className="text-[11px] text-text-muted">The passage moved under another heading.</p> : null}
      <CommentBody comment={comment} />
      {thread.replies.map((reply) => (
        <div key={reply.id} className="ml-3 border-l border-[rgba(0,0,0,0.1)] pl-2.5">
          <CommentBody comment={reply} />
        </div>
      ))}
      {comment.deleted ? null : replying ? (
        <div className="flex flex-col gap-1.5">
          <Textarea value={body} onChange={(event) => setBody(event.target.value)} aria-label="Write a reply" className="min-h-14 text-[13px]" autoFocus />
          {failure === null ? null : (
            <p role="alert" className="text-[12px] text-[var(--ds-status-red)]">
              {failure}
            </p>
          )}
          <div className="flex gap-2">
            <Button size="small" variant="solid" disabled={busy || problem !== undefined} onClick={() => void send({ path, body: body.trim(), parentId: comment.id })}>
              {busy ? "Sending…" : "Reply"}
            </Button>
            <Button size="small" onClick={() => setReplying(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <button type="button" className="self-start text-[12px] text-accent hover:underline" onClick={() => setReplying(true)}>
          Reply
        </button>
      )}
    </li>
  );
}

function CommentBody({ comment }: { comment: CommentView }): React.JSX.Element {
  return (
    <div className="flex flex-col gap-0.5">
      <p className="flex flex-wrap items-baseline gap-x-2 text-[12px] text-text-muted">
        <span className="font-medium text-text-secondary">{comment.author.displayName}</span>
        <time dateTime={comment.createdAt}>{formatRelative(comment.createdAt)}</time>
        {comment.editedAt === null ? null : <span>edited</span>}
        {comment.resolved ? <span className="rounded-full bg-recessed px-1.5 py-px text-text-secondary">resolved</span> : null}
      </p>
      {comment.deleted ? <p className="text-text-muted italic">This comment was deleted.</p> : <Markdown text={comment.body} />}
    </div>
  );
}
