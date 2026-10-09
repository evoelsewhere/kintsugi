// Port of DashboardStats — the DI token of this module (shared kernel: common/domain/repository.ts).

import { Repository } from "../../../../common/domain/repository.js";
import type { CreateDashboardStat, DashboardStat } from "./dashboard-stat.js";

export abstract class DashboardStatRepository extends Repository<DashboardStat, CreateDashboardStat> {}
