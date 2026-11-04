// What the wiki editor says about a page being written: the shapes the API gives and takes (threads/design-wiki-draft-publish),
// the rules of the autosave, and the text itself. Kept apart from the views so it can be tested without a browser.
// The text is exactly what was typed: nothing here changes a line ending, a final newline or the order of the front matter
// (ADR-0098 decision 1), so opening a page and publishing it without a change changes nothing.

// ---- The API's shapes --------------------------------------------------------------------------------------------

/** What a person may do with a path: `GET wiki/access?path=`. */
export interface AccessView {
  path: string;
  editable: boolean;
  canWrite: boolean;
  canPublish: boolean;
  /** Publishing commits straight to the default branch instead of opening a pull request. */
  direct: boolean;
  refusal: null | { code: "not-editable" | "permission" | "restriction"; message: string; pathPrefix?: string };
  /** A write of this page that is open: waiting for review. */
  pending: null | { writeId: string; status: string; prUrl: string | null; author: string };
}

/** A person's draft of a page and who else is writing it: `GET wiki/draft?path=`. */
export interface DraftView {
  path: string;
  pageId: string | null;
  text: string;
  revision: number;
  baseCommit: string | null;
  baseHash: string | null;
  touchedAt: string;
  writeId: string | null;
  others: Array<{ userId: string; name: string; touchedAt: string }>;
}

/** `PUT wiki/draft`: the first save (`baseRevision` null) carries the commit the text was read from, never the head. */
export interface DraftSaveBody {
  path: string;
  text: string;
  baseRevision: number | null;
  baseCommit?: string | null;
}

/** The refusal of a save the server did not take because the draft moved on (another tab of the same person). */
export interface RevisionConflict {
  code: "draft-revision";
  revision: number;
}

// ---- Publishing (P2-041) -----------------------------------------------------------------------------------------

export interface PublishRequest {
  path: string;
  revision: number;
  message: string;
  minor?: boolean;
  mergedFrom?: { commit: string; hash: string | null };
  resolvedText?: string;
}

export interface WriteSummary {
  id: string;
  status: string;
  mode: "pull-request" | "direct";
  branch?: string;
  prUrl?: string;
}

export type PublishResult =
  | { outcome: "published"; write: WriteSummary }
  | { outcome: "unchanged" }
  | { outcome: "merge-preview"; merged: string; head: { commit: string; hash: string | null }; base: { commit: string; hash: string | null } };

/** The body of a 409 `conflict`: the three texts and the regions of the base that both sides changed. */
export interface ConflictBody {
  code: "conflict";
  base: string;
  ours: string;
  theirs: string;
  head: { commit: string; hash: string | null };
  regions: Array<{ baseStart: number; baseEnd: number }>;
}

// ---- The text ----------------------------------------------------------------------------------------------------

/** The largest text a draft may hold (the API refuses more). */
export const MAX_DRAFT_BYTES = 5 * 1024 * 1024;

/** The size of a text as the API counts it: bytes of its UTF-8. */
export const textBytes = (text: string): number => new TextEncoder().encode(text).length;

/** Why a text cannot be saved, in a person's words; undefined when it can. */
export function textProblem(text: string): string | undefined {
  return textBytes(text) > MAX_DRAFT_BYTES ? "This page is larger than 5 MiB: it cannot be saved. Split it into several pages." : undefined;
}

/**
 * The line separator the editor must use so that its text comes out exactly as it went in: CRLF when the text has one,
 * else LF. (CodeMirror splits on any of CR, LF and CRLF and joins with LF unless it is told which one to use.)
 */
export const lineSeparatorOf = (text: string): "\r\n" | "\n" => (text.includes("\r\n") ? "\r\n" : "\n");

// ---- Autosave rules ----------------------------------------------------------------------------------------------

/** A save waits this long after the last keystroke... */
export const AUTOSAVE_QUIET_MS = 1500;
/** ...and happens at least this often while someone keeps typing. */
export const AUTOSAVE_MAX_MS = 10_000;

/**
 * How long to wait from `now` before the next save, given when the unsaved changes began (`dirtySince`) and when the
 * last of them was made (`lastChange`); null when there is nothing to save. Never negative.
 */
export function autosaveDelay(now: number, dirtySince: number | null, lastChange: number | null): number | null {
  if (dirtySince === null || lastChange === null) return null;
  return Math.max(0, Math.min(lastChange + AUTOSAVE_QUIET_MS, dirtySince + AUTOSAVE_MAX_MS) - now);
}

export type SaveStatus = "saved" | "unsaved" | "saving" | "failed" | "locked";

/** What the editor tells a person about the draft, next to the Publish button. */
export const SAVE_STATUS_LABEL: Record<SaveStatus, string> = {
  saved: "Saved",
  unsaved: "Unsaved changes",
  saving: "Saving…",
  failed: "Save failed, retry",
  locked: "Not saved: editing is locked",
};

/** The pieces of a failed request the saver needs: the HTTP status and the API's structured detail. */
export interface SaveFailure {
  status?: number | undefined;
  message: string;
  details?: Record<string, unknown> | undefined;
}

/** The part of the API the saver uses (`PUT wiki/draft` and `GET wiki/draft`), so it can be run against a mock. */
export interface DraftApi {
  save: (body: DraftSaveBody) => Promise<DraftView>;
  load: (path: string) => Promise<DraftView | null>;
}

export interface DraftSaverOptions {
  path: string;
  api: DraftApi;
  /** The draft that exists already (null when none: the first save creates it). */
  draft: DraftView | null;
  /** The text the editor started from, and the commit it was read from: the base of a draft that is created. */
  startText: string;
  startCommit: string | null;
  /** The saver reports each change of what it knows. */
  onChange: (state: SaverState) => void;
  /** The server holds another revision (a second tab): the person chooses which text to keep. */
  onRevisionConflict: (server: DraftView) => void;
  now?: () => number;
  setTimer?: (run: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  toFailure?: (error: unknown) => SaveFailure;
}

export interface SaverState {
  status: SaveStatus;
  /** The revision the server holds, null before the first save. */
  revision: number | null;
  /** The people who are writing this page too, as of the last answer. */
  others: DraftView["others"];
  /** What a failure said (the API's message), when there is one. */
  message: string | null;
}

/**
 * Saves a draft as it is typed: one request at a time, a quiet period after the last keystroke and a longest wait while
 * typing goes on, and a save on demand (focus lost, the page closing). The first save creates the draft with the commit
 * the text was read from; the next ones send the revision the server gave. A text the server holds a newer revision of
 * is not overwritten: the person decides. A refusal (403) locks the editor and keeps what was typed.
 */
export class DraftSaver {
  private text: string;
  private savedText: string;
  private revision: number | null;
  private others: DraftView["others"];
  private baseCommit: string | null;
  private dirtySince: number | null = null;
  private lastChange: number | null = null;
  private timer: unknown = undefined;
  private inFlight = false;
  private status: SaveStatus = "saved";
  private message: string | null = null;
  private disposed = false;

  constructor(private readonly options: DraftSaverOptions) {
    this.text = options.draft?.text ?? options.startText;
    this.savedText = this.text;
    this.revision = options.draft?.revision ?? null;
    this.others = options.draft?.others ?? [];
    this.baseCommit = options.startCommit;
  }

  private now(): number {
    return (this.options.now ?? Date.now)();
  }

  private emit(): void {
    if (this.disposed) return;
    this.options.onChange({ status: this.status, revision: this.revision, others: this.others, message: this.message });
  }

  /** The editor's text changed. */
  change(text: string): void {
    if (this.status === "locked" || text === this.text) return;
    this.text = text;
    const problem = textProblem(text);
    if (problem !== undefined) {
      this.status = "failed";
      this.message = problem;
      this.clear();
      this.emit();
      return;
    }
    const at = this.now();
    if (text === this.savedText) {
      this.dirtySince = null;
      this.lastChange = null;
      this.clear();
      if (!this.inFlight) this.status = "saved";
      this.message = null;
      this.emit();
      return;
    }
    this.dirtySince ??= at;
    this.lastChange = at;
    if (!this.inFlight) this.status = "unsaved";
    this.message = null;
    this.schedule();
    this.emit();
  }

  /** Saves now: the editor lost focus, or the page is closing (`beforeunload`), or the person asked to retry. */
  flush(): void {
    this.clear();
    void this.save();
  }

  /** Takes the server's draft as the text (the person chose it after a revision conflict). */
  adopt(server: DraftView): void {
    this.text = server.text;
    this.savedText = server.text;
    this.revision = server.revision;
    this.others = server.others;
    this.dirtySince = null;
    this.lastChange = null;
    this.status = "saved";
    this.message = null;
    this.clear();
    this.emit();
  }

  /** Keeps the person's text over the server's draft: its revision is taken and the text is saved again. */
  keepMine(server: DraftView): void {
    this.revision = server.revision;
    this.others = server.others;
    this.dirtySince ??= this.now();
    this.lastChange = this.now();
    this.status = "unsaved";
    this.emit();
    this.flush();
  }

  dispose(): void {
    this.disposed = true;
    this.clear();
  }

  /** The text as it is now and the revision the server holds: what Publish sends. */
  get current(): { text: string; revision: number | null } {
    return { text: this.text, revision: this.revision };
  }

  private schedule(): void {
    this.clear();
    const delay = autosaveDelay(this.now(), this.dirtySince, this.lastChange);
    if (delay === null) return;
    this.timer = (this.options.setTimer ?? ((run, ms) => setTimeout(run, ms)))(() => void this.save(), delay);
  }

  private clear(): void {
    if (this.timer === undefined) return;
    (this.options.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>)))(this.timer);
    this.timer = undefined;
  }

  private async save(): Promise<void> {
    if (this.inFlight || this.status === "locked" || this.text === this.savedText) return;
    if (textProblem(this.text) !== undefined) return;
    this.inFlight = true;
    this.status = "saving";
    this.message = null;
    this.emit();
    const sent = this.text;
    const body: DraftSaveBody = this.revision === null ? { path: this.options.path, text: sent, baseRevision: null, baseCommit: this.baseCommit } : { path: this.options.path, text: sent, baseRevision: this.revision };
    try {
      const saved = await this.options.api.save(body);
      this.revision = saved.revision;
      this.others = saved.others;
      this.savedText = sent;
      this.inFlight = false;
      if (this.text === sent) {
        this.dirtySince = null;
        this.lastChange = null;
        this.status = "saved";
      } else {
        // Typing went on while the request was out: the newer text waits for its own save.
        this.dirtySince = this.now();
        this.status = "unsaved";
        this.schedule();
      }
      this.emit();
    } catch (error) {
      this.inFlight = false;
      const failure = (this.options.toFailure ?? defaultFailure)(error);
      if (failure.status === 409 && failure.details?.["code"] === "draft-revision") {
        this.status = "unsaved";
        this.emit();
        try {
          const server = await this.options.api.load(this.options.path);
          if (server !== null) {
            this.options.onRevisionConflict(server);
            return;
          }
        } catch {
          // The server's draft could not be read: the failure below says so.
        }
        this.status = "failed";
        this.message = failure.message;
        this.emit();
        return;
      }
      this.status = failure.status === 403 ? "locked" : "failed";
      this.message = failure.message;
      this.emit();
    }
  }
}

function defaultFailure(error: unknown): SaveFailure {
  const shape = error as { status?: unknown; body?: { details?: Record<string, unknown> } };
  return {
    status: typeof shape.status === "number" ? shape.status : undefined,
    message: error instanceof Error ? error.message : "The draft could not be saved.",
    details: shape.body?.details,
  };
}
