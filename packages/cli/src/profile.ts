import { lstat, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";

export interface Profile {
  id: string;
  baseUrl: string;
  projectId?: string;
  caFile?: string;
}

export interface ProfileConfig {
  schemaVersion: "1";
  activeProfile?: string;
  profiles: Record<string, Profile>;
}

export interface ProfileStore {
  load(): Promise<ProfileConfig>;
  save(config: ProfileConfig): Promise<void>;
}

export class CliError extends Error {
  readonly code: string;
  readonly status?: number;
  constructor(code: string, message: string, status?: number) {
    super(message);
    this.name = "CliError";
    this.code = code;
    this.status = status;
  }
}

/** The profile of one project on one installation: `connect`, `init`, `login` and the plugin commands all find it by this name. */
export function stableProjectProfileId(baseUrl: string, projectId: string): string {
  return `kintsugi-${createHash("sha256").update(`${baseUrl}\0${projectId}`, "utf8").digest("hex").slice(0, 12)}`;
}

export function isProfileId(value: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(value);
}

export function validateInstallationUrl(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new CliError("INVALID_INSTALLATION_URL", "Installation URL is invalid"); }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new CliError("HTTPS_REQUIRED", "Installation URL must use HTTPS (HTTP is allowed only for loopback)");
  }
  if (url.username || url.password || url.search || url.hash) throw new CliError("INVALID_INSTALLATION_URL", "Installation URL cannot contain credentials, query, or fragment");
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString().replace(/\/$/, "");
}

export function defaultConfigPath(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string {
  if (platform === "win32") return join(env.APPDATA || join(homedir(), "AppData", "Roaming"), "Kintsugi", "config.json");
  if (platform === "darwin") return join(homedir(), "Library", "Application Support", "Kintsugi", "config.json");
  const xdg = env.XDG_CONFIG_HOME;
  return join(xdg !== undefined && xdg.startsWith("/") ? xdg : join(homedir(), ".config"), "kintsugi", "config.json");
}

function emptyConfig(): ProfileConfig { return { schemaVersion: "1", profiles: {} }; }

function parseConfig(value: unknown): ProfileConfig {
  if (value === null || typeof value !== "object") throw new CliError("PROFILE_CONFIG_INVALID", "Kintsugi profile file is invalid");
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== "1" || record.profiles === null || typeof record.profiles !== "object" || Array.isArray(record.profiles)) {
    throw new CliError("PROFILE_CONFIG_INVALID", "Kintsugi profile file uses an unsupported format");
  }
  const profiles: Record<string, Profile> = {};
  for (const [id, raw] of Object.entries(record.profiles)) {
    if (!isProfileId(id) || raw === null || typeof raw !== "object") throw new CliError("PROFILE_CONFIG_INVALID", "Kintsugi profile file contains an invalid profile");
    const item = raw as Record<string, unknown>;
    if (item.id !== id || typeof item.baseUrl !== "string") throw new CliError("PROFILE_CONFIG_INVALID", "Kintsugi profile file contains an invalid profile");
    const profile: Profile = { id, baseUrl: validateInstallationUrl(item.baseUrl) };
    if (item.projectId !== undefined) {
      if (typeof item.projectId !== "string" || item.projectId.length === 0) throw new CliError("PROFILE_CONFIG_INVALID", "Kintsugi profile file contains an invalid project");
      profile.projectId = item.projectId;
    }
    if (item.caFile !== undefined) {
      if (typeof item.caFile !== "string" || item.caFile.length === 0) throw new CliError("PROFILE_CONFIG_INVALID", "Kintsugi profile file contains an invalid CA file path");
      profile.caFile = item.caFile;
    }
    profiles[id] = profile;
  }
  const config: ProfileConfig = { schemaVersion: "1", profiles };
  if (record.activeProfile !== undefined) {
    if (typeof record.activeProfile !== "string" || profiles[record.activeProfile] === undefined) throw new CliError("PROFILE_CONFIG_INVALID", "Kintsugi active profile does not exist");
    config.activeProfile = record.activeProfile;
  }
  return config;
}

async function assertNotSymlink(path: string): Promise<void> {
  try {
    const info = await lstat(path);
    if (info.isSymbolicLink()) throw new CliError("PROFILE_PATH_UNSAFE", "Kintsugi profile path cannot be a symbolic link");
  } catch (error) {
    if (error instanceof CliError) throw error;
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

export class FileProfileStore implements ProfileStore {
  constructor(readonly path = defaultConfigPath()) {}

  async load(): Promise<ProfileConfig> {
    await assertNotSymlink(this.path);
    try {
      const data = await readFile(this.path, "utf8");
      let parsed: unknown;
      try { parsed = JSON.parse(data) as unknown; } catch { throw new CliError("PROFILE_CONFIG_INVALID", "Kintsugi profile file is not valid JSON"); }
      return parseConfig(parsed);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyConfig();
      throw error;
    }
  }

  async save(config: ProfileConfig): Promise<void> {
    const validated = parseConfig(config);
    const folder = dirname(this.path);
    await mkdir(folder, { recursive: true, mode: 0o700 });
    await assertNotSymlink(folder);
    await assertNotSymlink(this.path);
    const temporary = join(folder, `.config-${randomUUID()}.tmp`);
    const file = await open(temporary, "wx", 0o600);
    try {
      await file.writeFile(`${JSON.stringify(validated, null, 2)}\n`, "utf8");
      await file.sync();
    } finally { await file.close(); }
    try {
      await rename(temporary, this.path);
      if (process.platform !== "win32") {
        const installed = await open(this.path, "r+");
        try { await installed.chmod(0o600); } finally { await installed.close(); }
      }
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
  }
}

export function profileConfigPathFromEnv(env: NodeJS.ProcessEnv, cwd: string): string {
  const explicit = env.KINTSUGI_CONFIG;
  return explicit === undefined ? defaultConfigPath(env) : resolve(cwd, explicit);
}

/**
 * The installation the CLI came from: the installers write `install.json` beside the app folder (ADR-0070), so a
 * member does not retype the URL. Order: KINTSUGI_URL, the active profile, install.json.
 */
export async function defaultInstallationUrl(
  env: NodeJS.ProcessEnv,
  entrypoint: string | undefined,
  activeProfileUrl?: string,
): Promise<string | undefined> {
  const explicit = env.KINTSUGI_URL;
  if (explicit !== undefined && explicit !== "") return validateInstallationUrl(explicit);
  if (activeProfileUrl !== undefined) return activeProfileUrl;
  const home = env.KINTSUGI_HOME ?? (entrypoint === undefined ? undefined : resolve(dirname(entrypoint), "..", ".."));
  if (home === undefined) return undefined;
  try {
    const parsed = JSON.parse(await readFile(join(home, "install.json"), "utf8")) as { baseUrl?: unknown };
    return typeof parsed.baseUrl === "string" ? validateInstallationUrl(parsed.baseUrl) : undefined;
  } catch {
    return undefined;
  }
}
