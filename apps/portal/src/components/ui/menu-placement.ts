// Where the portaled menu of a Select or Combobox goes: below its trigger, or above it when
// there is clearly more room there, anchored to the viewport (the menu is position: fixed).

/** Viewport-anchored placement for a portaled menu. */
export interface MenuPlacement {
  left: number;
  width: number;
  maxHeight: number;
  top?: number;
  bottom?: number;
}

const MENU_MARGIN = 6;
const MENU_FALLBACK_HEIGHT = 260;

export function placeMenu(trigger: HTMLElement): MenuPlacement {
  const rect = trigger.getBoundingClientRect();
  const spaceBelow = window.innerHeight - rect.bottom - MENU_MARGIN * 2;
  const spaceAbove = rect.top - MENU_MARGIN * 2;
  const flip = spaceBelow < MENU_FALLBACK_HEIGHT && spaceAbove > spaceBelow;
  const maxHeight = Math.max(96, Math.min(256, flip ? spaceAbove : spaceBelow));
  return flip
    ? { bottom: window.innerHeight - rect.top + MENU_MARGIN, left: rect.left, width: rect.width, maxHeight }
    : { top: rect.bottom + MENU_MARGIN, left: rect.left, width: rect.width, maxHeight };
}
