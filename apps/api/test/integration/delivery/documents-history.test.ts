// The versions of a document (ADR-0096 decision 5): the commits that changed a file, newest first, with the actor
// and minor flag a portal publish writes as trailers, across a rename, paged by a cursor. The mirror is a real bare
// repository built here, so the commit messages and the rename are real Git history.

import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { CheckoutStorage } from "@kintsugi/git";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Client, adminClient, currentUserId, grantProjectAccess, startTestApp, type TestApp } from "../../support/app.js";
import { hasDatabase } from "../../support/database.js";

interface Entry {
  sha: string;
  date: string;
  subject: string;
  actor: string;
  minor: boolean;
}
interface History {
  ref: string;
  commit: string;
  path: string;
  followsRenames: boolean;
  entries: Entry[];
  next: string | null;
}

const GUIDE = "20-spaces/onb/guide.md";
const HANDBOOK = "20-spaces/onb/handbook.md";
const PORTAL = "20-spaces/onb/portal.md";
/** The commit identity of a fresh installation (docs/reference/document-repo-commit-conventions.md). */
const BOT = { name: "kintsugi-bot", email: "kintsugi-bot@kintsugi.invalid" };
const text = (lines: number, extra = ""): string => `${Array.from({ length: lines }, (_, at) => `line ${at + 1} of a page long enough to be followed across a move`).join("\n")}\n${extra}`;

describe.skipIf(!hasDatabase)("history of a document (integration)", () => {
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
      env: { ...process.env, GIT_AUTHOR_NAME: "Ada Author", GIT_AUTHOR_EMAIL: "ada@example.com", GIT_COMMITTER_NAME: "Ada Author", GIT_COMMITTER_EMAIL: "ada@example.com" },
    }).trim();
  const write = async (path: string, content: string): Promise<void> => {
    await mkdir(dirname(join(work, path)), { recursive: true });
    await writeFile(join(work, path), content);
    git("add", path);
  };
  const commit = (name: string, message: string, author = "Ada Author", email = `${author.toLowerCase().replace(/\W+/g, ".")}@example.com`): void => {
    git("-c", `user.name=${author}`, "commit", "-q", "--author", `${author} <${email}>`, "-m", message);
    shas[name] = git("rev-parse", "HEAD");
  };
  const history = (query: string) => admin.get<History>(`/projects/shop/documents/history?${query}`);

  beforeAll(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "kintsugi-history-"));
    process.env["KINTSUGI_DATA_DIR"] = dataDir;
    work = join(dataDir, "work");
    await mkdir(work);
    git("init", "-q", "-b", "main");
    await write("README.md", "docs\n");
    commit("init", "init");
    await write(GUIDE, text(12));
    commit("create", "Create the onboarding guide");
    await write(GUIDE, text(12, "A typo fixed.\n"));
    commit("typo", "Fix a typo\n\nKintsugi-Actor: grace\nKintsugi-Minor: true\nKintsugi-Page: PAGE-ONB-0001", BOT.name, BOT.email);
    await write("20-spaces/onb/other.md", "unrelated\n");
    commit("other", "Add another page");
    git("mv", GUIDE, HANDBOOK);
    commit("move", "Move the guide to the handbook");
    await write(HANDBOOK, text(12, "A typo fixed.\nA new section.\n"));
    // A member's own commit may write any trailer; it is not believed.
    commit("expand", "Expand the handbook\n\nKintsugi-Actor: linus\nKintsugi-Minor: true");
    // Pages published from the portal by Kintsugi, and commits that only look like them.
    await write(PORTAL, "one\n");
    commit("portal-one", "Publish from the portal\n\nKintsugi-Actor: linus\nKintsugi-Minor: true", BOT.name, BOT.email);
    await write(PORTAL, "two\n");
    commit("portal-forged", "Forged\n\nKintsugi-Actor: alice\nKintsugi-Minor: true", "Mallory", "mallory@example.com");
    await write(PORTAL, "three\n");
    commit("portal-name-only", "Same name, other address\n\nKintsugi-Actor: bob\nKintsugi-Minor: true", BOT.name, "kintsugi-bot@example.com");
    await write(PORTAL, "four\n");
    commit("portal-upper", "Address in another case\n\nKintsugi-Actor: carol", BOT.name, BOT.email.toUpperCase());
    await write(PORTAL, "five\n");
    commit("portal-doc-bot", "Written by the identity set later\n\nKintsugi-Actor: dana\nKintsugi-Minor: true", "Doc Bot", "doc-bot@example.com");
    // Windows-awkward and glob-like names are one literal path.
    await write("20-spaces/onb/a[1].md", "x\n");
    await write("20-spaces/onb/a1.md", "x\n");
    commit("globs", "Add two pages");
    git("branch", "feature", shas["typo"] ?? "HEAD");
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

  it("lists the commits that changed the file, newest first, across its rename", async () => {
    const response = await history(`path=${HANDBOOK}`);
    expect(response.status).toBe(200);
    const data = response.body.data!;
    expect(data).toMatchObject({ path: HANDBOOK, followsRenames: true, next: null, commit: shas["globs"] });
    expect(data.entries.map((entry) => entry.subject)).toEqual(["Expand the handbook", "Move the guide to the handbook", "Fix a typo", "Create the onboarding guide"]);
    expect(data.entries.map((entry) => entry.sha)).toEqual([shas["expand"], shas["move"], shas["typo"], shas["create"]]);
    for (const entry of data.entries) expect(Number.isNaN(Date.parse(entry.date))).toBe(false);
    // Newest first by date as well.
    const dates = data.entries.map((entry) => Date.parse(entry.date));
    expect(dates).toEqual([...dates].sort((a, b) => b - a));
  });

  it("names the actor of a commit Kintsugi made from its trailer and marks its minor edits, and believes no trailer of any other commit", async () => {
    const entries = (await history(`path=${HANDBOOK}`)).body.data!.entries;
    const byName = Object.fromEntries(entries.map((entry) => [entry.subject, entry]));
    expect(byName["Fix a typo"]).toMatchObject({ actor: "grace", minor: true });
    // a member's commit carrying Kintsugi-Actor and Kintsugi-Minor: its author, and not minor
    expect(byName["Expand the handbook"]).toMatchObject({ actor: "Ada Author", minor: false });
    expect(byName["Create the onboarding guide"]).toMatchObject({ actor: "Ada Author", minor: false });
    expect(byName["Move the guide to the handbook"]).toMatchObject({ actor: "Ada Author", minor: false });
  });

  it("trusts a trailer only on a commit whose author is the commit identity, whatever the case of its address", async () => {
    const byName = Object.fromEntries((await history(`path=${PORTAL}`)).body.data!.entries.map((entry) => [entry.subject, entry]));
    expect(byName["Publish from the portal"]).toMatchObject({ actor: "linus", minor: true });
    expect(byName["Address in another case"]).toMatchObject({ actor: "carol", minor: false });
    expect(byName["Forged"]).toMatchObject({ actor: "Mallory", minor: false });
    // the name alone is not the identity
    expect(byName["Same name, other address"]).toMatchObject({ actor: BOT.name, minor: false });
    expect(byName["Written by the identity set later"]).toMatchObject({ actor: "Doc Bot", minor: false });
  });

  it("follows the commit identity an administrator sets: its commits are believed from then on, the old identity's no longer", async () => {
    expect((await admin.request("PUT", "/admin/settings/commit-identity", { body: { name: "Doc Bot", email: "DOC-BOT@example.com" } })).status).toBe(200);
    const byName = Object.fromEntries((await history(`path=${PORTAL}`)).body.data!.entries.map((entry) => [entry.subject, entry]));
    expect(byName["Written by the identity set later"]).toMatchObject({ actor: "dana", minor: true });
    expect(byName["Publish from the portal"]).toMatchObject({ actor: BOT.name, minor: false });
    expect(byName["Forged"]).toMatchObject({ actor: "Mallory", minor: false });
    expect((await admin.request("PUT", "/admin/settings/commit-identity", { body: BOT })).status).toBe(200);
    expect(Object.fromEntries((await history(`path=${PORTAL}`)).body.data!.entries.map((entry) => [entry.subject, entry]))["Publish from the portal"]).toMatchObject({ actor: "linus", minor: true });
  });

  it("pages with a cursor: next is the before of the following page, and the pages join up", async () => {
    const first = (await history(`path=${HANDBOOK}&limit=3`)).body.data!;
    expect(first.entries.map((entry) => entry.subject)).toEqual(["Expand the handbook", "Move the guide to the handbook", "Fix a typo"]);
    expect(first.next).toBe(shas["typo"]);
    const second = (await history(`path=${HANDBOOK}&limit=3&before=${first.next}`)).body.data!;
    expect(second.entries.map((entry) => entry.subject)).toEqual(["Create the onboarding guide"]);
    expect(second.next).toBeNull();
    const exact = (await history(`path=${HANDBOOK}&limit=4`)).body.data!;
    expect(exact.entries).toHaveLength(4);
    expect(exact.next).toBeNull();
  });

  it("reads the history at another ref", async () => {
    const data = (await history(`path=${GUIDE}&ref=refs/heads/feature`)).body.data!;
    expect(data.commit).toBe(shas["typo"]);
    expect(data.entries.map((entry) => entry.subject)).toEqual(["Fix a typo", "Create the onboarding guide"]);
    expect((await history(`path=${GUIDE}&ref=${shas["create"]}`)).body.data!.entries.map((entry) => entry.subject)).toEqual(["Create the onboarding guide"]);
  });

  it("gives an empty list for a path no commit touched, and reads glob characters literally", async () => {
    const none = (await history("path=20-spaces/onb/never.md")).body.data!;
    expect(none).toMatchObject({ entries: [], next: null });
    const brackets = (await history("path=20-spaces/onb/a%5B1%5D.md")).body.data!;
    expect(brackets.entries.map((entry) => entry.subject)).toEqual(["Add two pages"]);
    const star = (await history("path=20-spaces/onb/a*.md")).body.data!;
    expect(star.entries).toEqual([]);
  });

  it("refuses unsafe paths, restricted/, unknown refs and cursors, and out-of-range limits", async () => {
    expect((await history("path=../etc/passwd")).status).toBe(400);
    expect((await history("path=/abs.md")).status).toBe(400);
    expect((await history("path=.git/config")).status).toBe(400);
    expect((await history("path=restricted/secret.md")).status).toBe(403);
    expect((await history("path=a/Restricted/x.md")).status).toBe(403);
    expect((await history("")).status).toBe(400);
    expect((await history(`path=${HANDBOOK}&ref=refs/heads/nope`)).status).toBe(404);
    expect((await history(`path=${HANDBOOK}&ref=nonsense`)).status).toBe(400);
    expect((await history(`path=${HANDBOOK}&before=${"0".repeat(40)}`)).status).toBe(404);
    expect((await history(`path=${HANDBOOK}&before=HEAD`)).status).toBe(400);
    expect((await history(`path=${HANDBOOK}&limit=0`)).status).toBe(400);
    expect((await history(`path=${HANDBOOK}&limit=201`)).status).toBe(400);
    expect((await history(`path=${HANDBOOK}&limit=200`)).status).toBe(200);
  });

  it("gives nothing after the root commit", async () => {
    const root = (await history("path=README.md")).body.data!;
    expect(root.entries.map((entry) => entry.subject)).toEqual(["init"]);
    expect((await history(`path=README.md&before=${shas["init"]}`)).body.data).toMatchObject({ entries: [], next: null });
  });
});
