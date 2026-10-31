// The keyboard of the Select (a select-only combobox, WAI-ARIA): which option a key highlights. Pure, so it is tested
// without a browser; disabled options are skipped, and typing a character jumps to the next label that starts with it.

interface KeyOption {
  label: string;
  disabled?: boolean;
}

const enabled = (options: readonly KeyOption[], index: number): boolean => options[index] !== undefined && options[index].disabled !== true;

/** The first enabled option from `from` in `step` direction (wrapping when `wrap`), or `from` itself when there is none. */
function seek(options: readonly KeyOption[], from: number, step: 1 | -1, wrap: boolean): number {
  for (let offset = 1; offset <= options.length; offset += 1) {
    const raw = from + step * offset;
    if (!wrap && (raw < 0 || raw >= options.length)) break;
    const index = ((raw % options.length) + options.length) % options.length;
    if (enabled(options, index)) return index;
  }
  return from;
}

/** The option a list opens on: the selected one when it can be chosen, else the first that can. */
export function openingOption(options: readonly KeyOption[], selected: number): number {
  return enabled(options, selected) ? selected : seek(options, -1, 1, false);
}

/** The option highlighted after `key` with `active` highlighted; `active` when the key moves nothing. */
export function optionAfterKey(options: readonly KeyOption[], active: number, key: string): number {
  switch (key) {
    case "ArrowDown":
      return seek(options, active, 1, false);
    case "ArrowUp":
      return seek(options, active, -1, false);
    case "Home":
      return seek(options, -1, 1, false);
    case "End":
      return seek(options, options.length, -1, false);
    default: {
      if (key.length !== 1 || key === " ") return active;
      const letter = key.toLowerCase();
      for (let offset = 1; offset <= options.length; offset += 1) {
        const index = (active + offset + options.length) % options.length;
        if (enabled(options, index) && options[index]!.label.toLowerCase().startsWith(letter)) return index;
      }
      return active;
    }
  }
}
