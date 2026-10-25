import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { PinnedSource, MemoryWrite, MemoryFilter, MemoryPage, ProjectMemoryEntry, ProjectMemoryStatus, ProjectMemoryView, ScratchpadInput, ScratchpadItem } from "@kintsugi/domain";
import { MemoryRequestError } from "@kintsugi/runtime-sdk";
import { digestOf } from "../workspace/ledger.js";
import { withPgTransaction } from "../postgres.js";

export interface MemoryContext {
  projectId: string;
  applicationId: string;
  runId: string;
  stepId: string;
  stage: string;
  agent: string;
  reviewedOnly: boolean;
  sources: readonly PinnedSource[];
}
export type VerifiedMemoryWrite = MemoryWrite & { evidence?: NonNullable<ProjectMemoryEntry["evidence"]> };
export interface ScratchpadPage { items: ScratchpadItem[]; total: number; itemId?: string }
export interface ProjectMemory {
  status(context: MemoryContext, includeCount?: boolean): Promise<ProjectMemoryStatus>;
  search(context: MemoryContext, query: string | undefined, filter: MemoryFilter, offset: number, limit: number): Promise<MemoryPage>;
  read(context: MemoryContext, id: string): Promise<ProjectMemoryEntry | undefined>;
  recoveries(context: MemoryContext, offset: number, limit: number): Promise<MemoryPage>;
  days(context: MemoryContext, offset: number, limit: number): Promise<{ items: string[]; total: number }>;
  write(context: MemoryContext, input: VerifiedMemoryWrite, epoch: number): Promise<ProjectMemoryEntry>;
  forget(context: MemoryContext, id: string, epoch: number): Promise<{ recoveryId: string }>;
  restore(context: MemoryContext, recoveryId: string, epoch: number): Promise<{ id: string }>;
  scratchpad(context: MemoryContext, input: ScratchpadInput, epoch: number, offset: number, limit: number): Promise<ScratchpadPage>;
}
const ITEM = `jsonb_build_object('id', e.id, 'applicationId', e.application_id, 'originApplicationId', e.origin_application_id,
  'kind', e.kind, 'target', e.target, 'day', e.day::text, 'summary', e.summary, 'content', e.content, 'tags', e.tags,
  'evidence', case when e.repository_id is null then null else jsonb_strip_nulls(jsonb_build_object('repositoryId', e.repository_id,
    'commit', e.commit_sha, 'path', e.path, 'quote', e.quote)) end,
  'sourceRunId', e.source_run_id, 'sourceStepId', e.source_step_id, 'sourceStage', e.source_stage,
  'producerStatus', coalesce((select r.status from workflow.job_run r where r.id = e.source_run_id), 'unknown'),
  'agent', e.agent, 'state', e.state, 'deletedAt', e.deleted_at, 'recoveryId', e.recovery_id, 'createdAt', e.created_at)`;
const SCOPED = `from knowledge.project_memory_entry e
  join knowledge.project_memory_setting s on s.project_id = e.project_id and s.enabled and s.epoch = e.epoch
  where e.project_id = $1 and (e.application_id is null or e.application_id = $2)
    and (not $4::boolean or (e.state = 'approved' and e.source_run_id is distinct from $5))
    and (e.repository_id is null or (
      exists(select 1 from jsonb_array_elements($3::jsonb) pin where pin->>0 = e.repository_id and pin->>1 = e.commit_sha)
      and exists(select 1 from admin.project_repository l where l.project_id = $1 and l.application_id = $2 and l.repository_id = e.repository_id)
    ))`;
const VISIBLE = `${SCOPED} and e.deleted_at is null and e.state <> 'rejected'`;
const scope = (context: MemoryContext): unknown[] => [context.projectId, context.applicationId,
  JSON.stringify(context.sources.map((source) => [source.repositoryId, source.commit])), context.reviewedOnly, context.runId];

/** Live reads and transactional mutations; no copied memory corpus or read cache. */
export class PgProjectMemory implements ProjectMemory {
  constructor(private readonly db: Pool) {}

  private locked<T>(projectId: string, work: (client: PoolClient, setting: { enabled: boolean; epoch: number }) => Promise<T>, expectedEpoch?: number): Promise<T> {
    return withPgTransaction(this.db, async (client) => {
      await client.query("set local statement_timeout = '5s'");
      await client.query("set local lock_timeout = '3s'");
      await client.query("insert into knowledge.project_memory_setting(project_id) values ($1) on conflict do nothing", [projectId]);
      const result = await client.query<{ enabled: boolean; epoch: number }>("select enabled, epoch from knowledge.project_memory_setting where project_id = $1 for update", [projectId]);
      const setting = result.rows[0]!;
      if (expectedEpoch !== undefined && (!setting.enabled || setting.epoch !== expectedEpoch)) throw new MemoryRequestError("Memory was reset or disabled; retry the operation against current state");
      return work(client, setting);
    });
  }

  async view(projectId: string, offset: number, limit: number): Promise<ProjectMemoryView | undefined> {
    const result = await this.db.query<{ enabled: boolean; epoch: number; total: string; entries: ProjectMemoryEntry[] }>(
      `select coalesce(s.enabled,false) enabled, coalesce(s.epoch,1) epoch,
        (select count(*) from knowledge.project_memory_entry e where e.project_id = p.id) total,
        coalesce((select jsonb_agg(page.item order by page.created_at desc, page.id) from
          (select ${ITEM} item,e.created_at,e.id from knowledge.project_memory_entry e where e.project_id = p.id
           order by e.created_at desc,e.id offset $2 limit $3) page),'[]'::jsonb) entries
       from admin.project p left join knowledge.project_memory_setting s on s.project_id = p.id where p.id = $1`, [projectId, offset, limit]);
    const row = result.rows[0];
    return row === undefined ? undefined : { ...row, total: Number(row.total) };
  }

  configure(projectId: string, enabled: boolean): Promise<void> {
    return this.locked(projectId, async (client, setting) => {
      const epoch = setting.epoch + (setting.enabled && !enabled ? 1 : 0);
      await client.query("update knowledge.project_memory_setting set enabled=$2, epoch=$3 where project_id=$1", [projectId, enabled, epoch]);
      if (epoch !== setting.epoch) {
        for (const table of ["project_memory_entry", "project_memory_recovery", "project_memory_scratchpad"]) {
          await client.query(`update knowledge.${table} set epoch=$2 where project_id=$1`, [projectId, epoch]);
        }
      }
    });
  }
  reset(projectId: string): Promise<void> {
    return this.locked(projectId, async (client) => {
      await client.query("update knowledge.project_memory_setting set epoch=epoch+1 where project_id=$1", [projectId]);
      await client.query("delete from knowledge.project_memory_entry where project_id=$1", [projectId]);
      await client.query("delete from knowledge.project_memory_scratchpad where project_id=$1", [projectId]);
    });
  }
  review(projectId: string, id: string, state: "approved" | "rejected", actor: string): Promise<boolean> {
    return this.locked(projectId, async (client) => {
      const result = await client.query("update knowledge.project_memory_entry set state=$3,reviewed_by=$4,reviewed_at=now() where project_id=$1 and id=$2 and deleted_at is null", [projectId, id, state, actor]);
      return (result.rowCount ?? 0) > 0;
    });
  }

  async status(context: MemoryContext, includeCount = true): Promise<ProjectMemoryStatus> {
    const result = await this.db.query<{ enabled: boolean; epoch: number; available: string }>(
      `select coalesce(setting.enabled,false) enabled,coalesce(setting.epoch,0) epoch,case when $6::boolean then (select count(*) ${VISIBLE}) else 0 end available
       from admin.application a left join knowledge.project_memory_setting setting on setting.project_id=a.project_id
       where a.project_id=$1 and a.id=$2`, [...scope(context),includeCount]);
    const row = result.rows[0];
    return row === undefined ? { enabled: false, epoch: 0, available: 0 } : { ...row, available: Number(row.available) };
  }
  async search(context: MemoryContext, query: string | undefined, filter: MemoryFilter, offset: number, limit: number): Promise<MemoryPage> {
    const vector = "to_tsvector('simple',e.summary || ' ' || e.content || ' ' || e.tags::text)";
    const result = await this.db.query<{ items: ProjectMemoryEntry[]; total: string }>(
      `with matches as (select ${ITEM} item,e.id,e.created_at,
        case when $6::text is null then 0 else ts_rank_cd(${vector},websearch_to_tsquery('simple',$6)) end score
        ${VISIBLE} and ($6::text is null or ${vector} @@ websearch_to_tsquery('simple',$6))
        and ($7::text is null or e.target=$7) and ($8::text is null or e.kind=$8) and ($9::date is null or e.day=$9)
      ) select (select count(*) from matches) total,
        coalesce((select jsonb_agg(page.item order by page.score desc,page.created_at desc,page.id) from
          (select * from matches order by score desc,created_at desc,id offset $10 limit $11) page),'[]'::jsonb) items`,
      [...scope(context), query ?? null, filter.target ?? null, filter.kind ?? null, filter.date ?? null, offset, limit]);
    const row = result.rows[0]!;
    return { items: row.items, total: Number(row.total) };
  }
  async read(context: MemoryContext, id: string): Promise<ProjectMemoryEntry | undefined> {
    const result = await this.db.query<{ item: ProjectMemoryEntry }>(`select ${ITEM} item ${VISIBLE} and e.id=$6`, [...scope(context), id]);
    return result.rows[0]?.item;
  }
  async recoveries(context: MemoryContext, offset: number, limit: number): Promise<MemoryPage> {
    const result = await this.db.query<{items:ProjectMemoryEntry[];total:string}>(`with records as (
      select ${ITEM} item,e.deleted_at,e.id ${SCOPED} and e.deleted_at is not null and e.state='learned'
    ) select (select count(*) from records) total,
      coalesce((select jsonb_agg(p.item order by p.deleted_at desc,p.id) from
        (select * from records order by deleted_at desc,id offset $6 limit $7) p),'[]'::jsonb) items`,[...scope(context),offset,limit]);
    return {items:result.rows[0]!.items,total:Number(result.rows[0]!.total)};
  }
  async days(context: MemoryContext, offset: number, limit: number): Promise<{ items: string[]; total: number }> {
    const result = await this.db.query<{ items: string[]; total: string }>(
      `with days as (select distinct e.day ${VISIBLE} and e.target='daily') select (select count(*) from days) total,
       coalesce((select jsonb_agg(page.day::text order by page.day desc) from (select day from days order by day desc offset $6 limit $7) page),'[]'::jsonb) items`, [...scope(context), offset, limit]);
    return { items: result.rows[0]!.items, total: Number(result.rows[0]!.total) };
  }

  write(context: MemoryContext, input: VerifiedMemoryWrite, epoch: number): Promise<ProjectMemoryEntry> {
    if (context.reviewedOnly) throw new MemoryRequestError("Reviewer memory is read-only");
    return this.locked(context.projectId, async (client) => {
      const app = input.scope === "application" ? context.applicationId : null;
      const day = input.target === "daily" ? new Date().toISOString().slice(0,10) : null;
      const id = digestOf([context.projectId,app,input.target,day,input.kind,input.content,input.tags,input.evidence ?? null]);
      const existing = await client.query<{ state: string; deleted_at: unknown }>("select state,deleted_at from knowledge.project_memory_entry where project_id=$1 and id=$2", [context.projectId,id]);
      if (existing.rows[0]?.deleted_at != null || existing.rows[0]?.state === "rejected") throw new MemoryRequestError("This memory was forgotten or rejected; restore it explicitly or correct the content");
      if (existing.rows.length === 0) {
        const count = await client.query<{ total: string; own: string }>("select count(*) total,count(*) filter(where source_run_id=$2) own from knowledge.project_memory_entry where project_id=$1", [context.projectId,context.runId]);
        if (Number(count.rows[0]!.total) >= 2000 || Number(count.rows[0]!.own) >= 128) throw new MemoryRequestError("Memory quota reached: 2000 entries per project and 128 new entries per run");
        await client.query(`insert into knowledge.project_memory_entry(id,project_id,application_id,origin_application_id,epoch,kind,target,day,summary,content,tags,
          repository_id,commit_sha,path,quote,source_run_id,source_step_id,source_stage,agent)
          values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14,$15,$16,$17,$18,$19)`,
          [id,context.projectId,app,context.applicationId,epoch,input.kind,input.target,day,input.summary,input.content,JSON.stringify(input.tags),
            input.evidence?.repositoryId ?? null,input.evidence?.commit ?? null,input.evidence?.path ?? null,input.evidence?.quote ?? null,
            context.runId,context.stepId,context.stage,context.agent]);
      }
      const result = await client.query<{ item: ProjectMemoryEntry }>(`select ${ITEM} item from knowledge.project_memory_entry e where e.id=$1 and e.project_id=$2`, [id,context.projectId]);
      return result.rows[0]!.item;
    }, epoch);
  }

  forget(context: MemoryContext, id: string, epoch: number): Promise<{ recoveryId: string }> {
    if (context.reviewedOnly) throw new MemoryRequestError("Reviewer memory is read-only");
    return this.locked(context.projectId, async (client) => {
      // Agent mutations apply only to learned memory visible in its bound scope, never reviewed/rejected knowledge.
      const found = await client.query<{ item: ProjectMemoryEntry }>(`select ${ITEM} item ${VISIBLE} and e.id=$6 and e.state='learned' for update of e`, [...scope(context),id]);
      if (found.rows.length === 0) throw new MemoryRequestError("Learned memory is unavailable in this scope");
      return this.forgetEntry(client,context.projectId,id,epoch,context.runId);
    }, epoch);
  }
  restore(context: MemoryContext, recoveryId: string, epoch: number): Promise<{ id: string }> {
    if (context.reviewedOnly) throw new MemoryRequestError("Reviewer memory is read-only");
    return this.locked(context.projectId, async (client) => {
      const result = await client.query<{ id: string }>(`select e.id from knowledge.project_memory_recovery r join knowledge.project_memory_entry e on e.id=r.entry_id
        where r.project_id=$1 and r.id=$2 and r.epoch=$3 and r.restored_at is null and e.project_id=$1 and e.epoch=$3
          and e.recovery_id=r.id and e.deleted_at is not null and e.state='learned' and (e.application_id is null or e.application_id=$4)
          and (e.repository_id is null or (exists(select 1 from jsonb_array_elements($5::jsonb) pin where pin->>0=e.repository_id and pin->>1=e.commit_sha)
            and exists(select 1 from admin.project_repository l where l.project_id=$1 and l.application_id=$4 and l.repository_id=e.repository_id))) for update of e`,
        [context.projectId,recoveryId,epoch,context.applicationId,JSON.stringify(context.sources.map((source)=>[source.repositoryId,source.commit]))]);
      const id = result.rows[0]?.id;
      if (id === undefined) throw new MemoryRequestError("Recovery record is unavailable, already restored or outside this scope");
      return this.restoreEntry(client,context.projectId,recoveryId,id);
    }, epoch);
  }
  private async forgetEntry(client: PoolClient, projectId: string, id: string, epoch: number, runId: string | null): Promise<{ recoveryId: string }> {
    const recoveryId = randomUUID();
    await client.query("insert into knowledge.project_memory_recovery(id,project_id,entry_id,epoch,created_by_run_id) values($1,$2,$3,$4,$5)", [recoveryId,projectId,id,epoch,runId]);
    await client.query("update knowledge.project_memory_entry set deleted_at=now(),recovery_id=$3 where project_id=$1 and id=$2", [projectId,id,recoveryId]);
    return { recoveryId };
  }
  private async restoreEntry(client: PoolClient, projectId: string, recoveryId: string, id: string): Promise<{ id: string }> {
    await client.query("update knowledge.project_memory_entry set deleted_at=null,recovery_id=null where project_id=$1 and id=$2", [projectId,id]);
    await client.query("update knowledge.project_memory_recovery set restored_at=now() where project_id=$1 and id=$2", [projectId,recoveryId]);
    return { id };
  }
  forgetManaged(projectId: string, id: string): Promise<{ recoveryId: string } | undefined> {
    return this.locked(projectId, async (client,setting) => {
      const found = await client.query("select id from knowledge.project_memory_entry where project_id=$1 and id=$2 and deleted_at is null for update",[projectId,id]);
      if (!found.rowCount) return undefined;
      return this.forgetEntry(client,projectId,id,setting.epoch,null);
    });
  }
  restoreManaged(projectId: string, recoveryId: string): Promise<{ id: string } | undefined> {
    return this.locked(projectId, async (client,setting) => {
      const found = await client.query<{id:string}>(`select e.id from knowledge.project_memory_entry e join knowledge.project_memory_recovery r on r.entry_id=e.id
        where e.project_id=$1 and r.project_id=$1 and r.id=$2 and r.epoch=$3 and r.restored_at is null
        and e.recovery_id=r.id and e.deleted_at is not null for update of e`,[projectId,recoveryId,setting.epoch]);
      const id = found.rows[0]?.id;
      return id === undefined ? undefined : this.restoreEntry(client,projectId,recoveryId,id);
    });
  }
  scratchpad(context: MemoryContext, input: ScratchpadInput, epoch: number, offset: number, limit: number): Promise<ScratchpadPage> {
    if (context.reviewedOnly) throw new MemoryRequestError("Reviewer memory is read-only");
    return this.locked(context.projectId, async (client) => {
      const values = [context.projectId,context.runId,epoch];
      let itemId: string | undefined;
      if (input.action === "add") {
        const count = await client.query<{ count: string }>("select count(*) from knowledge.project_memory_scratchpad where project_id=$1 and run_id=$2 and epoch=$3", values);
        if (Number(count.rows[0]!.count) >= 100) throw new MemoryRequestError("Scratchpad limit reached (100 items per run)");
        itemId = randomUUID();
        await client.query("insert into knowledge.project_memory_scratchpad(id,project_id,run_id,epoch,text) values($4,$1,$2,$3,$5)", [...values,itemId,input.text]);
      } else if (input.action === "done" || input.action === "undo") {
        const changed = await client.query("update knowledge.project_memory_scratchpad set done=$5 where project_id=$1 and run_id=$2 and epoch=$3 and id=$4", [...values,input.id,input.action === "done"]);
        if (!changed.rowCount) throw new MemoryRequestError("Scratchpad item not found in this run");
      } else if (input.action === "clear") {
        await client.query("delete from knowledge.project_memory_scratchpad where project_id=$1 and run_id=$2 and epoch=$3 and done", values);
      }
      const result = await client.query<{ items: ScratchpadItem[]; total: string }>(`select
        (select count(*) from knowledge.project_memory_scratchpad where project_id=$1 and run_id=$2 and epoch=$3) total,
        coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'text',p.text,'done',p.done) order by p.created_at,p.id) from
          (select * from knowledge.project_memory_scratchpad where project_id=$1 and run_id=$2 and epoch=$3 order by created_at,id offset $4 limit $5) p),'[]'::jsonb) items`, [...values,offset,limit]);
      return { items: result.rows[0]!.items, total: Number(result.rows[0]!.total), ...(itemId === undefined ? {} : { itemId }) };
    }, epoch);
  }
}
