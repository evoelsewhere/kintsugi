import { Injectable } from "@nestjs/common";
import { PgProjectMemory } from "@kintsugi/orchestrator/project-memory";
import { getPool } from "#common/db/pool.js";
import { ProjectMemoryRepository } from "../domain/project-memory.repository.js";

@Injectable()
export class PgProjectMemoryRepository extends ProjectMemoryRepository {
  private get store(): PgProjectMemory { return new PgProjectMemory(getPool()); }
  view(projectId: string, offset: number, limit: number) { return this.store.view(projectId, offset, limit); }
  configure(projectId: string, enabled: boolean) { return this.store.configure(projectId, enabled); }
  reset(projectId: string) { return this.store.reset(projectId); }
  forgetManaged(projectId: string, id: string) { return this.store.forgetManaged(projectId,id); }
  restoreManaged(projectId: string, recoveryId: string) { return this.store.restoreManaged(projectId,recoveryId); }
  review(projectId: string, id: string, state: "approved" | "rejected", actor: string) { return this.store.review(projectId, id, state, actor); }
}
