// The kernel `shell` tool (ADR-0039). pi's own bash keeps a persistent shell in the host's
// environment — exactly the boundary ADR-0029 removes — so the kernel runs commands itself: the
// call shape models know (`command`, `timeout` in seconds) with each command as its own process
// through the launcher's runProcess — explicit `bash -c` (no implicit shell interpretation by
// spawn), the job's cleared environment (HOME, TEMP and TMPDIR at the job's scratch), a
// wall-clock timeout and kill-tree on timeout or abort. Nothing survives a call. The job's OS
// account is the real boundary (ADR-0029): a command can reach anything the account can, so the
// worktree is read-only at the OS level where available and the launcher's cleanup is the
// mitigation — the same guarantee script steps already run under.

import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { runProcess } from "../launcher/process.js";
import { jobEnvironment } from "../launcher/script.js";

const DEFAULT_TIMEOUT_SEC = 60;
const MAX_TIMEOUT_SEC = 600;

const parameters = Type.Object({
  command: Type.String({ description: "The command to run, executed with `bash -c`." }),
  timeout: Type.Optional(Type.Number({ description: `Timeout in seconds (default ${DEFAULT_TIMEOUT_SEC}, max ${MAX_TIMEOUT_SEC}).` })),
});

function clampTimeoutSec(timeout: number | undefined): number {
  if (timeout === undefined || Number.isNaN(timeout)) return DEFAULT_TIMEOUT_SEC;
  return Math.min(Math.max(Math.round(timeout), 1), MAX_TIMEOUT_SEC);
}

export function createKernelShellTool(cwd: string, tmp: string): ToolDefinition {
  return defineTool({
    name: "shell",
    label: "shell",
    description: "Runs a shell command in the job workspace and returns its output.",
    parameters,
    execute: async (_toolCallId, params, signal) => {
      const timeoutSec = clampTimeoutSec(params.timeout);
      const result = await runProcess({
        command: "bash",
        args: ["-c", params.command],
        cwd,
        env: jobEnvironment(tmp),
        timeoutMs: timeoutSec * 1000,
        signal,
      });
      const chunks: string[] = [];
      if (result.stdout !== "") chunks.push(result.stdout);
      if (result.stderr !== "") chunks.push(result.stderr);
      let text = chunks.join(chunks.length === 2 ? "\n" : "");
      if (text === "") text = "(no output)";
      const notices: string[] = [];
      if (result.stopped === "timeout") notices.push(`Command timed out after ${timeoutSec}s`);
      else if (result.stopped === "aborted") notices.push("Command aborted");
      else if (result.stopped === "output-limit") notices.push("Command output exceeded the capture limit");
      else if (result.exitCode !== 0) notices.push(`Command exited with code ${result.exitCode}`);
      if (result.truncated) notices.push("output truncated");
      if (notices.length > 0) text = `${text}\n\n[${notices.join(". ")}]`;
      return { details: undefined, content: [{ type: "text", text }] };
    },
  });
}
