// Page attachments (ADR-0096 decision 6): the bytes of an allowed file in an `_attachments/` folder, with a content type
// the extension fixes, and nothing else. The mirror is a real bare repository built here; the files hold every byte
// value, so a text decoding anywhere on the way would change them.

import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { ATTACHMENT_EXTENSIONS } from "@kintsugi/domain";
import { CheckoutStorage } from "@kintsugi/git";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ATTACHMENT_MEDIA_TYPES, MAX_ATTACHMENT_BYTES } from "../../../src/modules/delivery/documents/domain/document.js";
import { type Client, adminClient, currentUserId, grantProjectAccess, startTestApp, type TestApp } from "../../support/app.js";
import { hasDatabase } from "../../support/database.js";

const FOLDER = "20-spaces/onb/_attachments";
/** Every byte value twice, so the file is neither valid UTF-8 nor free of NUL. */
const ALL_BYTES = Buffer.from(Array.from({ length: 512 }, (_, at) => at % 256));
const PDF = Buffer.concat([Buffer.from("%PDF-1.4\n"), ALL_BYTES, Buffer.from("\n%%EOF\n")]);

describe("attachment content types", () => {
  it("are fixed for exactly the types the layout allows", () => {
    expect(Object.keys(ATTACHMENT_MEDIA_TYPES).sort()).toEqual([...ATTACHMENT_EXTENSIONS].sort());
    expect(ATTACHMENT_MEDIA_TYPES["jpg"]).toBe(ATTACHMENT_MEDIA_TYPES["jpeg"]);
    expect(MAX_ATTACHMENT_BYTES).toBe(5 * 1024 * 1024);
  });
});

describe.skipIf(!hasDatabase)("page attachments (integration)", () => {
  let app: TestApp;
  let admin: Client;
  let dataDir: string;
  let work: string;
  let first: string;
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
  const fetchAttachment = async (query: string): Promise<{ status: number; headers: Headers; bytes: Buffer }> => {
    const response = await fetch(`${app.baseUrl}/projects/shop/documents/attachment?${query}`, { headers: { cookie: admin.cookie ?? "" } });
    return { status: response.status, headers: response.headers, bytes: Buffer.from(await response.arrayBuffer()) };
  };
  const attachment = (path: string, ref?: string) => fetchAttachment(`path=${encodeURIComponent(path)}${ref === undefined ? "" : `&ref=${ref}`}`);

  beforeAll(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "kintsugi-attachment-"));
    process.env["KINTSUGI_DATA_DIR"] = dataDir;
    work = join(dataDir, "work");
    await mkdir(work);
    git("init", "-q", "-b", "main");
    await write("README.md", "docs\n");
    git("commit", "-q", "-m", "init");
    first = git("rev-parse", "HEAD");
    for (const name of ["a.png", "b.jpg", "c.jpeg", "d.gif", "e.webp", "UPPER.PNG"]) await write(`${FOLDER}/${name}`, ALL_BYTES);
    await write(`${FOLDER}/doc.pdf`, PDF);
    await write(`${FOLDER}/exact.png`, Buffer.alloc(MAX_ATTACHMENT_BYTES, 0x61));
    await write(`${FOLDER}/over.png`, Buffer.alloc(MAX_ATTACHMENT_BYTES + 1, 0x61));
    await write(`${FOLDER}/vector.svg`, '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(1)</script></svg>');
    await write(`${FOLDER}/page.html`, "<script>alert(1)</script>");
    await write(`${FOLDER}/notes.md`, "# notes\n");
    await write(`${FOLDER}/noextension`, "x");
    await write(`${FOLDER}/a.png.exe`, ALL_BYTES);
    await write(`${FOLDER}/nested/inner.png`, ALL_BYTES);
    await write(`${FOLDER}/_attachments/again.png`, ALL_BYTES);
    await write("20-spaces/onb/outside.png", ALL_BYTES);
    await write("_attachments/root.png", ALL_BYTES);
    await write("plugins/p/_attachments/a.png", ALL_BYTES);
    await write("restricted/_attachments/secret.png", ALL_BYTES);
    await write("10-applications/web/02-modern/_attachments/diagram.png", ALL_BYTES);
    git("commit", "-q", "-m", "attachments");
    await mkdir(join(dataDir, "mirrors"), { recursive: true });
    execFileSync("git", ["clone", "-q", "--bare", work, new CheckoutStorage(dataDir).mirror("local", "docs")]);

    app = await startTestApp();
    admin = await adminClient(app);
    await app.db.query("insert into admin.git_server (id, kind, name, base_url, auth_type) values ('local', 'plain-git', 'Local', 'http://127.0.0.1:1', 'none')");
    await app.db.query("insert into admin.git_repository (id, server_id, url, default_branch) values ('docs', 'local', 'http://127.0.0.1:1/docs.git', 'main')");
    expect((await admin.request("POST", "/admin/projects", { body: { id: "shop", name: "Shop", documentRepositoryId: "docs" } })).status).toBe(201);
    await grantProjectAccess(admin, "shop", await currentUserId(admin));
  }, 240_000);
  afterAll(async () => {
    await app?.close();
    await rm(dataDir, { recursive: true, force: true });
    if (previousDataDir === undefined) delete process.env["KINTSUGI_DATA_DIR"];
    else process.env["KINTSUGI_DATA_DIR"] = previousDataDir;
  });

  it.each([
    ["a.png", "image/png", "inline"],
    ["b.jpg", "image/jpeg", "inline"],
    ["c.jpeg", "image/jpeg", "inline"],
    ["d.gif", "image/gif", "inline"],
    ["e.webp", "image/webp", "inline"],
    ["UPPER.PNG", "image/png", "inline"],
    ["doc.pdf", "application/pdf", "attachment"],
  ])("serves %s with the type its extension fixes, byte for byte", async (name, contentType, disposition) => {
    const response = await attachment(`${FOLDER}/${name}`);
    expect(response.status, response.bytes.toString("utf8").slice(0, 300)).toBe(200);
    expect(response.headers.get("content-type")).toBe(contentType);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-disposition")).toBe(`${disposition}; filename="${name}"`);
    expect(response.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
    expect(response.bytes.equals(name === "doc.pdf" ? PDF : ALL_BYTES)).toBe(true);
  });

  it("serves a file of exactly 5 MiB and refuses one byte more with 413 and no bytes", async () => {
    const exact = await attachment(`${FOLDER}/exact.png`);
    expect(exact.status).toBe(200);
    expect(exact.bytes.length).toBe(MAX_ATTACHMENT_BYTES);
    const over = await attachment(`${FOLDER}/over.png`);
    expect(over.status).toBe(413);
    expect(over.bytes.length).toBeLessThan(1000);
    expect(over.headers.get("content-type")).toContain("application/json");
  });

  it("refuses SVG, HTML, Markdown and every other type with 415 and no bytes", async () => {
    for (const name of ["vector.svg", "page.html", "notes.md", "noextension", "a.png.exe"]) {
      const response = await attachment(`${FOLDER}/${name}`);
      expect(response.status, name).toBe(415);
      expect(response.headers.get("content-type"), name).toContain("application/json");
      expect(response.bytes.toString("utf8"), name).not.toContain("alert(1)");
    }
  });

  it("refuses a file outside an _attachments folder of a page, or in a nested one, with 400", async () => {
    for (const path of ["20-spaces/onb/outside.png", "_attachments/root.png", `${FOLDER}/nested/inner.png`, `${FOLDER}/_attachments/again.png`, "plugins/p/_attachments/a.png", "README.md", FOLDER]) {
      expect((await attachment(path)).status, path).toBe(400);
    }
  });

  it("refuses unsafe paths and restricted/ as the file route does", async () => {
    for (const path of ["../outside/_attachments/a.png", "/abs/_attachments/a.png", ".git/_attachments/a.png"]) expect((await attachment(path)).status, path).toBe(400);
    expect((await attachment("restricted/_attachments/secret.png")).status).toBe(403);
    expect((await attachment("a/Restricted/_attachments/x.png")).status).toBe(403);
    expect((await fetchAttachment("")).status).toBe(400);
  });

  it("answers 404 for a missing file, an unknown ref, and a file not yet there at an older commit", async () => {
    expect((await attachment(`${FOLDER}/missing.png`)).status).toBe(404);
    expect((await attachment(`${FOLDER}/a.png`, "refs/heads/nope")).status).toBe(404);
    expect((await attachment(`${FOLDER}/a.png`, first)).status).toBe(404);
    expect((await attachment(`${FOLDER}/a.png`, "main")).status).toBe(400);
  });

  it("refuses a file name the layout does not allow, glob characters and spaces included, and serves attachments of a stage's folder", async () => {
    for (const name of ["glob[1].png", "glob*.png", "with space.png", ".hidden.png"]) expect((await attachment(`${FOLDER}/${name}`)).status, name).toBe(400);
    expect((await attachment("10-applications/web/02-modern/_attachments/diagram.png")).status).toBe(200);
  });
});
