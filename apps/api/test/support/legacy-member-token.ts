import { randomBytes } from "node:crypto";
import { newId } from "../../src/common/domain/ids.js";
import { hashToken } from "../../src/common/security/token-hash.js";
import { MEMBER_TOKEN_PREFIX } from "../../src/modules/core/auth/application/member-token.service.js";
import type { TestApp } from "./app.js";

/** Seeds a legacy PAT row for tests that need a pre-existing read-only credential. */
export async function seedLegacyMemberToken(
  app: TestApp,
  input: { userId: string; projectIds: string[]; name: string; expiresAt?: Date },
): Promise<{ id: string; token: string }> {
  const id = newId();
  const token = MEMBER_TOKEN_PREFIX + randomBytes(32).toString("base64url");
  const expiresAt = input.expiresAt ?? new Date(Date.now() + 60_000);
  await app.db.query(
    "insert into core.member_token (id, user_id, name, token_hash, expires_at) values ($1, $2, $3, $4, $5)",
    [id, input.userId, input.name, hashToken(token), expiresAt],
  );
  await app.db.query(
    "insert into core.member_token_project (token_id, project_id) select $1, project_id from unnest($2::text[]) as project_id",
    [id, input.projectIds],
  );
  return { id, token };
}
