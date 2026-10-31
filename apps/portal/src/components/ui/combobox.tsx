// Combobox — a Select with type-ahead, for long lists (agents, models, projects). Same trigger
// and menu as Select (DESIGN.md §4); the open menu starts with a filter field that keeps the
// focus: type to narrow the list (lib/option-filter.ts), ↑/↓ to move, Enter to choose, Escape
// to close. Typing on the closed trigger opens it with that text.
//
// One press = one choice: an option keeps the focus in the filter field on mouse down and is
// chosen on click, and a press inside the menu never counts as "outside", so no re-render or
// blur in between can drop a click.

import { Check, ChevronDown, Search } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { filterOptions } from "@/lib/option-filter";
import { cn } from "@/lib/utils";
import { type MenuPlacement, placeMenu } from "./menu-placement";
import type { SelectOption, SelectProps } from "./select";

export interface ComboboxProps extends SelectProps {
  /** Placeholder of the filter field. */
  searchPlaceholder?: string;
}

export function Combobox({
  value,
  options,
  onChange,
  placeholder = "Select…",
  disabled,
  className,
  id,
  size = "default",
  searchPlaceholder = "Type to filter…",
}: ComboboxProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [placement, setPlacement] = useState<MenuPlacement | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const selected = options.find((option) => option.value === value);
  const shown = filterOptions(options, query);
  const placed = open && placement !== null;

  function show(seed: string): void {
    setQuery(seed);
    setActive(seed === "" ? Math.max(0, options.findIndex((option) => option.value === value)) : 0);
    setOpen(true);
  }

  function choose(option: SelectOption): void {
    onChange(option.value);
    setOpen(false);
    triggerRef.current?.focus();
  }

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
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open]);

  useEffect(() => {
    if (placed) inputRef.current?.focus({ preventScroll: true });
  }, [placed]);

  useEffect(() => {
    if (placed) menuRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [placed, active]);

  function onFilterKey(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((index) => Math.min(Math.max(index + step, 0), Math.max(shown.length - 1, 0)));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const option = shown[active];
      if (option !== undefined) choose(option);
    } else if (event.key === "Tab") {
      // Back on the trigger, so Tab moves on from there.
      triggerRef.current?.focus();
      setOpen(false);
    }
  }

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        disabled={disabled}
        onClick={(event) => {
          // Inside a <label>, the label would replay this click on the trigger.
          event.preventDefault();
          if (open) setOpen(false);
          else show("");
        }}
        onKeyDown={(event) => {
          if (open) return;
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            show("");
          } else if (event.key.length === 1 && event.key !== " " && !event.ctrlKey && !event.metaKey && !event.altKey) {
            event.preventDefault();
            show(event.key);
          }
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
            <div ref={menuRef} className="fixed z-[60] flex flex-col overflow-hidden rounded-xl bg-surface p-1" style={{ boxShadow: "var(--ds-shadow-menu)", ...placement }}>
              <div className="flex shrink-0 items-center gap-2 px-2.5 pt-1 pb-1.5 [box-shadow:0_1px_0_rgba(0,0,0,0.06)]">
                <Search className="size-3.5 shrink-0 text-text-muted" strokeWidth={1.75} />
                <input
                  ref={inputRef}
                  role="combobox"
                  aria-expanded
                  aria-controls={listId}
                  aria-autocomplete="list"
                  aria-activedescendant={shown[active] === undefined ? undefined : `${listId}-${active}`}
                  value={query}
                  placeholder={searchPlaceholder}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setActive(0);
                  }}
                  onKeyDown={onFilterKey}
                  className="h-8 min-w-0 flex-1 bg-transparent text-[14px] text-text outline-none placeholder:text-text-muted"
                />
              </div>
              <ul id={listId} role="listbox" className="mt-1 min-h-0 flex-1 overflow-y-auto">
                {shown.length === 0 ? <li className="px-2.5 py-2 text-[13px] text-text-muted">No match</li> : null}
                {shown.map((option, index) => {
                  const current = option.value === value;
                  return (
                    <li
                      key={option.value}
                      id={`${listId}-${index}`}
                      data-index={index}
                      role="option"
                      aria-selected={current}
                      onMouseDown={(event) => event.preventDefault()}
                      onMouseMove={() => setActive(index)}
                      onClick={() => choose(option)}
                      className={cn(
                        "flex w-full cursor-pointer items-center gap-2 rounded-[var(--geist-radius)] px-2.5 py-2 text-left text-[14px] text-text-secondary",
                        index === active && "bg-hover text-text",
                        current && "text-text",
                      )}
                    >
                      <Check className={cn("size-3.5 shrink-0", current ? "opacity-100" : "opacity-0")} strokeWidth={2} />
                      {option.icon}
                      <span className="min-w-0 flex-1 truncate">{option.label}</span>
                      {option.hint === undefined ? null : <span title={option.hint} className="max-w-[40%] min-w-0 shrink truncate text-right text-[11px] text-text-muted">{option.hint}</span>}
                    </li>
                  );
                })}
              </ul>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
