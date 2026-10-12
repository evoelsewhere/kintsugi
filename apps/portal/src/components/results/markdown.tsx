// Markdown written by an agent (ASSESSMENT.md, BUSINESS_RULES.md, …), rendered with GitHub
// tables. Raw HTML is dropped, link targets are sanitized (react-markdown's default URL
// transform); web links open in a new tab, relative links resolve against the document's repo
// path and open inside the portal (DocumentLink); ```mermaid fences become diagrams.

import { useMemo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { DocumentLink } from "./document-links";
import { MermaidDiagram } from "./mermaid-diagram";

const components: Components = {
  h1: ({ children }) => <h1 className="mt-2 mb-3 text-[20px] font-semibold tracking-tight text-text">{children}</h1>,
  h2: ({ children }) => <h2 className="mt-6 mb-2 text-[16px] font-semibold text-text [box-shadow:0_1px_0_0_rgba(0,0,0,0.06)] pb-1">{children}</h2>,
  h3: ({ children }) => <h3 className="mt-4 mb-1.5 text-[14px] font-semibold text-text">{children}</h3>,
  h4: ({ children }) => <h4 className="mt-3 mb-1 text-[13px] font-semibold text-text">{children}</h4>,
  p: ({ children }) => <p className="my-2 leading-6">{children}</p>,
  ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>,
  li: ({ children }) => <li className="leading-6">{children}</li>,
  blockquote: ({ children }) => <blockquote className="my-2 pl-3 text-text-secondary [box-shadow:inset_2px_0_0_0_var(--ds-background-300)]">{children}</blockquote>,
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
    }),
    [path],
  );
  return (
    <div className="max-w-none text-[13px] text-text-secondary [&_strong]:font-semibold [&_strong]:text-text">
      <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={withLinks}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
