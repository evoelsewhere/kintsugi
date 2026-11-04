// How the links of a wiki page behave: a link to another page (or a heading of this one) moves the reader there
// without reloading it, an attachment opens through the API's attachment route, and an address that names a heading
// scrolls to it once the page is on screen. The renderer resolves each link against the page it is written in.

import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useDocumentLinkHandler } from "@/components/results/use-document-links";
import { attachmentUrl, headingIdOfHash, wikiLink, wikiLinkAction } from "@/lib/wiki";

/** Claims the pages and attachments of the repository for the reader; any other target keeps the shared drawer. */
export function useWikiLinks(projectId: string, commit: string): void {
  const navigate = useNavigate();
  useDocumentLinkHandler((target) => {
    const action = wikiLinkAction(target);
    if (action.kind === "page") {
      void navigate(wikiLink(projectId, action.path, action.anchor));
      return true;
    }
    if (action.kind === "attachment") {
      window.open(attachmentUrl(projectId, action.path, commit), "_blank", "noopener,noreferrer");
      return true;
    }
    return false;
  });
}

/**
 * Scrolls to the heading the address names (`#slug`) once the page's text is rendered (`ready`), and again whenever the
 * reader moves to another heading, also of the same page. The id is looked up as an id, never as a selector.
 */
export function useScrollToHeading(ready: boolean): void {
  const { hash, key } = useLocation();
  useEffect(() => {
    if (!ready || hash === "") return;
    const id = headingIdOfHash(hash);
    // The renderer is lazy: the heading may need a frame after the text arrives.
    const frame = requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ block: "start" }));
    return () => cancelAnimationFrame(frame);
  }, [ready, hash, key]);
}
