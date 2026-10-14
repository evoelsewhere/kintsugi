// Modal dialog — DESIGN.md §6: surface #FFFFFF, shadow-modal, radius 12px, overlay
// backdrop rgba(0,0,0,0.4); entrance scale .96 → 1 with the swift easing token.
//
// Padding anatomy: the panel itself carries none — header, body and footer each own
// their insets. The body is the scroll container, so its horizontal padding sits
// INSIDE the clip box and full-width children keep their shadow-border rings and
// focus rings intact (padding on the panel would clip them at the scroll edge).

import { X } from "lucide-react";
import * as React from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { useOverlayStack } from "./overlay-stack";

export interface ModalProps {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  /** "wide" fits side-by-side forms; "nested" stays inset inside a page dialog. */
  size?: "default" | "wide" | "page" | "nested";
}

export function Modal({ open, title, description, onClose, children, footer, size = "default" }: ModalProps): React.JSX.Element | null {
  const dialogRef = React.useRef<HTMLDivElement>(null);
  const buried = useOverlayStack(open, onClose, dialogRef);
  const titleId = React.useId();
  const descriptionId = React.useId();

  if (!open) return null;

  const page = size === "page";
  const nested = size === "nested";

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
      <div className="fixed inset-0 bg-black/40" onClick={onClose} aria-hidden />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description === undefined ? undefined : descriptionId}
        tabIndex={-1}
        data-under={buried ? "true" : undefined}
        className={cn(
          "relative flex w-full flex-col overflow-hidden rounded-xl bg-surface outline-none data-[under=true]:scale-[0.98]",
          page
            ? "h-[85vh] max-w-5xl"
            : nested
              ? "max-h-[calc(85vh-2rem)] max-w-3xl"
              : "max-h-[calc(100vh-2rem)] sm:max-h-[calc(100vh-3rem)]",
          !page && !nested && (size === "wide" ? "max-w-3xl" : "max-w-md"),
        )}
        style={{
          boxShadow: "var(--ds-shadow-modal)",
        }}
      >
        <div
          className={cn(
            "flex shrink-0 items-start justify-between gap-4 px-5",
            page
              ? "pt-4 pb-3 [box-shadow:0_1px_0_0_rgba(0,0,0,0.08)]"
              : nested
                ? "px-4 pt-4 pb-3"
                : "pt-5 pb-4",
          )}
        >
          <div>
            <h2 id={titleId} className={cn("text-[16px] font-medium text-text", page && "text-[17px]")}>{title}</h2>
            {description === undefined ? null : <p id={descriptionId} className="mt-0.5 text-[12px] text-text-secondary">{description}</p>}
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

        {/* px on the scroll container keeps rings inside the clip box; pb clears the footer. */}
        <div className={cn("min-h-0 flex-1 overflow-y-auto", nested ? "px-4 pt-3 pb-4" : "px-5 pb-5", page && "pt-3")}>
          {children}
        </div>

        {footer === undefined ? null : (
          <div className={cn("flex shrink-0 items-center justify-end gap-2", nested ? "px-4 pb-4" : "px-5 pb-5")}>{footer}</div>
        )}
      </div>
    </div>,
    document.body,
  );
}
