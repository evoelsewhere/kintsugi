// Bounds what `shell` and `git` hand back to the model. Their process capture is large (64 KB per
// stream), and one `git log` or a noisy build can fill a fifth of a context window in a single tool
// result; pi's own tools stop at 2000 lines or 50 KB, so the kernel's process tools do the same.
// Compaction (see context.ts) is the safety net; this keeps one call from needing it.

import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize, truncateHead, truncateTail } from "@earendil-works/pi-coding-agent";

export interface BoundedOutput {
  text: string;
  /** What was cut, for the notice line; undefined when nothing was. */
  notice?: string;
}

/**
 * Keeps the start (`head`) or the end (`tail`) of `text` within pi's default limits. The process tools use
 * `head`: their capture stops at 64 KB, so what they hold is the beginning of the output, and a tail of that
 * would be an arbitrary middle.
 */
export function boundOutput(text: string, keep: "head" | "tail"): BoundedOutput {
  const result = keep === "head" ? truncateHead(text) : truncateTail(text);
  if (!result.truncated) return { text };
  const shown = result.truncatedBy === "lines" ? `${result.outputLines} of ${result.totalLines} lines` : `${formatSize(result.outputBytes)} of ${formatSize(result.totalBytes)}`;
  const where = keep === "head" ? "first" : "last";
  return {
    text: result.content,
    notice: `output cut to the ${where} ${shown} (limit ${DEFAULT_MAX_LINES} lines or ${formatSize(DEFAULT_MAX_BYTES)}); narrow the command (a path, a count, a filter) to see the rest`,
  };
}
