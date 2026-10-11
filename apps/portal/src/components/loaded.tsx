// Loaded — renders a useLoader resource the same way everywhere: skeleton rows while it loads
// (with a "still loading" note and Retry when the API is slow), the error with Retry when it
// failed, and the content once data is there. A failed refresh keeps the last data and shows
// a small notice above it.

import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SkeletonRows } from "@/components/ui/skeleton";
import type { Loader } from "@/lib/use-loader";

export interface LoadedProps<T> {
  loader: Loader<T>;
  /** Skeleton rows while loading. */
  rows?: number;
  children: (data: T) => React.ReactNode;
}

export function Loaded<T>({ loader, rows = 3, children }: LoadedProps<T>): React.JSX.Element {
  const retry = (
    <Button size="small" variant="ghost" onClick={() => void loader.reload()}>
      <RefreshCw className="size-4" />
      Retry
    </Button>
  );
  if (loader.data === undefined) {
    if (loader.error !== null) {
      return (
        <div role="alert" className="flex flex-wrap items-center gap-2 py-2 text-[13px] text-[var(--ds-status-red)]">
          <span className="min-w-0 flex-1 break-words">Could not load: {loader.error}</span>
          {retry}
        </div>
      );
    }
    return (
      <div>
        <SkeletonRows rows={rows} />
        {loader.slow ? (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px] text-text-muted">
            <span className="min-w-0 flex-1">Still loading — the API is taking longer than usual.</span>
            {retry}
          </div>
        ) : null}
      </div>
    );
  }
  return (
    <>
      {loader.error === null ? null : <p className="mb-2 text-[12px] text-[var(--ds-status-red)]">Refresh failed: {loader.error} — showing the last loaded data.</p>}
      {children(loader.data)}
    </>
  );
}
