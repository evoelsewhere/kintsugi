// Use cases of member monitoring: record what a member's connection did, list it, and summarize it per member.

import { randomUUID } from "node:crypto";
import { BadRequestException, HttpException, HttpStatus, Injectable } from "@nestjs/common";
import type { Page } from "#common/application/pagination.js";
import {
  MEMBER_ACTIVITY_DETAIL_MAX_BYTES,
  MEMBER_ACTIVITY_HOURLY_LIMIT,
  MEMBER_ACTIVITY_SUMMARY_MAX,
  type MemberActivity,
  type MemberActivityFilter,
  type MemberActivityInput,
  type MemberUsageSummary,
} from "../domain/member-activity.js";
import { MemberActivityRepository } from "../domain/member-activity.repository.js";

const DAY_MS = 86_400_000;
const DEFAULT_WINDOW_DAYS = 30;

@Injectable()
export class MemberActivityService {
  constructor(private readonly store: MemberActivityRepository) {}

  /** Records one activity; refuses oversized records and a user who is writing too many. Returns its id. */
  async record(input: MemberActivityInput): Promise<string> {
    if ((input.summary ?? "").length > MEMBER_ACTIVITY_SUMMARY_MAX) throw new BadRequestException(`summary is longer than ${MEMBER_ACTIVITY_SUMMARY_MAX} characters`);
    if (Buffer.byteLength(JSON.stringify(input.detail ?? {}), "utf8") > MEMBER_ACTIVITY_DETAIL_MAX_BYTES) throw new BadRequestException(`detail is larger than ${MEMBER_ACTIVITY_DETAIL_MAX_BYTES} bytes`);
    if ((await this.store.countSince(input.userId, new Date(Date.now() - 3_600_000))) >= MEMBER_ACTIVITY_HOURLY_LIMIT) {
      throw new HttpException("Too many activity records in the last hour", HttpStatus.TOO_MANY_REQUESTS);
    }
    const id = randomUUID();
    await this.store.insert(id, input);
    return id;
  }

  /** The same as `record`, for activity Kintsugi observes itself: a failure here never fails the request. */
  async observe(input: MemberActivityInput): Promise<void> {
    await this.store.insert(randomUUID(), input).catch(() => undefined);
  }

  list(filter: MemberActivityFilter): Promise<Page<MemberActivity>> {
    return this.store.list(filter);
  }

  async summary(projectId: string, window: { from?: Date; to?: Date }): Promise<MemberUsageSummary> {
    const to = window.to ?? new Date();
    const from = window.from ?? new Date(to.getTime() - DEFAULT_WINDOW_DAYS * DAY_MS);
    if (from >= to) throw new BadRequestException("from must be before to");
    return { projectId, from: from.toISOString(), to: to.toISOString(), members: await this.store.usage(projectId, from, to) };
  }
}
