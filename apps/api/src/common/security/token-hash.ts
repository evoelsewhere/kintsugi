// Common security helper for opaque bearer tokens. Persist hashes, never raw credentials.

import { createHash } from "node:crypto";

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
