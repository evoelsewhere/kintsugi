import { HttpException, Injectable } from "@nestjs/common";
import type { ReviewQuery, ReviewReport } from "@kintsugi/harness-sdk";
import type { MemberPrincipal } from "#modules/core/auth/index.js";
import { ReviewReader } from "../domain/review-reader.port.js";

@Injectable()
export class UnavailableReviewReader extends ReviewReader {
  async get(_principal: MemberPrincipal, _query: ReviewQuery): Promise<ReviewReport> {
    throw new HttpException({
      message: "Review evidence is not available yet",
      details: { code: "UNSUPPORTED_CAPABILITY", capability: "reviews" },
    }, 501);
  }
}
