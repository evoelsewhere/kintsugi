// The `submit_result` tool: how an agent reports a structured result (ADR-0023). A job whose step has a
// result schema gets this tool, and its parameters ARE that schema, so the provider's tool calling shapes the
// arguments and pi validates them before the tool runs: a wrong result is an error the model sees in the same
// turn and fixes, instead of a file the launcher finds wrong after the agent has stopped. The valid result is
// written as `result.json` in the output directory, where the step reads it (what it did before, when the agent
// wrote that file by hand and sometimes wrote the schema itself).

import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { PathGuard } from "./paths.js";
import { RESULT_FILE, RESULT_TOOL } from "./tool-names.js";

/** The tool for a job with a result schema; `onOutput` reports the file it writes (path relative to outDir). */
export function createResultTool(schema: Record<string, unknown>, outDir: string, onOutput: (path: string) => void): ToolDefinition {
  const guard = new PathGuard([outDir]);
  const tool = {
    name: RESULT_TOOL,
    label: RESULT_TOOL,
    description:
      "Report the final structured result of this job. Call it once, when the work is done, with the result fields as the arguments. " +
      "The arguments are the result itself, not a description of it. A call that does not fit is refused with the reason: call it again, corrected.",
    parameters: Type.Unsafe(schema),
    execute: async (_toolCallId: string, params: unknown): Promise<unknown> => {
      const target = guard.check(`${outDir}/${RESULT_FILE}`);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, `${JSON.stringify(params, null, 2)}\n`, "utf8");
      onOutput(RESULT_FILE);
      return { details: undefined, content: [{ type: "text", text: "Result recorded. Stop now: the job is complete." }] };
    },
  };
  return tool as unknown as ToolDefinition;
}
