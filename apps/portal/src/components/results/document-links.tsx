// Links inside agent-written Markdown, followed inside the portal. A results view wraps its
// content in DocumentLinksProvider (the project and the commit the documents were read at); a view
// claims the targets it can show in place (a unit spec opens the unit's drawer, a SEC-xxx anchor
// the finding's drawer) with useDocumentLinkHandler (use-document-links.ts); any other document of the document repo opens
// in a document drawer at the same commit. Web links open in a new tab; links that leave the repo
// or point under restricted/ are never followed (lib/document-links.ts).

import { ExternalLink } from "lucide-react";
import { useCallback, useContext, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Loaded } from "@/components/loaded";
import { Drawer } from "@/components/ui/drawer";
import { documentsApi } from "@/lib/api/documents";
import { resolveDocumentLink, stageOfDocument } from "@/lib/document-links";
import { useLoader } from "@/lib/use-loader";
import { Markdown } from "./lazy-markdown";
import { type DocumentLinkHandler, DocumentLinksContext, type DocumentTarget } from "./use-document-links";

export function DocumentLinksProvider({ projectId, commit, children }: { projectId: string; commit: string; children: React.ReactNode }): React.JSX.Element {
  const handlers = useRef<DocumentLinkHandler[]>([]);
  const [shown, setShown] = useState<DocumentTarget | null>(null);
  const register = useCallback((handler: DocumentLinkHandler) => {
    handlers.current = [handler, ...handlers.current];
    return () => {
      handlers.current = handlers.current.filter((entry) => entry !== handler);
    };
  }, []);
  const open = useCallback((target: DocumentTarget, from: string) => {
    if (handlers.current.some((handler) => handler(target))) {
      setShown(null);
      return;
    }
    // An anchor in the same document has nowhere else to go.
    if (target.path !== from) setShown(target);
  }, []);
  const value = useMemo(() => ({ open, register }), [open, register]);
  return (
    <DocumentLinksContext.Provider value={value}>
      {children}
      <Drawer open={shown !== null} size="wide" title={shown?.path.split("/").pop() ?? ""} subtitle={<span className="font-mono">{shown?.path}</span>} onClose={() => setShown(null)}>
        {shown === null ? null : <DocumentFile projectId={projectId} commit={commit} path={shown.path} />}
      </Drawer>
    </DocumentLinksContext.Provider>
  );
}

function DocumentFile({ projectId, commit, path }: { projectId: string; commit: string; path: string }): React.JSX.Element {
  const file = useLoader(`document/${projectId}/${commit}/${path}`, () => documentsApi.file(projectId, path, commit));
  const [params] = useSearchParams();
  const stage = stageOfDocument(path);
  const results = new URLSearchParams(params);
  if (stage !== undefined) {
    results.set("app", stage.app);
    results.set("tab", "results");
    results.delete("ref");
    results.delete("run");
  }
  return (
    <div className="flex flex-col gap-3">
      {stage === undefined ? null : (
        <Link to={`/delivery/${stage.stage}?${results.toString()}`} className="inline-flex items-center gap-1 self-start text-[12px] text-accent hover:underline">
          <ExternalLink className="size-3.5" strokeWidth={1.75} />
          Open the {stage.stage} results
        </Link>
      )}
      <Loaded loader={file} rows={8}>
        {(loaded) =>
          /\.md$/i.test(path) ? (
            <Markdown text={loaded.content} path={path} />
          ) : (
            <pre className="overflow-x-auto rounded-lg bg-recessed p-3 font-mono text-[12px] leading-5 text-text-secondary">{loaded.content}</pre>
          )
        }
      </Loaded>
    </div>
  );
}

/** A link of a rendered document at `basePath` (repo-relative; undefined when unknown). */
export function DocumentLink({ href, basePath, children }: { href: string | undefined; basePath: string | undefined; children: React.ReactNode }): React.JSX.Element {
  const links = useContext(DocumentLinksContext);
  if (href === undefined || href === "") return <>{children}</>;
  const target = resolveDocumentLink(href, basePath ?? "");
  if (target.kind === "external") {
    return (
      <a href={target.href} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
        {children}
      </a>
    );
  }
  if (target.kind === "blocked" || links === null || basePath === undefined) {
    return (
      <span className="text-text underline decoration-dotted underline-offset-2" title={target.kind === "blocked" ? `Not followed: ${target.reason}` : href}>
        {children}
      </span>
    );
  }
  return (
    <a
      href={`#${target.path}`}
      className="text-accent hover:underline"
      title={target.path}
      onClick={(event) => {
        event.preventDefault();
        links.open({ path: target.path, ...(target.anchor !== undefined && { anchor: target.anchor }) }, basePath);
      }}
    >
      {children}
    </a>
  );
}
