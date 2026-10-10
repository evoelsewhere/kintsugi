// Select — styled dropdown (no native <select>). DESIGN.md §4: input-like trigger
// (40px, radius 6px, shadow-as-border), menu with --ds-shadow-menu, radius 12px,
// 14px items with gray hover fill.

import { Check, ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "../../lib/utils";

export interface SelectOption {
  value: string;
  label: string;
  hint?: string;
  icon?: React.ReactNode;
}

export interface SelectProps {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  id?: string;
}

export function Select({ value, options, onChange, placeholder = "Select…", disabled, className, id }: SelectProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = options.find((option) => option.value === value);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent): void => {
      if (rootRef.current !== null && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      // Consumed: the surrounding modal must stay open (see Modal).
      event.preventDefault();
      setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <button
        id={id}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(
          "shadow-border flex h-[var(--geist-form-height)] w-full items-center gap-2 rounded-[var(--geist-radius)] bg-transparent px-3 text-left text-[14px] text-text",
          "hover:bg-hover focus-visible:outline-none focus-visible:[box-shadow:var(--ds-focus-ring)] disabled:pointer-events-none disabled:text-text-muted",
        )}
      >
        <span className={cn("min-w-0 flex-1 truncate", selected === undefined && "text-text-muted")}>
          {selected?.icon}
          {selected?.label ?? placeholder}
        </span>
        <ChevronDown className={cn("size-4 shrink-0 text-text-muted transition-transform duration-150", open && "rotate-180")} strokeWidth={1.75} />
      </button>

      {open ? (
        <ul
          role="listbox"
          className="absolute z-30 mt-1.5 max-h-64 w-full overflow-y-auto rounded-xl bg-surface p-1"
          style={{ boxShadow: "var(--ds-shadow-menu)" }}
        >
          {options.map((option) => {
            const active = option.value === value;
            return (
              <li key={option.value}>
                <button
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-[var(--geist-radius)] px-2.5 py-2 text-left text-[14px] text-text-secondary hover:bg-hover hover:text-text",
                    active && "text-text",
                  )}
                >
                  <Check className={cn("size-3.5 shrink-0", active ? "opacity-100" : "opacity-0")} strokeWidth={2} />
                  {option.icon}
                  <span className="min-w-0 flex-1 truncate">{option.label}</span>
                  {option.hint === undefined ? null : <span className="shrink-0 text-[11px] text-text-muted">{option.hint}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
