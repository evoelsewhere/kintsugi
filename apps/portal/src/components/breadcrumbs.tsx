// Breadcrumbs (common) — compact trail at the top of every page: home icon + entries.
// The old PageHeader (title/description block) was removed; this keeps orientation
// without spending vertical space. DESIGN.md: 13px muted text. An entry with `to` is a link to
// its page (the home icon always is); the last entry is the current page and stays text. An entry
// with `onSelect` is a button (the way back from a detail page, see detail-page.tsx).

import { ChevronRight, Gauge } from "lucide-react";
import * as React from "react";
import { Link } from "react-router-dom";
import { usePublishBreadcrumbs } from "./detail-context";

export type Crumb = string | { label: string; to?: string | undefined; onSelect?: (() => void) | undefined };

export interface BreadcrumbsProps {
  /** Trail after the home entry, e.g. ["Administration", { label: "Plugins", to: "/plugins" }, "Reverse Engineering"]. */
  items: Crumb[];
}

const LINK = "rounded-sm text-text-secondary hover:text-text hover:underline focus-visible:outline-none focus-visible:[box-shadow:var(--ds-focus-ring)]";

/** The trail of a page; a detail page opened over it extends it. */
export function Breadcrumbs({ items }: BreadcrumbsProps): React.JSX.Element {
  usePublishBreadcrumbs(items);
  return <BreadcrumbTrail items={items} />;
}

export function BreadcrumbTrail({ items }: BreadcrumbsProps): React.JSX.Element {
  return (
    <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1.5 text-[13px] text-text-muted">
      <Link to="/" aria-label="Overview" className="rounded-sm hover:text-text focus-visible:outline-none focus-visible:[box-shadow:var(--ds-focus-ring)]">
        <Gauge className="size-4" strokeWidth={1.75} />
      </Link>
      {items.map((entry, index) => {
        const label = typeof entry === "string" ? entry : entry.label;
        const last = index === items.length - 1;
        const to = typeof entry === "string" || last ? undefined : entry.to;
        const onSelect = typeof entry === "string" || last ? undefined : entry.onSelect;
        return (
          <React.Fragment key={`${index}:${label}`}>
            <ChevronRight className="size-3.5" strokeWidth={1.75} />
            {onSelect !== undefined ? (
              <button type="button" onClick={onSelect} className={LINK}>
                {label}
              </button>
            ) : to === undefined ? (
              <span className="text-text-secondary" aria-current={last ? "page" : undefined}>
                {label}
              </span>
            ) : (
              <Link to={to} className={LINK}>
                {label}
              </Link>
            )}
          </React.Fragment>
        );
      })}
    </nav>
  );
}
