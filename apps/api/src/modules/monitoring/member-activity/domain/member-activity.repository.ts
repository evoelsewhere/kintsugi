// Port of the member activity store. Implementations live in infrastructure only.

import type { Page } from "#common/application/pagination.js";
import type { MemberActivity, MemberActivityFilter, MemberActivityInput, MemberUsage } from "./member-activity.js";

export abstract class MemberActivityRepository {
  abstract insert(id: string, input: MemberActivityInput): Promise<void>;
  /** How many records a user added since `since`. */
  abstract countSince(userId: string, since: Date): Promise<number>;
  abstract list(filter: MemberActivityFilter): Promise<Page<MemberActivity>>;
  abstract usage(projectId: string, from: Date, to: Date): Promise<MemberUsage[]>;
}
