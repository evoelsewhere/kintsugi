import { BRAIN_MAX_LABELS, brainLabels, mergeWithMarkers } from "@kintsugi/domain";
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
  /**
   * A text that stands in for the draft's (restoring an older version): it is unsaved from the start, so the next save
   * replaces the server's draft text with it, against the revision the server holds.
   */
  replaceWith?: string | undefined;
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
    // A draft opened as it was left has no starting text of its own: its own base is the one to send if it has to be made again.
    this.baseCommit = options.startCommit ?? options.draft?.baseCommit ?? null;
    if (options.replaceWith !== undefined && options.replaceWith !== this.text) {
      this.text = options.replaceWith;
      this.dirtySince = this.now();
      this.lastChange = this.dirtySince;
      this.status = "unsaved";
      this.schedule();
    }
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

  private running: Promise<void> | null = null;

  private save(force = false): Promise<void> {
    if (this.inFlight) return this.running ?? Promise.resolve();
    this.running = this.run(force);
    return this.running;
  }

  /**
   * Saves what is typed and waits until the server holds it, then gives the revision to publish. A page opened and not
   * changed has no draft yet: it is created here, from the text as it is, so that publishing it can say "no change".
   */
  async whenSaved(): Promise<number> {
    this.clear();
    for (let round = 0; round < 4; round += 1) {
      await this.save(this.revision === null);
      if (this.inFlight) await this.running;
      if ((this.text === this.savedText && this.revision !== null) || this.status === "failed" || this.status === "locked") break;
    }
    if (this.revision === null || this.text !== this.savedText) throw new Error(this.message ?? "The draft could not be saved.");
    return this.revision;
  }

  private async run(force: boolean): Promise<void> {
    if (this.inFlight || this.status === "locked" || (this.text === this.savedText && !force)) return;
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
      if (failure.status === 409 && failure.details?.["code"] === "draft-revision" && failure.details["revision"] === 0) {
        // The draft no longer exists on the server (published and merged, or discarded in another tab): make it again from the text typed here.
        this.revision = null;
        this.status = "unsaved";
        this.emit();
        await this.save();
        return;
      }
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

// ---- Resolving a conflict ----------------------------------------------------------------------------------------
// When the page changed in the repository while it was being edited, the API answers with three texts: the one both
// started from (base), the person's (ours) and the repository's (theirs). The person resolves it in a box that starts as
// a Git merge result: what only one side changed is taken, and each place both sides changed differently is written
// between `<<<<<<<`, `=======` and `>>>>>>>` lines, to be settled by hand. Lines keep their own endings.

/** The lines of a text, each with its line ending, so that joining them gives the text back byte for byte. */
export const linesOf = (text: string): string[] => (text === "" ? [] : (text.match(/[^\n]*\n|[^\n]+$/g) ?? []));

/** For each line of `a`, the index of the line of `b` it is matched with in a longest common subsequence, or -1. */
function matchLines(a: readonly string[], b: readonly string[]): number[] {
  const rows = a.length;
  const cols = b.length;
  const table = Array.from({ length: rows + 1 }, () => new Uint32Array(cols + 1));
  for (let i = rows - 1; i >= 0; i -= 1) {
    const row = table[i] as Uint32Array;
    const below = table[i + 1] as Uint32Array;
    for (let j = cols - 1; j >= 0; j -= 1) row[j] = a[i] === b[j] ? (below[j + 1] as number) + 1 : Math.max(below[j] as number, row[j + 1] as number);
  }
  const matched = new Array<number>(rows).fill(-1);
  let i = 0;
  let j = 0;
  while (i < rows && j < cols) {
    if (a[i] === b[j]) {
      matched[i] = j;
      i += 1;
      j += 1;
    } else if (((table[i + 1] as Uint32Array)[j] as number) >= ((table[i] as Uint32Array)[j + 1] as number)) i += 1;
    else j += 1;
  }
  return matched;
}

/**
 * The three texts as a Git merge result with conflict markers: what only one side changed is taken, a change both made the
 * same way is taken once, and each place both changed differently is written between `<<<<<<< yours`, `=======` and
 * `>>>>>>> theirs`. It is the domain's `mergeWithMarkers`, the very merge the API runs, so the screen shows exactly the regions
 * the server calls conflicts.
 */
export const withConflictMarkers = (base: string, ours: string, theirs: string): { text: string; conflicts: number } => mergeWithMarkers(base, ours, theirs);

/** A line without its ending, for showing it. */
export const withoutEnding = (line: string): string => line.replace(/\r?\n$/, "");

/** Whether a text still has a conflict marker line (`<<<<<<<` or `>>>>>>>` at the start of a line). */
export const hasConflictMarkers = (text: string): boolean => /^(<<<<<<<|>>>>>>>)/m.test(text);

/** Texts longer than this many lines (on either side) are shown as wholly replaced instead of compared line by line. */
const DIFF_MAX_LINES = 4000;

/** One line of a comparison of two texts. */
export interface DiffLine {
  type: "context" | "add" | "del";
  text: string;
}

/** The lines that differ between two texts (`from` to `to`), with the unchanged ones between them; for showing a merge result. */
export function lineDiff(from: string, to: string): DiffLine[] {
  const a = linesOf(from);
  const b = linesOf(to);
  if (a.length > DIFF_MAX_LINES || b.length > DIFF_MAX_LINES) {
    return from === to ? a.map((text) => ({ type: "context" as const, text })) : [...a.map((text) => ({ type: "del" as const, text })), ...b.map((text) => ({ type: "add" as const, text }))];
  }
  const matched = matchLines(a, b);
  const out: DiffLine[] = [];
  let at = 0;
  for (let index = 0; index <= a.length; index += 1) {
    const hit = index < a.length ? (matched[index] as number) : b.length;
    if (index < a.length && hit < 0) {
      out.push({ type: "del", text: a[index] as string });
      continue;
    }
    for (; at < hit; at += 1) out.push({ type: "add", text: b[at] as string });
    if (index < a.length) {
      out.push({ type: "context", text: a[index] as string });
      at = hit + 1;
    }
  }
  return out;
}

// ---- Publishing --------------------------------------------------------------------------------------------------

/** The longest message of a publish (the first line becomes the title of the pull request). */
export const PUBLISH_MESSAGE_MAX = 200;

/** The message a publish starts with: `Update <title>`. */
export const defaultPublishMessage = (title: string): string => `Update ${title}`.slice(0, PUBLISH_MESSAGE_MAX);

/** Why a message cannot be sent, in a person's words; undefined when it can. */
export function messageProblem(message: string): string | undefined {
  const text = message.trim();
  if (text === "") return "Write a short message that says what changed.";
  if (text.length > PUBLISH_MESSAGE_MAX) return `Keep the message to ${PUBLISH_MESSAGE_MAX} characters or fewer.`;
  return undefined;
}

/** What the result of a publish will be, said before it is made. */
export const publishModeLine = (direct: boolean): string =>
  direct ? "This will commit straight to the default branch: no review." : "This will open a pull request for review: the page changes once it is merged.";

/** What a refused publish is, for the screen that follows it. */
export type PublishFailure =
  | { kind: "conflict"; body: ConflictBody }
  | { kind: "open-write"; author: string; prUrl: string | null; message: string }
  | { kind: "draft-revision"; message: string }
  | { kind: "message"; status: number | undefined; message: string };

/** The structured detail of a failed request: the `details` of the API's error body, or the body itself. */
function detailOf(error: unknown): Record<string, unknown> {
  const body = (error as { body?: { details?: Record<string, unknown> } & Record<string, unknown> }).body;
  return body?.details ?? body ?? {};
}

/**
 * Sorts a failed publish: a conflict (the three texts to settle), a write of the page that is open (who and where),
 * a draft that moved on, and any other refusal, which is shown with the API's own words.
 */
export function classifyPublishFailure(error: unknown): PublishFailure {
  const message = error instanceof Error ? error.message : "The page could not be published.";
  const status = (error as { status?: unknown }).status;
  const detail = detailOf(error);
  if (status === 409 && detail["code"] === "conflict") return { kind: "conflict", body: detail as unknown as ConflictBody };
  if (status === 409 && detail["code"] === "open-write") {
    const write = (detail["write"] ?? {}) as { author?: unknown; prUrl?: unknown };
    return { kind: "open-write", author: typeof write.author === "string" ? write.author : "Someone else", prUrl: typeof write.prUrl === "string" ? write.prUrl : null, message };
  }
  if (status === 409 && detail["code"] === "draft-revision") return { kind: "draft-revision", message };
  return { kind: "message", status: typeof status === "number" ? status : undefined, message };
}

// ---- A new page --------------------------------------------------------------------------------------------------

/** A template a new page can start from: `GET wiki/templates?folder=`. */
export interface TemplateOption {
  path: string;
  title: string;
  summary: string;
}

/** `POST wiki/pages`: the answer is the draft of the new page (nothing is written to the repository yet). */
export interface NewPageBody {
  folder: string;
  title: string;
  templatePath?: string;
}

/** The longest title a new page takes. */
export const NEW_PAGE_TITLE_MAX = 200;

/** Why a title cannot start a page, in a person's words; undefined when it can. */
export function newPageProblem(title: string): string | undefined {
  const text = title.trim();
  if (text === "") return "Give the page a title.";
  if (text.length > NEW_PAGE_TITLE_MAX) return `Keep the title to ${NEW_PAGE_TITLE_MAX} characters or fewer.`;
  if (!/[A-Za-z0-9]/.test(text)) return "The title needs at least one letter or digit: the page's file name is made from it.";
  return undefined;
}

/**
 * A path the access answer can be asked about before a page exists in `folder`: whether the person may write new pages
 * there. A page lives in a folder, never at the root of the repository (`folder` "" gives undefined).
 */
export const newPageProbe = (folder: string): string | undefined => (folder === "" ? undefined : `${folder}/new-page.md`);

/** The body to send: a template only when one is chosen, the title as typed but trimmed. */
export const newPageBody = (folder: string, title: string, templatePath: string): NewPageBody => ({ folder, title: title.trim(), ...(templatePath === "" ? {} : { templatePath }) });

// ---- Moving and renaming a page ----------------------------------------------------------------------------------

/** `POST wiki/move/preview` and `POST wiki/move`: where the page goes. */
export interface MoveBody {
  from: string;
  to: string;
  message: string;
}

/** What a move would change: the page itself and every page whose links to it are rewritten. */
export interface MovePreview {
  entries: Array<{ path: string; renameFrom?: string; kind: "moved" | "rewritten" }>;
  rewrittenLinks: number;
}

/** The most pages a move may rewrite (the API refuses more with `too-many`). */
export const MOVE_REWRITE_LIMIT = 500;

/** Why a target path cannot be asked about, in a person's words; undefined when it can. */
export function moveTargetProblem(from: string, to: string): string | undefined {
  const target = to.trim();
  if (target === "") return "Give the new path of the page.";
  if (target.startsWith("/") || target.endsWith("/")) return "The path is relative to the repository: no slash at the start or the end.";
  if (!/\.md$/i.test(target)) return "A page's file name ends in .md.";
  const segments = target.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) return "The path cannot have empty, . or .. parts.";
  if (segments.length < 2) return "A page lives in a folder, not at the root of the repository.";
  if (target === from) return "That is where the page is already.";
  return undefined;
}

/** The folder part of a path ("" for none). */
export const folderOfPath = (path: string): string => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");

/** What the page's move becomes in the dialog's words: renamed in place, or moved to another folder. */
export const moveKind = (from: string, to: string): "rename" | "move" => (folderOfPath(from) === folderOfPath(to) ? "rename" : "move");

/** The default message of a move: `Move <from> to <to>`, cut to what a message may hold. */
export const defaultMoveMessage = (from: string, to: string): string => `${moveKind(from, to) === "rename" ? "Rename" : "Move"} ${from} to ${to}`.slice(0, PUBLISH_MESSAGE_MAX);

/** Whether a shown preview is of the target now typed: the Confirm button opens only then. */
export const previewIsCurrent = (previewed: string | null, typed: string): boolean => previewed !== null && previewed === typed.trim();

/** What a refused move is: too many pages to rewrite (with the count), or one of the publish refusals. */
export type MoveFailure = { kind: "too-many"; count: number; limit: number; message: string } | Exclude<PublishFailure, { kind: "conflict" }>;

/** Sorts a refused move or preview: `too-many` gets the sentence the API words it with, any other refusal is shown verbatim. */
export function classifyMoveFailure(error: unknown): MoveFailure {
  const detail = detailOf(error);
  if ((error as { status?: unknown }).status === 409 && detail["code"] === "too-many") {
    const count = typeof detail["count"] === "number" ? detail["count"] : 0;
    const limit = typeof detail["limit"] === "number" ? detail["limit"] : MOVE_REWRITE_LIMIT;
    return { kind: "too-many", count, limit, message: `Too many pages link here (${count}, the limit is ${limit})` };
  }
  const failure = classifyPublishFailure(error);
  // A move has no three-way merge: a conflict answer would still be the API's own words.
  return failure.kind === "conflict" ? { kind: "message", status: 409, message: error instanceof Error ? error.message : "The page could not be moved." } : failure;
}

// ---- Labels in the front matter ----------------------------------------------------------------------------------
// A page's labels are the `labels:` entry of its front matter. The editor changes that entry and nothing else: every other
// byte of the text stays as it was, line endings included.

const eolOf = (line: string): string => (line.endsWith("\r\n") ? "\r\n" : line.endsWith("\n") ? "\n" : "");
const bare = (line: string): string => line.replace(/\r?\n$/, "");

/** The index of the line that closes the front matter, or -1 when the text has none (it must open on its first line). */
function frontMatterEnd(lines: readonly string[]): number {
  if (lines.length === 0 || bare(lines[0] as string).trimEnd() !== "---") return -1;
  for (let index = 1; index < lines.length; index += 1) {
    const line = bare(lines[index] as string).trimEnd();
    if (line === "---" || line === "...") return index;
  }
  return -1;
}

interface LabelsEntry {
  /** The line of `labels:` and the number of lines the entry takes (the key line and its list lines). */
  at: number;
  length: number;
  form: "inline" | "block";
  /** The values as written, without quotes. */
  values: string[];
  /** The text before a block item's dash, and the dash: `  - `. */
  itemPrefix: string;
}

const unquote = (value: string): string => value.trim().replace(/^(["'])(.*)\1$/, "$2").trim();
const withoutComment = (value: string): string => value.replace(/\s+#.*$/, "");

/** Where the `labels:` entry is in the front matter, and what it holds. */
function labelsEntry(lines: readonly string[], end: number): LabelsEntry | null {
  for (let at = 1; at < end; at += 1) {
    const match = /^labels[ \t]*:(.*)$/.exec(bare(lines[at] as string));
    if (match === null) continue;
    const rest = withoutComment(match[1] ?? "").trim();
    let length = 1;
    const items: string[] = [];
    let itemPrefix = "  - ";
    for (let next = at + 1; next < end; next += 1) {
      const item = /^(\s*-)(\s+)(.*)$/.exec(bare(lines[next] as string)) ?? /^(\s*-)()$/.exec(bare(lines[next] as string));
      if (item === null) break;
      if (items.length === 0) itemPrefix = `${item[1]}${item[2] || " "}`;
      items.push(unquote(withoutComment(item[3] ?? "")));
      length += 1;
    }
    if (rest === "") return { at, length, form: "block", values: items.filter((value) => value !== ""), itemPrefix };
    const inner = rest.startsWith("[") ? rest.replace(/^\[/, "").replace(/\]\s*$/, "") : rest;
    return { at, length: 1, form: "inline", values: inner.split(",").map(unquote).filter((value) => value !== ""), itemPrefix };
  }
  return null;
}

/** The labels a page's front matter lists, as written (the Brain cleans them when it reads them). */
export function labelsOf(text: string): string[] {
  const lines = linesOf(text);
  const end = frontMatterEnd(lines);
  return end < 0 ? [] : (labelsEntry(lines, end)?.values ?? []);
}

/**
 * The text with its `labels:` entry set to `labels`: an inline list stays inline and a block list stays a block, a missing
 * entry is added (as an inline list, at the end of the front matter, which is made when the page has none) and an empty
 * list removes the entry. Every other byte of the text is kept. The same labels in the same order give the text back.
 */
export function setLabels(text: string, labels: readonly string[]): string {
  const lines = linesOf(text);
  const end = frontMatterEnd(lines);
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const list = `[${labels.join(", ")}]`;
  if (end < 0) return labels.length === 0 ? text : `---${eol}labels: ${list}${eol}---${eol}${text}`;
  const entry = labelsEntry(lines, end);
  if (entry === null) {
    if (labels.length === 0) return text;
    return [...lines.slice(0, end), `labels: ${list}${eol}`, ...lines.slice(end)].join("");
  }
  if (entry.values.length === labels.length && entry.values.every((value, index) => value === labels[index])) return text;
  const keyLine = lines[entry.at] as string;
  const rest = [...lines.slice(0, entry.at), ...lines.slice(entry.at + entry.length)];
  if (labels.length === 0) return [...rest.slice(0, entry.at), ...rest.slice(entry.at)].join("");
  const lineEnding = eolOf(keyLine) || eol;
  const written =
    entry.form === "block"
      ? [keyLine.endsWith("\n") ? keyLine : keyLine + lineEnding, ...labels.map((label) => `${entry.itemPrefix}${label}${lineEnding}`)]
      : [`labels: ${list}${eolOf(keyLine)}`];
  return [...lines.slice(0, entry.at), ...written, ...lines.slice(entry.at + entry.length)].join("");
}

/** The most labels a page keeps and the longest one (the Brain cleans and cuts anything beyond). */
export const LABELS_MAX = BRAIN_MAX_LABELS;
export const LABEL_MAX_LENGTH = 100;

/**
 * What typing a label into the chip box comes to: the form the Brain would store (lower case, letters, digits and hyphens),
 * and a reason it is not added when it is not stored as typed, is a duplicate, is too long or there are too many already.
 */
export function labelCheck(input: string, existing: readonly string[]): { cleaned: string; problem: string | undefined } {
  const typed = input.trim();
  // The Brain's own rules (`brainLabels`), so that what is accepted here is what it stores.
  const cleaned = brainLabels([typed])[0] ?? "";
  if (typed === "") return { cleaned: "", problem: undefined };
  if (cleaned === "") return { cleaned, problem: "A label holds letters, digits and hyphens." };
  if (typed.length > LABEL_MAX_LENGTH) return { cleaned, problem: `A label has at most ${LABEL_MAX_LENGTH} characters.` };
  if (cleaned !== typed) return { cleaned, problem: `It would be stored as “${cleaned}”: type it that way to add it.` };
  if (existing.includes(cleaned)) return { cleaned, problem: "The page has this label already." };
  if (existing.length >= LABELS_MAX) return { cleaned, problem: `A page has at most ${LABELS_MAX} labels.` };
  return { cleaned, problem: undefined };
}

// ---- The person's drafts -----------------------------------------------------------------------------------------

/** One line of `GET wiki/drafts`: a draft of the caller's. */
export interface DraftSummary {
  path: string;
  touchedAt: string;
  revision: number;
  /** The write that publishes it, when a publish is waiting for review. */
  writeId: string | null;
}

/** The newest saved first. */
export const sortDrafts = (drafts: readonly DraftSummary[]): DraftSummary[] => [...drafts].sort((a, b) => b.touchedAt.localeCompare(a.touchedAt) || a.path.localeCompare(b.path));

/** Where a draft stands, in a word: waiting for review once it was published as a pull request, else still being written. */
export const draftStateLabel = (draft: Pick<DraftSummary, "writeId">): string => (draft.writeId === null ? "Not published" : "Waiting for review");

// ---- Deleting a page ---------------------------------------------------------------------------------------------

/** `POST wiki/delete`: the page goes in one write; links to it become broken links. */
export interface DeleteBody {
  path: string;
  message: string;
}

/** The answer of a delete: like a publish, with how many links into the page break. */
export interface DeleteResult {
  outcome: "published";
  write: WriteSummary;
  brokenLinks: number;
}

/** The message a restore starts with: `Restore version <short sha> of <title>`. */
export const restoreMessage = (sha: string, title: string): string => `Restore version ${sha.slice(0, 7)} of ${title}`.slice(0, PUBLISH_MESSAGE_MAX);

/** The message a delete starts with. */
export const defaultDeleteMessage = (path: string): string => `Delete ${path}`.slice(0, PUBLISH_MESSAGE_MAX);

/** What the dialog says about the links into the page, before anything is confirmed. */
export function deleteWarning(links: number): string {
  if (links === 0) return "No other page links to this page.";
  return `${links} ${links === 1 ? "link into this page" : "links into this page"} will break: ${links === 1 ? "it" : "they"} will show in the broken links report until fixed.`;
}

// ---- Attachments of a draft --------------------------------------------------------------------------------------
// A file or an image added while editing is kept beside the draft and joins the repository, under the page's
// `_attachments/` folder, when the page is published (threads/design-wiki-draft-publish, decision of 01:14).

/** An attachment of a draft: the name the server gave it and the Markdown to insert. */
export interface AttachmentView {
  name: string;
  contentType: string;
  size: number;
  markdown: string;
}

/** `POST wiki/draft/attachments`. */
export interface AttachmentUpload {
  path: string;
  name: string;
  contentType: string;
  contentBase64: string;
}

/** The types an attachment may have (SVG is not one: it can carry script), by file extension. */
export const ATTACHMENT_TYPES: Readonly<Record<string, string>> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  pdf: "application/pdf",
};

/** A change to the text: `insert` replaces the characters from `from` to `to`. */
export interface TextChange {
  from: number;
  to: number;
  insert: string;
}

/**
 * Where the Markdown of a new attachment goes in a text (line endings as LF: offsets are those of the editor's document):
 * on a line of its own, at the cursor, but never inside the front matter or in front of it. A cursor in the front matter,
 * or a text nobody has clicked in (the cursor is at the very start), puts it right after the front matter's closing `---`.
 */
export function attachmentInsertion(text: string, cursor: number, markdown: string): TextChange {
  const lines = linesOf(text);
  const end = frontMatterEnd(lines);
  let after = 0;
  if (end >= 0) for (let index = 0; index <= end; index += 1) after += (lines[index] as string).length;
  // The closing line may have no line ending (a page that is only front matter): then a line is added first.
  const at = Math.min(Math.max(cursor, end >= 0 ? after : 0), text.length);
  const lead = at > 0 && text[at - 1] !== "\n" ? "\n" : "";
  // Mid-line, at the start of a line or on an empty line the rest of the text moves to the line after; at the end of a line the line ending is already there.
  const trail = at >= text.length || text[at] !== "\n" || lead === "" ? "\n" : "";
  return { from: at, to: at, insert: `${lead}${markdown}${trail}` };
}

/** The most a file, and all the files of a draft, may weigh (the API refuses more). */
export const ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;
export const ATTACHMENTS_MAX_BYTES = 20 * 1024 * 1024;

/** The type of a file from its extension, or undefined when it is not one that may be attached. */
export function attachmentTypeOf(name: string): string | undefined {
  const extension = /\.([A-Za-z0-9]+)$/.exec(name)?.[1]?.toLowerCase();
  return extension === undefined ? undefined : ATTACHMENT_TYPES[extension];
}

/** Why a file cannot be attached, in a person's words; undefined when it can. `held` is what the draft's attachments weigh already. */
export function attachmentProblem(file: { name: string; size: number }, held: number): string | undefined {
  if (attachmentTypeOf(file.name) === undefined) return `${file.name}: only images (png, jpg, gif, webp) and PDF files can be attached.`;
  if (file.size === 0) return `${file.name} is empty.`;
  if (file.size > ATTACHMENT_MAX_BYTES) return `${file.name} is larger than 5 MiB.`;
  if (held + file.size > ATTACHMENTS_MAX_BYTES) return `${file.name} would take this page's attachments over 20 MiB.`;
  return undefined;
}

/** The bytes of a file as base64, for the JSON body of an upload. */
export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let at = 0; at < bytes.length; at += 0x8000) binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  return btoa(binary);
}

/** The address of an attachment of the person's own draft: what the editor's preview shows an image from. */
export const draftAttachmentUrl = (projectId: string, path: string, name: string): string =>
  `/api/projects/${encodeURIComponent(projectId)}/wiki/draft/attachments/file?${new URLSearchParams({ path, name }).toString()}`;

/**
 * Where an image the preview of a page being edited points at is served from while the page is a draft: an attachment
 * the draft holds (`<page folder>/_attachments/<name>`), else nothing (the published route does not have it yet).
 */
export function draftImageUrl(projectId: string, pagePath: string, resolvedPath: string, held: readonly string[]): string | undefined {
  const folder = `${pagePath.includes("/") ? pagePath.slice(0, pagePath.lastIndexOf("/")) : ""}/_attachments/`.replace(/^\//, "");
  if (!resolvedPath.startsWith(folder)) return undefined;
  const name = resolvedPath.slice(folder.length);
  return name !== "" && !name.includes("/") && held.includes(name) ? draftAttachmentUrl(projectId, pagePath, name) : undefined;
}

// ---- Archiving a page --------------------------------------------------------------------------------------------
// An archived page is a page whose front matter says `status: archived`: the tree, the search and the label pages leave
// it out, and it is listed apart. Archiving is an edit of that one line, published like any other edit.

/**
 * The text with its `status:` line set to `status`, or removed when `status` is null; the front matter is made when the page
 * has none (and a status is set). Every other byte is kept, line endings included; the same status gives the text back.
 */
export function setStatus(text: string, status: string | null): string {
  const lines = linesOf(text);
  const end = frontMatterEnd(lines);
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  if (end < 0) return status === null ? text : `---${eol}status: ${status}${eol}---${eol}${text}`;
  let at = -1;
  for (let index = 1; index < end; index += 1) {
    if (/^status[ \t]*:/.test(bare(lines[index] as string))) {
      at = index;
      break;
    }
  }
  if (at < 0) return status === null ? text : [...lines.slice(0, end), `status: ${status}${eol}`, ...lines.slice(end)].join("");
  if (status === null) return [...lines.slice(0, at), ...lines.slice(at + 1)].join("");
  const current = unquote(withoutComment(bare(lines[at] as string).replace(/^status[ \t]*:/, "")));
  if (current === status) return text;
  return [...lines.slice(0, at), `status: ${status}${eolOf(lines[at] as string)}`, ...lines.slice(at + 1)].join("");
}

/** What archiving or unarchiving a page does, for the editor's address and the publish message. */
export type StatusChange = "archive" | "unarchive";

/** The status a change sets: `archived`, or none. */
export const statusOf = (change: StatusChange): string | null => (change === "archive" ? "archived" : null);

/** The message of a publish that archives or unarchives: `Archive <title>`. */
export const statusChangeMessage = (change: StatusChange, title: string): string => `${change === "archive" ? "Archive" : "Unarchive"} ${title}`.slice(0, PUBLISH_MESSAGE_MAX);
