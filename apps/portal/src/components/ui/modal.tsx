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

/**
 * Open modals, innermost last. Escape closes only the top one — a dialog opened from
 * another dialog (or from the Settings modal) must not take its parent down with it.
 */
const openModals: symbol[] = [];

export function Modal({ open, title, description, onClose, children, footer, wide, size = "default" }: ModalProps): React.JSX.Element | null {
  // Always calls the latest onClose without re-registering the key listener.
  const close = React.useEffectEvent(onClose);

  React.useEffect(() => {
    if (!open) return;
    const self = Symbol("modal");
    openModals.push(self);
    const onKey = (event: KeyboardEvent): void => {
      // A nested control (e.g. an open Select) that handled Escape marks it as consumed.
      if (event.key !== "Escape" || event.defaultPrevented || openModals.at(-1) !== self) return;
      event.preventDefault();
      close();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      openModals.splice(openModals.indexOf(self), 1);
    };
  }, [open]);

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
          page && "flex h-[92vh] w-[95vw] max-w-none flex-col overflow-hidden p-0",
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

        <div className={cn("mt-4", page && "mt-0 min-h-0 flex-1 overflow-y-auto")}>{children}</div>

        {footer === undefined ? null : <div className="mt-4 flex items-center justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}
