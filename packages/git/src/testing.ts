// Test support (`@kintsugi/git/testing`): a local Git smart-HTTP server — `git http-backend`
// behind a tiny CGI bridge on 127.0.0.1, serving fixture repositories over plain http
// (anonymous; pushes allowed). For integration tests only; never used by the product.

import { execFileSync, spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export interface GitHttpServer {
  /** Base URL, e.g. http://127.0.0.1:1234 — repositories live at `${baseUrl}/<name>.git`. */
  baseUrl: string;
  /** Creates a bare repository with one commit on `branch`. */
  createRepository(name: string, branch?: string): Promise<void>;
  /** Adds a commit to `branch` (on top of its current tip) of an existing repository and returns its id. */
  commit(name: string, file: string, content: string, branch?: string): Promise<string>;
  /** Runs git in the server-side bare repository, e.g. `show main:README.md`; returns stdout. */
  git(name: string, ...args: string[]): string;
  close(): Promise<void>;
}

const fixtureGit = (cwd: string, ...args: string[]): void => {
  execFileSync("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "core.autocrlf=false", ...args], { cwd });
};

export async function startGitHttpServer(): Promise<GitHttpServer> {
  const root = await mkdtemp(join(tmpdir(), "kintsugi-git-http-"));
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    const cgi = spawn("git", ["http-backend"], {
      env: {
        ...process.env,
        GIT_PROJECT_ROOT: root,
        GIT_HTTP_EXPORT_ALL: "1",
        PATH_INFO: decodeURIComponent(url.pathname),
        QUERY_STRING: url.search.slice(1),
        REQUEST_METHOD: request.method ?? "GET",
        CONTENT_TYPE: request.headers["content-type"] ?? "",
        HTTP_CONTENT_ENCODING: request.headers["content-encoding"] ?? "",
        GIT_PROTOCOL: String(request.headers["git-protocol"] ?? ""),
        REMOTE_ADDR: "127.0.0.1",
        // http-backend accepts pushes (receive-pack) from an authenticated user only.
        REMOTE_USER: "kintsugi-test",
      },
    });
    request.pipe(cgi.stdin);
    const chunks: Buffer[] = [];
    cgi.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    cgi.on("close", () => {
      // CGI output: headers, a blank line, then the body.
      const output = Buffer.concat(chunks);
      const split = output.indexOf("\r\n\r\n");
      const headerText = output.subarray(0, split).toString("latin1");
      let status = 200;
      for (const line of headerText.split("\r\n")) {
        const [name, ...rest] = line.split(":");
        const value = rest.join(":").trim();
        if (name === undefined || value === "") continue;
        if (name.toLowerCase() === "status") status = Number.parseInt(value, 10);
        else response.setHeader(name, value);
      }
      response.writeHead(status).end(output.subarray(split + 4));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    async createRepository(name, branch = "main") {
      const work = join(root, `${name}-work`);
      await mkdir(work);
      fixtureGit(work, "init", "-q", "-b", branch);
      await writeFile(join(work, "README.md"), `${name}\n`);
      fixtureGit(work, "add", "README.md");
      fixtureGit(work, "commit", "-q", "-m", "init");
      fixtureGit(root, "clone", "-q", "--bare", work, `${name}.git`);
    },
    async commit(name, file, content, branch = "main") {
      const work = join(root, `${name}-work`);
      // Start from the server's tip: someone (the code under test) may have pushed meanwhile.
      try {
        fixtureGit(work, "fetch", "-q", join(root, `${name}.git`), branch);
        fixtureGit(work, "checkout", "-q", "-B", branch, "FETCH_HEAD");
      } catch {
        fixtureGit(work, "checkout", "-q", "-B", branch);
      }
      await mkdir(dirname(join(work, file)), { recursive: true });
      await writeFile(join(work, file), content);
      fixtureGit(work, "add", file);
      fixtureGit(work, "commit", "-q", "-m", `write ${file}`);
      fixtureGit(work, "push", "-q", join(root, `${name}.git`), `HEAD:${branch}`);
      return execFileSync("git", ["rev-parse", "HEAD"], { cwd: work, encoding: "utf8" }).trim();
    },
    git(name, ...args) {
      return execFileSync("git", ["--git-dir", join(root, `${name}.git`), ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    },
    async close() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(root, { recursive: true, force: true });
    },
  };
}
