// Type-ahead for pickers (Combobox): which options match what a person typed. Every word of
// the query must appear in the option's label, value or hint, in any order and case.

import type { SelectOption } from "@/components/ui/select";

export function filterOptions(options: readonly SelectOption[], query: string): SelectOption[] {
  const words = query.toLowerCase().split(/\s+/).filter((word) => word !== "");
  if (words.length === 0) return [...options];
  return options.filter((option) => {
    const text = `${option.label} ${option.value} ${option.hint ?? ""}`.toLowerCase();
    return words.every((word) => text.includes(word));
  });
}
