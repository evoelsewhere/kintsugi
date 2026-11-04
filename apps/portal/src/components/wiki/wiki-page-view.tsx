// One page of the wiki: its trail, its labels and status, then the Markdown rendered as it was at the commit the Brain
// indexed (code, Mermaid diagrams, alerts and `kintsugi-*` blocks come from the shared renderer). The text is read
// from the documents route, the page's attributes from the Brain's lookup; a failed lookup only leaves them out.

import type { BrainNode } from "@kintsugi/domain";
import { GitCommitHorizontal, Tag } from "lucide-react";
import { Link } from "react-router-dom";
import { Loaded } from "@/components/loaded";
import { Markdown } from "@/components/results/lazy-markdown";
import { brainApi } from "@/lib/api/brain";
import { documentsApi } from "@/lib/api/documents";
import { formatRelative, shortSha } from "@/lib/format";
import { splitFrontMatter } from "@/lib/front-matter";
import { useLoader } from "@/lib/use-loader";
import { pathTrail, wikiLink, wikiRead } from "@/lib/wiki";
import { useScrollToHeading, useWikiLinks } from "./use-wiki-links";

export interface WikiPageViewProps {
  projectId: string;
  /** The commit the Brain indexed: the tree and the page agree on one version. */
  commit: string;
  /** The page's path in the document repo. */
  path: string;
}

export function WikiPageView({ projectId, commit, path }: WikiPageViewProps): React.JSX.Element {
  const file = useLoader(`wiki/${projectId}/${commit}/file/${path}`, () => wikiRead(() => documentsApi.file(projectId, path, commit)));
  const meta = useLoader(`wiki/${projectId}/${commit}/meta/${path}`, () => wikiRead(() => brainApi.lookup(projectId, path)));
  const node = meta.data?.matches.find((match) => match.kind === "document" && match.path === path);
  useWikiLinks(projectId, commit);
  useScrollToHeading(file.data !== undefined);

  return (
    <article className="flex flex-col gap-3" aria-label={node?.title ?? path}>
      <PageTrail projectId={projectId} path={path} />
      {node === undefined ? null : <PageFacts node={node} commit={commit} />}
      <Loaded loader={file} rows={8}>
        {(loaded) => <Markdown text={splitFrontMatter(loaded.content).body} path={path} />}
      </Loaded>
    </article>
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
function PageFacts({ node, commit }: { node: BrainNode; commit: string }): React.JSX.Element | null {
  const facts: React.ReactNode[] = [];
  if (node.space !== null) facts.push(<span key="space">Space {node.space}</span>);
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
        <span key={label} className="flex items-center gap-1 rounded-full bg-recessed px-2 py-0.5 text-text-secondary">
          <Tag className="size-3" strokeWidth={1.75} />
          {label}
        </span>
      ))}
      {facts}
    </div>
  );
}
