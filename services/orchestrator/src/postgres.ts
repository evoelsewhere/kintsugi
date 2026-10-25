import type { Pool, PoolClient } from "pg";

/** One unit of work on one connection; never run transaction statements through a pool. */
export async function withPgTransaction<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const value = await work(client);
    await client.query("commit");
    return value;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally { client.release(); }
}
