// The wiki editor: the page's Markdown source in CodeMirror on the left and the page as the reader shows it on the right
// (the same renderer, so links, images, alerts and diagrams look as they will). The text is exactly what is typed; it is
// saved to the person's draft as they go (lib/wiki-edit.ts `DraftSaver`), never to the repository. Publishing is the
// next step (publish dialog); nothing here writes to the document repository.

import { Eye, PencilLine, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { CodeView } from "@/components/code/code-view";
import { Loaded } from "@/components/loaded";
import { Markdown } from "@/components/results/lazy-markdown";
import { Button } from "@/components/ui/button";
import { Tabs } from "@/components/ui/tabs";
import { documentsApi } from "@/lib/api/documents";
import { draftApiOf, wikiEditApi } from "@/lib/api/wiki-edit";
import { splitFrontMatter } from "@/lib/front-matter";
import { useLoader } from "@/lib/use-loader";
import { cn } from "@/lib/utils";
import { wikiPageLink, wikiRead } from "@/lib/wiki";
import { type AccessView, DraftSaver, type DraftView, lineSeparatorOf, SAVE_STATUS_LABEL, type SaverState } from "@/lib/wiki-edit";

/** The preview follows the typing after this long. */
const PREVIEW_DELAY_MS = 250;

export interface WikiEditorProps {
  projectId: string;
  /** The commit the Brain indexed: where the text is read from when the person has no draft yet. */
  commit: string;
  path: string;
}

export function WikiEditor({ projectId, commit, path }: WikiEditorProps): React.JSX.Element {
  const access = useLoader(`wiki/${projectId}/access/${path}`, () => wikiRead(() => wikiEditApi.access(projectId, path)));
  return (
    <Loaded loader={access} rows={4}>
      {(view) => (view.canWrite ? <OpenedEditor key={path} projectId={projectId} commit={commit} path={path} access={view} /> : <Refused path={path} projectId={projectId} access={view} />)}
    </Loaded>
  );
}

/** The person may not write this page: say why, in the API's words, and leave. */
function Refused({ projectId, path, access }: { projectId: string; path: string; access: AccessView }): React.JSX.Element {
  return (
    <div role="alert" className="flex flex-col gap-2 rounded-lg bg-recessed p-4 text-[13px] text-text-secondary">
      <p className="flex items-center gap-2 text-text">
        <TriangleAlert className="size-4" strokeWidth={1.75} aria-hidden="true" />
        This page cannot be edited
      </p>
      <p>{access.refusal?.message ?? "You may not edit this page."}</p>
      <Link to={wikiPageLink(projectId, path)} className="self-start text-accent hover:underline">
        Back to the page
      </Link>
    </div>
  );
}

/** What the editor starts from: the person's draft, or the page as the Brain indexed it (and the commit that is). */
function OpenedEditor({ projectId, commit, path }: WikiEditorProps & { access: AccessView }): React.JSX.Element {
  const start = useLoader(`wiki/${projectId}/${commit}/edit-start/${path}`, () =>
    wikiRead(async () => {
      const draft = await wikiEditApi.draft(projectId, path);
      // The draft holds its own base; the file is read only when there is no draft to continue.
      const file = draft === null ? await documentsApi.file(projectId, path, commit) : null;
      return { draft, file };
    }),
  );
  return (
    <Loaded loader={start} rows={8}>
      {({ draft, file }) => <Surface projectId={projectId} path={path} draft={draft} startText={file?.content ?? ""} startCommit={file?.commit ?? null} />}
    </Loaded>
  );
}

function Surface({ projectId, path, draft, startText, startCommit }: { projectId: string; path: string; draft: DraftView | null; startText: string; startCommit: string | null }): React.JSX.Element {
  const initial = draft?.text ?? startText;
  const [text, setText] = useState(initial);
  const [preview, setPreview] = useState(initial);
  const [saver, setSaver] = useState<SaverState>({ status: "saved", revision: draft?.revision ?? null, others: draft?.others ?? [], message: null });
  const [conflict, setConflict] = useState<DraftView | null>(null);
  const [pane, setPane] = useState<"source" | "preview">("source");
  // A text taken from the server remounts the editor with it.
  const [generation, setGeneration] = useState(0);
  const engine = useRef<DraftSaver | null>(null);
  const separator = useMemo(() => lineSeparatorOf(initial), [initial]);

  useEffect(() => {
    const made = new DraftSaver({
      path,
      api: draftApiOf(projectId),
      draft,
      startText,
      startCommit,
      onChange: setSaver,
      onRevisionConflict: setConflict,
    });
    engine.current = made;
    const leaving = (): void => made.flush();
    window.addEventListener("beforeunload", leaving);
    return () => {
      window.removeEventListener("beforeunload", leaving);
      // Leaving the page saves what is typed; the draft is the person's, so nothing is lost by it.
      made.flush();
      made.dispose();
      engine.current = null;
    };
  }, [projectId, path, draft, startText, startCommit]);

  useEffect(() => {
    const timer = setTimeout(() => setPreview(text), PREVIEW_DELAY_MS);
    return () => clearTimeout(timer);
  }, [text]);

  const typed = (next: string): void => {
    setText(next);
    engine.current?.change(next);
  };

  const others = saver.others;
  return (
    <div className="flex flex-col gap-3" onBlur={() => engine.current?.flush()}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link to={wikiPageLink(projectId, path)} className="text-[12px] text-text-muted hover:text-text hover:underline">
          Back to the page
        </Link>
        <p role="status" aria-live="polite" className={cn("flex items-center gap-2 text-[12px]", saver.status === "failed" || saver.status === "locked" ? "text-[var(--ds-status-red)]" : "text-text-muted")}>
          {SAVE_STATUS_LABEL[saver.status]}
          {saver.status === "failed" ? (
            <Button size="small" variant="ghost" onClick={() => engine.current?.flush()}>
              Retry
            </Button>
          ) : null}
        </p>
      </div>
      {saver.message === null ? null : (
        <p role="alert" className="text-[12px] text-[var(--ds-status-red)]">
          {saver.message}
        </p>
      )}
      {others.length === 0 ? null : (
        <p className="text-[12px] text-text-muted">
          {others.map((other) => other.name).join(", ")} {others.length === 1 ? "is" : "are"} also editing this page.
        </p>
      )}
      {conflict === null ? null : (
        <div role="alert" className="flex flex-col gap-2 rounded-lg bg-recessed p-3 text-[13px] text-text-secondary">
          <p className="text-text">This draft was changed in another tab.</p>
          <p>Choose which text to keep. Nothing was overwritten.</p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="small"
              onClick={() => {
                engine.current?.keepMine(conflict);
                setConflict(null);
              }}
            >
              Keep what I typed here
            </Button>
            <Button
              size="small"
              onClick={() => {
                engine.current?.adopt(conflict);
                setText(conflict.text);
                setPreview(conflict.text);
                setGeneration((value) => value + 1);
                setConflict(null);
              }}
            >
              Use the other tab’s text
            </Button>
          </div>
        </div>
      )}
      <div className="lg:hidden">
        <Tabs
          label="Source and preview"
          value={pane}
          tabs={[
            { id: "source", label: "Source" },
            { id: "preview", label: "Preview" },
          ]}
          onChange={setPane}
        />
      </div>
      <div className="grid min-h-[420px] gap-3 lg:grid-cols-2">
        <section aria-label="Markdown source" className={cn("h-[60vh] min-h-[320px] overflow-hidden rounded-lg shadow-border", pane === "preview" && "hidden lg:block")}>
          <p className="sr-only">
            <PencilLine aria-hidden="true" /> Source
          </p>
          <CodeView key={generation} text={text} path={path} onChange={typed} lineSeparator={separator} />
        </section>
        <section aria-label="Preview" className={cn("h-[60vh] min-h-[320px] overflow-auto rounded-lg p-4 shadow-border", pane === "source" && "hidden lg:block")}>
          <p className="sr-only">
            <Eye aria-hidden="true" /> Preview
          </p>
          <Markdown text={splitFrontMatter(preview).body} path={path} />
        </section>
      </div>
    </div>
  );
}
