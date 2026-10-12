// The link context of rendered documents (see document-links.tsx): the provider's open and
// register, and the hook a results view uses to show some link targets in place.

import { createContext, useContext, useEffect, useRef } from "react";

/** A document-repo file a link points to (repo-relative), with its fragment. */
export interface DocumentTarget {
  path: string;
  anchor?: string;
}

/** Returns true when the view showed the target itself. */
export type DocumentLinkHandler = (target: DocumentTarget) => boolean;

export interface DocumentLinks {
  open: (target: DocumentTarget, from: string) => void;
  register: (handler: DocumentLinkHandler) => () => void;
}

export const DocumentLinksContext = createContext<DocumentLinks | null>(null);

/** Lets a view show some link targets in place (the latest registered handler is asked first). */
export function useDocumentLinkHandler(handler: DocumentLinkHandler): void {
  const links = useContext(DocumentLinksContext);
  const latest = useRef(handler);
  useEffect(() => {
    latest.current = handler;
  });
  useEffect(() => links?.register((target) => latest.current(target)), [links]);
}
