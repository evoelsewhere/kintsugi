// Which files of a commit give a page id in their front matter (P2-029).

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CheckoutStorage, GitError, cloneMirror, findPageIdOwners, resolveCommit } from "../src/index.js";
import { type GitHttpServer, startGitHttpServer } from "../src/testing.js";

const remoteOptions = { allowHttp: true } as const;
const page = (id: string, body = "Text.\n"): string => `---\nid: ${id}\ntitle: A page\n---\n\n# A page\n\n${body}`;

let server: GitHttpServer;
let root: string;
let storage: CheckoutStorage;

beforeAll(async () => {
  server = await startGitHttpServer();
  root = await mkdtemp(join(tmpdir(), "kintsugi-git-page-ids-"));
  storage = new CheckoutStorage(root);
  await storage.prepare();
});
afterAll(async () => {
  await server?.close();
  if (root !== undefined) await rm(root, { recursive: true, force: true });
});

describe("findPageIdOwners", () => {
  it("finds the pages whose front matter holds the id, and no file that only mentions it", async () => {
    await server.createRepository("ids");
    await server.commitFiles("ids", [
      { path: "20-spaces/eng/a.md", content: page("PAGE-ENG-0001") },
      { path: "20-spaces/eng/quoted.md", content: page("PAGE-ENG-0002", "See PAGE-ENG-0001 and id: PAGE-ENG-0001 in the text.\n\n```yaml\n---\nid: PAGE-ENG-0001\n---\n```\n") },
      { path: "20-spaces/hr/B.MD", content: page("PAGE-ENG-0001") },
      { path: "20-spaces/hr/quoted-id.md", content: page('"PAGE-ENG-0001"') },
      { path: "20-spaces/hr/notes.txt", content: page("PAGE-ENG-0001") },
      { path: "20-spaces/hr/other.md", content: page("PAGE-ENG-0010") },
    ]);
    const mirror = storage.mirror("local", "ids");
    await cloneMirror(`${server.baseUrl}/ids.git`, mirror, { ...remoteOptions, partial: true });
    const head = await resolveCommit(mirror, "refs/heads/main");
    expect(await findPageIdOwners(mirror, head, "PAGE-ENG-0001")).toEqual(["20-spaces/eng/a.md", "20-spaces/hr/B.MD", "20-spaces/hr/quoted-id.md"]);
    expect(await findPageIdOwners(mirror, head, "PAGE-ENG-0002")).toEqual(["20-spaces/eng/quoted.md"]);
    expect(await findPageIdOwners(mirror, head, "PAGE-ENG-0099")).toEqual([]);
    await expect(findPageIdOwners(mirror, head, "not an id")).rejects.toThrow(GitError);
  });
});
