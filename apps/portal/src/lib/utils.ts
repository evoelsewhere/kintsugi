import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// `text-caption` (index.css) is a font-size utility: without this, tailwind-merge reads it as a text
// colour and drops it next to `text-text-secondary`, leaving the element at the inherited size.
const twMerge = extendTailwindMerge({
  extend: { classGroups: { "font-size": ["text-caption"] } },
});

/** shadcn/ui class helper: merge conditional classes and resolve Tailwind conflicts. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
