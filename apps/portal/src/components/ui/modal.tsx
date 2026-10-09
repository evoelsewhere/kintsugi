// Modal dialog — DESIGN.md §6: surface #FFFFFF, shadow-modal, radius 12px, overlay
// backdrop rgba(0,0,0,0.4); entrance scale .96 → 1 with the swift easing token.

import { X } from "lucide-react";
import * as React from "react";
import { cn } from "../../lib/utils";

export interface ModalProps {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
}

export function Modal({ open, title, description, onClose, children, footer, wide }: ModalProps): React.JSX.Element | null {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-6">
      <div className="fixed inset-0 bg-black/40" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          "relative mt-10 w-full rounded-xl bg-surface p-6",
          wide ? "max-w-2xl" : "max-w-md",
        )}
        style={{
          boxShadow: "var(--ds-shadow-modal)",
          animation: "ds-modal-in var(--ds-motion-overlay-duration) var(--ds-motion-timing-swift)",
        }}
      >
        <style>{`@keyframes ds-modal-in { from { opacity: 0; transform: scale(0.96); } to { opacity: 1; transform: scale(1); } }`}</style>

        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-[16px] font-medium text-text">{title}</h2>
            {description === undefined ? null : <p className="mt-1 text-[13px] text-text-secondary">{description}</p>}
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

        <div className="mt-5">{children}</div>

        {footer === undefined ? null : <div className="mt-6 flex items-center justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}
