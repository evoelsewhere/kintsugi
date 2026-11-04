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
  messageProblem,
  PUBLISH_MESSAGE_MAX,
  publishModeLine,
  lineDiff,
  lineSeparatorOf,
  MERGE_MAX_LINES,
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
    expect(crlf.text).toBe("a\r\n<<<<<<< yours\nB1\r\n=======\nB2\r\n>>>>>>> theirs\nc\r\n");
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

  it("does not compare a very long page line by line: the whole page is the conflict", () => {
    const long = "line\n".repeat(MERGE_MAX_LINES + 1);
    const merged = withConflictMarkers(long, `${long}mine\n`, `${long}theirs\n`);
    expect(merged.conflicts).toBe(1);
    expect(merged.text.startsWith("<<<<<<< yours\n")).toBe(true);
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
