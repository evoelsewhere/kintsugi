import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import { isFullUnitId } from "@kintsugi/domain";
import { reviewReportSchema, type ReviewQuery, type ReviewReport, type TaskIdentity } from "@kintsugi/harness-sdk";
import type { MemberPrincipal } from "#modules/core/auth/index.js";
import { ProjectAccessService } from "#modules/admin/project-access/index.js";
import { ReviewReadRepository } from "../domain/review-read.repository.js";

@Injectable()
export class ReviewQueryService {
  constructor(
    private readonly reviews: ReviewReadRepository,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  async get(principal: MemberPrincipal, query: ReviewQuery): Promise<ReviewReport> {
    await this.authorize(principal, query.projectId);
    const stored = await this.reviews.find(query.projectId, query.reviewId);
    if (stored === undefined) throw new NotFoundException("The review was not found in this project");
    if (stored.report === null) {
      throw new ConflictException({
        message: "The review report is not available yet",
        details: { code: stored.status === "failed" ? "REVIEW_FAILED" : "REVIEW_NOT_READY", status: stored.status },
      });
    }

    const parsed = reviewReportSchema.safeParse(stored.report);
    if (!parsed.success) throw new InternalServerErrorException("The stored review report is invalid");
    const report = parsed.data;
    if (report.projectId !== stored.projectId || report.unitId !== stored.unitId ||
        report.reviewId !== stored.reviewId || report.generation !== stored.generation ||
        report.currentness !== stored.currentness) {
      throw new InternalServerErrorException("The stored review report does not match its indexed identity");
    }
    return report;
  }

  async listCurrentIds(principal: MemberPrincipal, identity: TaskIdentity): Promise<string[]> {
    await this.authorize(principal, identity.projectId);
    if (!isFullUnitId(identity.unitId)) throw new BadRequestException("unitId must be application/module/unit");
    return this.reviews.listCurrentIds(identity);
  }

  private async authorize(principal: MemberPrincipal, projectId: string): Promise<void> {
    if (!principal.projectIds.includes(projectId)) {
      throw new ForbiddenException("The token is not scoped to this project");
    }
    await this.projectAccess.requireRead(principal.userId, projectId);
  }
}
