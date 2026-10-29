// The record of what an agent job read of the legacy source (ADR-0086). The kernel reports each `read` and `grep` as a
// `source.read` event with the lines it showed the model; this collects those of the files under `as-is/` across the
// job's attempts, merged per file, and notes the tools that can read the source without telling which lines (`shell`,
// `git`): with one of them used, the record is not complete. An agent step with `readsTo` saves it there as JSON for a
// later script step (the understand stage's finish checks the specification's citations against it). Paths become
// `<repository id>/<path>`, the form citations take; the record holds no file content.

import type { JobEvent } from "@kintsugi/runtime-sdk";

/** Kernel tools that can show the model source lines without a `source.read` event. */
export const UNRECORDED_READ_TOOLS: ReadonlySet<string> = new Set(["shell", "git"]);

/** A line range, 1-based; `to` null for the rest of the file. */
export type LineRange = readonly [from: number, to: number | null];

export interface ReadRecordJson {
  /** The agent the job ran (`<id>@<version>`). */
  agent: string;
  /** False when a tool that reads without telling which lines was used: a line missing here may still have been read. */
  complete: boolean;
  /** Calls of such tools, by tool. */
  unrecorded: Record<string, number>;
  /** `<repository id>/<path>` → the merged ranges of lines shown. */
  files: Record<string, LineRange[]>;
}

/** Adds a range to a sorted list of disjoint ranges, merging what overlaps or touches. */
export function mergeRange(ranges: readonly LineRange[], range: LineRange): LineRange[] {
  const end = (value: number | null): number => value ?? Number.POSITIVE_INFINITY;
  let [from, to] = range;
  const out: LineRange[] = [];
  let placed = false;
  for (const current of ranges) {
    if (end(current[1]) + 1 < from) {
      out.push(current);
    } else if (end(to) + 1 < current[0]) {
      if (!placed) out.push([from, to]);
      placed = true;
      out.push(current);
    } else {
      from = Math.min(from, current[0]);
      to = current[1] === null || to === null ? null : Math.max(to, current[1]);
    }
  }
  if (!placed) out.push([from, to]);
  return out;
}

export class ReadRecord {
  readonly #files = new Map<string, LineRange[]>();
  readonly #unrecorded = new Map<string, number>();
  readonly #zone: string;

  /** `sourceZone`: the folder of the legacy checkouts, relative to the job workspace (`as-is`). */
  constructor(sourceZone: string = "as-is") {
    this.#zone = `${sourceZone.replace(/\/+$/, "")}/`;
  }

  /** Takes the events of the job that matter here; the others are ignored. */
  add(event: JobEvent): void {
    if (event.type === "source.read") {
      if (!event.path.startsWith(this.#zone) || event.from < 1) return;
      const path = event.path.slice(this.#zone.length);
      this.#files.set(path, mergeRange(this.#files.get(path) ?? [], [event.from, event.to]));
    } else if (event.type === "tool.call" && event.decision === "allowed" && UNRECORDED_READ_TOOLS.has(event.tool)) {
      this.#unrecorded.set(event.tool, (this.#unrecorded.get(event.tool) ?? 0) + 1);
    }
  }

  toJSON(agent: string): ReadRecordJson {
    const files: Record<string, LineRange[]> = {};
    for (const path of [...this.#files.keys()].sort()) files[path] = this.#files.get(path)!;
    return { agent, complete: this.#unrecorded.size === 0, unrecorded: Object.fromEntries([...this.#unrecorded].sort()), files };
  }
}
