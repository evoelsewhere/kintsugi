// Shared kernel: time helpers. One clock format everywhere — ISO-8601 UTC.

export function nowIso(): string {
  return new Date().toISOString();
}
