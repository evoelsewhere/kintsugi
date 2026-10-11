// Empty state — what an empty section means and the next action to take (DESIGN.md: muted
// text, ghost action). Used instead of a bare "None." so every empty list says what to do.

import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: React.ReactNode;
  /** The next action, e.g. a Button or a Link. */
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps): React.JSX.Element {
  return (
    <div className={cn("flex flex-col items-center gap-1.5 px-4 py-6 text-center", className)}>
      {Icon === undefined ? null : <Icon className="mb-1 size-5 text-text-muted" strokeWidth={1.5} />}
      <p className="text-[13px] font-medium text-text">{title}</p>
      {description === undefined ? null : <p className="max-w-md text-[12px] text-text-muted">{description}</p>}
      {action === undefined ? null : <div className="mt-2">{action}</div>}
    </div>
  );
}
