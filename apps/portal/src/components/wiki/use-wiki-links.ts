// How the links of a wiki page behave: a link to another page (or a heading of this one) moves the reader there
// without reloading it, an attachment opens through the API's attachment route, and an address that names a heading
// scrolls to it once the page is on screen. The renderer resolves each link against the page it is written in.

import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useDocumentLinkHandler } from "@/components/results/use-document-links";
import { attachmentUrl, headingIdOfHash, headingOffPlace, SCROLL_POLL_MS, scrollSettled, wikiLink, wikiLinkAction } from "@/lib/wiki";

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

/** The nearest ancestor that scrolls (the page area of the reader), or null when the window itself does. */
function scrollParent(element: HTMLElement): HTMLElement | null {
  for (let parent = element.parentElement; parent !== null; parent = parent.parentElement) {
    const overflow = getComputedStyle(parent).overflowY;
    if ((overflow === "auto" || overflow === "scroll") && parent.scrollHeight > parent.clientHeight) return parent;
  }
  return null;
}

/**
 * Scrolls to the heading the address names (`#slug`) once the page's text is rendered (`ready`), and again whenever the
 * reader moves to another heading, also of the same page. The page keeps growing for a moment after it is drawn (lazy
 * renderer, diagrams, images), so the heading is put back at the top until the page has settled or the person scrolls
 * by hand. The id is looked up as an id, never as a selector.
 */
export function useScrollToHeading(ready: boolean): void {
  const { hash, key } = useLocation();
  useEffect(() => {
    if (!ready || hash === "") return;
    const id = headingIdOfHash(hash);
    const started = performance.now();
    let scrolledByHand = false;
    const byHand = (): void => {
      scrolledByHand = true;
    };
    // Only the person's own input stops it: a scroll event would also fire for the reader's own scrolling.
    const inputs = ["wheel", "touchstart", "keydown", "pointerdown"] as const;
    for (const input of inputs) window.addEventListener(input, byHand, { capture: true, passive: true });

    const hold = (): void => {
      const heading = document.getElementById(id);
      if (heading === null) return;
      const top = scrollParent(heading)?.getBoundingClientRect().top ?? 0;
      if (headingOffPlace(heading.getBoundingClientRect().top - top)) heading.scrollIntoView({ block: "start" });
    };
    const frame = requestAnimationFrame(hold);
    const timer = setInterval(() => {
      if (scrollSettled(performance.now() - started, scrolledByHand)) clearInterval(timer);
      else hold();
    }, SCROLL_POLL_MS);
    return () => {
      cancelAnimationFrame(frame);
      clearInterval(timer);
      for (const input of inputs) window.removeEventListener(input, byHand, { capture: true });
    };
  }, [ready, hash, key]);
}
