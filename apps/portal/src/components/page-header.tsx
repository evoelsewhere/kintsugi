// Page header — admin-panel pattern: breadcrumb row, then title left + actions right
// (DESIGN.md §9: display headings with negative tracking, spacing instead of dividers).
import { ChevronRight, Gauge } from "lucide-react";
import * as React from "react";

export interface PageHeaderProps {
  title: string;
  description?: string;
  /** Breadcrumb trail after the home entry, e.g. ["Settings", "Providers"]. */
  breadcrumbs?: string[];
  actions?: React.ReactNode;
}

export function PageHeader({ title, description, breadcrumbs, actions }: PageHeaderProps): React.JSX.Element {
  const trail = breadcrumbs ?? [title];
  return (
    <header className="flex flex-col gap-4">
      <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-[12px] text-text-muted">
        <Gauge className="size-3.5" strokeWidth={1.75} />
        {trail.map((entry) => (
          <React.Fragment key={entry}>
            <ChevronRight className="size-3.5" strokeWidth={1.75} />
            <span className="text-text-secondary">{entry}</span>
          </React.Fragment>
        ))}
      </nav>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <h1 className="h-title text-text">{title}</h1>
          {description === undefined ? null : <p className="max-w-[720px] text-[15px] text-text-secondary">{description}</p>}
        </div>
        {actions === undefined ? null : <div className="flex items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}
