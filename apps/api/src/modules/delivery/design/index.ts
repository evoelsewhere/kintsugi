// Public surface of the design module: other modules import only from here.

export { DesignModule } from "./design.module.js";
export { DesignService } from "./application/design.service.js";
export { DesignRunsService, MAX_UNITS_PER_RUN } from "./application/design-runs.service.js";
export type {
  CommonDesignView,
  DesignActivityView,
  DesignAttention,
  DesignOverviewView,
  DesignSetsView,
  DesignSetView,
  UnitDesignRow,
  UnitDesignView,
  UnitSetActivity,
  UnitSetSummary,
} from "./domain/design.js";
