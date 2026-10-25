/** Completed review branches can release their run's scope, including PRs the Git host closed. */
export function canAbandonDocumentWrite(write: { status: string; branch?: string } | null | undefined): boolean {
  return write?.status === "pr-opened" || write?.status === "closed" || (write?.status === "committed" && write.branch !== undefined);
}
