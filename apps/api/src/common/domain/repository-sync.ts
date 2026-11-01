// The sync state of a registered repository as people see it (ADR-0025). The worker records a repository with no commit
// as a sync error; that is the normal state of a new target repository, so it is shown as `empty`, never as an error.

import { describeSyncError, EMPTY_REPOSITORY_MESSAGE } from "@kintsugi/domain";

/** The worker's sync states, plus `empty` for a repository that has no commit yet. */
export type ShownSyncStatus = "pending" | "cloning" | "ready" | "error" | "empty";

/** The state to show for a stored sync status and error. */
export function shownSyncStatus<S extends string>(status: S, lastError: string | null | undefined): S | "empty" {
  return status === "error" && lastError != null && describeSyncError(lastError) === EMPTY_REPOSITORY_MESSAGE ? "empty" : status;
}

/** The stored error of an empty repository, for queries that leave it out of the error counts. */
export const EMPTY_REPOSITORY_ERROR = EMPTY_REPOSITORY_MESSAGE;

/**
 * SQL that is true for a stored sync error `shownSyncStatus` shows as `empty`, so counts and lists agree: the worker's
 * message for an empty repository (`param` is the placeholder that holds EMPTY_REPOSITORY_ERROR), or Git's own failure
 * to resolve HEAD that rows recorded before that message still hold (the pattern `describeSyncError` reads).
 */
export function emptyRepositorySql(param: string): string {
  return `coalesce(last_error = ${param} or (last_error ~ 'rev-parse --verify( --end-of-options)? HEAD\\^\\{commit\\}' and last_error like '%Needed a single revision%'), false)`;
}
