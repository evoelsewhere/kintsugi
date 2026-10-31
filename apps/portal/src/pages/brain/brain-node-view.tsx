// The right pane of the Brain: one node as brain_read gives it to an agent — where it sits, what its summary says
// and where that summary comes from, the citation an answer would carry, the text at the indexed commit, what
// it contains and what links to it. A folder shows its contents as cards instead of text.

import { type BrainCrumb, type BrainLinkedNode, type BrainNode, type BrainReadView, isBrainIndexedPath } from "@kintsugi/domain";
import { ArrowDownLeft, ArrowUpRight, ChevronRight } from "lucide-react";
import { useState } from "react";
import { Loaded } from "@/components/loaded";
import { Markdown } from "@/components/results/lazy-markdown";
import { useDocumentLinkHandler } from "@/components/results/use-document-links";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { brainApi } from "@/lib/api/brain";
import { BRAIN_KIND_LABEL, SUMMARY_SOURCE_LABEL, citationText, formatTokens, linkedNodeIds } from "@/lib/brain";
import { errorText } from "@/lib/format";
import { splitFrontMatter } from "@/lib/front-matter";
import { useLoader } from "@/lib/use-loader";
import { BrainNodeIcon } from "./brain-tree";

export interface BrainNodeViewProps {
  projectId: string;
  /** The indexed commit and build time: a new build reads the node again. */
  version: string;
  nodeId: string;
  onSelect: (id: string) => void;
  /** Called with the node's ancestors once it is read, so the tree can open down to it. */
  onPath: (ids: string[]) => void;
}

export function BrainNodeView({ projectId, version, nodeId, onSelect, onPath }: BrainNodeViewProps): React.JSX.Element {
  const read = useLoader(`brain/${projectId}/${version}/node/${nodeId}`, async () => {
    const view = await brainApi.node(projectId, nodeId);
    onPath([...view.breadcrumb.map((crumb) => crumb.id), view.node.id]);
    return view;
  });
  return (
    <Loaded loader={read} rows={10}>
      {(view) => <NodeView key={view.node.id} projectId={projectId} view={view} onSelect={onSelect} />}
    </Loaded>
  );
}

function NodeView({ projectId, view, onSelect }: { projectId: string; view: BrainReadView; onSelect: (id: string) => void }): React.JSX.Element {
  const { node } = view;
  // A link inside the text opens its node here: the section it names when the index linked it, else its document.
  useDocumentLinkHandler((target) => {
    const [exact, document] = linkedNodeIds(target.path, target.anchor);
    const linked = view.outgoing.find((candidate) => candidate.id === exact);
    if (linked !== undefined) onSelect(linked.id);
    else if (isBrainIndexedPath(target.path)) onSelect(document ?? target.path);
    else return false;
    return true;
  });

  return (
    <article className="flex flex-col gap-5" aria-labelledby="brain-node-title">
      <Breadcrumb crumbs={view.breadcrumb} onSelect={onSelect} />
      <header className="flex flex-col gap-2">
        <div className="flex items-start gap-2">
          <BrainNodeIcon node={node} className="mt-1 text-text-muted" />
          <h2 id="brain-node-title" className="min-w-0 flex-1 text-[18px] font-semibold leading-6 tracking-[-0.36px] text-text [overflow-wrap:anywhere]">
            {node.title}
          </h2>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-text-muted">
          <Badge>{BRAIN_KIND_LABEL[node.kind]}</Badge>
          {node.ids.map((id) => (
            <Badge key={id} className="font-mono">
              {id}
            </Badge>
          ))}
          {node.kind === "root" || node.kind === "folder" ? (
            <span>
              {node.children} {node.children === 1 ? "entry" : "entries"}
            </span>
          ) : null}
          <span title="About four characters per token, with everything under this node">≈ {formatTokens(node.subtreeTokens)} tokens</span>
        </div>
        {node.summary === "" ? null : (
          <p className="max-w-3xl text-[13px] leading-5 text-text-secondary">
            {node.summary}
            <span className="ml-2 text-[11px] text-text-muted">Summary from {SUMMARY_SOURCE_LABEL[node.summarySource]}</span>
          </p>
        )}
      </header>

      {view.citation === null ? null : (
        <div className="flex flex-wrap items-center gap-2 rounded-[var(--geist-radius)] bg-recessed px-3 py-2">
          <span className="text-[11px] uppercase tracking-wide text-text-muted">Citation</span>
          <code className="min-w-0 flex-1 truncate font-mono text-[12px] text-text-secondary" title={citationText(view.citation)}>
            {citationText(view.citation)}
          </code>
          <CopyButton value={citationText(view.citation)} label="Copy citation" />
          <CopyButton value={node.id} label="Copy node id" iconOnly />
        </div>
      )}

      {node.kind === "root" || node.kind === "folder" ? (
        <ChildCards nodes={view.children} total={node.children} onSelect={onSelect} />
      ) : (
        <NodeText projectId={projectId} view={view} />
      )}

      {(node.kind === "document" || node.kind === "section") && view.children.length > 0 ? (
        <section className="flex flex-col gap-2" aria-label="Contents">
          <h3 className="text-[12px] font-medium uppercase tracking-wide text-text-muted">In this {node.kind}</h3>
          <ul className="flex flex-col gap-px">
            {view.children.map((child) => (
              <li key={child.id}>
                <NodeRow node={child} onSelect={onSelect} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <Links view={view} onSelect={onSelect} />
    </article>
  );
}

function Breadcrumb({ crumbs, onSelect }: { crumbs: BrainCrumb[]; onSelect: (id: string) => void }): React.JSX.Element | null {
  if (crumbs.length === 0) return null;
  return (
    <nav aria-label="Where this node is" className="flex min-w-0 flex-wrap items-center gap-1 font-mono text-[11px] text-text-muted">
      {crumbs.map((crumb, index) => (
        <span key={crumb.id} className="flex min-w-0 items-center gap-1">
          {index === 0 ? null : <ChevronRight className="size-3 shrink-0" strokeWidth={1.75} />}
          <button type="button" className="max-w-[220px] truncate rounded px-0.5 hover:text-text hover:underline focus-visible:outline-none focus-visible:[box-shadow:var(--ds-focus-ring)]" onClick={() => onSelect(crumb.id)} title={crumb.title}>
            {crumb.title}
          </button>
        </span>
      ))}
    </nav>
  );
}

/** The node's text as the agent reads it, without the heading the header already shows; more on request. */
function NodeText({ projectId, view }: { projectId: string; view: BrainReadView }): React.JSX.Element {
  const [more, setMore] = useState<{ text: string; nextLine: number | null; loading: boolean; error?: string }>({ text: "", nextLine: view.nextLine, loading: false });
  const { fields, body } = view.node.kind === "document" ? splitFrontMatter(view.text) : { fields: [], body: view.text };
  const lines = body.split("\n");
  const first = lines.findIndex((line) => line.trim() !== "");
  const withoutTitle = first >= 0 && /^#{1,6}\s/.test(lines[first] ?? "") ? lines.slice(first + 1).join("\n") : body;
  const text = `${withoutTitle}${more.text === "" ? "" : `\n${more.text}`}`.trim();

  const loadMore = async (): Promise<void> => {
    if (more.nextLine === null) return;
    setMore((current) => ({ ...current, loading: true }));
    try {
      const next = await brainApi.node(projectId, view.node.id, more.nextLine);
      setMore((current) => ({ text: `${current.text}\n${next.text}`, nextLine: next.nextLine, loading: false }));
    } catch (failure) {
      setMore((current) => ({ ...current, loading: false, error: errorText(failure) }));
    }
  };

  return (
    <section className="flex flex-col gap-3" aria-label="Text">
      {fields.length === 0 ? null : (
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 rounded-[var(--geist-radius)] bg-recessed p-3 text-[12px]">
          {fields.map(([key, value]) => (
            <div key={key} className="contents">
              <dt className="text-text-muted">{key}</dt>
              <dd className="min-w-0 break-words text-text-secondary">{value === "" ? "—" : value}</dd>
            </div>
          ))}
        </dl>
      )}
      {text === "" ? (
        <p className="text-[13px] text-text-muted">{view.scope === "node" ? "No text of its own: open what it contains below." : "No text."}</p>
      ) : (
        <Markdown text={text} path={view.node.path} />
      )}
      {more.nextLine === null ? null : (
        <div className="flex items-center gap-3 rounded-[var(--geist-radius)] px-3 py-2 text-[12px] text-text-secondary shadow-border">
          <span className="flex-1">Shown up to line {more.nextLine - 1}. An agent reads the rest in further calls.</span>
          {more.error === undefined ? null : <span className="text-[var(--ds-status-red)]">{more.error}</span>}
          <Button size="small" variant="ghost" disabled={more.loading} onClick={() => void loadMore()}>
            {more.loading ? "Loading…" : "Show more"}
          </Button>
        </div>
      )}
    </section>
  );
}

function ChildCards({ nodes, total, onSelect }: { nodes: BrainNode[]; total: number; onSelect: (id: string) => void }): React.JSX.Element {
  if (nodes.length === 0) return <p className="text-[13px] text-text-muted">This folder holds no indexed document.</p>;
  return (
    <section className="flex flex-col gap-2" aria-label="Contents">
      <ul className="grid gap-2 sm:grid-cols-2 2xl:grid-cols-3">
        {nodes.map((child) => (
          <li key={child.id}>
            <button
              type="button"
              className="flex h-full w-full flex-col gap-1.5 rounded-[var(--geist-radius)] bg-surface p-3 text-left shadow-border hover:bg-hover focus-visible:outline-none focus-visible:[box-shadow:var(--ds-focus-ring)]"
              onClick={() => onSelect(child.id)}
            >
              <span className="flex min-w-0 items-center gap-1.5 text-[13px] text-text">
                <BrainNodeIcon node={child} className="text-text-muted" />
                <span className="truncate">{child.title}</span>
                <span className="ml-auto shrink-0 text-[11px] text-text-muted tabular-nums">
                  {child.kind === "folder" ? `${child.children}` : `≈ ${formatTokens(child.subtreeTokens)}`}
                </span>
              </span>
              {child.summary === "" ? null : <span className="line-clamp-3 text-[12px] leading-4 text-text-secondary">{child.summary}</span>}
            </button>
          </li>
        ))}
      </ul>
      {nodes.length < total ? <p className="text-[12px] text-text-muted">Showing {nodes.length} of {total}; open the folder in the tree for the rest.</p> : null}
    </section>
  );
}

function NodeRow({ node, onSelect, kind }: { node: BrainNode; onSelect: (id: string) => void; kind?: BrainLinkedNode["linkKind"] }): React.JSX.Element {
  return (
    <button
      type="button"
      className="flex w-full min-w-0 items-start gap-2 rounded-[var(--geist-radius)] px-2 py-1.5 text-left hover:bg-hover focus-visible:outline-none focus-visible:[box-shadow:var(--ds-focus-ring)]"
      onClick={() => onSelect(node.id)}
    >
      <BrainNodeIcon node={node} className="mt-0.5 text-text-muted" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="truncate text-[13px] text-text">{node.title}</span>
          {kind === "id" ? <span className="shrink-0 text-[11px] text-text-muted">mentions its id</span> : null}
        </span>
        {node.summary === "" ? null : <span className="truncate text-[12px] text-text-muted">{node.summary}</span>}
        {kind === undefined ? null : <span className="truncate font-mono text-[11px] text-text-muted">{node.path}</span>}
      </span>
    </button>
  );
}

function Links({ view, onSelect }: { view: BrainReadView; onSelect: (id: string) => void }): React.JSX.Element | null {
  if (view.outgoingTotal + view.incomingTotal === 0) return null;
  const column = (title: string, Icon: typeof ArrowUpRight, nodes: BrainLinkedNode[], total: number) => (
    <section className="flex min-w-0 flex-col gap-1" aria-label={title}>
      <h3 className="flex items-center gap-1.5 text-[12px] font-medium uppercase tracking-wide text-text-muted">
        <Icon className="size-3.5" strokeWidth={1.75} />
        {title}
        <span className="tabular-nums">{total}</span>
      </h3>
      {nodes.length === 0 ? (
        <p className="px-2 py-1.5 text-[12px] text-text-muted">None.</p>
      ) : (
        <ul className="flex flex-col gap-px">
          {nodes.map((linked) => (
            <li key={linked.id}>
              <NodeRow node={linked} kind={linked.linkKind} onSelect={onSelect} />
            </li>
          ))}
        </ul>
      )}
      {nodes.length < total ? <p className="px-2 text-[11px] text-text-muted">and {total - nodes.length} more</p> : null}
    </section>
  );
  return (
    <div className="grid gap-4 pt-1 lg:grid-cols-2">
      {column("Links to", ArrowUpRight, view.outgoing, view.outgoingTotal)}
      {column("Linked from", ArrowDownLeft, view.incoming, view.incomingTotal)}
    </div>
  );
}
