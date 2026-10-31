// Checkbox — styled control (no native <input type="checkbox">). DESIGN.md §4:
// 16px box, radius 4px, shadow-as-border; checked = near-black with a white check.

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  /** The accessible name when there is no visible label (a cell of a matrix), or a fuller one than the label. */
  ariaLabel?: string;
  disabled?: boolean;
  id?: string;
}

export function Checkbox({ checked, onChange, label, ariaLabel, disabled, id }: CheckboxProps): React.JSX.Element {
  return (
    <button
      id={id}
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "inline-flex items-center gap-2 text-[14px] text-text focus-visible:outline-none focus-visible:[box-shadow:var(--ds-focus-ring)] disabled:pointer-events-none disabled:text-text-muted",
        label === undefined && "rounded-[4px]",
      )}
    >
      <CheckMark checked={checked} />
      {label === undefined ? null : <span>{label}</span>}
    </button>
  );
}

/** The visual box alone, for rows that own the checkbox role and the toggle themselves. */
export function CheckMark({ checked }: { checked: boolean }): React.JSX.Element {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-4 shrink-0 items-center justify-center rounded-[4px]",
        checked ? "bg-text text-background" : "shadow-border bg-transparent text-transparent hover:bg-hover",
      )}
    >
      <Check className="size-3" strokeWidth={3} />
    </span>
  );
}
