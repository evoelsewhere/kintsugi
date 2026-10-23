import { spawn } from "node:child_process";

export const CREDENTIAL_SERVICE = "com.kintsugi.cli";

export interface CredentialStore {
  get(profileId: string): Promise<string | undefined>;
  set(profileId: string, value: string): Promise<void>;
  delete(profileId: string): Promise<void>;
}

interface KeyringEntry {
  getPassword(): string | null | undefined | Promise<string | null | undefined>;
  setPassword(value: string): void | Promise<void>;
  deletePassword(): boolean | void | Promise<boolean | void>;
}

export type EntryFactory = (service: string, account: string) => KeyringEntry;
export type SecretToolRunner = (args: string[], input?: string) => Promise<{ stdout: string }>;

function executeSecretTool(args: string[], input?: string): Promise<{ stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("secret-tool", args, { stdio: ["pipe", "pipe", "pipe"], windowsHide: true, shell: false });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.stdin.on("error", () => undefined);
    child.on("error", () => reject(new Error("Secret Service is unavailable")));
    child.on("close", (code) => {
      if (code !== 0) {
        if (args[0] === "lookup" && Buffer.concat(stdout).length === 0 && Buffer.concat(stderr).length === 0) return resolve({ stdout: "" });
        return reject(new Error("Secret Service operation failed"));
      }
      resolve({ stdout: Buffer.concat(stdout).toString("utf8") });
    });
    if (input !== undefined) child.stdin.end(input);
    else child.stdin.end();
  });
}

export class NativeCredentialStore implements CredentialStore {
  constructor(
    private readonly createEntry?: EntryFactory,
    private readonly platform: NodeJS.Platform = process.platform,
    private readonly runSecretTool: SecretToolRunner = executeSecretTool,
  ) {}

  private async entry(profileId: string): Promise<KeyringEntry> {
    if (this.platform === "linux") throw new Error("Linux credentials use Secret Service directly");
    if (this.createEntry !== undefined) return this.createEntry(CREDENTIAL_SERVICE, profileId);
    const { AsyncEntry } = await import("@napi-rs/keyring");
    return new AsyncEntry(CREDENTIAL_SERVICE, profileId);
  }

  private linuxArgs(action: "lookup" | "clear" | "store", profileId: string): string[] {
    const args: string[] = [action];
    if (action === "store") args.push("--label=Kintsugi CLI credential");
    args.push("service", CREDENTIAL_SERVICE, "profile", profileId);
    return args;
  }

  async get(profileId: string): Promise<string | undefined> {
    try {
      if (this.platform === "linux") {
        const result = await this.runSecretTool(this.linuxArgs("lookup", profileId));
        return result.stdout.replace(/\r?\n$/, "") || undefined;
      }
      return (await (await this.entry(profileId)).getPassword()) ?? undefined;
    } catch {
      throw new CredentialStoreError();
    }
  }

  async set(profileId: string, value: string): Promise<void> {
    try {
      if (this.platform === "linux") {
        await this.runSecretTool(this.linuxArgs("store", profileId), value);
        return;
      }
      await (await this.entry(profileId)).setPassword(value);
    } catch {
      throw new CredentialStoreError();
    }
  }

  async delete(profileId: string): Promise<void> {
    try {
      if (this.platform === "linux") {
        await this.runSecretTool(this.linuxArgs("clear", profileId));
        return;
      }
      await (await this.entry(profileId)).deletePassword();
    } catch {
      throw new CredentialStoreError();
    }
  }
}

export class CredentialStoreError extends Error {
  readonly code = "CREDENTIAL_STORE_UNAVAILABLE";
  constructor() { super("The operating system credential store is unavailable; no credential was saved"); this.name = "CredentialStoreError"; }
}
