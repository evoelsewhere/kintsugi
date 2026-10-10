// Postgres adapter for sessions (schema: core). Tokens are stored as SHA-256 hashes.

import { createHash, randomBytes } from "node:crypto";
import { Injectable } from "@nestjs/common";
import type { Pool } from "pg";
import { getPool } from "../../../../common/db/pool.js";
import { SESSION_TTL_SECONDS, SessionRepository } from "../domain/session.repository.js";

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

@Injectable()
export class PgSessionRepository extends SessionRepository {
  get #pool(): Pool {
    return getPool();
  }

  async create(userId: string): Promise<string> {
    const token = randomBytes(32).toString("base64url");
    await this.#pool.query(
      `insert into core.session (token_hash, user_id, expires_at)
       values ($1, $2, now() + make_interval(secs => $3))`,
      [hashToken(token), userId, SESSION_TTL_SECONDS],
    );
    return token;
  }

  async validate(token: string): Promise<string | undefined> {
    const result = await this.#pool.query<{ user_id: string }>(
      "update core.session set last_seen_at = now() where token_hash = $1 and expires_at > now() returning user_id",
      [hashToken(token)],
    );
    return result.rows[0]?.user_id;
  }

  async revoke(token: string): Promise<void> {
    await this.#pool.query("delete from core.session where token_hash = $1", [hashToken(token)]);
  }
}
