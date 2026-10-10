// Runs the system `git` binary for Kintsugi (ADR-0025): no shell, argument arrays, a
// timeout on every call, and a hardened environment. Credentials are supplied for one
// invocation only — never in URLs, remote config, process arguments or a credential store.

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** How Kintsugi authenticates to a Git server for one call. */
export type GitCredential =
  | { kind: "none" }
  /** HTTPS token. `username` defaults to "kintsugi"; most servers ignore it for tokens. */
  | { kind: "token"; token: string; username?: string }
  /** SSH private key (OpenSSH format); the server's host keys are checked against `knownHosts`. */
  | { kind: "ssh-key"; privateKey: string };

export interface GitRunOptions {
  cwd?: string;
  credential?: GitCredential;
  /** Pinned SSH host keys (known_hosts lines), stored with the Git server; required for SSH. */
  knownHosts?: string;
  /** Allows file:// and local paths — tests and one-off imports only. */
  allowFileProtocol?: boolean;
  /** Milliseconds; default 10 minutes. */
  timeoutMs?: number;
  /** Written to git's stdin. */
  input?: string;
}

export interface GitResult {
  stdout: string;
  stderr: string;
}

/** A failed git call. Messages are redacted: they never contain a credential. */
export class GitError extends Error {
  constructor(
    message: string,
    readonly exitCode: number | null,
    readonly stderr: string,
  ) {
    super(message);
    this.name = "GitError";
  }
}

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

interface Sandbox {
  root: string;
  home: string;
  hooks: string;
  globalConfig: string;
}

let sandbox: Promise<Sandbox> | undefined;

/** Per-process scratch: an empty HOME, an empty hooks directory and an empty global config. */
function gitSandbox(): Promise<Sandbox> {
  sandbox ??= (async () => {
    const root = await mkdtemp(join(tmpdir(), "kintsugi-git-"));
    const home = join(root, "home");
    const hooks = join(root, "hooks");
    const globalConfig = join(root, "gitconfig");
    await mkdir(home);
    await mkdir(hooks);
    await writeFile(globalConfig, "");
    return { root, home, hooks, globalConfig };
  })();
  return sandbox;
}

/** Paths inside GIT_SSH_COMMAND go through sh: forward slashes, double-quoted. */
const shPath = (path: string): string => `"${path.replaceAll("\\", "/")}"`;

// Reads the token from the environment of this call only; answers `get` and ignores `store`/`erase`.
const ENV_CREDENTIAL_HELPER =
  "!f() { test \"$1\" = get && printf 'username=%s\\npassword=%s\\n' \"$KINTSUGI_GIT_USERNAME\" \"$KINTSUGI_GIT_TOKEN\"; }; f";

/** Inherited variables that could redirect git or hand it other credentials. */
const isUnsafeInherited = (name: string): boolean => /^(GIT_|SSH_|GCM_)/i.test(name);

/**
 * Runs `git <args>` and resolves with its output, or rejects with a redacted GitError.
 * Repository hooks never run, only https and ssh are allowed (plus file when asked),
 * and git never prompts.
 */
export async function runGit(args: readonly string[], options: GitRunOptions = {}): Promise<GitResult> {
  const box = await gitSandbox();
  const credential = options.credential ?? { kind: "none" };
  const secrets: string[] = [];

  const config = [
    `core.hooksPath=${box.hooks}`,
    "protocol.allow=never",
    "protocol.https.allow=always",
    "protocol.ssh.allow=always",
    ...(options.allowFileProtocol === true ? ["protocol.file.allow=always"] : []),
    "submodule.recurse=false",
    "credential.helper=",
    ...(credential.kind === "token" ? [`credential.helper=${ENV_CREDENTIAL_HELPER}`] : []),
  ];

  const env: NodeJS.ProcessEnv = Object.fromEntries(Object.entries(process.env).filter(([name]) => !isUnsafeInherited(name)));
  Object.assign(env, {
    HOME: box.home,
    XDG_CONFIG_HOME: box.home,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: box.globalConfig,
    GIT_TERMINAL_PROMPT: "0",
    GCM_INTERACTIVE: "never",
    LC_ALL: "C",
  });

  if (credential.kind === "token") {
    secrets.push(credential.token);
    env["KINTSUGI_GIT_USERNAME"] = credential.username ?? "kintsugi";
    env["KINTSUGI_GIT_TOKEN"] = credential.token;
  }
  // SSH never trusts a host on first use: only the server's pinned keys, never ~/.ssh.
  if (credential.kind === "ssh-key" && (options.knownHosts ?? "").trim() === "") {
    throw new GitError("An ssh-key credential needs the server's pinned host keys (knownHosts).", null, "");
  }

  // Short-lived 0600 files (SSH key, known_hosts), removed when the call ends.
  const tempFiles: string[] = [];
  const tempFile = async (prefix: string, content: string): Promise<string> => {
    const path = join(box.root, `${prefix}-${randomBytes(8).toString("hex")}`);
    tempFiles.push(path);
    await writeFile(path, content.endsWith("\n") ? content : `${content}\n`, { mode: 0o600 });
    return path;
  };
  try {
    const knownHostsFile = await tempFile("known-hosts", options.knownHosts ?? "");
    const ssh = `ssh -o BatchMode=yes -o StrictHostKeyChecking=yes -o GlobalKnownHostsFile=/dev/null -o UserKnownHostsFile=${shPath(knownHostsFile)}`;
    env["GIT_SSH_COMMAND"] =
      credential.kind === "ssh-key" ? `${ssh} -o IdentitiesOnly=yes -i ${shPath(await tempFile("key", credential.privateKey))}` : ssh;

    const fullArgs = [...config.flatMap((entry) => ["-c", entry]), ...args];
    return await spawnGit(fullArgs, env, options, (text) => redact(text, secrets), args);
  } finally {
    await Promise.all(tempFiles.map((path) => rm(path, { force: true })));
  }
}

function spawnGit(
  fullArgs: string[],
  env: NodeJS.ProcessEnv,
  options: GitRunOptions,
  clean: (text: string) => string,
  shownArgs: readonly string[],
): Promise<GitResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", fullArgs, { cwd: options.cwd, env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let size = 0;
    let failure: string | undefined;

    const collect = (sink: Buffer[]) => (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_OUTPUT_BYTES) {
        failure ??= "output limit exceeded";
        child.kill();
        return;
      }
      sink.push(chunk);
    };
    child.stdout.on("data", collect(stdout));
    child.stderr.on("data", collect(stderr));

    const timer = setTimeout(() => {
      failure ??= `timed out after ${options.timeoutMs ?? DEFAULT_TIMEOUT_MS} ms`;
      child.kill();
    }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

    child.on("error", (error) => {
      clearTimeout(timer);
      reject(new GitError(clean(`git could not be started: ${error.message}`), null, ""));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const out = Buffer.concat(stdout).toString("utf8");
      const err = clean(Buffer.concat(stderr).toString("utf8"));
      const command = clean(`git ${shownArgs.join(" ")}`);
      if (failure !== undefined) {
        reject(new GitError(`${command}: ${failure}`, code, err));
      } else if (code !== 0) {
        reject(new GitError(`${command} failed (exit ${code}): ${err.trim().split("\n").at(-1) ?? ""}`, code, err));
      } else {
        resolve({ stdout: out, stderr: err });
      }
    });

    child.stdin.on("error", () => undefined); // git may exit before reading its input
    child.stdin.end(options.input ?? "");
  });
}

function redact(text: string, secrets: readonly string[]): string {
  let result = text;
  for (const secret of secrets) {
    if (secret.length > 0) result = result.split(secret).join("[redacted]");
  }
  // Credentials embedded in URLs (user:pass@host), wherever they came from.
  return result.replace(/(\b[a-z][a-z0-9+.-]*:\/\/)[^/@\s:]*:[^/@\s]*@/gi, "$1[redacted]@");
}
