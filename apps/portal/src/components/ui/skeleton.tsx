// Skeleton — placeholder blocks shown while a section loads, in the recessed gray of the
// palette with a soft pulse. Rows mimic a list so the layout does not jump when data arrives.

import { cn } from "@/lib/utils";

export function Skeleton({ className }: { className?: string }): React.JSX.Element {
  return <span aria-hidden className={cn("block animate-pulse rounded-[var(--geist-radius)] bg-recessed", className)} />;
}

/** A list placeholder: `rows` lines of a title and a caption. */
export function SkeletonRows({ rows = 3, className }: { rows?: number; className?: string }): React.JSX.Element {
  return (
    <div role="status" aria-label="Loading" className={cn("flex flex-col gap-3 py-1", className)}>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-center gap-3">
          <Skeleton className="size-4 rounded-full" />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Skeleton className="h-3 w-2/5" />
            <Skeleton className="h-2.5 w-3/5" />
          </div>
        </div>
      ))}
    </div>
  );
}
