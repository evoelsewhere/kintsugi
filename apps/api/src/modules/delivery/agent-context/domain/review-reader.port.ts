// Read-only port for persisted, revision-bound review evidence.

import type { ReviewQuery, ReviewReport, TaskIdentity } from "@kintsugi/harness-sdk";
import type { MemberPrincipal } from "#modules/core/auth/index.js";

export abstract class ReviewReader {
  abstract get(principal: MemberPrincipal, query: ReviewQuery): Promise<ReviewReport>;
  abstract listCurrentIds(principal: MemberPrincipal, identity: TaskIdentity): Promise<string[]>;
}
