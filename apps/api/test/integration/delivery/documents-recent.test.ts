// The recent changes of the document repo (ADR-0096): the newest commits that changed Markdown files, each with its
// files, paged by a cursor, and nothing of restricted/ — not a file, not a commit that only touched one, and not the
// name a file had when it was moved in or out of it. The mirror is a real bare repository built here.

import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { CheckoutStorage } from "@kintsugi/git";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Client, adminClient, currentUserId, grantProjectAccess, memberClient, startTestApp, type TestApp } from "../../support/app.js";
import { hasDatabase } from "../../support/database.js";

interface Recent {
  ref: string;
  commit: string;
  entries: Array<{ sha: string; date: string; subject: string; actor: string; minor: boolean; files: Array<{ path: string; previousPath: string | null; status: string }>; moreFiles: boolean }>;
  next: string | null;
}

const BOT = { name: "kintsugi-bot", email: "kintsugi-bot@kintsugi.invalid" };
const page = (name: string, extra = ""): string => `${Array.from({ length: 12 }, (_, at) => `line ${at + 1} of ${name}, long enough to be followed across a move`).join("\n")}\n${extra}`;

describe.skipIf(!hasDatabase)("recent changes (integration)", () => {
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
  const commit = (name: string, message: string, author = "Ada Author", email = "ada@example.com"): void => {
    git("-c", `user.name=${author}`, "commit", "-q", "--author", `${author} <${email}>`, "-m", message);
    shas[name] = git("rev-parse", "HEAD");
  };
  const recent = (query = "") => admin.get<Recent>(`/projects/shop/documents/recent${query === "" ? "" : `?${query}`}`);

  beforeAll(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "kintsugi-recent-"));
    process.env["KINTSUGI_DATA_DIR"] = dataDir;
    work = join(dataDir, "work");
    await mkdir(work);
    git("init", "-q", "-b", "main");
    await write("README.md", "docs\n");
    commit("init", "Start the repository");
    await write("20-spaces/onb/guide.md", page("guide"));
    commit("guide", "Create the guide");
    await write("restricted/vault.md", page("vault"));
    await write("20-spaces/onb/notes.txt", "not markdown\n");
    commit("vault-only", "Add private material");
    await write("20-spaces/onb/guide.md", page("guide", "A typo fixed.\n"));
    await write("restricted/vault.md", page("vault", "more\n"));
    commit("mixed", "Fix a typo");
    // A file moved out of restricted/ is new for the reader; its old path is not named.
    git("mv", "restricted/vault.md", "20-spaces/onb/published.md");
    commit("moved-in", "Publish a page");
    // A file moved into restricted/ is gone for the reader, under the path it had.
    git("mv", "20-spaces/onb/published.md", "restricted/published.md");
    commit("moved-out", "Withdraw a page");
    // An ordinary move names both paths.
    git("mv", "20-spaces/onb/guide.md", "20-spaces/onb/handbook.md");
    commit("renamed", "Rename the guide");
    await write("20-spaces/onb/portal.md", "one\n");
    commit("portal", "Publish from the portal\n\nKintsugi-Actor: linus\nKintsugi-Minor: true", BOT.name, BOT.email);
    await write("20-spaces/onb/forged.md", "two\n");
    commit("forged", "Forged\n\nKintsugi-Actor: alice\nKintsugi-Minor: true", "Mallory", "mallory@example.com");
    await write("20-spaces/onb/image.txt", "only a text file\n");
    commit("text-only", "Add a text file");
    git("branch", "feature", shas["mixed"] ?? "HEAD");
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

  it("lists the commits that changed Markdown files, newest first, with their files", async () => {
    const response = await recent();
    expect(response.status).toBe(200);
    const data = response.body.data!;
    expect(data).toMatchObject({ next: null, commit: shas["text-only"] });
    // The commit that only added a text file, and the one that only touched restricted/, are not there.
    expect(data.entries.map((entry) => entry.subject)).toEqual(["Forged", "Publish from the portal", "Rename the guide", "Withdraw a page", "Publish a page", "Fix a typo", "Create the guide", "Start the repository"]);
    expect(data.entries.map((entry) => entry.sha)).toEqual([shas["forged"], shas["portal"], shas["renamed"], shas["moved-out"], shas["moved-in"], shas["mixed"], shas["guide"], shas["init"]]);
    const dates = data.entries.map((entry) => Date.parse(entry.date));
    expect(dates).toEqual([...dates].sort((a, b) => b - a));
    const bySubject = Object.fromEntries(data.entries.map((entry) => [entry.subject, entry]));
    expect(bySubject["Create the guide"]?.files).toEqual([{ path: "20-spaces/onb/guide.md", previousPath: null, status: "added" }]);
    expect(bySubject["Rename the guide"]?.files).toEqual([{ path: "20-spaces/onb/handbook.md", previousPath: "20-spaces/onb/guide.md", status: "renamed" }]);
    expect(bySubject["Fix a typo"]?.files).toEqual([{ path: "20-spaces/onb/guide.md", previousPath: null, status: "modified" }]);
    expect(bySubject["Fix a typo"]?.moreFiles).toBe(false);
  });

  it("shows nothing of restricted/: no file, no commit that touched only it, and no name of a file moved in or out", async () => {
    const data = (await recent()).body.data!;
    const text = JSON.stringify(data);
    expect(text).not.toContain("restricted");
    expect(text).not.toContain("vault");
    expect(text).not.toContain("Add private material");
    const bySubject = Object.fromEntries(data.entries.map((entry) => [entry.subject, entry]));
    // moved out of restricted/: new, with no previous path; moved into it: deleted under the path it had before
    expect(bySubject["Publish a page"]?.files).toEqual([{ path: "20-spaces/onb/published.md", previousPath: null, status: "added" }]);
    expect(bySubject["Withdraw a page"]?.files).toEqual([{ path: "20-spaces/onb/published.md", previousPath: null, status: "deleted" }]);
  });

  it("names the actor of a commit Kintsugi made from its trailer and believes no other commit's", async () => {
    const bySubject = Object.fromEntries((await recent()).body.data!.entries.map((entry) => [entry.subject, entry]));
    expect(bySubject["Publish from the portal"]).toMatchObject({ actor: "linus", minor: true });
    expect(bySubject["Forged"]).toMatchObject({ actor: "Mallory", minor: false });
    expect(bySubject["Create the guide"]).toMatchObject({ actor: "Ada Author", minor: false });
  });

  it("pages with a cursor: next is the before of the following page, and the pages join up", async () => {
    const first = (await recent("limit=3")).body.data!;
    expect(first.entries.map((entry) => entry.subject)).toEqual(["Forged", "Publish from the portal", "Rename the guide"]);
    expect(first.next).toBe(shas["renamed"]);
    const second = (await recent(`limit=3&before=${first.next}`)).body.data!;
    expect(second.entries.map((entry) => entry.subject)).toEqual(["Withdraw a page", "Publish a page", "Fix a typo"]);
    expect(second.next).toBe(shas["mixed"]);
    const third = (await recent(`limit=3&before=${second.next}`)).body.data!;
    expect(third.entries.map((entry) => entry.subject)).toEqual(["Create the guide", "Start the repository"]);
    expect(third.next).toBeNull();
    expect((await recent("limit=8")).body.data!.next).toBeNull();
    // A cursor that is a commit of the mirror but not one of the list (the text-only commit): no commits.
    expect((await recent(`before=${shas["text-only"]}`)).body.data).toMatchObject({ entries: [], next: null });
  });

  it("reads another ref and refuses what is not in the mirror, or not a commit id", async () => {
    const data = (await recent("ref=refs/heads/feature")).body.data!;
    expect(data.commit).toBe(shas["mixed"]);
    expect(data.entries.map((entry) => entry.subject)).toEqual(["Fix a typo", "Create the guide", "Start the repository"]);
    expect((await recent(`before=${"0".repeat(40)}`)).status).toBe(404);
    expect((await recent("ref=refs/heads/nowhere")).status).toBe(404);
    expect((await recent("before=main")).status).toBe(400);
    expect((await recent("limit=201")).status).toBe(400);
    expect((await recent("limit=0")).status).toBe(400);
  });

  it("needs Project Access, administrators included", async () => {
    const { client: outsider } = await memberClient(app, admin, "recent-outsider", ["admin"], []);
    expect((await outsider.get("/projects/shop/documents/recent")).status).toBe(403);
    const { client: reader } = await memberClient(app, admin, "recent-reader", ["user"], ["shop"]);
    expect((await reader.get("/projects/shop/documents/recent")).status).toBe(200);
  });
});
