// `pnpm dev` / `make dev`: the turbo dev stack (API, worker, portal) and, when a Gitea binary is
// configured, a local Gitea beside it. GITEA_BIN (environment or the root .env) is the path of
// the gitea binary; without it only the stack starts. Gitea listens on GITEA_PORT (default 3300,
// where a "gitea" server of Settings → Git points) and keeps its data under GITEA_WORK_PATH
// (default .kintsugi/gitea, which is gitignored). Ctrl+C stops both.

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { connect } from "node:net";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";

const root = resolve(import.meta.dirname, "..");

/** KEY=VALUE lines of the root .env; the environment wins. */
function setting(name) {
  if (process.env[name] !== undefined && process.env[name] !== "") return process.env[name];
  const file = join(root, ".env");
  if (!existsSync(file)) return undefined;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (match?.[1] === name) return match[2].replace(/^(['"])(.*)\1$/, "$2");
  }
  return undefined;
}

const children = [];
const stopAll = () => {
  for (const child of children) child.kill();
};

const listening = (port) =>
  new Promise((done) => {
    const socket = connect({ port, host: "127.0.0.1" });
    socket.once("connect", () => {
      socket.destroy();
      done(true);
    });
    socket.once("error", () => done(false));
  });

async function startGitea() {
  const bin = setting("GITEA_BIN");
  if (bin === undefined) return;
  if (!existsSync(bin)) {
    console.warn(`[gitea] GITEA_BIN points to ${bin}, which does not exist: starting without Gitea.`);
    return;
  }
  const port = setting("GITEA_PORT") ?? "3300";
  if (await listening(Number(port))) {
    console.log(`[gitea] something already listens on port ${port}: not starting another Gitea.`);
    return;
  }
  const work = resolve(root, setting("GITEA_WORK_PATH") ?? ".kintsugi/gitea");
  mkdirSync(work, { recursive: true });
  const gitea = spawn(bin, ["web", "--port", port, "--work-path", work], { cwd: work, stdio: ["ignore", "pipe", "pipe"] });
  children.push(gitea);
  for (const stream of [gitea.stdout, gitea.stderr]) createInterface({ input: stream }).on("line", (line) => console.log(`[gitea] ${line}`));
  gitea.on("error", (error) => console.warn(`[gitea] could not start: ${error.message}`));
  gitea.on("exit", (code) => console.warn(`[gitea] stopped (exit ${code ?? "signal"}); the rest keeps running.`));
  console.log(`[gitea] http://localhost:${port} (data in ${work})`);
}

await startGitea();

const turbo = spawn(process.execPath, [join(root, "node_modules/turbo/bin/turbo"), "run", "dev", ...process.argv.slice(2)], { cwd: root, stdio: "inherit" });
children.push(turbo);
turbo.on("exit", (code) => {
  stopAll();
  process.exitCode = code ?? 1;
});
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    stopAll();
    process.exit();
  });
}
