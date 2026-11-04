import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import {
  AUTOSAVE_MAX_MS,
  AUTOSAVE_QUIET_MS,
  autosaveDelay,
  type DraftApi,
  type DraftSaveBody,
  DraftSaver,
  type DraftView,
  classifyPublishFailure,
  defaultPublishMessage,
  hasConflictMarkers,
  classifyMoveFailure,
  defaultMoveMessage,
  folderOfPath,
  LABEL_MAX_LENGTH,
  labelCheck,
  labelsOf,
  LABELS_MAX,
  defaultDeleteMessage,
  deleteWarning,
  ATTACHMENT_MAX_BYTES,
  ATTACHMENTS_MAX_BYTES,
  attachmentProblem,
  attachmentTypeOf,
  draftImageUrl,
  draftStateLabel,
  type DraftSummary,
  attachmentInsertion,
  messageProblem,
  setStatus,
  statusChangeMessage,
  statusOf,
  sortDrafts,
  toBase64,
  restoreMessage,
  setLabels,
  MOVE_REWRITE_LIMIT,
  moveKind,
  moveTargetProblem,
  previewIsCurrent,
  NEW_PAGE_TITLE_MAX,
  newPageBody,
  newPageProbe,
  newPageProblem,
  PUBLISH_MESSAGE_MAX,
  publishModeLine,
  lineDiff,
  lineSeparatorOf,
  withConflictMarkers,
  MAX_DRAFT_BYTES,
  type SaverState,
  textBytes,
  textProblem,
} from "./wiki-edit";

const draft = (over: Partial<DraftView> = {}): DraftView => ({
  path: "a/page.md",
  pageId: null,
  text: "start",
  revision: 1,
  baseCommit: "c".repeat(40),
  baseHash: null,
  touchedAt: "2026-11-05T00:00:00Z",
  writeId: null,
  others: [],
  ...over,
});

describe("the text of a page", () => {
  it("counts bytes of UTF-8 and refuses more than 5 MiB", () => {
    expect(textBytes("é")).toBe(2);
    expect(textProblem("x".repeat(MAX_DRAFT_BYTES))).toBeUndefined();
    expect(textProblem("x".repeat(MAX_DRAFT_BYTES + 1))).toMatch(/5 MiB/);
    expect(textProblem("é".repeat(MAX_DRAFT_BYTES / 2 + 1))).toMatch(/5 MiB/);
  });

  it("keeps the line separator of the text, so that it comes out as it went in", () => {
    expect(lineSeparatorOf("a\r\nb\r\n")).toBe("\r\n");
    expect(lineSeparatorOf("a\nb\n")).toBe("\n");
    expect(lineSeparatorOf("no newline")).toBe("\n");
    expect(lineSeparatorOf("")).toBe("\n");
  });
});

describe("when the autosave happens", () => {
  it("waits 1.5 s after the last keystroke", () => {
    expect(autosaveDelay(1000, 1000, 1000)).toBe(AUTOSAVE_QUIET_MS);
    expect(autosaveDelay(2000, 1000, 1000)).toBe(AUTOSAVE_QUIET_MS - 1000);
  });

  it("saves at least every 10 s while typing goes on", () => {
    // Typing since t=0, last keystroke at t=9 s: the quiet period would end at 10.5 s, the longest wait at 10 s.
    expect(autosaveDelay(9000, 0, 9000)).toBe(AUTOSAVE_MAX_MS - 9000);
    expect(autosaveDelay(5000, 0, 5000)).toBe(AUTOSAVE_QUIET_MS);
  });

  it("is never negative and is nothing when nothing is unsaved", () => {
    expect(autosaveDelay(99_000, 0, 1000)).toBe(0);
    expect(autosaveDelay(0, null, null)).toBeNull();
  });
});

/** A saver on a fake clock and a mocked API; `answer` decides what each save returns or throws. */
function harness(options: { draft?: DraftView | null; startText?: string; startCommit?: string | null; answer?: (body: DraftSaveBody, call: number) => Promise<DraftView>; load?: () => Promise<DraftView | null> } = {}) {
  let clock = 0;
  const timers: Array<{ at: number; run: () => void; id: number; live: boolean }> = [];
  const calls: DraftSaveBody[] = [];
  const states: SaverState[] = [];
  const conflicts: DraftView[] = [];
  const api: DraftApi = {
    save: async (body) => {
      calls.push(body);
      return (options.answer ?? (async (sent, call) => draft({ text: sent.text, revision: call })))(body, calls.length);
    },
    load: options.load ?? (async () => null),
  };
  const saver = new DraftSaver({
    path: "a/page.md",
    api,
    draft: options.draft ?? null,
    startText: options.startText ?? "start",
    startCommit: options.startCommit === undefined ? "a".repeat(40) : options.startCommit,
    onChange: (state) => states.push(state),
    onRevisionConflict: (server) => conflicts.push(server),
    now: () => clock,
    setTimer: (run, ms) => {
      const timer = { at: clock + ms, run, id: timers.length, live: true };
      timers.push(timer);
      return timer.id;
    },
    clearTimer: (handle) => {
      const timer = timers[handle as number];
      if (timer !== undefined) timer.live = false;
    },
  });
  const advance = async (ms: number): Promise<void> => {
    const until = clock + ms;
    for (;;) {
      const next = timers.filter((timer) => timer.live && timer.at <= until).sort((a, b) => a.at - b.at)[0];
      if (next === undefined) break;
      clock = next.at;
      next.live = false;
      next.run();
      await settle();
    }
    clock = until;
  };
  const settle = async (): Promise<void> => {
    for (let index = 0; index < 5; index += 1) await Promise.resolve();
  };
  return { saver, calls, states, conflicts, advance, settle, last: () => states[states.length - 1] };
}

describe("saving a draft as it is typed", () => {
  it("creates the draft on the first change, with the commit the text was read from and no revision", async () => {
    const { saver, calls, advance, last } = harness({ startCommit: "a".repeat(40) });
    saver.change("start, edited");
    expect(last()?.status).toBe("unsaved");
    await advance(AUTOSAVE_QUIET_MS);
    expect(calls).toEqual([{ path: "a/page.md", text: "start, edited", baseRevision: null, baseCommit: "a".repeat(40) }]);
    expect(last()).toMatchObject({ status: "saved", revision: 1 });
  });

  it("takes the base from the older commit the text was read from, never from anything later", async () => {
    // The Brain indexed an older commit than the head: that older commit is what the draft's base must be.
    const { saver, calls, advance } = harness({ startCommit: "1".repeat(40) });
    saver.change("changed");
    await advance(AUTOSAVE_QUIET_MS);
    expect(calls[0]?.baseCommit).toBe("1".repeat(40));
  });

  it("sends the revision the server gave on the next saves, without a base commit", async () => {
    const { saver, calls, advance } = harness();
    saver.change("one");
    await advance(AUTOSAVE_QUIET_MS);
    saver.change("two");
    await advance(AUTOSAVE_QUIET_MS);
    expect(calls.map((call) => [call.text, call.baseRevision])).toEqual([
      ["one", null],
      ["two", 1],
    ]);
    expect("baseCommit" in (calls[1] ?? {})).toBe(false);
  });

  it("starts from the draft the server holds, and saves against its revision", async () => {
    const { saver, calls, advance } = harness({ draft: draft({ text: "mine", revision: 4 }) });
    expect(saver.current).toEqual({ text: "mine", revision: 4 });
    saver.change("mine, more");
    await advance(AUTOSAVE_QUIET_MS);
    expect(calls).toEqual([{ path: "a/page.md", text: "mine, more", baseRevision: 4 }]);
  });

  it("saves once for a burst of keystrokes, and not at all when the text is back as it was", async () => {
    const { saver, calls, advance, last } = harness();
    saver.change("s");
    await advance(500);
    saver.change("st");
    await advance(500);
    saver.change("sta");
    await advance(AUTOSAVE_QUIET_MS);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.text).toBe("sta");
    saver.change("start");
    expect(last()?.status).toBe("unsaved");
    saver.change("sta");
    expect(last()?.status).toBe("saved");
    await advance(AUTOSAVE_MAX_MS);
    expect(calls).toHaveLength(1);
  });

  it("saves every ten seconds at most while typing goes on without a pause", async () => {
    const { saver, calls, advance } = harness();
    for (let second = 0; second < 12; second += 1) {
      saver.change(`text ${second}`);
      await advance(1000);
    }
    expect(calls.length).toBeGreaterThanOrEqual(1);
    expect(calls[0]?.text).toBe("text 9");
  });

  it("has one request out at a time, and saves what was typed meanwhile after it", async () => {
    let release: (view: DraftView) => void = () => undefined;
    const { saver, calls, advance, settle, last } = harness({
      answer: (body, call) => (call === 1 ? new Promise<DraftView>((resolve) => (release = resolve)) : Promise.resolve(draft({ text: body.text, revision: call }))),
    });
    saver.change("first");
    await advance(AUTOSAVE_QUIET_MS);
    expect(last()?.status).toBe("saving");
    saver.change("first, and more");
    saver.flush();
    await settle();
    expect(calls).toHaveLength(1);
    release(draft({ text: "first", revision: 1 }));
    await settle();
    expect(last()?.status).toBe("unsaved");
    await advance(AUTOSAVE_QUIET_MS);
    expect(calls.map((call) => [call.text, call.baseRevision])).toEqual([
      ["first", null],
      ["first, and more", 1],
    ]);
    expect(last()?.status).toBe("saved");
  });

  it("saves at once when asked (focus lost, the page closing)", async () => {
    const { saver, calls, settle } = harness();
    saver.change("urgent");
    saver.flush();
    await settle();
    expect(calls).toHaveLength(1);
  });

  it("says that a save failed, keeps the text and saves it again on a retry", async () => {
    let failing = true;
    const { saver, calls, advance, settle, last } = harness({
      answer: async (body, call) => {
        if (failing) throw Object.assign(new Error("The API did not answer"), { status: 502 });
        return draft({ text: body.text, revision: call });
      },
    });
    saver.change("work");
    await advance(AUTOSAVE_QUIET_MS);
    expect(last()).toMatchObject({ status: "failed", message: "The API did not answer" });
    expect(saver.current.text).toBe("work");
    failing = false;
    saver.flush();
    await settle();
    expect(calls).toHaveLength(2);
    expect(last()?.status).toBe("saved");
  });

  it("locks on a refusal and shows the API's message, keeping what was typed", async () => {
    const { saver, calls, advance, last } = harness({
      answer: async () => {
        throw Object.assign(new Error("Editing is restricted to the docs team"), { status: 403 });
      },
    });
    saver.change("work");
    await advance(AUTOSAVE_QUIET_MS);
    expect(last()).toMatchObject({ status: "locked", message: "Editing is restricted to the docs team" });
    saver.change("more work");
    await advance(AUTOSAVE_MAX_MS);
    expect(calls).toHaveLength(1);
    expect(saver.current.text).toBe("work");
  });

  it("asks which text to keep when another tab saved a newer revision, and overwrites nothing", async () => {
    const server = draft({ text: "from the other tab", revision: 7 });
    const { saver, calls, conflicts, advance } = harness({
      draft: draft({ revision: 2 }),
      answer: async () => {
        throw Object.assign(new Error("The draft changed"), { status: 409, body: { details: { code: "draft-revision", revision: 7 } } });
      },
      load: async () => server,
    });
    saver.change("my text");
    await advance(AUTOSAVE_QUIET_MS);
    expect(conflicts).toEqual([server]);
    expect(calls).toHaveLength(1);
    // The person keeps the server's text...
    saver.adopt(server);
    expect(saver.current).toEqual({ text: "from the other tab", revision: 7 });
  });

  it("keeps the person's text over the server's draft by saving it against the server's revision", async () => {
    const server = draft({ text: "from the other tab", revision: 7 });
    let first = true;
    const { saver, calls, conflicts, advance, settle } = harness({
      draft: draft({ revision: 2 }),
      answer: async (body) => {
        if (first) {
          first = false;
          throw Object.assign(new Error("The draft changed"), { status: 409, body: { details: { code: "draft-revision", revision: 7 } } });
        }
        return draft({ text: body.text, revision: 8 });
      },
      load: async () => server,
    });
    saver.change("my text");
    await advance(AUTOSAVE_QUIET_MS);
    expect(conflicts).toHaveLength(1);
    saver.keepMine(server);
    await settle();
    expect(calls[1]).toEqual({ path: "a/page.md", text: "my text", baseRevision: 7 });
    expect(saver.current).toEqual({ text: "my text", revision: 8 });
  });

  it("makes the draft again when the server says it is gone (revision 0), keeping the base it had", async () => {
    let first = true;
    const { saver, calls, advance, last } = harness({
      draft: draft({ revision: 4, baseCommit: "b".repeat(40) }),
      startCommit: null,
      answer: async (body, call) => {
        if (first) {
          first = false;
          throw Object.assign(new Error("The draft is gone"), { status: 409, body: { details: { code: "draft-revision", revision: 0 } } });
        }
        return draft({ text: body.text, revision: call });
      },
    });
    saver.change("typed after the draft was discarded elsewhere");
    await advance(AUTOSAVE_QUIET_MS);
    expect(calls.map((call) => [call.baseRevision, call.baseCommit])).toEqual([
      [4, undefined],
      [null, "b".repeat(40)],
    ]);
    expect(last()?.status).toBe("saved");
  });

  it("refuses to save a text over 5 MiB and says why", async () => {
    const { saver, calls, advance, last } = harness();
    saver.change("x".repeat(MAX_DRAFT_BYTES + 1));
    await advance(AUTOSAVE_MAX_MS);
    expect(calls).toHaveLength(0);
    expect(last()).toMatchObject({ status: "failed" });
    expect(last()?.message).toMatch(/5 MiB/);
  });

  it("shows who else is writing the page, as of the last answer", async () => {
    const others = [{ userId: "u2", name: "Kim", touchedAt: "2026-11-05T00:00:00Z" }];
    const { saver, advance, last } = harness({ answer: async (body) => draft({ text: body.text, revision: 1, others }) });
    saver.change("edit");
    await advance(AUTOSAVE_QUIET_MS);
    expect(last()?.others).toEqual(others);
  });
});

describe("opening a page in the editor and publishing it without a change", () => {
  // The editor's own document model: what comes out of CodeMirror's state for the text that went in.
  const through = (text: string): string => EditorState.create({ doc: text, extensions: [EditorState.lineSeparator.of(lineSeparatorOf(text))] }).sliceDoc();

  it("gives back the text byte for byte: CRLF, a missing final newline, an empty line at the end, front matter as it was", () => {
    const samples = [
      "---\ntitle: Page\nid: PAGE-ENG-0001\nlabels: [b, a]\n---\n\n# Page\n\nText\n",
      "---\r\ntitle: Page\r\n---\r\n\r\n# Page\r\n\r\nText\r\n",
      "no final newline",
      "ends with two newlines\n\n",
      "a lone \r in a line\nand more\n",
      "mixed\r\nendings\nin one file\r\n",
      "",
      "\n",
      "tabs\t and trailing spaces   \n",
      "title: é ü 漢字 🙂\n",
    ];
    for (const sample of samples) expect(through(sample)).toBe(sample);
  });

  it("would change the text without the separator: the reason the editor is told which one to use", () => {
    expect(EditorState.create({ doc: "a\r\nb\r\n" }).doc.toString()).toBe("a\nb\n");
  });
});

describe("settling a conflict: the three texts as a Git merge result", () => {
  const base = "# Title\n\nfirst paragraph\n\nsecond paragraph\n\nthird paragraph\n";

  it("combines what only one side changed and takes a change both made once", () => {
    const ours = base.replace("first paragraph", "first, edited by me");
    const theirs = base.replace("third paragraph", "third, edited by them");
    expect(withConflictMarkers(base, ours, theirs)).toEqual({ text: "# Title\n\nfirst, edited by me\n\nsecond paragraph\n\nthird, edited by them\n", conflicts: 0 });
    expect(withConflictMarkers(base, ours, ours)).toEqual({ text: ours, conflicts: 0 });
    expect(withConflictMarkers(base, base, theirs).text).toBe(theirs);
  });

  it("writes a place both changed differently between the three markers, Git style", () => {
    const ours = base.replace("second paragraph", "second, mine");
    const theirs = base.replace("second paragraph", "second, theirs");
    const merged = withConflictMarkers(base, ours, theirs);
    expect(merged.conflicts).toBe(1);
    expect(merged.text).toBe("# Title\n\nfirst paragraph\n\n<<<<<<< yours\nsecond, mine\n=======\nsecond, theirs\n>>>>>>> theirs\n\nthird paragraph\n");
  });

  it("marks each of several regions, the clean changes between them taken", () => {
    const ours = base.replace("first paragraph", "first, mine").replace("third paragraph", "third, mine");
    const theirs = base.replace("first paragraph", "first, theirs").replace("second paragraph", "second, theirs only").replace("third paragraph", "third, theirs");
    const merged = withConflictMarkers(base, ours, theirs);
    expect(merged.conflicts).toBe(2);
    expect(merged.text).toContain("<<<<<<< yours\nfirst, mine\n=======\nfirst, theirs\n>>>>>>> theirs\n");
    expect(merged.text).toContain("second, theirs only\n");
    expect(merged.text).toContain("<<<<<<< yours\nthird, mine\n=======\nthird, theirs\n>>>>>>> theirs\n");
  });

  it("handles the edges: a conflict on the first line, on the last line, and where one side deleted what the other edited", () => {
    const first = withConflictMarkers("a\nb\nc\n", "A1\nb\nc\n", "A2\nb\nc\n");
    expect(first.text).toBe("<<<<<<< yours\nA1\n=======\nA2\n>>>>>>> theirs\nb\nc\n");
    const last = withConflictMarkers("a\nb\nc\n", "a\nb\nC1\n", "a\nb\nC2\n");
    expect(last.text).toBe("a\nb\n<<<<<<< yours\nC1\n=======\nC2\n>>>>>>> theirs\n");
    const gone = withConflictMarkers("a\nb\nc\n", "a\nc\n", "a\nB\nc\n");
    expect(gone).toEqual({ text: "a\n<<<<<<< yours\n=======\nB\n>>>>>>> theirs\nc\n", conflicts: 1 });
  });

  it("keeps CRLF line endings, a missing final newline and front matter as plain text", () => {
    const crlf = withConflictMarkers("a\r\nb\r\nc\r\n", "a\r\nB1\r\nc\r\n", "a\r\nB2\r\nc\r\n");
    expect(crlf.text).toBe("a\r\n<<<<<<< yours\r\nB1\r\n=======\r\nB2\r\n>>>>>>> theirs\r\nc\r\n");
    const noFinal = withConflictMarkers("a\nb", "a\nB1", "a\nB2");
    expect(noFinal.text).toBe("a\n<<<<<<< yours\nB1\n=======\nB2\n>>>>>>> theirs\n");
    const front = withConflictMarkers("---\ntitle: A\n---\ntext\n", "---\ntitle: A\n---\ntext mine\n", "---\ntitle: B\n---\ntext\n");
    expect(front).toEqual({ text: "---\ntitle: B\n---\ntext mine\n", conflicts: 0 });
  });

  it("is one conflict for a page of both sides added (no base), none when they are equal", () => {
    expect(withConflictMarkers("", "mine\n", "theirs\n")).toEqual({ text: "<<<<<<< yours\nmine\n=======\ntheirs\n>>>>>>> theirs\n", conflicts: 1 });
    expect(withConflictMarkers("", "same\n", "same\n")).toEqual({ text: "same\n", conflicts: 0 });
  });

  it("gives back the text when nothing changed anywhere", () => {
    expect(withConflictMarkers(base, base, base)).toEqual({ text: base, conflicts: 0 });
    expect(withConflictMarkers("", "", "")).toEqual({ text: "", conflicts: 0 });
  });

  it("blocks publishing while a marker line is left, and lets go of it once they are gone", () => {
    expect(hasConflictMarkers("a\n<<<<<<< yours\nb\n")).toBe(true);
    expect(hasConflictMarkers("a\nb\n>>>>>>> theirs\n")).toBe(true);
    expect(hasConflictMarkers("text with <<<<<<< inside a line\n")).toBe(false);
    expect(hasConflictMarkers("a\n=======\nb\n")).toBe(false);
    expect(hasConflictMarkers("settled\n")).toBe(false);
  });
});

describe("the lines a merge result changed", () => {
  it("shows what was removed and what was added between two texts, the rest as context", () => {
    expect(lineDiff("a\nb\nc\n", "a\nB\nc\nd\n")).toEqual([
      { type: "context", text: "a\n" },
      { type: "del", text: "b\n" },
      { type: "add", text: "B\n" },
      { type: "context", text: "c\n" },
      { type: "add", text: "d\n" },
    ]);
    expect(lineDiff("same\n", "same\n")).toEqual([{ type: "context", text: "same\n" }]);
    expect(lineDiff("", "new\n")).toEqual([{ type: "add", text: "new\n" }]);
    expect(lineDiff("old\n", "")).toEqual([{ type: "del", text: "old\n" }]);
  });

  it("gives back both texts from its lines", () => {
    const from = "x\ny\nz\n";
    const to = "x\nY\nz\nw\n";
    const diff = lineDiff(from, to);
    expect(diff.filter((line) => line.type !== "add").map((line) => line.text).join("")).toBe(from);
    expect(diff.filter((line) => line.type !== "del").map((line) => line.text).join("")).toBe(to);
  });
});

describe("publishing", () => {
  it("starts with Update <title> and checks the message is 1 to 200 characters", () => {
    expect(defaultPublishMessage("Database failover")).toBe("Update Database failover");
    expect(defaultPublishMessage("x".repeat(500))).toHaveLength(PUBLISH_MESSAGE_MAX);
    expect(messageProblem("")).toMatch(/message/);
    expect(messageProblem("   ")).toMatch(/message/);
    expect(messageProblem("Fix the steps")).toBeUndefined();
    expect(messageProblem("x".repeat(PUBLISH_MESSAGE_MAX))).toBeUndefined();
    expect(messageProblem("x".repeat(PUBLISH_MESSAGE_MAX + 1))).toMatch(/200/);
  });

  it("says whether the result is a pull request or a direct commit before it is made", () => {
    expect(publishModeLine(false)).toMatch(/pull request/);
    expect(publishModeLine(true)).toMatch(/straight to the default branch/);
  });

  const refused = (status: number, details: Record<string, unknown>, message = "refused"): Error => Object.assign(new Error(message), { status, body: { details } });

  it("sorts a refused publish: conflict, open write, a draft that moved, anything else verbatim", () => {
    const body = { code: "conflict", base: "b", ours: "o", theirs: "t", head: { commit: "c", hash: "h" }, regions: [{ baseStart: 1, baseEnd: 2 }] };
    expect(classifyPublishFailure(refused(409, body))).toEqual({ kind: "conflict", body });
    expect(classifyPublishFailure(refused(409, { code: "open-write", write: { id: "w", author: "Kim", prUrl: "https://git.example/pr/3" } }, "Another pull request is open"))).toEqual({
      kind: "open-write",
      author: "Kim",
      prUrl: "https://git.example/pr/3",
      message: "Another pull request is open",
    });
    expect(classifyPublishFailure(refused(409, { code: "open-write", write: {} })).kind).toBe("open-write");
    expect(classifyPublishFailure(refused(409, { code: "draft-revision", revision: 3 }, "The draft changed"))).toEqual({ kind: "draft-revision", message: "The draft changed" });
    expect(classifyPublishFailure(refused(409, { code: "id-taken", path: "a/other.md", pageId: "PAGE-ENG-0099", revision: 4 }, "The page id is taken"))).toEqual({ kind: "id-taken", message: "The page id is taken", renewed: true });
    // A page that exists is not given a new id: the API says so without a pageId, and the draft is unchanged.
    expect(classifyPublishFailure(refused(409, { code: "id-taken", path: "a/other.md" }, "Page id PAGE-ENG-0012 is already defined by a/other.md"))).toEqual({ kind: "id-taken", message: "Page id PAGE-ENG-0012 is already defined by a/other.md", renewed: false });
    expect(classifyPublishFailure(refused(403, {}, "Publishing is restricted to the docs team"))).toEqual({ kind: "message", status: 403, message: "Publishing is restricted to the docs team" });
    expect(classifyPublishFailure(refused(400, {}, "Not an editable path"))).toEqual({ kind: "message", status: 400, message: "Not an editable path" });
    expect(classifyPublishFailure(new Error("boom"))).toEqual({ kind: "message", status: undefined, message: "boom" });
  });
});

describe("saving before publishing", () => {
  it("creates the draft of a page that was opened and not changed, so that publishing it can answer 'no change'", async () => {
    const { saver, calls } = harness({ startCommit: "a".repeat(40) });
    await expect(saver.whenSaved()).resolves.toBe(1);
    expect(calls).toEqual([{ path: "a/page.md", text: "start", baseRevision: null, baseCommit: "a".repeat(40) }]);
  });

  it("waits for a save that is out and for the text typed since, and gives the last revision", async () => {
    const { saver, calls } = harness({ draft: draft({ revision: 3 }) });
    saver.change("typed");
    await expect(saver.whenSaved()).resolves.toBe(1);
    expect(calls[0]).toMatchObject({ text: "typed", baseRevision: 3 });
  });

  it("fails, keeping the text, when the draft cannot be saved", async () => {
    const { saver } = harness({
      draft: draft(),
      answer: async () => {
        throw Object.assign(new Error("The API did not answer"), { status: 502 });
      },
    });
    saver.change("typed");
    await expect(saver.whenSaved()).rejects.toThrow("The API did not answer");
    expect(saver.current.text).toBe("typed");
  });
});

describe("a new page", () => {
  it("needs a title with a letter or a digit in it, of at most 200 characters", () => {
    expect(newPageProblem("")).toMatch(/title/);
    expect(newPageProblem("   ")).toMatch(/title/);
    expect(newPageProblem("---")).toMatch(/letter or digit/);
    expect(newPageProblem("Runbook: failover")).toBeUndefined();
    expect(newPageProblem("日本語 1")).toBeUndefined();
    expect(newPageProblem("x".repeat(NEW_PAGE_TITLE_MAX + 1))).toMatch(/200/);
  });

  it("asks what may be written in a folder through a path in it, and never at the root", () => {
    expect(newPageProbe("20-spaces/eng/runbooks")).toBe("20-spaces/eng/runbooks/new-page.md");
    expect(newPageProbe("")).toBeUndefined();
  });

  it("sends the title trimmed and a template only when one is chosen", () => {
    expect(newPageBody("a/b", "  My page ", "")).toEqual({ folder: "a/b", title: "My page" });
    expect(newPageBody("a/b", "My page", "01-standards/page-templates/runbook.md")).toEqual({ folder: "a/b", title: "My page", templatePath: "01-standards/page-templates/runbook.md" });
  });

  it("opens the editor on exactly the draft text the API returned, byte for byte", async () => {
    // A page made from a template: CRLF endings, no final newline, a front matter the editor must not reorder.
    const text = "---\r\nid: PAGE-ENG-0042\r\ntitle: New runbook\r\nlabels: [z, a]\r\n---\r\n\r\n# New runbook\r\n\r\nSteps:\r\n- one";
    const { saver, calls } = harness({ draft: draft({ text, revision: 1, baseCommit: null, baseHash: null }) });
    expect(saver.current).toEqual({ text, revision: 1 });
    // Publishing it unchanged saves the very same text.
    await saver.whenSaved();
    expect(calls).toEqual([]);
    expect(textBytes(saver.current.text)).toBe(textBytes(text));
  });
});

describe("moving and renaming a page", () => {
  const from = "20-spaces/eng/runbooks/db-failover.md";

  it("checks the target before asking the API about it", () => {
    expect(moveTargetProblem(from, "")).toMatch(/new path/);
    expect(moveTargetProblem(from, "/a/b.md")).toMatch(/slash/);
    expect(moveTargetProblem(from, "a/b/")).toMatch(/slash/);
    expect(moveTargetProblem(from, "a/b.txt")).toMatch(/\.md/);
    expect(moveTargetProblem(from, "a/../b.md")).toMatch(/\.\./);
    expect(moveTargetProblem(from, "a//b.md")).toMatch(/empty/);
    expect(moveTargetProblem(from, "b.md")).toMatch(/folder/);
    expect(moveTargetProblem(from, from)).toMatch(/already/);
    expect(moveTargetProblem(from, " 20-spaces/eng/runbooks/failover.md ")).toBeUndefined();
    expect(moveTargetProblem(from, "20-spaces/ops/db-failover.md")).toBeUndefined();
  });

  it("tells a rename in place from a move to another folder, for the default message", () => {
    expect(moveKind(from, "20-spaces/eng/runbooks/failover.md")).toBe("rename");
    expect(moveKind(from, "20-spaces/ops/db-failover.md")).toBe("move");
    expect(defaultMoveMessage(from, "20-spaces/eng/runbooks/failover.md")).toBe(`Rename ${from} to 20-spaces/eng/runbooks/failover.md`);
    expect(defaultMoveMessage(from, "20-spaces/ops/db-failover.md").startsWith("Move ")).toBe(true);
    expect(defaultMoveMessage("a/b.md", `x/${"y".repeat(400)}.md`)).toHaveLength(PUBLISH_MESSAGE_MAX);
    expect(folderOfPath("a/b/c.md")).toBe("a/b");
    expect(folderOfPath("c.md")).toBe("");
  });

  it("opens Confirm only for a preview of the target as it is typed now", () => {
    expect(previewIsCurrent(null, "a/b.md")).toBe(false);
    expect(previewIsCurrent("a/b.md", "a/b.md")).toBe(true);
    expect(previewIsCurrent("a/b.md", " a/b.md ")).toBe(true);
    expect(previewIsCurrent("a/b.md", "a/c.md")).toBe(false);
    expect(previewIsCurrent("a/b.md", "")).toBe(false);
  });

  const refused = (status: number, details: Record<string, unknown>, message = "refused"): Error => Object.assign(new Error(message), { status, body: { details } });

  it("words a refusal for too many linking pages with the count and the limit, and shows any other verbatim", () => {
    expect(classifyMoveFailure(refused(409, { code: "too-many", count: 612, limit: 500 }, "x"))).toEqual({ kind: "too-many", count: 612, limit: 500, message: "Too many pages link here (612, the limit is 500)" });
    expect(classifyMoveFailure(refused(409, { code: "too-many" }, "x"))).toMatchObject({ kind: "too-many", limit: MOVE_REWRITE_LIMIT });
    expect(classifyMoveFailure(refused(409, { code: "target-exists" }, "A page already exists at that path"))).toEqual({ kind: "message", status: 409, message: "A page already exists at that path" });
    expect(classifyMoveFailure(refused(409, { code: "open-write", write: { author: "Kim", prUrl: "https://git.example/pr/9" } }, "A pull request is open"))).toMatchObject({ kind: "open-write", author: "Kim", prUrl: "https://git.example/pr/9" });
    expect(classifyMoveFailure(refused(403, {}, "Editing is restricted to the docs team"))).toEqual({ kind: "message", status: 403, message: "Editing is restricted to the docs team" });
  });
});

describe("the labels of a page in its front matter", () => {
  it("reads the labels of an inline list, a block list and a single value, with or without quotes", () => {
    expect(labelsOf("---\nlabels: [runbook, sev1]\n---\ntext\n")).toEqual(["runbook", "sev1"]);
    expect(labelsOf("---\nlabels:\n  - runbook\n  - 'sev1'\n---\n")).toEqual(["runbook", "sev1"]);
    expect(labelsOf("---\nlabels:\n- runbook\n- sev1\nowner: x\n---\n")).toEqual(["runbook", "sev1"]);
    expect(labelsOf("---\nlabels: runbook\n---\n")).toEqual(["runbook"]);
    expect(labelsOf('---\nlabels: ["a b", c] # comment\n---\n')).toEqual(["a b", "c"]);
    expect(labelsOf("---\ntitle: x\n---\n")).toEqual([]);
    expect(labelsOf("no front matter\nlabels: [a]\n")).toEqual([]);
    expect(labelsOf("---\nlabels: [a]\n")).toEqual([]);
  });

  it("changes an inline list and keeps every other byte", () => {
    const text = "---\ntitle: Page   \nlabels: [runbook,  sev1]\nowner:  me\n---\n\n# Body  \n\ttabs\n";
    expect(setLabels(text, ["runbook", "sev1", "database"])).toBe("---\ntitle: Page   \nlabels: [runbook, sev1, database]\nowner:  me\n---\n\n# Body  \n\ttabs\n");
  });

  it("keeps a block list a block list, with its own indentation and dash", () => {
    const text = "---\nlabels:\n    -   runbook\n    -   sev1\nowner: me\n---\nbody";
    expect(setLabels(text, ["runbook", "database"])).toBe("---\nlabels:\n    -   runbook\n    -   database\nowner: me\n---\nbody");
    expect(setLabels("---\nlabels:\n- a\n---\n", ["a", "b"])).toBe("---\nlabels:\n- a\n- b\n---\n");
  });

  it("adds the entry at the end of the front matter when it is missing, and makes a front matter for a page without one", () => {
    expect(setLabels("---\ntitle: x\n---\nbody\n", ["a"])).toBe("---\ntitle: x\nlabels: [a]\n---\nbody\n");
    expect(setLabels("just text\n", ["a", "b"])).toBe("---\nlabels: [a, b]\n---\njust text\n");
    expect(setLabels("just text\n", [])).toBe("just text\n");
    expect(setLabels("---\ntitle: x\n---\nbody\n", [])).toBe("---\ntitle: x\n---\nbody\n");
  });

  it("removes the entry, a block list included, when no label is left", () => {
    expect(setLabels("---\ntitle: x\nlabels: [a]\nowner: y\n---\n", [])).toBe("---\ntitle: x\nowner: y\n---\n");
    expect(setLabels("---\nlabels:\n  - a\n  - b\nowner: y\n---\n", [])).toBe("---\nowner: y\n---\n");
  });

  it("keeps CRLF line endings and a missing final newline, and gives the text back when the labels are the same", () => {
    const crlf = "---\r\ntitle: x\r\nlabels: [a]\r\n---\r\n\r\nbody";
    expect(setLabels(crlf, ["a", "b"])).toBe("---\r\ntitle: x\r\nlabels: [a, b]\r\n---\r\n\r\nbody");
    expect(setLabels("---\r\ntitle: x\r\n---\r\nbody", ["a"])).toBe("---\r\ntitle: x\r\nlabels: [a]\r\n---\r\nbody");
    expect(setLabels("plain\r\ntext", ["a"])).toBe("---\r\nlabels: [a]\r\n---\r\nplain\r\ntext");
    const same = "---\nlabels:   [a,b]\n---\n";
    expect(setLabels(same, ["a", "b"])).toBe(same);
  });

  it("only touches the labels entry of the front matter, never a line of the body", () => {
    const text = "---\ntitle: x\n---\nlabels: [in the body]\n";
    expect(setLabels(text, ["a"])).toBe("---\ntitle: x\nlabels: [a]\n---\nlabels: [in the body]\n");
  });

  it("accepts a label only as the Brain would store it, and says why not", () => {
    expect(labelCheck("runbook", [])).toEqual({ cleaned: "runbook", problem: undefined });
    expect(labelCheck("  sev-1 ", [])).toEqual({ cleaned: "sev-1", problem: undefined });
    expect(labelCheck("", [])).toEqual({ cleaned: "", problem: undefined });
    expect(labelCheck("Run Book", []).problem).toMatch(/stored as “runbook”/);
    expect(labelCheck("Runbook", []).cleaned).toBe("runbook");
    expect(labelCheck("!!!", []).problem).toMatch(/letters, digits and hyphens/);
    expect(labelCheck("runbook", ["runbook"]).problem).toMatch(/already/);
    expect(labelCheck("x".repeat(LABEL_MAX_LENGTH + 1), []).problem).toMatch(/100/);
    expect(labelCheck("new", Array.from({ length: LABELS_MAX }, (_, index) => `l${index}`)).problem).toMatch(/at most/);
  });
});

describe("deleting a page", () => {
  it("says before confirming how many links into the page will break", () => {
    expect(deleteWarning(0)).toBe("No other page links to this page.");
    expect(deleteWarning(1)).toBe("1 link into this page will break: it will show in the broken links report until fixed.");
    expect(deleteWarning(37)).toBe("37 links into this page will break: they will show in the broken links report until fixed.");
  });

  it("starts the message with Delete <path>, within the limit", () => {
    expect(defaultDeleteMessage("a/b.md")).toBe("Delete a/b.md");
    expect(defaultDeleteMessage(`a/${"b".repeat(400)}.md`)).toHaveLength(PUBLISH_MESSAGE_MAX);
  });
});

describe("restoring an older version", () => {
  it("starts the message with Restore version <short sha> of <title>", () => {
    expect(restoreMessage("a1b2c3d4e5f6".padEnd(40, "0"), "Database failover")).toBe("Restore version a1b2c3d of Database failover");
    expect(restoreMessage("a".repeat(40), "x".repeat(400))).toHaveLength(PUBLISH_MESSAGE_MAX);
  });

  it("has no draft yet: the old text is the editor's, and the first save carries the commit of the page as it is now", async () => {
    const current = "c".repeat(40);
    const { saver, calls } = harness({ startText: "the old version's text", startCommit: current });
    expect(saver.current).toEqual({ text: "the old version's text", revision: null });
    await saver.whenSaved();
    expect(calls).toEqual([{ path: "a/page.md", text: "the old version's text", baseRevision: null, baseCommit: current }]);
  });

  it("replaces the text of a draft that exists, saving it against the revision the server holds, once the person said so", async () => {
    let clock = 0;
    const calls: DraftSaveBody[] = [];
    const timers: Array<() => void> = [];
    const saver = new DraftSaver({
      path: "a/page.md",
      api: {
        save: async (body) => {
          calls.push(body);
          return draft({ text: body.text, revision: 6 });
        },
        load: async () => null,
      },
      draft: draft({ text: "my unfinished draft", revision: 5 }),
      startText: "",
      startCommit: null,
      replaceWith: "the old version's text",
      onChange: () => undefined,
      onRevisionConflict: () => undefined,
      now: () => clock,
      setTimer: (run) => timers.push(run),
      clearTimer: () => undefined,
    });
    clock = 2000;
    expect(saver.current).toEqual({ text: "the old version's text", revision: 5 });
    await expect(saver.whenSaved()).resolves.toBe(6);
    expect(calls).toEqual([{ path: "a/page.md", text: "the old version's text", baseRevision: 5 }]);
    expect(timers.length).toBeGreaterThan(0);
  });

  it("changes nothing when the text to restore is the draft's own", async () => {
    const { saver, calls } = harness({ draft: draft({ text: "same", revision: 2 }) });
    expect(saver.current.text).toBe("same");
    expect(calls).toEqual([]);
  });
});

describe("attachments of a draft", () => {
  it("knows the types that may be attached by extension, in any case, and not SVG or scripts", () => {
    expect(attachmentTypeOf("diagram.PNG")).toBe("image/png");
    expect(attachmentTypeOf("photo.jpeg")).toBe("image/jpeg");
    expect(attachmentTypeOf("spec.pdf")).toBe("application/pdf");
    for (const name of ["logo.svg", "page.html", "run.sh", "archive.zip", "noextension", "x.png.exe"]) expect(attachmentTypeOf(name)).toBeUndefined();
  });

  it("refuses a file before upload, with the reason: type, empty, over 5 MiB, or over 20 MiB for the page", () => {
    expect(attachmentProblem({ name: "a.png", size: 1000 }, 0)).toBeUndefined();
    expect(attachmentProblem({ name: "a.svg", size: 1000 }, 0)).toMatch(/only images/);
    expect(attachmentProblem({ name: "a.png", size: 0 }, 0)).toMatch(/empty/);
    expect(attachmentProblem({ name: "a.png", size: ATTACHMENT_MAX_BYTES }, 0)).toBeUndefined();
    expect(attachmentProblem({ name: "a.png", size: ATTACHMENT_MAX_BYTES + 1 }, 0)).toMatch(/5 MiB/);
    expect(attachmentProblem({ name: "a.png", size: 1000 }, ATTACHMENTS_MAX_BYTES)).toMatch(/20 MiB/);
  });

  it("encodes bytes as base64, also for a file larger than one chunk", () => {
    expect(toBase64(new Uint8Array([104, 105]))).toBe("aGk=");
    const big = Uint8Array.from({ length: 100_000 }, (_, index) => index % 251);
    expect(Uint8Array.from(Buffer.from(toBase64(big), "base64"))).toEqual(big);
    expect(toBase64(new Uint8Array())).toBe("");
  });

  it("shows an image the draft holds from the draft's own route, and any other image not at all", () => {
    const page = "20-spaces/eng/runbooks/db-failover.md";
    expect(draftImageUrl("my project", page, "20-spaces/eng/runbooks/_attachments/failover.png", ["failover.png"])).toBe(
      `/api/projects/my%20project/wiki/draft/attachments/file?path=${encodeURIComponent(page)}&name=failover.png`,
    );
    // Not held by the draft: it may be a published attachment, which the reader's route serves.
    expect(draftImageUrl("p", page, "20-spaces/eng/runbooks/_attachments/other.png", ["failover.png"])).toBeUndefined();
    // Another page's folder, a deeper path, an empty name.
    expect(draftImageUrl("p", page, "20-spaces/eng/_attachments/failover.png", ["failover.png"])).toBeUndefined();
    expect(draftImageUrl("p", page, "20-spaces/eng/runbooks/_attachments/sub/failover.png", ["sub/failover.png"])).toBeUndefined();
    expect(draftImageUrl("p", page, "20-spaces/eng/runbooks/_attachments/", [""])).toBeUndefined();
    expect(draftImageUrl("p", "top.md", "_attachments/a.png", ["a.png"])).toContain("name=a.png");
  });
});

describe("the person's drafts", () => {
  const entry = (path: string, touchedAt: string, writeId: string | null = null): DraftSummary => ({ path, touchedAt, revision: 1, writeId });

  it("lists the newest saved first, by path when saved at the same time", () => {
    const sorted = sortDrafts([entry("b.md", "2026-11-05T01:00:00Z"), entry("a.md", "2026-11-05T02:00:00Z"), entry("c.md", "2026-11-05T01:00:00Z")]);
    expect(sorted.map((draft) => draft.path)).toEqual(["a.md", "b.md", "c.md"]);
    expect(sortDrafts([])).toEqual([]);
  });

  it("says whether a draft is still being written or its publish waits for review", () => {
    expect(draftStateLabel(entry("a.md", "x"))).toBe("Not published");
    expect(draftStateLabel(entry("a.md", "x", "w1"))).toBe("Waiting for review");
  });
});

describe("archiving a page: its status line", () => {
  it("changes only the status line, whatever it was", () => {
    expect(setStatus("---\ntitle: x\nstatus: draft\nowner: me\n---\nbody\n", "archived")).toBe("---\ntitle: x\nstatus: archived\nowner: me\n---\nbody\n");
    expect(setStatus('---\nstatus:   "Approved"  # ok\n---\n', "archived")).toBe("---\nstatus: archived\n---\n");
    expect(setStatus("---\nstatus: archived\n---\nbody", "archived")).toBe("---\nstatus: archived\n---\nbody");
  });

  it("adds the line at the end of the front matter, or makes a front matter, when there is none", () => {
    expect(setStatus("---\ntitle: x\n---\nbody\n", "archived")).toBe("---\ntitle: x\nstatus: archived\n---\nbody\n");
    expect(setStatus("just text\n", "archived")).toBe("---\nstatus: archived\n---\njust text\n");
  });

  it("removes the line to unarchive, and leaves a page without one as it is", () => {
    expect(setStatus("---\ntitle: x\nstatus: archived\nowner: me\n---\nbody\n", null)).toBe("---\ntitle: x\nowner: me\n---\nbody\n");
    expect(setStatus("---\ntitle: x\n---\nbody\n", null)).toBe("---\ntitle: x\n---\nbody\n");
    expect(setStatus("no front matter\n", null)).toBe("no front matter\n");
  });

  it("keeps CRLF, a missing final newline and a `status:` line of the body", () => {
    expect(setStatus("---\r\ntitle: x\r\nstatus: draft\r\n---\r\nbody", "archived")).toBe("---\r\ntitle: x\r\nstatus: archived\r\n---\r\nbody");
    expect(setStatus("---\r\ntitle: x\r\n---\r\nbody", "archived")).toBe("---\r\ntitle: x\r\nstatus: archived\r\n---\r\nbody");
    expect(setStatus("---\ntitle: x\n---\nstatus: in the body\n", "archived")).toBe("---\ntitle: x\nstatus: archived\n---\nstatus: in the body\n");
  });

  it("round trips: archive then unarchive gives back a page that had no status", () => {
    const text = "---\r\ntitle: x\r\nlabels: [a]\r\n---\r\n\r\nbody  \r\n";
    expect(setStatus(setStatus(text, "archived"), null)).toBe(text);
  });

  it("names the change in the publish message and in the status it sets", () => {
    expect(statusChangeMessage("archive", "Old plan")).toBe("Archive Old plan");
    expect(statusChangeMessage("unarchive", "Old plan")).toBe("Unarchive Old plan");
    expect(statusOf("archive")).toBe("archived");
    expect(statusOf("unarchive")).toBeNull();
  });
});

describe("where an attachment's Markdown goes", () => {
  const md = "![pixel.png](_attachments/pixel.png)";
  const apply = (text: string, cursor: number): string => {
    const change = attachmentInsertion(text, cursor, md);
    return text.slice(0, change.from) + change.insert + text.slice(change.to);
  };
  const page = "---\ntitle: Cache flush\nid: PAGE-ENG-0012\nlabels: [runbook]\n---\n\n# Cache flush\n\nSteps.\n";

  it("puts it after the front matter, on its own line, when the text was never clicked (cursor at the start)", () => {
    const text = apply(page, 0);
    expect(text).toBe(`---\ntitle: Cache flush\nid: PAGE-ENG-0012\nlabels: [runbook]\n---\n${md}\n\n# Cache flush\n\nSteps.\n`);
    expect(labelsOf(text)).toEqual(["runbook"]);
    expect(text.startsWith("---\ntitle: Cache flush")).toBe(true);
  });

  it("puts it after the front matter too when the cursor is inside it, never in the middle of a line of it", () => {
    for (const cursor of [4, 10, page.indexOf("id:") + 3, page.indexOf("labels") + 2, page.indexOf("---\n\n") + 2]) {
      const text = apply(page, cursor);
      expect(text.startsWith("---\ntitle: Cache flush\nid: PAGE-ENG-0012\nlabels: [runbook]\n---\n")).toBe(true);
      expect(labelsOf(text)).toEqual(["runbook"]);
      expect(text.includes(`---\n${md}\n`)).toBe(true);
    }
  });

  it("puts it at the cursor in the body, on a line of its own", () => {
    const at = page.indexOf("Steps.");
    expect(apply(page, at)).toBe(page.replace("Steps.", `${md}\nSteps.`));
    const middle = page.indexOf("Steps.") + 3;
    expect(apply(page, middle)).toBe(page.replace("Steps.", `Ste\n${md}\nps.`));
    expect(apply(page, page.length)).toBe(`${page}${md}\n`);
  });

  it("handles a page without front matter, an empty page, a page without a final newline and one that is only front matter", () => {
    expect(apply("Just text\n", 0)).toBe(`${md}\nJust text\n`);
    expect(apply("Just text\n", 4)).toBe(`Just\n${md}\n text\n`);
    expect(apply("", 0)).toBe(`${md}\n`);
    expect(apply("no newline", 10)).toBe(`no newline\n${md}\n`);
    expect(apply("---\ntitle: x\n---", 0)).toBe(`---\ntitle: x\n---\n${md}\n`);
    expect(apply("---\ntitle: x\n---\n", 2)).toBe(`---\ntitle: x\n---\n${md}\n`);
  });

  it("does not take a `---` in the body for a front matter, and an unclosed front matter is plain text", () => {
    const body = "intro\n\n---\n\nrule above\n";
    expect(apply(body, 0)).toBe(`${md}\nintro\n\n---\n\nrule above\n`);
    expect(apply("---\ntitle: x\nno closing line\n", 0)).toBe(`${md}\n---\ntitle: x\nno closing line\n`);
  });

  it("keeps a cursor past the end of the text inside it", () => {
    expect(apply("abc\n", 99)).toBe(`abc\n${md}\n`);
  });
});
