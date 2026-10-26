// Sticky header (common) — the band at the top of every page (breadcrumbs, title, page actions)
// that stays put while the page scrolls. It bleeds over the padding of the panel shell
// (layout/panel-shell.tsx) so nothing shows around it, and publishes its height as
// --page-header-height so other sticky pieces (tabs, side navigation) stick right below it.

import * as React from "react";
import { cn } from "@/lib/utils";

export const HEADER_OFFSET = "var(--page-header-height,0px)";

export function StickyHeader({ children, className, hidden }: { children: React.ReactNode; className?: string; hidden?: boolean }): React.JSX.Element {
  const ref = React.useRef<HTMLDivElement>(null);
  React.useLayoutEffect(() => {
    const node = ref.current;
    if (node === null) return;
    // A hidden header (a page under an open detail) measures 0 and leaves the value to the visible one.
    const publish = (): void => {
      if (node.offsetHeight > 0) document.documentElement.style.setProperty("--page-header-height", `${node.offsetHeight}px`);
    };
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return (
    <div
      ref={ref}
      hidden={hidden}
      className={cn("sticky top-0 z-20 -mx-4 -mt-4 -mb-2 bg-background px-4 pt-4 pb-3 sm:-mx-5 sm:px-5 md:-mt-5 md:pt-5", className)}
    >
      {children}
    </div>
  );
}
