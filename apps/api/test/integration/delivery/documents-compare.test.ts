// The comparison of one document at two commits (ADR-0096 decision 5): hunks with old and new line numbers, an
// added or deleted file, no hunks for the same text, and the refusals of the file route. The mirror is a real bare
// repository built here.

import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { CheckoutStorage } from "@kintsugi/git";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Client, adminClient, currentUserId, grantProjectAccess, startTestApp, type TestApp } from "../../support/app.js";
import { hasDatabase } from "../../support/database.js";

interface Line {
  type: "context" | "add" | "del";
  oldLine: number | null;
  newLine: number | null;
  text: string;
}
interface Compare {
  path: string;
  from: string;
  to: string;
  status: "unchanged" | "added" | "deleted" | "modified";
  added: number;
  removed: number;
  hunks: Array<{ oldStart: number; oldLines: number; newStart: number; newLines: number; lines: Line[] }>;
}

const PAGE = "20-spaces/onb/page.md";
const numbered = (count: number, change: Record<number, string> = {}): string => `${Array.from({ length: count }, (_, at) => change[at + 1] ?? `line ${at + 1}`).join("\n")}\n`;

describe.skipIf(!hasDatabase)("comparison of two versions of a document (integration)", () => {
  let app: TestApp;
  let admin: Client;
  let dataDir: string;
  let work: string;
  const shas: Record<string, string> = {};
  const previousDataDir = process.env["KINTSUGI_DATA_DIR"];

  const git = (...args: string[]): string =>
    execFileSync("git", args, {
      cwd: work,
      encoding: "utf8",
      env: { ...process.env, GIT_AUTHOR_NAME: "Ada", GIT_AUTHOR_EMAIL: "ada@example.com", GIT_COMMITTER_NAME: "Ada", GIT_COMMITTER_EMAIL: "ada@example.com" },
    }).trim();
  const write = async (path: string, content: string | Buffer): Promise<void> => {
    await mkdir(dirname(join(work, path)), { recursive: true });
    await writeFile(join(work, path), content);
    git("add", path);
  };
  const commit = (name: string): void => {
    git("commit", "-q", "-m", name);
    shas[name] = git("rev-parse", "HEAD");
  };
  const compare = (query: string) => admin.get<Compare>(`/projects/shop/documents/compare?${query}`);
  const between = (path: string, from: string, to: string) => compare(`path=${encodeURIComponent(path)}&from=${shas[from] ?? from}&to=${shas[to] ?? to}`);

  beforeAll(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "kintsugi-compare-"));
    process.env["KINTSUGI_DATA_DIR"] = dataDir;
    work = join(dataDir, "work");
    await mkdir(work);
    git("init", "-q", "-b", "main");
    await write("README.md", "docs\n");
    commit("one");
    await write(PAGE, numbered(10));
    await write("20-spaces/onb/gone.md", "soon gone\n");
    await write("20-spaces/onb/blob.md", Buffer.from([0x23, 0x20, 0x00, 0x01, 0x0a]));
    await write("20-spaces/onb/a[1].md", "x\n");
    await write("20-spaces/onb/a1.md", "x\n");
    commit("two");
    // line 3 changed, line 9 removed, a line added at the end, so two hunks
    await write(PAGE, `${numbered(10, { 3: "line three, edited" }).replace("line 9\n", "")}line 11 added\n`);
    await write("20-spaces/onb/blob.md", Buffer.from([0x23, 0x20, 0x00, 0x02, 0x0a]));
    await write("20-spaces/onb/a[1].md", "changed\n");
    commit("three");
    git("rm", "-q", "20-spaces/onb/gone.md");
    await write("20-spaces/onb/big.md", `${"x".repeat(2 * 1024 * 1024 + 10)}\n`);
    await write("restricted/secret.md", "no\n");
    commit("four");
    await mkdir(join(dataDir, "mirrors"), { recursive: true });
    execFileSync("git", ["clone", "-q", "--bare", work, new CheckoutStorage(dataDir).mirror("local", "docs")]);

    app = await startTestApp();
    admin = await adminClient(app);
    await app.db.query("insert into admin.git_server (id, kind, name, base_url, auth_type) values ('local', 'plain-git', 'Local', 'http://127.0.0.1:1', 'none')");
    await app.db.query("insert into admin.git_repository (id, server_id, url, default_branch) values ('docs', 'local', 'http://127.0.0.1:1/docs.git', 'main')");
    expect((await admin.request("POST", "/admin/projects", { body: { id: "shop", name: "Shop", documentRepositoryId: "docs" } })).status).toBe(201);
    await grantProjectAccess(admin, "shop", await currentUserId(admin));
  }, 120_000);
  afterAll(async () => {
    await app?.close();
    await rm(dataDir, { recursive: true, force: true });
    if (previousDataDir === undefined) delete process.env["KINTSUGI_DATA_DIR"];
    else process.env["KINTSUGI_DATA_DIR"] = previousDataDir;
  });

  it("returns the hunks of a modified file with old and new line numbers", async () => {
    const response = await between(PAGE, "two", "three");
    expect(response.status).toBe(200);
    const data = response.body.data!;
    expect(data).toMatchObject({ path: PAGE, from: shas["two"], to: shas["three"], status: "modified", added: 2, removed: 2 });
    // Three lines of context join the two changes at lines 3 and 9 into one hunk; a hunk is a run of lines.
    const lines = data.hunks.flatMap((hunk) => hunk.lines);
    expect(lines.filter((line) => line.type === "del").map((line) => [line.oldLine, line.text])).toEqual([
      [3, "line 3"],
      [9, "line 9"],
    ]);
    expect(lines.filter((line) => line.type === "add").map((line) => [line.newLine, line.text])).toEqual([
      [3, "line three, edited"],
      [10, "line 11 added"],
    ]);
    for (const hunk of data.hunks) {
      expect(hunk.lines.filter((line) => line.type !== "add")).toHaveLength(hunk.oldLines);
      expect(hunk.lines.filter((line) => line.type !== "del")).toHaveLength(hunk.newLines);
    }
    for (const line of lines.filter((line) => line.type === "context")) expect(line.text).toBe(`line ${line.oldLine}`);
  });

  it("compares in the other direction as the reverse change", async () => {
    const data = (await between(PAGE, "three", "two")).body.data!;
    expect(data).toMatchObject({ status: "modified", added: 2, removed: 2 });
    expect(data.hunks.flatMap((hunk) => hunk.lines).filter((line) => line.type === "add").map((line) => line.text)).toEqual(["line 3", "line 9"]);
  });

  it("gives an empty diff for the same text, between one commit and itself or two that did not change the file", async () => {
    for (const [from, to] of [["three", "three"], ["three", "four"], ["one", "one"]] as const) {
      const path = from === "one" ? "README.md" : PAGE;
      const data = (await between(path, from, to)).body.data!;
      expect(data, `${from} ${to}`).toMatchObject({ status: "unchanged", added: 0, removed: 0, hunks: [] });
    }
  });

  it("shows a file missing at the older commit as added, and one missing at the newer as deleted", async () => {
    const added = (await between(PAGE, "one", "two")).body.data!;
    expect(added).toMatchObject({ status: "added", removed: 0, added: 10 });
    expect(added.hunks).toHaveLength(1);
    expect(added.hunks[0]?.lines[0]).toEqual({ type: "add", oldLine: null, newLine: 1, text: "line 1" });
    const deleted = (await between("20-spaces/onb/gone.md", "two", "four")).body.data!;
    expect(deleted).toMatchObject({ status: "deleted", added: 0, removed: 1 });
    expect(deleted.hunks[0]?.lines).toEqual([{ type: "del", oldLine: 1, newLine: null, text: "soon gone" }]);
  });

  it("reads glob characters of the path literally", async () => {
    const brackets = (await between("20-spaces/onb/a[1].md", "two", "three")).body.data!;
    expect(brackets).toMatchObject({ status: "modified", added: 1, removed: 1 });
    expect((await between("20-spaces/onb/a*.md", "two", "three")).status).toBe(404);
  });

  it("answers 404 when neither commit has the file or a commit is unknown, and 400 for a malformed commit", async () => {
    expect((await between("20-spaces/onb/never.md", "two", "three")).status).toBe(404);
    expect((await between(PAGE, "two", "f".repeat(40))).status).toBe(404);
    expect((await between(PAGE, "f".repeat(40), "three")).status).toBe(404);
    expect((await between(PAGE, "two", "main")).status).toBe(400);
    expect((await between(PAGE, "two", "refs/heads/main")).status).toBe(400);
    expect((await compare(`path=${PAGE}&from=${shas["two"]}`)).status).toBe(400);
    expect((await compare(`from=${shas["two"]}&to=${shas["three"]}`)).status).toBe(400);
  });

  it("refuses a binary file with 415 and one over 2 MiB with 413, as the file route does", async () => {
    expect((await between("20-spaces/onb/blob.md", "two", "three")).status).toBe(415);
    expect((await between("20-spaces/onb/big.md", "three", "four")).status).toBe(413);
    expect((await between("20-spaces/onb/big.md", "four", "four")).status).toBe(413);
    expect((await between("20-spaces/onb", "two", "three")).status).toBe(400);
  });

  it("refuses unsafe paths and restricted/ as the file route does", async () => {
    expect((await between("../etc/passwd", "two", "three")).status).toBe(400);
    expect((await between("/abs.md", "two", "three")).status).toBe(400);
    expect((await between(".git/config", "two", "three")).status).toBe(400);
    expect((await between("restricted/secret.md", "three", "four")).status).toBe(403);
    expect((await between("a/Restricted/x.md", "three", "four")).status).toBe(403);
  });
});
