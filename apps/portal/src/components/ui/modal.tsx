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
  /** "page" renders a large workspace dialog (≈80% of the viewport) for settings-style UIs. */
  size?: "default" | "page";
}

export function Modal({ open, title, description, onClose, children, footer, wide, size = "default" }: ModalProps): React.JSX.Element | null {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const page = size === "page";

  return (
    <div className={cn("fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:p-6", page && "items-center p-0 sm:p-0")}>
      <div className="fixed inset-0 bg-black/40" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          "relative mt-6 w-full rounded-xl bg-surface p-5 sm:mt-10 sm:p-6",
          wide ? "max-w-2xl" : "max-w-md",
          page && "flex h-[85vh] w-[90vw] max-w-[1280px] flex-col overflow-hidden p-0",
        )}
        style={{
          boxShadow: "var(--ds-shadow-modal)",
          animation: "ds-modal-in var(--ds-motion-overlay-duration) var(--ds-motion-timing-swift)",
        }}
      >
        <style>{`@keyframes ds-modal-in { from { opacity: 0; transform: scale(0.96); } to { opacity: 1; transform: scale(1); } }`}</style>

        <div className={cn("flex items-start justify-between gap-4", page && "border-b border-transparent px-3 pt-2.5 pb-2", page && "[box-shadow:0_1px_0_0_rgba(0,0,0,0.08)]")}>
          <div>
            <h2 className={cn("text-[16px] font-medium text-text", page && "text-[17px]")}>{title}</h2>
            {description === undefined ? null : <p className="mt-0.5 text-[12px] text-text-secondary">{description}</p>}
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

        <div className={cn("mt-4", page && "mt-0 min-h-0 flex-1 overflow-hidden")}>{children}</div>

        {footer === undefined ? null : <div className="mt-4 flex items-center justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}
