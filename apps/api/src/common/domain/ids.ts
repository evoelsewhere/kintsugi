// Shared domain kernel: identity helpers.

import { randomUUID } from "node:crypto";

/** Stable identifier for a new record. */
export function newId(): string {
  return randomUUID();
}
