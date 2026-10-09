// Breadcrumbs (common) — compact trail at the top of every page: home icon + entries.
// The old PageHeader (title/description block) was removed; this keeps orientation
// without spending vertical space. DESIGN.md: 11px muted text.

import { ChevronRight, Gauge } from "lucide-react";
import * as React from "react";

export interface BreadcrumbsProps {
  /** Trail after the home entry, e.g. ["Administration", "Members & Permissions"]. */
  items: string[];
}

export function Breadcrumbs({ items }: BreadcrumbsProps): React.JSX.Element {
  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-[11px] text-text-muted">
      <Gauge className="size-3.5" strokeWidth={1.75} />
      {items.map((entry) => (
        <React.Fragment key={entry}>
          <ChevronRight className="size-3" strokeWidth={1.75} />
          <span className="text-text-secondary">{entry}</span>
        </React.Fragment>
      ))}
    </nav>
  );
}
