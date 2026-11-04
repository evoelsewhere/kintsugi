// Markdown written by an agent (assessment.md, BUSINESS_RULES.md, …), rendered with GitHub
// tables. Raw HTML is dropped, link targets are sanitized (react-markdown's default URL
// transform); web links open in a new tab, relative links resolve against the document's repo
// path and open inside the portal (DocumentLink); ```mermaid fences become diagrams. Headings carry the id the
// Brain gives their section (`headingSlug`, so `page.md#anchor` scrolls to it), GitHub alerts (`> [!NOTE]`) become
// labelled panels and ```kintsugi-<macro> fences are shown as a labelled block, never run.

import { useMemo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { DocumentLink } from "./document-links";
import { MarkdownImage } from "./markdown-image";
import { MentionChip } from "./mention-chip";
import { MermaidDiagram } from "./mermaid-diagram";
import { type HastNode, textOf, wikiMarkdown } from "./markdown-wiki";

const ALERT_LABEL: Record<string, string> = { note: "Note", tip: "Tip", important: "Important", warning: "Warning", caution: "Caution" };

/** A fenced `kintsugi-<macro>` block: its name and its parameters as written, shown and never run. */
function MacroBlock({ macro, parameters }: { macro: string; parameters: string }): React.JSX.Element {
  return (
    <div className="my-3 rounded-lg bg-recessed p-3 shadow-border" data-macro={macro}>
      <p className="text-[11px] tracking-wide text-text-muted uppercase">Macro: {macro}</p>
      {parameters.trim() === "" ? null : <p className="mt-1 font-mono text-[12px] leading-5 whitespace-pre-wrap text-text-secondary">{parameters.replace(/\n$/, "")}</p>}
    </div>
  );
}

const components: Components = {
  h1: ({ children, id }) => <h1 id={id} className="mt-2 mb-3 text-[20px] font-semibold tracking-tight text-text">{children}</h1>,
  h2: ({ children, id }) => <h2 id={id} className="mt-6 mb-2 text-[16px] font-semibold text-text [box-shadow:0_1px_0_0_rgba(0,0,0,0.06)] pb-1">{children}</h2>,
  h3: ({ children, id }) => <h3 id={id} className="mt-4 mb-1.5 text-[14px] font-semibold text-text">{children}</h3>,
  h4: ({ children, id }) => <h4 id={id} className="mt-3 mb-1 text-[13px] font-semibold text-text">{children}</h4>,
  h5: ({ children, id }) => <h5 id={id} className="mt-3 mb-1 text-[12.5px] font-semibold text-text">{children}</h5>,
  h6: ({ children, id }) => <h6 id={id} className="mt-3 mb-1 text-[12px] font-semibold text-text-secondary">{children}</h6>,
  p: ({ children }) => <p className="my-2 leading-6">{children}</p>,
  ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>,
  li: ({ children }) => <li className="leading-6">{children}</li>,
  blockquote: ({ children, node }) => {
    const alert = node?.properties["dataAlert"];
    if (typeof alert !== "string" || ALERT_LABEL[alert] === undefined) {
      return <blockquote className="my-2 pl-3 text-text-secondary [box-shadow:inset_2px_0_0_0_var(--ds-background-300)]">{children}</blockquote>;
    }
    return (
      <aside className="my-3 rounded-lg bg-recessed p-3 shadow-border" data-alert={alert}>
        <p className="text-[11px] tracking-wide text-accent uppercase">{ALERT_LABEL[alert]}</p>
        <div className="mt-1 text-text-secondary">{children}</div>
      </aside>
    );
  },
  hr: () => <hr className="my-4 border-0 [box-shadow:0_1px_0_0_rgba(0,0,0,0.08)]" />,
  table: ({ children }) => (
    <div className="my-3 overflow-x-auto rounded-lg shadow-border">
      <table className="w-full text-left text-[12.5px]">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-recessed/60 text-[11px] tracking-wide text-text-muted uppercase">{children}</thead>,
  th: ({ children }) => <th className="px-3 py-1.5 font-normal">{children}</th>,
  td: ({ children }) => <td className="px-3 py-1.5 align-top [box-shadow:0_-1px_0_rgba(0,0,0,0.06)]">{children}</td>,
  code: ({ className, children }) => {
    const language = /language-(\w+)/.exec(className ?? "")?.[1];
    const text = String(children).replace(/\n$/, "");
    if (language === "mermaid") return <MermaidDiagram source={text} title="Diagram" />;
    if (language !== undefined || text.includes("\n")) return <code className="font-mono text-[12px]">{text}</code>;
    return <code className="rounded-[4px] bg-hover px-1 py-px font-mono text-[0.9em] text-text">{children}</code>;
  },
  pre: ({ children, node }) => {
    const code = node?.children[0];
    const classes = code?.type === "element" && code.tagName === "code" ? code.properties["className"] : undefined;
    // A mermaid fence renders as a diagram, not inside a code block.
    if (Array.isArray(classes) && classes.includes("language-mermaid")) return <>{children}</>;
    // A wiki macro fence is shown as a labelled block; nothing in it is run.
    const macro = Array.isArray(classes) ? classes.map(String).find((name) => /^language-kintsugi-[a-z0-9-]+$/.test(name)) : undefined;
    if (macro !== undefined && code?.type === "element") return <MacroBlock macro={macro.slice("language-kintsugi-".length)} parameters={textOf(code as HastNode)} />;
    return <pre className="my-3 overflow-x-auto rounded-lg bg-recessed p-3 leading-5 text-text-secondary">{children}</pre>;
  },
};

/** `path`: the document's path in the document repo, for its relative links. */
export default function Markdown({ text, path }: { text: string; path?: string | undefined }): React.JSX.Element {
  const withLinks = useMemo<Components>(
    () => ({
      ...components,
      a: ({ href, children }) => (
        <DocumentLink href={href} basePath={path}>
          {children}
        </DocumentLink>
      ),
      span: ({ node: _node, children, ...props }) => {
        const mention = (props as Record<string, unknown>)["data-mention"];
        return typeof mention === "string" ? <MentionChip username={mention}>{children}</MentionChip> : <span {...props}>{children}</span>;
      },
      img: ({ src, alt }) => <MarkdownImage src={typeof src === "string" ? src : undefined} alt={alt} basePath={path} />,
    }),
    [path],
  );
  return (
    <div className="max-w-none text-[13px] text-text-secondary [&_strong]:font-semibold [&_strong]:text-text">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[wikiMarkdown]} skipHtml components={withLinks}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
