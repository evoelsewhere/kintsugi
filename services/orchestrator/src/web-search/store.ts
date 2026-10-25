import type { Pool } from "pg";
import { DEFAULT_WEB_SEARCH, WEB_SEARCH_LIMITS, WEB_FETCH_LIMITS, type WebOperation, type WebSearchSettings } from "@kintsugi/domain";
import { WebRequestError } from "@kintsugi/runtime-sdk";
import { withPgTransaction } from "../postgres.js";

export interface WebSearchContext { projectId: string; rootId: string; stepId: string; stepKey: string; agent: string }
export interface WebReservation { epoch: number; remainingForStep: number; remainingForRun: number }
export class PgWebSearch {
  constructor(private readonly pool: Pool) {}
  async view(projectId: string): Promise<WebSearchSettings | undefined> {
    const result = await this.pool.query<{ enabled: boolean | null; fetch_enabled: boolean | null; agents: string[] | null }>(
      `select s.enabled,s.fetch_enabled,s.agents from admin.project p left join knowledge.web_search_setting s on s.project_id=p.id where p.id=$1`, [projectId]);
    const row = result.rows[0];
    return row === undefined ? undefined : { enabled: row.enabled ?? DEFAULT_WEB_SEARCH.enabled, fetchEnabled: row.fetch_enabled ?? DEFAULT_WEB_SEARCH.fetchEnabled, agents: row.agents ?? [...DEFAULT_WEB_SEARCH.agents] };
  }
  async configure(projectId: string, settings: WebSearchSettings): Promise<void> {
    await this.pool.query(`insert into knowledge.web_search_setting(project_id,enabled,agents,fetch_enabled) values($1,$2,$3,$4)
      on conflict(project_id) do update set enabled=excluded.enabled, agents=excluded.agents, fetch_enabled=excluded.fetch_enabled, epoch=knowledge.web_search_setting.epoch+1`, [projectId,settings.enabled,settings.agents,settings.fetchEnabled]);
  }
  async allowed(projectId: string, agent: string, epoch?: number, operation: WebOperation = "search"): Promise<boolean> {
    const result = await this.pool.query(`select 1 from knowledge.web_search_setting
      where project_id=$1 and enabled and $2=any(agents) and ($3::int is null or epoch=$3) and ($4='search' or fetch_enabled)`, [projectId,agent,epoch ?? null,operation]);
    return result.rows.length > 0;
  }
  async reserve(context: WebSearchContext, id: string, operation: WebOperation): Promise<WebReservation> {
    return withPgTransaction(this.pool, async (client) => {
      await client.query("set local lock_timeout = '3s'");
      await client.query("set local statement_timeout = '5s'");
      const setting = await client.query<{ enabled: boolean; fetch_enabled: boolean; agents: string[]; epoch: number; busy: boolean; cooling: boolean }>(
        `select enabled,fetch_enabled,agents,epoch,active_until > clock_timestamp() as busy,next_search_at > clock_timestamp() as cooling
         from knowledge.web_search_setting where project_id=$1 for update`, [context.projectId]);
      const row = setting.rows[0];
      if (row?.enabled !== true || !row.agents.includes(context.agent) || (operation === "fetch" && !row.fetch_enabled)) throw new WebRequestError(`Web ${operation} is disabled or this agent is not permitted.`);
      const limit = operation === "search" ? WEB_SEARCH_LIMITS : WEB_FETCH_LIMITS;
      const count = await client.query<{ total: number; step: number }>(
        `select count(*)::int as total,count(*) filter(where step_key=$3)::int as step
         from knowledge.web_search_request where project_id=$1 and root_id=$2 and operation=$4`, [context.projectId,context.rootId,context.stepKey,operation]);
      const used = count.rows[0]!;
      if (used.total >= limit.perRun || used.step >= limit.perStep) throw new WebRequestError(`Web ${operation} budget exhausted (${limit.perStep}/step, ${limit.perRun}/run, including retries). Continue with existing sources.`);
      if (operation === "search" && (row.busy || row.cooling)) throw new WebRequestError("Another project search is running or cooling down. Wait at least 2 seconds; fetch a known reference or continue other work meanwhile.");
      if (operation === "fetch") {
        const active = await client.query<{ count: number }>(`select count(*)::int as count from knowledge.web_search_request
          where project_id=$1 and operation='fetch' and finished_at is null and lease_until > clock_timestamp()`, [context.projectId]);
        if (active.rows[0]!.count >= WEB_FETCH_LIMITS.concurrency) throw new WebRequestError("Three project page fetches are already running. Continue other work and fetch again after one finishes.");
      }
      await client.query(`insert into knowledge.web_search_request(id,project_id,root_id,step_id,step_key,operation,lease_until) values($1,$2,$3,$4,$5,$6,clock_timestamp()+interval '45 seconds')`, [id,context.projectId,context.rootId,context.stepId,context.stepKey,operation]);
      if (operation === "search") await client.query(`update knowledge.web_search_setting set active_request=$2,active_until=clock_timestamp()+interval '45 seconds',next_search_at=clock_timestamp()+interval '2 seconds' where project_id=$1`, [context.projectId,id]);
      return { epoch: row.epoch, remainingForStep: limit.perStep-used.step-1, remainingForRun: limit.perRun-used.total-1 };
    });
  }
  async release(projectId: string, id: string): Promise<void> {
    await this.pool.query(`update knowledge.web_search_request set finished_at=clock_timestamp(),lease_until=null where project_id=$1 and id=$2`, [projectId,id]);
    await this.pool.query(`update knowledge.web_search_setting set active_request=null,active_until=null where project_id=$1 and active_request=$2`, [projectId,id]);
  }
}
