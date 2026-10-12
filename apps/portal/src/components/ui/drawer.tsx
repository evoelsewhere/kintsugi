// Drawer — a side panel over the page for the detail of a table row (DESIGN.md §6: surface,
// shadow-modal, overlay rgba(0,0,0,0.25)). Shares the overlay stack with Modal: focus trap,
// focus restore, Escape closes only the top overlay.

import { X } from "lucide-react";
import * as React from "react";
import { createPortal } from "react-dom";
import { useOverlayStack } from "./overlay-stack";

export interface DrawerProps {
  open: boolean;
  title: string;
  /** A line under the title (an id, a location). */
  subtitle?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
}

export function Drawer({ open, title, subtitle, onClose, children }: DrawerProps): React.JSX.Element | null {
  const panelRef = React.useRef<HTMLDivElement>(null);
  useOverlayStack(open, onClose, panelRef);
  const titleId = React.useId();
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="fixed inset-0 bg-black/25" onClick={onClose} aria-hidden />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="relative flex h-full w-full max-w-xl flex-col bg-surface outline-none"
        style={{ boxShadow: "var(--ds-shadow-modal)" }}
      >
        <div className="flex shrink-0 items-start justify-between gap-4 px-5 pt-5 pb-3 [box-shadow:0_1px_0_0_rgba(0,0,0,0.08)]">
          <div className="min-w-0">
            <h2 id={titleId} className="text-[16px] font-medium text-text">
              {title}
            </h2>
            {subtitle === undefined ? null : <div className="mt-1 text-[12px] text-text-secondary">{subtitle}</div>}
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="flex size-7 shrink-0 items-center justify-center rounded-[var(--geist-radius)] text-text-muted hover:bg-hover hover:text-text focus-visible:outline-none focus-visible:[box-shadow:var(--ds-focus-ring)]"
          >
            <X className="size-4" strokeWidth={1.75} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
