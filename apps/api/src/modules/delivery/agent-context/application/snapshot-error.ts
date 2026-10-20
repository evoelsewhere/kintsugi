import { ConflictException, GoneException } from "@nestjs/common";

type SnapshotErrorCode = "SNAPSHOT_PREPARING" | "SNAPSHOT_EXPIRED" | "SNAPSHOT_UNAVAILABLE";

/** Keeps snapshot recovery data inside the existing HTTP error envelope. */
export function snapshotError(code: SnapshotErrorCode, snapshotId: string, reason: string = code): ConflictException | GoneException {
  const preparing = code === "SNAPSHOT_PREPARING";
  const guidance = preparing
    ? "Retry the task brief with this same snapshotId; retention is still in progress."
    : "Request a new task brief without snapshotId.";
  const body = {
    message: reason + ": " + guidance,
    details: { code, snapshotId, ...(preparing ? { retryAfterMs: 1000 } : {}) },
  };
  return code === "SNAPSHOT_EXPIRED" ? new GoneException(body) : new ConflictException(body);
}
