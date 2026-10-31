// Page not found — an address no route knows, said as such instead of quietly showing the Overview.

import { Compass } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/ui/empty-state";

export function NotFoundPage(): React.JSX.Element {
  const { pathname } = useLocation();
  return (
    <div className="flex flex-col gap-5">
      <PageHeader crumbs={["Page not found"]} title="Page not found" />
      <EmptyState
        icon={Compass}
        title={`Nothing lives at ${pathname}`}
        description="The address may be mistyped, or the page has moved. Use the sidebar, or go back to the Overview."
        action={
          <Link className="text-[13px] text-[var(--ds-accent)] hover:underline" to="/">
            Go to the Overview
          </Link>
        }
        className="py-12"
      />
    </div>
  );
}
