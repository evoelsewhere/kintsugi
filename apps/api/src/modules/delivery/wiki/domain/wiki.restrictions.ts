// Who may edit or publish under a path (ADR-0099 decision 5). A restriction only narrows: no row never widens or
// narrows anything, and holding `wiki.manage` exempts nobody. Pure.

import type { WikiRestriction, WikiRestrictionKind } from "./wiki.js";

/** Whether a restriction prefix covers a page: the prefix is the page itself, or a folder (ending in "/") above it. */
export function prefixCovers(prefix: string, path: string): boolean {
  return prefix === path || (prefix.endsWith("/") && path.startsWith(prefix));
}

/** The answer of the evaluation: allowed, or refused with the prefix whose rule the person does not meet. */
export type RestrictionOutcome = { allowed: true } | { allowed: false; pathPrefix: string };

/**
 * For every path prefix that covers `path` and has rows of `kind`, the person must be one of its listed users or hold
 * one of its listed roles; the rule of a folder and the rule of a page under it both have to be met (a child adds to its
 * parent, never replaces it). A prefix without rows of the kind says nothing. When more than one prefix refuses, the
 * deepest is reported: it is the one the person can most plausibly have asked to be let into.
 */
export function evaluateRestrictions(rows: readonly WikiRestriction[], userId: string, roleIds: readonly string[], path: string, kind: WikiRestrictionKind): RestrictionOutcome {
  const byPrefix = new Map<string, WikiRestriction[]>();
  for (const row of rows) {
    if (row.kind !== kind || !prefixCovers(row.pathPrefix, path)) continue;
    const group = byPrefix.get(row.pathPrefix);
    if (group === undefined) byPrefix.set(row.pathPrefix, [row]);
    else group.push(row);
  }
  let refused: string | undefined;
  for (const [prefix, group] of byPrefix) {
    const met = group.some((row) => (row.subjectKind === "user" ? row.subjectId === userId : roleIds.includes(row.subjectId)));
    if (!met && (refused === undefined || prefix.length > refused.length)) refused = prefix;
  }
  return refused === undefined ? { allowed: true } : { allowed: false, pathPrefix: refused };
}
