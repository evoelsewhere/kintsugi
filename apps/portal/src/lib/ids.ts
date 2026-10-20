// Ids are never typed by the user: they are derived from a name (or a URL) and made unique here.

/** "Billing web" → "billing-web". */
export function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** The slug of `text`, with a numeric suffix when `taken` already holds it; "" when nothing slugifies. */
export function uniqueId(text: string, taken: readonly string[]): string {
  const base = slugify(text);
  if (base === "" || !taken.includes(base)) return base;
  for (let n = 2; ; n++) if (!taken.includes(`${base}-${n}`)) return `${base}-${n}`;
}
