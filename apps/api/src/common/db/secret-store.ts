// Encrypted secret rows (ADR-0009), shared by every module that stores credentials
// (LLM providers, Git servers). Each secret table has the same shape:
//   (secret_id text pk, <owner> text fk on delete cascade, ciphertext, iv, auth_tag)
// Plaintext only exists between the caller and encrypt/decrypt; it is never logged
// or returned by the API.

import { decryptSecret, encryptSecret } from "@kintsugi/secrets";
import type { Queryable } from "./pool.js";

/** A secret table and its owner column. Code constants only — never request input. */
export interface SecretTable {
  table: `${string}.${string}`;
  ownerColumn: string;
}

/** Encrypts and upserts one secret owned by `ownerId`. */
export async function storeSecret(db: Queryable, where: SecretTable, ownerId: string, secretId: string, plaintext: string): Promise<void> {
  const encrypted = encryptSecret(plaintext);
  await db.query(
    `insert into ${where.table} (secret_id, ${where.ownerColumn}, ciphertext, iv, auth_tag)
     values ($1, $2, $3, $4, $5)
     on conflict (secret_id) do update set ciphertext = $3, iv = $4, auth_tag = $5`,
    [secretId, ownerId, encrypted.ciphertext, encrypted.iv, encrypted.authTag],
  );
}

/** Decrypts one secret; undefined when it does not exist. */
export async function readSecret(db: Queryable, where: SecretTable, secretId: string): Promise<string | undefined> {
  const result = await db.query<{ ciphertext: string; iv: string; auth_tag: string }>(
    `select ciphertext, iv, auth_tag from ${where.table} where secret_id = $1`,
    [secretId],
  );
  const row = result.rows[0];
  return row === undefined ? undefined : decryptSecret({ ciphertext: row.ciphertext, iv: row.iv, authTag: row.auth_tag });
}

/** Presence only — never decrypts, so a rotated or missing key cannot break listings. */
export async function secretExists(db: Queryable, where: SecretTable, secretId: string): Promise<boolean> {
  const result = await db.query(`select 1 from ${where.table} where secret_id = $1`, [secretId]);
  return (result.rowCount ?? 0) > 0;
}
