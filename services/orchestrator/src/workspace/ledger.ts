// The ledger of a job workspace (ADR-0055): .state/ledger.json, written by the worker only. For every step of a
// stage it records what the step ran with (its fingerprint), what it wrote and whether it succeeded, so a later
// attempt of the job skips the steps whose fingerprint is unchanged and whose outputs are still there.
//
// A fingerprint covers everything a step is given: its definition (the agent or workflow, by content), the task
// after the stage's own placeholders are filled, the pinned sources and documents, and the *upstream chain*: a
// hash of every step that came before it in the plan, so a change anywhere upstream re-runs what follows. The
// chain folds in each step's fingerprint and the digest of what it wrote (a step that ran again and wrote
// something else changes the chain even when its own fingerprint did not). Members of a parallel or forEach group
// do not see each other: they all start from the chain before the group.

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { writeAtomically } from "./manifest.js";

export const LEDGER_VERSION = 1;

export interface LedgerOutput {
  /** Document-repo path of the file. */
  path: string;
  /** Where the stage kept it: `out` (published) or `work` (for later steps only). */
  zone: "out" | "work";
}

export interface LedgerEntry {
  status: "succeeded" | "failed";
  fingerprint: string;
  /** Hash of the paths and contents the step wrote: what the steps after it were given. */
  digest: string;
  /** The attempt of the job that ran the step. */
  attempt: number;
  outputs: LedgerOutput[];
  finishedAt: string;
  reason?: string;
}

interface LedgerFile {
  version: typeof LEDGER_VERSION;
  entries: Record<string, LedgerEntry>;
  /** The choices taken at the stage's gates, replayed by a later attempt instead of asking again. */
  gates: Record<string, string>;
}

/** JSON with sorted keys, so equal values hash equal whatever order they were built in. */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export const digestOf = (value: unknown): string => createHash("sha256").update(stableStringify(value)).digest("hex");

/** The digest of the files a step wrote. */
export const filesDigest = (files: ReadonlyArray<{ path: string; sha256: string }>): string =>
  digestOf([...files].map((file) => [file.path, file.sha256]).sort((a, b) => (a[0]! < b[0]! ? -1 : a[0]! > b[0]! ? 1 : 0)));

/** What a step contributes to the chain of the steps after it. */
export const contributionOf = (key: string, fingerprint: string, digest: string): string => digestOf([key, fingerprint, digest]);

/** The chain after a sequence of contributions; members of a group are sorted so their order does not matter. */
export const chainAfter = (previous: string, contributions: readonly string[]): string => digestOf([previous, [...contributions].sort()]);

export class Ledger {
  readonly #file: string;
  readonly #data: LedgerFile;
  #queue: Promise<void> = Promise.resolve();

  private constructor(file: string, data: LedgerFile) {
    this.#file = file;
    this.#data = data;
  }

  /** The ledger at `file`; an empty one when there is none, or when it is unreadable (every step then runs). */
  static async open(file: string): Promise<Ledger> {
    const text = await readFile(file, "utf8").catch(() => undefined);
    let data: LedgerFile = { version: LEDGER_VERSION, entries: {}, gates: {} };
    if (text !== undefined) {
      try {
        const parsed = JSON.parse(text) as Partial<LedgerFile>;
        if (parsed.version === LEDGER_VERSION && typeof parsed.entries === "object" && parsed.entries !== null) {
          data = { version: LEDGER_VERSION, entries: parsed.entries, gates: typeof parsed.gates === "object" && parsed.gates !== null ? parsed.gates : {} };
        }
      } catch {
        // An unreadable ledger is an empty one.
      }
    }
    return new Ledger(file, data);
  }

  get(key: string): LedgerEntry | undefined {
    return this.#data.entries[key];
  }

  /** Every recorded step, by key. */
  entries(): Array<[string, LedgerEntry]> {
    return Object.entries(this.#data.entries);
  }

  gates(): ReadonlyMap<string, string> {
    return new Map(Object.entries(this.#data.gates));
  }

  async record(key: string, entry: LedgerEntry): Promise<void> {
    this.#data.entries[key] = entry;
    await this.#save();
  }

  async recordGate(id: string, choice: string): Promise<void> {
    this.#data.gates[id] = choice;
    await this.#save();
  }

  /** Forgets everything (a retry from scratch). */
  async reset(): Promise<void> {
    this.#data.entries = {};
    this.#data.gates = {};
    await this.#save();
  }

  /** Writes are queued: groups record from several steps at once. */
  #save(): Promise<void> {
    const next = this.#queue.then(() => writeAtomically(this.#file, `${JSON.stringify(this.#data, null, 2)}\n`));
    this.#queue = next.catch(() => undefined);
    return next;
  }
}
