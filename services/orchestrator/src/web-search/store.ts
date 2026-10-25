import type { Pool } from "pg";
import { DEFAULT_WEB_SEARCH, WEB_SEARCH_LIMITS, type WebSearchSettings } from "@kintsugi/domain";
import { WebSearchRequestError } from "@kintsugi/runtime-sdk";
import { withPgTransaction } from "../postgres.js";

export interface WebSearchContext { projectId: string; rootId: string; stepId: string; stepKey: string; agent: string }
export class PgWebSearch {
  constructor(private readonly pool: Pool) {}
  async view(projectId: string): Promise<WebSearchSettings | undefined> {
    const result = await this.pool.query<{ enabled: boolean | null; agents: string[] | null }>(
      `select s.enabled, s.agents from admin.project p left join knowledge.web_search_setting s on s.project_id=p.id where p.id=$1`, [projectId]);
    const row = result.rows[0];
    return row === undefined ? undefined : { enabled: row.enabled ?? DEFAULT_WEB_SEARCH.enabled, agents: row.agents ?? [...DEFAULT_WEB_SEARCH.agents] };
  }
  async configure(projectId: string, settings: WebSearchSettings): Promise<void> {
    await this.pool.query(`insert into knowledge.web_search_setting(project_id,enabled,agents) values($1,$2,$3)
      on conflict(project_id) do update set enabled=excluded.enabled, agents=excluded.agents, epoch=knowledge.web_search_setting.epoch+1`, [projectId, settings.enabled, settings.agents]);
  }
  async allowed(projectId: string, agent: string, epoch?: number): Promise<boolean> {
    const result = await this.pool.query(`select 1 from knowledge.web_search_setting
      where project_id=$1 and enabled and $2=any(agents) and ($3::int is null or epoch=$3)`, [projectId,agent,epoch ?? null]);
    return result.rows.length > 0;
  }
  async reserve(context: WebSearchContext, id: string): Promise<number> {
    return withPgTransaction(this.pool, async (client) => {
      await client.query("set local lock_timeout = '3s'");
      await client.query("set local statement_timeout = '5s'");
      const setting = await client.query<{ enabled: boolean; agents: string[]; epoch: number; busy: boolean; cooling: boolean }>(
        `select enabled,agents,epoch,active_until > now() as busy,next_search_at > now() as cooling
         from knowledge.web_search_setting where project_id=$1 for update`, [context.projectId]);
      const row = setting.rows[0];
      if (row?.enabled !== true || !row.agents.includes(context.agent)) throw new WebSearchRequestError("Web search is disabled or this agent is not permitted.");
      const count = await client.query<{ total: number; step: number }>(
        `select count(*)::int as total, count(*) filter(where step_key=$3)::int as step
         from knowledge.web_search_request where project_id=$1 and root_id=$2`, [context.projectId,context.rootId,context.stepKey]);
      if (count.rows[0]!.total >= WEB_SEARCH_LIMITS.perRun || count.rows[0]!.step >= WEB_SEARCH_LIMITS.perStep) throw new WebSearchRequestError("Web search budget exhausted for this step or run, including prior attempts. Continue without web search.");
      if (row.busy || row.cooling) throw new WebSearchRequestError("Another project search is in progress or cooling down. Continue other work and try later if needed.");
      await client.query(`insert into knowledge.web_search_request(id,project_id,root_id,step_id,step_key) values($1,$2,$3,$4,$5)`, [id,context.projectId,context.rootId,context.stepId,context.stepKey]);
      await client.query(`update knowledge.web_search_setting set active_request=$2, active_until=now()+interval '25 seconds', next_search_at=now()+interval '2 seconds' where project_id=$1`, [context.projectId,id]);
      return row.epoch;
    });
  }
  async release(projectId: string, id: string): Promise<void> {
    await this.pool.query(`update knowledge.web_search_setting set active_request=null,active_until=null where project_id=$1 and active_request=$2`, [projectId,id]);
  }
}
