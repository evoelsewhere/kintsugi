// Shared overlay stack for modal overlays (Modal) — open overlays, innermost last.
// Escape closes only the top one: a dialog opened from another dialog (or from
// the Settings modal) must not take its parent down with it.

import * as React from "react";

const openOverlays: symbol[] = [];
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusablesIn(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((element) => element.getClientRects().length > 0);
}

/**
 * Registers an open overlay on the shared stack: focus trap, focus restore and
 * Escape closing only the top. Returns whether this overlay is buried under a
 * newer one (drives the depth scale-back).
 */
export function useOverlayStack(open: boolean, onClose: () => void, panelRef: React.RefObject<HTMLElement | null>): boolean {
  // Always calls the latest onClose without re-registering the key listener.
  const close = React.useEffectEvent(onClose);
  const [buried, setBuried] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    const self = Symbol("overlay");
    openOverlays.push(self);
    // Move focus into the panel (first control after the close button), and
    // give it back to whatever opened the overlay when it closes.
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panel = panelRef.current;
    if (panel !== null) {
      const [closeButton, ...rest] = focusablesIn(panel);
      (rest[0] ?? closeButton ?? panel).focus();
    }

    const syncDepth = (): void => {
      setBuried(openOverlays.at(-1) !== self);
    };
    listeners.add(syncDepth);
    notify();

    const onKey = (event: KeyboardEvent): void => {
      if (openOverlays.at(-1) !== self) return;
      if (event.key === "Tab" && panel !== null) {
        // Focus trap: Tab and Shift+Tab cycle inside the top-most overlay.
        const focusables = focusablesIn(panel);
        const first = focusables[0];
        const last = focusables.at(-1);
        if (first === undefined || last === undefined) {
          event.preventDefault();
          panel.focus();
        } else if (!panel.contains(document.activeElement) || (event.shiftKey && document.activeElement === first)) {
          event.preventDefault();
          (event.shiftKey ? last : first).focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
        return;
      }
      // A nested control (e.g. an open Select) that handled Escape marks it as consumed.
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      close();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      listeners.delete(syncDepth);
      openOverlays.splice(openOverlays.indexOf(self), 1);
      notify();
      if (opener?.isConnected === true) opener.focus();
    };
  }, [open, panelRef]);

  return buried;
}
