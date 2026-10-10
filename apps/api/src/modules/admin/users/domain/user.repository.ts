// Port of members. Implemented by infrastructure adapters; the application layer
// depends only on this contract.

import type { Page, PageQuery } from "../../../../common/application/pagination.js";
import type { PasswordHash } from "../../../../common/security/password.js";
import type { CreateUser, UpdateUser, UserRecord } from "./user.js";

export abstract class UserRepository {
  abstract list(): Promise<UserRecord[]>;
  /** One page of members ordered by username, with the total count. */
  abstract listPage(query: PageQuery): Promise<Page<UserRecord>>;
  abstract get(id: string): Promise<UserRecord | undefined>;
  abstract findByUsername(username: string): Promise<UserRecord | undefined>;
  abstract count(): Promise<number>;
  abstract create(id: string, user: CreateUser, password: PasswordHash): Promise<UserRecord>;
  abstract update(id: string, input: UpdateUser): Promise<UserRecord | undefined>;
  abstract setPassword(id: string, password: PasswordHash): Promise<void>;
  abstract remove(id: string): Promise<boolean>;
  abstract passwordOf(id: string): Promise<PasswordHash | undefined>;
  /** Enabled members holding the role — guards against removing the last admin. */
  abstract countEnabledWithRole(roleId: string): Promise<number>;
  /** Ends every session of the member (password reset, disable). */
  abstract revokeSessions(id: string): Promise<void>;
}
