// The mirror reader's search and diff against a real bare repository (no database): paths Git writes in awkward ways
// (a space, Vietnamese, a quote, glob characters, an upper-case extension), moves into and out of a folder, and a
// changed line that looks like a patch header.

import { execFileSync } from "node:child_process";
import { mkdtemp, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DiffFile, DocumentRepo } from "../../src/modules/delivery/documents/domain/document.js";
import { GitMirrorDocumentReader, markdownPathspec, patchPath } from "../../src/modules/delivery/documents/infrastructure/git-mirror.reader.js";

const lines = (count: number, change?: { at: number; text: string }) => Array.from({ length: count }, (_, at) => (change?.at === at + 1 ? change.text : `line ${at + 1} of a document long enough to be seen as moved`)).join("\n") + "\n";

const FIRST: Record<string, string> = {
  "notes/my notes.md": "# A\n\nold\n",
  "notes/tài liệu.md": "t\n",
  "notes/plus.md": lines(10),
  "notes/plain.md": "a\nb\nc\n",
  "Docs/UP.MD": "U\n",
  "a[1]/x.md": "x\n",
  "a1/x.md": "x\n",
  'q"uote.md': "q\n",
  "keep/out.md": lines(20),
  "other/in.md": lines(20),
  "README.txt": "not markdown\n",
};
const SECOND: Record<string, string> = {
  ...FIRST,
  "notes/my notes.md": "# A\n\nnew\n++ plus\n",
  "notes/tài liệu.md": "t2\n",
  // An added line "++ two" is written "+++ two" in the patch.
  "notes/plus.md": lines(10, { at: 2, text: "++ two" }).replace("line 8 of", "line eight of"),
  "notes/plain.md": "a\nc\n",
  "Docs/UP.MD": "U2 late fee\nfee late\n",
  "a[1]/x.md": "x2\n",
  'q"uote.md': "q2\n",
  "gone/out.md": lines(20),
  "keep/in.md": lines(20, { at: 5, text: "changed" }),
  "README.txt": "still not markdown\n",
};
delete SECOND["keep/out.md"];
delete SECOND["other/in.md"];

describe("GitMirrorDocumentReader grep and diff", () => {
  let dataDir: string;
  let mirror: string;
  let reader: GitMirrorDocumentReader;
  let first: string;
  let second: string;
  const repo = { serverId: "internal", repositoryId: "docs" } as DocumentRepo;
  const git = (args: string[], input?: string) =>
    execFileSync("git", ["-c", "core.protectNTFS=false", "--git-dir", mirror, ...args], { input, env: { ...process.env, GIT_INDEX_FILE: join(dataDir, "index") }, encoding: "utf8" }).trim();
  const commit = (files: Record<string, string>, message: string, parent?: string): string => {
    git(["read-tree", "--empty"]);
    for (const [path, text] of Object.entries(files)) git(["update-index", "--add", "--cacheinfo", `100644,${git(["hash-object", "-w", "--stdin"], text)},${path}`]);
    const tree = git(["write-tree"]);
    const id = git(["-c", "user.name=t", "-c", "user.email=t@t", "commit-tree", tree, "-m", message, ...(parent === undefined ? [] : ["-p", parent])]);
    git(["update-ref", "refs/heads/main", id]);
    return id;
  };

  beforeAll(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "kintsugi-reader-"));
    process.env["KINTSUGI_DATA_DIR"] = dataDir;
    mirror = join(dataDir, "git", "mirrors", "internal", "docs.git");
    execFileSync("git", ["init", "-q", "--bare", "-b", "main", mirror]);
    first = commit(FIRST, "one");
    second = commit(SECOND, "two", first);
    reader = new GitMirrorDocumentReader();
  });
  afterAll(async () => {
    if (dataDir !== undefined) await rm(dataDir, { recursive: true, force: true });
  });

  const byPath = (files: DiffFile[]) => Object.fromEntries(files.map((file) => [file.path, file]));

  it("lists every changed Markdown file with the lines of the later commit that changed", async () => {
    const diff = await reader.diff(repo, first.slice(0, 7), second, undefined);
    expect(diff?.from).toBe(first);
    expect(diff?.linesKnown).toBe(true);
    const files = byPath(diff!.files);
    expect(Object.keys(files).sort()).toEqual(["Docs/UP.MD", "a[1]/x.md", "gone/out.md", "keep/in.md", "notes/my notes.md", "notes/plain.md", "notes/plus.md", "notes/tài liệu.md", 'q"uote.md']);
    expect(files["notes/my notes.md"]).toEqual({ path: "notes/my notes.md", previousPath: null, status: "modified", added: 2, removed: 1, hunks: [{ start: 3, end: 4 }] });
    expect(files["notes/tài liệu.md"]?.hunks).toEqual([{ start: 1, end: 1 }]);
    expect(files['q"uote.md']?.hunks).toEqual([{ start: 1, end: 1 }]);
    expect(files["Docs/UP.MD"]).toMatchObject({ added: 2, removed: 1, hunks: [{ start: 1, end: 2 }] });
    // The changed line that reads like a header does not end the file's hunks.
    expect(files["notes/plus.md"]?.hunks).toEqual([{ start: 2, end: 2 }, { start: 8, end: 8 }]);
    // A removed line sits on the line before which it was.
    expect(files["notes/plain.md"]).toMatchObject({ added: 0, removed: 1, hunks: [{ start: 1, end: 1 }] });
    expect(files["gone/out.md"]).toMatchObject({ status: "renamed", previousPath: "keep/out.md", hunks: [] });
    expect(files["keep/in.md"]).toMatchObject({ status: "renamed", previousPath: "other/in.md", hunks: [{ start: 5, end: 5 }] });
  });

  it("sees a document moved into or out of a folder as moved, with its lines", async () => {
    const diff = await reader.diff(repo, first, second, "keep");
    const files = byPath(diff!.files);
    expect(Object.keys(files).sort()).toEqual(["gone/out.md", "keep/in.md"]);
    expect(files["keep/in.md"]?.hunks).toEqual([{ start: 5, end: 5 }]);
  });

  it("takes a folder or document path literally", async () => {
    expect((await reader.diff(repo, first, second, "a[1]"))!.files.map((file) => file.path)).toEqual(["a[1]/x.md"]);
    expect((await reader.diff(repo, first, second, "a1"))!.files).toEqual([]);
    const one = await reader.diff(repo, first, second, "notes/plain.md");
    expect(one!.files.map((file) => [file.path, file.hunks])).toEqual([["notes/plain.md", [{ start: 1, end: 1 }]]]);
    expect(await reader.diff(repo, first, second, "notes/missing.md")).toEqual({ from: first, files: [], linesKnown: true });
  });

  it("does not know a commit the mirror lacks", async () => {
    expect(await reader.diff(repo, "0".repeat(40), second, undefined)).toBeUndefined();
    expect(await reader.diff(repo, "main~5", second, undefined)).toBeUndefined();
  });

  it("finds lines with every term in Markdown files of any case, under a folder taken literally", async () => {
    const all = await reader.grep(repo, second, ["late", "fee"], { ignoreCase: false, limit: 10 });
    expect(all).toEqual({ matches: [{ path: "Docs/UP.MD", line: 1, text: "U2 late fee" }, { path: "Docs/UP.MD", line: 2, text: "fee late" }], truncated: false });
    expect((await reader.grep(repo, second, ["LATE"], { ignoreCase: true, limit: 1 })).truncated).toBe(true);
    expect((await reader.grep(repo, second, ["x"], { ignoreCase: false, under: "a[1]", limit: 10 })).matches.map((match) => match.path)).toEqual(["a[1]/x.md"]);
    expect((await reader.grep(repo, second, ["x"], { ignoreCase: false, under: "a1", limit: 10 })).matches.map((match) => match.path)).toEqual(["a1/x.md"]);
    expect((await reader.grep(repo, second, ["markdown"], { ignoreCase: false, limit: 10 })).matches).toEqual([]);
    expect((await reader.grep(repo, second, ["nothing here"], { ignoreCase: false, limit: 10 })).matches).toEqual([]);
  });

  it("lists the files without their lines when the older text is gone from the mirror", async () => {
    const blob = git(["rev-parse", `${first}:Docs/UP.MD`]);
    await unlink(join(mirror, "objects", blob.slice(0, 2), blob.slice(2)));
    const diff = await reader.diff(repo, first, second, "Docs");
    expect(diff).toMatchObject({ linesKnown: false, files: [{ path: "Docs/UP.MD", status: "modified", hunks: [] }] });
  });
});

describe("patchPath and markdownPathspec", () => {
  it("reads a patch path the way git wrote it", () => {
    expect(patchPath("b/my notes.md\t")).toBe("my notes.md");
    expect(patchPath("a/plain.md")).toBe("plain.md");
    expect(patchPath('"b/q\\"uote \\303\\240\\t\\\\.md"')).toBe('q"uote à\t\\.md');
    expect(patchPath("/dev/null")).toBeUndefined();
  });

  it("matches Markdown files of any case, under a path taken literally", () => {
    expect(markdownPathspec("")).toBe(":(glob)**/*.[mM][dD]");
    expect(markdownPathspec("a[1]/b*?")).toBe(":(glob)a[[]1]/b[*][?]/**/*.[mM][dD]");
    expect(markdownPathspec("x/Doc.MD")).toBe(":(glob)x/Doc.MD");
  });
});
