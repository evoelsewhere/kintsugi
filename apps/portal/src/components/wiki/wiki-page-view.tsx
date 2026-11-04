// One page of the wiki: its trail, its labels and status, then the Markdown rendered as it was at the commit the Brain
// indexed (code, Mermaid diagrams, alerts and `kintsugi-*` blocks come from the shared renderer). The text is read
// from the documents route, the page's attributes from the Brain's lookup; a failed lookup only leaves them out.

import type { BrainNode } from "@kintsugi/domain";
import { Archive, ArchiveRestore, GitCommitHorizontal, PencilLine, Tag } from "lucide-react";
import { useRef } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Loaded } from "@/components/loaded";
import { Markdown } from "@/components/results/lazy-markdown";
import { Button } from "@/components/ui/button";
import { Tabs } from "@/components/ui/tabs";
import { brainApi } from "@/lib/api/brain";
import { documentsApi } from "@/lib/api/documents";
import { wikiEditApi } from "@/lib/api/wiki-edit";
import { formatRelative, shortSha } from "@/lib/format";
import { splitFrontMatter } from "@/lib/front-matter";
import { useLoader } from "@/lib/use-loader";
import { type PageMode, pathTrail, readPageMode, wikiLabelLink, wikiLink, wikiPageLink, wikiRead, tocOf, wikiSpaceLink } from "@/lib/wiki";
import { useScrollToHeading, useWikiLinks } from "./use-wiki-links";
import { ExportMarkdownButton } from "./export-markdown-button";
import { WikiBacklinks } from "./wiki-backlinks";
import { WikiCompare } from "./wiki-compare";
import { WikiToc } from "./wiki-toc";
import { MentionDirectory } from "./mention-directory";
import { WikiComments } from "./wiki-comments";
import { PageWatchButton } from "./watch-button";
import { DeleteButton } from "./wiki-delete";
import { WikiEditor } from "./wiki-editor";
import { WikiHistory } from "./wiki-history";
import { MoveButton } from "./wiki-move";

export interface WikiPageViewProps {
  projectId: string;
  /** The commit the Brain indexed: the tree and the page agree on one version. */
  commit: string;
  /** The page's path in the document repo. */
  path: string;
}

export function WikiPageView({ projectId, commit, path }: WikiPageViewProps): React.JSX.Element {
  const [params] = useSearchParams();
  const mode = readPageMode(params);
  const meta = useLoader(`wiki/${projectId}/${commit}/meta/${path}`, () => wikiRead(() => brainApi.lookup(projectId, path)));
  const node = meta.data?.matches.find((match) => match.kind === "document" && match.path === path);
  useWikiLinks(projectId, commit);

  return (
    <article className="flex flex-col gap-3" aria-label={node?.title ?? path}>
      <PageTrail projectId={projectId} path={path} />
      {node === undefined ? null : <PageFacts projectId={projectId} node={node} commit={commit} />}
      {mode.mode === "edit" ? null : <PageTabs projectId={projectId} path={path} mode={mode} />}
      {mode.mode === "page" ? (
        <div className="flex flex-wrap items-start gap-2">
          <PageWatchButton projectId={projectId} path={path} target={path} />
          <EditEntry projectId={projectId} path={path} archived={node?.status === "archived"} />
        </div>
      ) : null}
      {mode.mode === "edit" ? (
        <WikiEditor projectId={projectId} commit={commit} path={path} restore={mode.restore} change={mode.change} />
      ) : mode.mode === "page" ? (
        <PageText projectId={projectId} commit={commit} path={path} />
      ) : mode.mode === "version" ? (
        <VersionText projectId={projectId} path={path} sha={mode.sha} />
      ) : mode.mode === "history" ? (
        <WikiHistory projectId={projectId} commit={commit} path={path} />
      ) : mode.mode === "compare" ? (
        <WikiCompare projectId={projectId} path={path} from={mode.from} to={mode.to} />
      ) : null}
    </article>
  );
}

/**
 * The way into the editor, and what stands in its way: the Edit button when the person may write the page, the reason
 * in the API's words when they may not, and a banner when a write of the page is waiting for review. A person without the
 * rights, or an API without the route, sees the page as before.
 */
function EditEntry({ projectId, path, archived }: { projectId: string; path: string; archived: boolean }): React.JSX.Element | null {
  const navigate = useNavigate();
  const access = useLoader(`wiki/${projectId}/access/${path}`, () => wikiRead(() => wikiEditApi.access(projectId, path)));
  const view = access.data;
  if (view === undefined || !view.editable) return null;
  return (
    <div className="flex flex-col gap-1.5">
      {view.pending === null ? null : (
        <p role="status" className="rounded-lg bg-recessed px-3 py-2 text-[12px] text-text-secondary">
          Pending review: {view.pending.author} changed this page
          {view.pending.prUrl === null ? "." : (
            <>
              {" "}
              <a href={view.pending.prUrl} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
                Open the pull request
              </a>
            </>
          )}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {view.canWrite ? (
          <>
          <Button size="small" variant="solid" onClick={() => void navigate(wikiPageLink(projectId, path, { mode: "edit" }))}>
            <PencilLine />
            Edit
          </Button>
          <MoveButton projectId={projectId} path={path} direct={view.direct} />
          <Button size="small" onClick={() => void navigate(wikiPageLink(projectId, path, { mode: "edit", change: archived ? "unarchive" : "archive" }))}>
            {archived ? <ArchiveRestore /> : <Archive />}
            {archived ? "Unarchive" : "Archive"}
          </Button>
          <DeleteButton projectId={projectId} path={path} direct={view.direct} />
          </>
        ) : (
          <Button size="small" disabled title={view.refusal?.message}>
            <PencilLine />
            Edit
          </Button>
        )}
        {view.canWrite || view.refusal === null ? null : <span className="text-[12px] text-text-muted">{view.refusal.message}</span>}
      </div>
    </div>
  );
}

/** The page and its history: the two things a reader does with a page; an old version and a comparison belong to them. */
function PageTabs({ projectId, path, mode }: { projectId: string; path: string; mode: PageMode }): React.JSX.Element {
  const navigate = useNavigate();
  const tab = mode.mode === "history" || mode.mode === "compare" ? "history" : "page";
  return (
    <Tabs
      label="Page and history"
      value={tab}
      tabs={[
        { id: "page", label: "Page" },
        { id: "history", label: "History" },
      ]}
      onChange={(id) => void navigate(wikiPageLink(projectId, path, id === "history" ? { mode: "history" } : { mode: "page" }))}
    />
  );
}

/** The page as the Brain indexed it. */
function PageText({ projectId, commit, path }: WikiPageViewProps): React.JSX.Element {
  const file = useLoader(`wiki/${projectId}/${commit}/file/${path}`, () => wikiRead(() => documentsApi.file(projectId, path, commit)));
  useScrollToHeading(file.data !== undefined);
  const article = useRef<HTMLDivElement>(null);
  return (
    <Loaded loader={file}>
      {(loaded) => (
        <>
          {/* The whole file, front matter included: the export is the source byte for byte. */}
          <div className="flex justify-end">
            <ExportMarkdownButton path={path} text={loaded.content} />
          </div>
          <WikiToc projectId={projectId} path={path} entries={tocOf(path, loaded.content)} />
          <div className="flex flex-col gap-6 xl:grid xl:grid-cols-[minmax(0,1fr)_300px]">
            <div className="min-w-0">
              <div ref={article}>
                <MentionDirectory projectId={projectId} texts={[splitFrontMatter(loaded.content).body]}>
                  <Markdown text={splitFrontMatter(loaded.content).body} path={path} />
                </MentionDirectory>
              </div>
              <WikiBacklinks projectId={projectId} commit={commit} path={path} />
            </div>
            <WikiComments projectId={projectId} commit={commit} path={path} page={article} />
          </div>
        </>
      )}
    </Loaded>
  );
}

/** The page as it was at one of its commits, with the way back to the current one. */
function VersionText({ projectId, path, sha }: { projectId: string; path: string; sha: string }): React.JSX.Element {
  const file = useLoader(`wiki/${projectId}/version/${sha}/${path}`, () => wikiRead(() => documentsApi.file(projectId, path, sha)));
  useScrollToHeading(file.data !== undefined);
  return (
    <>
      <p role="status" className="flex flex-wrap items-center gap-x-2 rounded-lg bg-recessed px-3 py-2 text-[12px] text-text-secondary">
        <span>
          Old version <span className="font-mono">{shortSha(sha)}</span>
        </span>
        <Link to={wikiPageLink(projectId, path)} className="text-accent hover:underline">
          Go to the current version
        </Link>
        <Link to={wikiPageLink(projectId, path, { mode: "history" })} className="text-accent hover:underline">
          History
        </Link>
      </p>
      <Loaded loader={file} rows={8}>
        {(loaded) => (
          <>
            <div className="flex justify-end">
              <ExportMarkdownButton path={path} text={loaded.content} />
            </div>
            <Markdown text={splitFrontMatter(loaded.content).body} path={path} />
          </>
        )}
      </Loaded>
    </>
  );
}

/** Where the page is: each folder above it, opening that folder. */
export function PageTrail({ projectId, path }: { projectId: string; path: string }): React.JSX.Element {
  const trail = pathTrail(path);
  return (
    <nav aria-label="Page location" className="flex flex-wrap items-center gap-1 text-[12px] text-text-muted">
      <Link to={wikiLink(projectId, "")} className="rounded-sm hover:text-text hover:underline">
        Wiki
      </Link>
      {trail.map((entry, index) => (
        <span key={entry.path} className="flex items-center gap-1">
          <span aria-hidden="true">/</span>
          {index === trail.length - 1 ? (
            <span className="text-text-secondary" aria-current="page">
              {entry.label}
            </span>
          ) : (
            <Link to={wikiLink(projectId, entry.path)} className="rounded-sm hover:text-text hover:underline">
              {entry.label}
            </Link>
          )}
        </span>
      ))}
    </nav>
  );
}

/** The labels, the status and the last change of a page: what the Brain knows beyond its text. */
function PageFacts({ projectId, node, commit }: { projectId: string; node: BrainNode; commit: string }): React.JSX.Element | null {
  const facts: React.ReactNode[] = [];
  if (node.space !== null) {
    facts.push(
      <Link key="space" to={wikiSpaceLink(projectId, node.space)} title={`The home page of the space ${node.space}`} className="hover:text-text hover:underline">
        Space {node.space}
      </Link>,
    );
  }
  if (node.status !== null) facts.push(<span key="status">{node.status}</span>);
  if (node.owner !== null) facts.push(<span key="owner">Owner {node.owner}</span>);
  if (node.changed !== null) {
    facts.push(
      <span key="changed" title={`${node.changed.subject} (${shortSha(node.changed.commit)})`}>
        Changed {formatRelative(node.changed.at)}
      </span>,
    );
  }
  facts.push(
    <span key="commit" className="flex items-center gap-1" title={`The page as of commit ${commit}`}>
      <GitCommitHorizontal className="size-3.5" strokeWidth={1.75} />
      <span className="font-mono text-[11px]">{shortSha(commit)}</span>
    </span>,
  );
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-text-muted">
      {node.labels.map((label) => (
        <Link key={label} to={wikiLabelLink(projectId, label)} title={`Pages with the label ${label}`} className="flex items-center gap-1 rounded-full bg-recessed px-2 py-0.5 text-text-secondary hover:text-text focus-visible:outline-none focus-visible:[box-shadow:var(--ds-focus-ring)]">
          <Tag className="size-3" strokeWidth={1.75} />
          {label}
        </Link>
      ))}
      {facts}
    </div>
  );
}
