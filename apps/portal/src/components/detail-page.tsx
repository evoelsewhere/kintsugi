// Detail page — the detail of a table row, shown as a page inside the layout instead of a panel over
// it. The panel shell wraps its outlet in DetailHost: while a DetailPage is open the page underneath is
// hidden (kept mounted, so its tabs, filters and loaded data are still there on return) and the host
// shows the page's breadcrumbs extended with the detail, so any crumb leads back. A detail opened from a
// detail (a document linked from a unit) stacks one more crumb. The crumbs and the detail's heading (back,
// title, subtitle) form one sticky header; only the detail's body scrolls.

import { ArrowLeft } from "lucide-react";
import * as React from "react";
import { createPortal } from "react-dom";
import { BreadcrumbTrail, type Crumb } from "./breadcrumbs";
import { DetailContext, type DetailEntry } from "./detail-context";
import { StickyHeader } from "./sticky-header";

export function DetailHost({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [slot, setSlot] = React.useState<HTMLElement | null>(null);
  const [headerSlot, setHeaderSlot] = React.useState<HTMLElement | null>(null);
  const [stack, setStack] = React.useState<readonly DetailEntry[]>([]);
  const [base, setBase] = React.useState<Crumb[]>([]);
  const register = React.useCallback((entry: DetailEntry) => {
    setStack((previous) => [...previous.filter((candidate) => candidate.id !== entry.id), entry]);
    return () => setStack((previous) => previous.filter((candidate) => candidate.id !== entry.id));
  }, []);
  const value = React.useMemo(() => ({ slot, headerSlot, stack, register, setBase }), [slot, headerSlot, stack, register]);
  const open = stack.length > 0;

  // Closing from a crumb closes every detail above it, innermost first.
  const closeAbove = (depth: number): void => {
    for (const entry of [...stack].slice(depth).reverse()) entry.onClose();
  };
  const trail: Crumb[] = [
    ...base.map((crumb, index) => {
      if (index < base.length - 1) return crumb;
      return { label: typeof crumb === "string" ? crumb : crumb.label, onSelect: () => closeAbove(0) };
    }),
    ...stack.map((entry, index) => (index === stack.length - 1 ? entry.title : { label: entry.title, onSelect: () => closeAbove(index + 1) })),
  ];

  return (
    <DetailContext.Provider value={value}>
      <div hidden={open}>{children}</div>
      <StickyHeader hidden={!open}>
        <div className="flex flex-col gap-3">
          {open ? <BreadcrumbTrail items={trail} /> : null}
          <div ref={setHeaderSlot} />
        </div>
      </StickyHeader>
      <div ref={setSlot} className={open ? "mt-4 flex flex-col gap-4" : "hidden"} />
    </DetailContext.Provider>
  );
}

export interface DetailPageProps {
  open: boolean;
  title: string;
  /** A line under the title (an id, a location). */
  subtitle?: React.ReactNode;
  /** Back to the page the detail was opened from. */
  onClose: () => void;
  children: React.ReactNode;
}

export function DetailPage({ open, title, subtitle, onClose, children }: DetailPageProps): React.JSX.Element | null {
  const host = React.useContext(DetailContext);
  const id = React.useMemo(() => Symbol("detail"), []);
  const close = React.useEffectEvent(onClose);
  const register = host?.register;
  React.useLayoutEffect(() => {
    if (!open || register === undefined) return;
    return register({ id, title, onClose: () => close() });
  }, [open, register, id, title]);
  React.useEffect(() => {
    if (open) window.scrollTo(0, 0);
  }, [open]);
  if (!open || host === null || host.slot === null || host.headerSlot === null) return null;
  const top = host.stack.at(-1)?.id === id;
  return (
    <>
      {createPortal(
        <div hidden={!top} className="flex items-start gap-3">
          <button
            type="button"
            aria-label="Back"
            title="Back"
            onClick={onClose}
            className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-[var(--geist-radius)] text-text-muted hover:bg-hover hover:text-text focus-visible:outline-none focus-visible:[box-shadow:var(--ds-focus-ring)]"
          >
            <ArrowLeft className="size-4" strokeWidth={1.75} />
          </button>
          <div className="min-w-0">
            <h1 className="text-[18px] font-semibold tracking-tight text-text">{title}</h1>
            {subtitle === undefined ? null : <div className="mt-1 text-[12px] text-text-secondary">{subtitle}</div>}
          </div>
        </div>,
        host.headerSlot,
      )}
      {createPortal(
        <div hidden={!top} className="min-w-0">
          {children}
        </div>,
        host.slot,
      )}
    </>
  );
}
