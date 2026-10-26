// Page header (common) — what every page starts with and what stays fixed while it scrolls:
// the breadcrumb trail and, under it, the title with its purpose line and the page-level actions.
// A page without a title of its own (a form, a card grid) passes only the crumbs.

import { Breadcrumbs, type Crumb } from "./breadcrumbs";
import { PageHeading } from "./page-heading";
import { StickyHeader } from "./sticky-header";

export interface PageHeaderProps {
  /** Trail after the home entry, see Breadcrumbs. */
  crumbs: Crumb[];
  title?: string | undefined;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}

export function PageHeader({ crumbs, title, description, actions }: PageHeaderProps): React.JSX.Element {
  return (
    <StickyHeader>
      <div className="flex flex-col gap-3">
        <Breadcrumbs items={crumbs} />
        {title === undefined ? null : <PageHeading title={title} description={description} actions={actions} />}
      </div>
    </StickyHeader>
  );
}
