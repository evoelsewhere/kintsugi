// Postgres adapter for sessions (schema: core). Tokens are stored as SHA-256 hashes.

import { createHash, randomBytes } from "node:crypto";
import { Injectable } from "@nestjs/common";
import type { Pool } from "pg";
import { getPool } from "../../../../common/db/pool.js";

const SESSION_DAYS = 7;

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

@Injectable()
export class PgSessionRepository {
  get #pool(): Pool {
    return getPool();
  }

  /** Returns the raw token — it is shown to the caller once and never stored. */
  async create(userId: string): Promise<string> {
    const token = randomBytes(32).toString("base64url");
    await this.#pool.query(
      `insert into core.session (token_hash, user_id, expires_at)
       values ($1, $2, now() + interval '${SESSION_DAYS} days')`,
      [hashToken(token), userId],
    );
    return token;
  }

  async validate(token: string): Promise<string | undefined> {
    const result = await this.#pool.query<{ user_id: string }>(
      "select user_id from core.session where token_hash = $1 and expires_at > now()",
      [hashToken(token)],
    );
    const row = result.rows[0];
    if (row === undefined) return undefined;
    await this.#pool.query("update core.session set last_seen_at = now() where token_hash = $1", [hashToken(token)]);
    return row.user_id;
  }

  async revoke(token: string): Promise<void> {
    await this.#pool.query("delete from core.session where token_hash = $1", [hashToken(token)]);
  }
}
