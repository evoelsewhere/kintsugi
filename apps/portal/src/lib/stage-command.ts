// The command of a stage as a person types it (ADR-0072, ADR-0089). No React, so it is tested alone.

import type { StageView } from "./api/job-runs";

/**
 * A member command as the member types it in their own AI client, where each Kintsugi plugin is a client plugin of its
 * own: `<plugin>:<command>` (`modernize:build`). A runtime or portal command, which the portal starts, by its name.
 */
export function stageCommand(stage: Pick<StageView, "audience" | "command" | "plugin">): string {
  return stage.audience === "member" && stage.plugin !== undefined && stage.plugin !== "" ? `${stage.plugin}:${stage.command}` : stage.command;
}
