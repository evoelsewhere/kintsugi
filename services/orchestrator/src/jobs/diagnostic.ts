// The diagnostic tail of an agent step (ADR-0090): the last tool calls of an attempt and the start of what each gave
// the model back, kept in the run's events only when the attempt failed or was stopped, so a person can see why a
// model looped. Every preview is redacted; the content of a file the model read is never kept.

import { redactText } from "@kintsugi/runtime/launcher";
import { TOOL_RESULT_PREVIEW_CHARS } from "@kintsugi/runtime-sdk";

/** Tool calls a tail keeps. */
export const DIAGNOSTIC_CALLS = 20;

/** Tools whose result is the content of a file: only whether they worked is kept. */
const CONTENT_TOOLS: ReadonlySet<string> = new Set(["read"]);

interface TailEntry {
  callId: string;
  tool: string;
  /** The call as the run's log says it (tool and where; already redacted). */
  line: string;
  blocked: boolean;
  ok?: boolean;
  preview?: string;
}

/** The newest tool calls of one agent attempt, with what they returned. */
export class ToolTail {
  readonly #entries: TailEntry[] = [];

  call(callId: string, tool: string, line: string, blocked: boolean): void {
    this.#entries.push({ callId, tool, line, blocked });
    if (this.#entries.length > DIAGNOSTIC_CALLS) this.#entries.shift();
  }

  result(callId: string, ok: boolean, preview: string | undefined): void {
    const entry = this.#entries.findLast((candidate) => candidate.callId === callId);
    if (entry === undefined) return;
    entry.ok = ok;
    if (preview !== undefined) entry.preview = preview;
  }

  get size(): number {
    return this.#entries.length;
  }

  /** One line per call, oldest first: "glob in/** → ok: No files found", redacted. */
  lines(): string[] {
    return this.#entries.map((entry) => {
      if (entry.blocked) return `${entry.line} → blocked`;
      if (entry.ok === undefined) return `${entry.line} → no result (stopped while it ran)`;
      const outcome = entry.ok ? "ok" : "error";
      const preview =
        entry.ok && CONTENT_TOOLS.has(entry.tool)
          ? "file content (not kept)"
          : entry.preview === undefined
            ? "(no text)"
            : redactText(entry.preview).slice(0, TOOL_RESULT_PREVIEW_CHARS);
      return `${entry.line} → ${outcome}: ${preview}`;
    });
  }
}
