// Application layer: use cases of DashboardStats. Extends the shared CRUD kernel
// (common/application/crud.service.ts) — add module-specific use cases here.

import { Injectable } from "@nestjs/common";
import { CrudService } from "#common/application/crud.service.js";
import type { CreateDashboardStat, DashboardStat } from "../domain/dashboard-stat.js";
import { DashboardStatRepository } from "../domain/dashboard-stat.repository.js";

export type UpdateDashboardStat = Partial<CreateDashboardStat>;

@Injectable()
export class DashboardStatsService extends CrudService<DashboardStat, CreateDashboardStat> {
  constructor(items: DashboardStatRepository) {
    super(items, "DashboardStat");
  }
}
