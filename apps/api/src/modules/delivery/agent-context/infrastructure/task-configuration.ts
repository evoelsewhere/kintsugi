import { createHash } from "node:crypto";

/** One identity algorithm for source observations and the rows locked before replacement. */
export function applicationIdsFingerprint(applicationIds: readonly string[]): string {
  return createHash("sha256").update(JSON.stringify([...new Set(applicationIds)].sort()), "utf8").digest("hex");
}
