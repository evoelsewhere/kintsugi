// Kintsugi custom tools for pi sessions (fixed in code, ADR-0014):
//   kb_search     — query the project knowledge base (gateway wiring lands with services/harness-hub);
//   outputs_write — write deliverables into the job's /out directory (the worker commits them, ADR-0007).

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export const kbSearchTool = defineTool({
  name: "kb_search",
  label: "KB search",
  description:
    "Search the project knowledge base. kb: \"as-is\" for the current state, \"to-be\" for the target state. Returns matching documents with sources.",
  promptSnippet: "kb_search — search the project knowledge base (as-is / to-be)",
  parameters: Type.Object({
    kb: Type.Union([Type.Literal("as-is"), Type.Literal("to-be")]),
    query: Type.String({ minLength: 1 }),
  }),
  execute: async (_toolCallId, params) => ({
    details: undefined,
    content: [
      {
        type: "text",
        text:
          `The knowledge base is not reachable from this job yet (kb=${params.kb}, query="${params.query}"). ` +
          "TODO: call the Kintsugi job gateway (services/harness-hub) when it lands.",
      },
    ],
  }),
});

export function createOutputsWriteTool(outDir: string): ToolDefinition {
  const root = resolve(outDir);
  return defineTool({
    name: "outputs_write",
    label: "Write job output",
    description:
      "Write a deliverable file to the job's /out directory (e.g. \"assessment/app/scorecard.md\"). Paths must stay inside /out; the worker validates and commits the files (ADR-0007).",
    promptSnippet: "outputs_write — write a deliverable file to /out",
    parameters: Type.Object({
      path: Type.String({ minLength: 1 }),
      content: Type.String(),
    }),
    execute: async (_toolCallId, params) => {
      const target = resolve(root, params.path);
      if (target !== root && !target.startsWith(root + sep)) {
        return { details: undefined, content: [{ type: "text", text: `Refused: path "${params.path}" escapes /out.` }], isError: true };
      }
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, params.content, "utf8");
      return { details: undefined, content: [{ type: "text", text: `wrote ${params.path} (${params.content.length} bytes)` }] };
    },
  });
}
