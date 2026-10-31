// Select — styled dropdown (no native <select>). DESIGN.md §4: input-like trigger
// (40px, radius 6px, shadow-as-border), menu with --ds-shadow-menu, radius 12px,
// 14px items with gray hover fill. The menu portals to the document body so it
// never clips inside a scrolling Modal body.
//
// One click = one toggle, also inside a Field (which wraps its control in a <label>): the
// trigger cancels the label's default action, so the label never replays the click on the
// trigger, and a press on the enclosing label does not count as "outside" (the label's own
// click toggles the menu instead of closing and immediately reopening it).

import { Check, ChevronDown } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { type MenuPlacement, placeMenu } from "./menu-placement";

export interface SelectOption {
  value: string;
  label: string;
  hint?: string;
  icon?: React.ReactNode;
  /** Shown but not selectable; the hint says why. */
  disabled?: boolean;
}

export interface SelectProps {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  id?: string;
  /** `small` (32px, 13px text) for the filters of a table or a toolbar. */
  size?: "default" | "small";
}


export function Select({ value, options, onChange, placeholder = "Select…", disabled, className, id, size = "default" }: SelectProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<MenuPlacement | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);
  const selected = options.find((option) => option.value === value);

  // Layout effect: the menu is placed before paint, so it never flashes at a stale position.
  useLayoutEffect(() => {
    if (!open) return;
    const root = rootRef.current;
    if (root === null) return;
    const reposition = (): void => setPlacement(placeMenu(root));
    reposition();
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) === true) return;
      if (menuRef.current?.contains(target) === true) return;
      if (rootRef.current?.closest("label")?.contains(target) === true) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      // Consumed: the surrounding overlay must stay open (see useOverlayStack).
      event.preventDefault();
      setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    // Capture phase: also follows scrolling inside Modal bodies.
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <button
        id={id}
        type="button"
        disabled={disabled}
        onClick={(event) => {
          // Inside a <label>, the label would replay this click on the trigger.
          event.preventDefault();
          setOpen((prev) => !prev);
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(
          "shadow-border flex w-full items-center gap-2 rounded-[var(--geist-radius)] bg-transparent text-left text-text",
          size === "small" ? "h-[var(--geist-form-small-height)] px-2.5 text-[13px]" : "h-[var(--geist-form-height)] px-3 text-[14px]",
          "hover:bg-hover focus-visible:outline-none focus-visible:[box-shadow:var(--ds-focus-ring)] disabled:pointer-events-none disabled:text-text-muted",
        )}
      >
        <span className={cn("flex min-w-0 flex-1 items-center gap-2", selected === undefined && "text-text-muted")}>
          {selected?.icon}
          <span className="min-w-0 truncate">{selected?.label ?? placeholder}</span>
        </span>
        <ChevronDown className={cn("shrink-0 text-text-muted", size === "small" ? "size-3.5" : "size-4", open && "rotate-180")} strokeWidth={1.75} />
      </button>

      {open && placement !== null
        ? createPortal(
            <ul
              ref={menuRef}
              role="listbox"
              className="fixed z-[60] overflow-y-auto rounded-xl bg-surface p-1"
              style={{ boxShadow: "var(--ds-shadow-menu)", ...placement }}
            >
              {options.map((option) => {
                const active = option.value === value;
                return (
                  <li key={option.value}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={active}
                      aria-disabled={option.disabled === true ? true : undefined}
                      disabled={option.disabled === true}
                      onClick={() => {
                        onChange(option.value);
                        setOpen(false);
                      }}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-[var(--geist-radius)] px-2.5 py-2 text-left text-[14px] text-text-secondary hover:bg-hover hover:text-text",
                        active && "text-text",
                        option.disabled === true && "cursor-not-allowed text-text-muted hover:bg-transparent hover:text-text-muted",
                      )}
                    >
                      <Check className={cn("size-3.5 shrink-0", active ? "opacity-100" : "opacity-0")} strokeWidth={2} />
                      {option.icon}
                      <span className="min-w-0 flex-1 truncate">{option.label}</span>
                      {option.hint === undefined ? null : <span title={option.hint} className="max-w-[40%] min-w-0 shrink truncate text-right text-[11px] text-text-muted">{option.hint}</span>}
                    </button>
                  </li>
                );
              })}
            </ul>,
            document.body,
          )
        : null}
    </div>
  );
}
