// Physical cleanup for the seven-day Coding Agent Workflow event replay window.

import type { Pool } from "pg";

const MEMBER_EVENT_RETENTION_BATCH_SIZE = 1_000;

export async function pruneMemberEvents(pool: Pick<Pool, "query">): Promise<number> {
  const result = await pool.query(
    `with expired as (
       select id
       from workflow.member_event
       where created_at < now() - interval '7 days'
       order by created_at asc
       limit $1
       for update skip locked
     )
     delete from workflow.member_event as event
     using expired
     where event.id = expired.id`,
    [MEMBER_EVENT_RETENTION_BATCH_SIZE],
  );
  return result.rowCount ?? 0;
}
