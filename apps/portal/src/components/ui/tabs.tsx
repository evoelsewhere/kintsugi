// Tabs — an underlined tab row (DESIGN.md: 13px labels, the active one in primary text with a
// 2px underline). Controlled; pages keep the active tab in the URL.

import { cn } from "@/lib/utils";

export interface TabItem<T extends string> {
  id: T;
  label: string;
  /** Small count after the label. */
  count?: number | undefined;
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
  sticky = false,
  scrollable = false,
}: {
  tabs: TabItem<T>[];
  value: T;
  onChange: (id: T) => void;
  label: string;
  /** Stays at the top of the page while its content scrolls. */ sticky?: boolean;
  scrollable?: boolean;
}): React.JSX.Element {
  return (
    <div
      role="tablist"
      aria-label={label}
      className={cn(
        "flex gap-1 [box-shadow:0_1px_0_0_rgba(0,0,0,0.08)]",
        scrollable ? "flex-nowrap overflow-x-auto" : "flex-wrap",
        sticky && "sticky top-0 z-10 bg-background",
      )}
    >
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={tab.id === value}
          onClick={() => onChange(tab.id)}
          className={cn(
            "-mb-px flex items-center gap-1.5 px-3 py-2 text-[13px] text-text-secondary hover:text-text focus-visible:outline-none focus-visible:[box-shadow:var(--ds-focus-ring)]",
            scrollable && "shrink-0 whitespace-nowrap",
            tab.id === value && "font-medium text-text [box-shadow:0_-2px_0_0_var(--color-text)_inset]",
          )}
        >
          {tab.label}
          {tab.count === undefined ? null : (
            <span className="rounded-[var(--geist-pill-radius)] bg-hover px-1.5 text-[11px] leading-4 text-text-muted">{tab.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}

/** Filter chips — a compact single-choice row (status filters). */
export function Chips<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
  label: string;
}): React.JSX.Element {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          role="radio"
          aria-checked={option.id === value}
          onClick={() => onChange(option.id)}
          className={cn(
            "h-7 rounded-[var(--geist-pill-radius)] px-3 text-[12px] text-text-secondary shadow-border hover:bg-hover hover:text-text focus-visible:outline-none focus-visible:[box-shadow:var(--ds-focus-ring)]",
            option.id === value && "bg-text text-background shadow-none hover:bg-text hover:text-background",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
