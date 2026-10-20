// Read-only port for review evidence. A provider is installed when GitHub review ingestion lands.

import type { ReviewQuery, ReviewReport } from "@kintsugi/harness-sdk";
import type { MemberPrincipal } from "#modules/core/auth/index.js";

export abstract class ReviewReader {
  abstract get(principal: MemberPrincipal, query: ReviewQuery): Promise<ReviewReport>;
}
