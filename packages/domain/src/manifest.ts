// kintsugi.yaml: the project manifest at the root of the document repo (ADR-0028,
// docs/reference/document-repo.md). Pure model and validator; YAML text is parsed and
// rendered by @kintsugi/manifest.
//
// Runtime values of index.ts are only read inside functions (import cycle, see project.ts).

import {
  type MemberHarnessId,
  MEMBER_HARNESSES,
  PHASES,
  type PipelineDefinition,
  REPOSITORY_ROLES,
  type StagePerformer,
} from "./index.js";
import { APPLICATION_REPOSITORY_ROLES, type ApplicationRepositoryRole, type ValidationProblem } from "./project.js";
import { DEFAULT_DOCUMENT_AUTO_COMMIT_PATHS } from "./document-layout.js";

export const MANIFEST_SCHEMA_VERSION = 1;

/** A repository as written in kintsugi.yaml: registered Git server id + path on that server. */
export interface ManifestRepositoryRef {
  server: string;
  path: string;
}

export interface ManifestRepository extends ManifestRepositoryRef {
  role: ApplicationRepositoryRole;
  /** Required for `target`, forbidden otherwise. */
  component?: string;
}

export interface ManifestApplication {
  id: string;
  name?: string;
  pipeline?: string;
  repos: ManifestRepository[];
}

export interface ManifestPolicy {
  harnesses: MemberHarnessId[];
  requireCommitTrailer: boolean;
}

/** A validated kintsugi.yaml, with defaults filled in. */
export interface KintsugiManifest {
  schemaVersion: typeof MANIFEST_SCHEMA_VERSION;
  project: { id: string; name: string; description?: string };
  document: ManifestRepositoryRef;
  unitKinds: string[];
  applications: ManifestApplication[];
  pipelines: PipelineDefinition[];
  autoCommitPaths: string[];
  policy: ManifestPolicy;
}

/** Paths committed straight to the default branch by kintsugi-bot (ADR-0019). */
export const DEFAULT_AUTO_COMMIT_PATHS: readonly string[] = DEFAULT_DOCUMENT_AUTO_COMMIT_PATHS;

/**
 * Whether a repository path (forward slashes, relative) matches a glob of `autoCommitPaths`:
 * `**` spans any number of folders (including none), `*` and `?` stay within one path segment.
 */
export function matchesPathGlob(path: string, glob: string): boolean {
  let source = "";
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i]!;
    if (char === "*" && glob[i + 1] === "*") {
      i++;
      if (glob[i + 1] === "/") {
        i++;
        source += "(?:.*/)?";
      } else {
        source += ".*";
      }
    } else if (char === "*") {
      source += "[^/]*";
    } else if (char === "?") {
      source += "[^/]";
    } else {
      source += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${source}$`).test(path);
}

/** Whether kintsugi-bot may commit `path` straight to the default branch (ADR-0019). */
export function isAutoCommitPath(path: string, autoCommitPaths: readonly string[]): boolean {
  return autoCommitPaths.some((glob) => matchesPathGlob(path, glob));
}

export type ManifestResult = { ok: true; manifest: KintsugiManifest } | { ok: false; problems: ValidationProblem[] };

const ID = /^[a-z0-9][a-z0-9-]*$/;

type Json = Record<string, unknown>;

/** Collects problems while reading untyped data; every reader returns undefined on a problem. */
class Reader {
  readonly problems: ValidationProblem[] = [];

  problem(path: string, message: string): undefined {
    this.problems.push({ path, message });
    return undefined;
  }

  object(value: unknown, path: string, keys: readonly string[]): Json | undefined {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return this.problem(path, "must be a mapping");
    for (const key of Object.keys(value)) {
      if (!keys.includes(key)) this.problem(join(path, key), `unknown key; expected one of ${keys.join(", ")}`);
    }
    return value as Json;
  }

  array(value: unknown, path: string, options: { nonEmpty?: boolean } = {}): unknown[] | undefined {
    if (!Array.isArray(value)) return this.problem(path, "must be a list");
    if (options.nonEmpty === true && value.length === 0) return this.problem(path, "must not be empty");
    return value;
  }

  string(value: unknown, path: string): string | undefined {
    if (typeof value !== "string" || value.trim() === "") return this.problem(path, "must be a non-empty string");
    return value.trim();
  }

  id(value: unknown, path: string): string | undefined {
    const text = this.string(value, path);
    if (text !== undefined && !ID.test(text)) return this.problem(path, `"${text}" must be lowercase kebab-case`);
    return text;
  }

  oneOf<T extends string>(value: unknown, path: string, allowed: readonly T[]): T | undefined {
    if (typeof value === "string" && (allowed as readonly string[]).includes(value)) return value as T;
    return this.problem(path, `must be one of ${allowed.join(", ")}`);
  }

  boolean(value: unknown, path: string): boolean | undefined {
    if (typeof value !== "boolean") return this.problem(path, "must be true or false");
    return value;
  }

  strings(value: unknown, path: string, options: { nonEmpty?: boolean } = {}): string[] | undefined {
    const list = this.array(value, path, options);
    if (list === undefined) return undefined;
    const result: string[] = [];
    const seen = new Set<string>();
    list.forEach((entry, index) => {
      const text = this.string(entry, `${path}[${index}]`);
      if (text === undefined) return;
      if (seen.has(text)) this.problem(`${path}[${index}]`, `duplicate "${text}"`);
      seen.add(text);
      result.push(text);
    });
    return result;
  }
}

const join = (path: string, key: string): string => (path === "" ? key : `${path}.${key}`);

/**
 * Validates parsed kintsugi.yaml data and fills defaults (`pipelines: []`,
 * `autoCommitPaths` per ADR-0019, `policy`). Reports every problem, not just the first.
 */
export function validateManifest(data: unknown): ManifestResult {
  const read = new Reader();
  const root = read.object(data, "", ["schemaVersion", "project", "document", "unitKinds", "applications", "pipelines", "autoCommitPaths", "policy"]);
  if (root === undefined) return { ok: false, problems: read.problems };

  if (root["schemaVersion"] !== MANIFEST_SCHEMA_VERSION) read.problem("schemaVersion", `must be ${MANIFEST_SCHEMA_VERSION}`);

  let project: KintsugiManifest["project"] | undefined;
  const projectData = read.object(root["project"], "project", ["id", "name", "description"]);
  if (projectData !== undefined) {
    const id = read.id(projectData["id"], "project.id");
    const name = read.string(projectData["name"], "project.name");
    const description = projectData["description"] === undefined ? undefined : read.string(projectData["description"], "project.description");
    if (id !== undefined && name !== undefined) project = { id, name, ...(description === undefined ? {} : { description }) };
  }

  const document = readRef(read, root["document"], "document", ["server", "path"]);
  const unitKinds = read.strings(root["unitKinds"], "unitKinds", { nonEmpty: true });

  const used = new Map<string, string>();
  if (document !== undefined) used.set(refKey(document), "document");
  const applications: ManifestApplication[] = [];
  const applicationIds = new Set<string>();
  read.array(root["applications"], "applications")?.forEach((entry, index) => {
    const application = readApplication(read, entry, `applications[${index}]`, used, applicationIds);
    if (application !== undefined) applications.push(application);
  });

  const pipelines: PipelineDefinition[] = [];
  if (root["pipelines"] !== undefined) {
    const ids = new Set<string>();
    read.array(root["pipelines"], "pipelines")?.forEach((entry, index) => {
      const pipeline = readPipeline(read, entry, `pipelines[${index}]`);
      if (pipeline === undefined) return;
      if (ids.has(pipeline.id)) read.problem(`pipelines[${index}].id`, `duplicate pipeline id "${pipeline.id}"`);
      ids.add(pipeline.id);
      pipelines.push(pipeline);
    });
  }

  const autoCommitPaths = root["autoCommitPaths"] === undefined ? [...DEFAULT_AUTO_COMMIT_PATHS] : read.strings(root["autoCommitPaths"], "autoCommitPaths");

  let policy: ManifestPolicy = { harnesses: [...MEMBER_HARNESSES], requireCommitTrailer: true };
  if (root["policy"] !== undefined) {
    const policyData = read.object(root["policy"], "policy", ["harnesses", "requireCommitTrailer"]);
    if (policyData !== undefined) {
      const harnesses = policyData["harnesses"] === undefined ? policy.harnesses : read.strings(policyData["harnesses"], "policy.harnesses", { nonEmpty: true });
      const trailer = policyData["requireCommitTrailer"] === undefined ? true : read.boolean(policyData["requireCommitTrailer"], "policy.requireCommitTrailer");
      if (harnesses !== undefined && trailer !== undefined) policy = { harnesses, requireCommitTrailer: trailer };
    }
  }

  if (read.problems.length > 0 || project === undefined || document === undefined || unitKinds === undefined || autoCommitPaths === undefined) {
    return { ok: false, problems: read.problems };
  }
  return {
    ok: true,
    manifest: { schemaVersion: MANIFEST_SCHEMA_VERSION, project, document, unitKinds, applications, pipelines, autoCommitPaths, policy },
  };
}

const refKey = (ref: ManifestRepositoryRef): string => `${ref.server}\u0000${ref.path.replace(/\/+$/, "").toLowerCase()}`;

function readRef(read: Reader, value: unknown, path: string, keys: readonly string[]): ManifestRepositoryRef | undefined {
  const data = read.object(value, path, keys);
  if (data === undefined) return undefined;
  const server = read.id(data["server"], join(path, "server"));
  const repoPath = read.string(data["path"], join(path, "path"));
  return server === undefined || repoPath === undefined ? undefined : { server, path: repoPath };
}

function readApplication(read: Reader, value: unknown, path: string, used: Map<string, string>, ids: Set<string>): ManifestApplication | undefined {
  const data = read.object(value, path, ["id", "name", "pipeline", "repos"]);
  if (data === undefined) return undefined;
  const id = read.id(data["id"], `${path}.id`);
  if (id !== undefined) {
    if (ids.has(id)) read.problem(`${path}.id`, `duplicate application id "${id}"`);
    ids.add(id);
  }
  const name = data["name"] === undefined ? undefined : read.string(data["name"], `${path}.name`);
  const pipeline = data["pipeline"] === undefined ? undefined : read.id(data["pipeline"], `${path}.pipeline`);

  const repos: ManifestRepository[] = [];
  const components = new Set<string>();
  read.array(data["repos"] ?? [], `${path}.repos`)?.forEach((entry, index) => {
    const at = `${path}.repos[${index}]`;
    const ref = readRef(read, entry, at, ["server", "path", "role", "component"]);
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return;
    const raw = entry as Json;
    if (raw["role"] === "document") {
      read.problem(`${at}.role`, "the document repo is declared once, under `document:` at project level");
      return;
    }
    const role = read.oneOf(raw["role"], `${at}.role`, APPLICATION_REPOSITORY_ROLES);
    let component: string | undefined;
    if (role === "target") {
      component = read.string(raw["component"], `${at}.component`);
      if (component !== undefined) {
        if (components.has(component)) read.problem(`${at}.component`, `another target repo already implements component "${component}"`);
        components.add(component);
      }
    } else if (role !== undefined && raw["component"] !== undefined) {
      read.problem(`${at}.component`, "only target repos have a component");
    }
    if (ref === undefined || role === undefined) return;
    const key = refKey(ref);
    const previous = used.get(key);
    if (previous !== undefined) read.problem(at, `${ref.server}:${ref.path} is already used by ${previous}`);
    used.set(key, at);
    repos.push({ ...ref, role, ...(component === undefined ? {} : { component }) });
  });

  if (id === undefined) return undefined;
  return { id, ...(name === undefined ? {} : { name }), ...(pipeline === undefined ? {} : { pipeline }), repos };
}

function readPipeline(read: Reader, value: unknown, path: string): PipelineDefinition | undefined {
  const data = read.object(value, path, ["id", "phases", "gates"]);
  if (data === undefined) return undefined;
  const id = read.id(data["id"], `${path}.id`);

  const phases: PipelineDefinition["phases"] = [];
  read.array(data["phases"], `${path}.phases`, { nonEmpty: true })?.forEach((entry, index) => {
    const at = `${path}.phases[${index}]`;
    const phase = read.object(entry, at, ["id", "category", "perUnit", "stages"]);
    if (phase === undefined) return;
    const phaseId = read.id(phase["id"], `${at}.id`);
    const builtIn = phaseId !== undefined && (PHASES as readonly string[]).includes(phaseId);
    const category =
      phase["category"] === undefined
        ? builtIn || phaseId === undefined
          ? undefined
          : read.problem(`${at}.category`, `custom phase "${phaseId}" needs a category: one of ${PHASES.join(", ")}`)
        : read.oneOf(phase["category"], `${at}.category`, PHASES);
    const perUnit = phase["perUnit"] === undefined ? undefined : read.boolean(phase["perUnit"], `${at}.perUnit`);
    const stages: PipelineDefinition["phases"][number]["stages"] = [];
    read.array(phase["stages"], `${at}.stages`, { nonEmpty: true })?.forEach((stageEntry, stageIndex) => {
      const stageAt = `${at}.stages[${stageIndex}]`;
      const stage = read.object(stageEntry, stageAt, ["id", "performer", "gate", "produces"]);
      if (stage === undefined) return;
      const stageId = read.id(stage["id"], `${stageAt}.id`);
      const performer = readPerformer(read, stage["performer"], `${stageAt}.performer`);
      const gate = stage["gate"] === undefined ? undefined : read.string(stage["gate"], `${stageAt}.gate`);
      const produces = stage["produces"] === undefined ? undefined : read.id(stage["produces"], `${stageAt}.produces`);
      if (stageId !== undefined && performer !== undefined) {
        stages.push({ id: stageId, performer, ...(gate === undefined ? {} : { gate }), ...(produces === undefined ? {} : { produces }) });
      }
    });
    if (phaseId !== undefined) {
      phases.push({ id: phaseId, ...(category === undefined ? {} : { category }), ...(perUnit === undefined ? {} : { perUnit }), stages });
    }
  });

  let gates: PipelineDefinition["gates"];
  if (data["gates"] !== undefined) {
    const gatesData = read.object(data["gates"], `${path}.gates`, Object.keys((data["gates"] as Json | null) ?? {}));
    if (gatesData !== undefined) {
      gates = {};
      for (const [gate, rule] of Object.entries(gatesData)) {
        const ruleData = read.object(rule, `${path}.gates.${gate}`, ["require"]);
        const require = ruleData === undefined ? undefined : read.strings(ruleData["require"], `${path}.gates.${gate}.require`);
        if (require !== undefined) gates[gate] = { require };
      }
    }
  }

  if (id === undefined) return undefined;
  return { id, phases,...(gates === undefined ? {} : { gates }) };
}

function readPerformer(read: Reader, value: unknown, path: string): StagePerformer | undefined {
  const data = read.object(value, path, ["agent", "member"]);
  if (data === undefined) return undefined;
  if (data["agent"] !== undefined && data["member"] === undefined) {
    const agent = read.string(data["agent"], `${path}.agent`);
    return agent === undefined ? undefined : { agent };
  }
  if (data["member"] !== undefined && data["agent"] === undefined) {
    const member = read.strings(data["member"], `${path}.member`, { nonEmpty: true });
    return member === undefined ? undefined : { member };
  }
  return read.problem(path, "must name either `agent: <runtime agent id>` or `member: [<project roles>]`");
}

/**
 * Path of a repository on its server, as written in kintsugi.yaml: the clone URL's path
 * relative to the server's base URL, without `.git`. `https://dev.azure.com/org/Billing/_git/web`
 * on `https://dev.azure.com/org` → `Billing/_git/web`; `git@github.com:org/app.git` → `org/app`.
 */
export function repositoryPath(url: string, serverBaseUrl: string): string {
  const trim = (path: string): string => path.replace(/^\/+|\/+$/g, "").replace(/\.git$/, "");
  const scp = /^[^@/\s]+@[^:/\s]+:(?!\/\/)(.*)$/.exec(url);
  if (scp !== null) return trim(scp[1]!);
  try {
    const parsed = new URL(url);
    let path = decodeURIComponent(parsed.pathname);
    try {
      const base = new URL(serverBaseUrl);
      const prefix = decodeURIComponent(base.pathname).replace(/\/+$/, "");
      if (base.hostname.toLowerCase() === parsed.hostname.toLowerCase() && prefix !== "" && path.toLowerCase().startsWith(`${prefix.toLowerCase()}/`)) {
        path = path.slice(prefix.length);
      }
    } catch {
      // No usable base URL: keep the full path.
    }
    return trim(path);
  } catch {
    return trim(url);
  }
}

/** Project state in the database, mapped to repository refs, from which a manifest is rendered. */
export interface ManifestSource {
  project: { id: string; name: string; description?: string };
  document: ManifestRepositoryRef;
  applications: ManifestApplication[];
  /** Fields the database does not manage yet; defaults are used when absent. */
  unitKinds?: string[];
  pipelines?: PipelineDefinition[];
  autoCommitPaths?: string[];
  policy?: ManifestPolicy;
}

/** Unit kind used when the project has not declared any. */
export const DEFAULT_UNIT_KINDS: readonly string[] = ["module"];

/** Builds the manifest for a project's database state (render only; see docs/reference/document-repo.md). */
export function manifestFromProject(source: ManifestSource): KintsugiManifest {
  const order = (role: string): number => (REPOSITORY_ROLES as readonly string[]).indexOf(role);
  return {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    project: { ...source.project },
    document: { ...source.document },
    unitKinds: [...(source.unitKinds ?? DEFAULT_UNIT_KINDS)],
    applications: source.applications.map((application) => ({
      ...application,
      repos: [...application.repos].sort((a, b) => order(a.role) - order(b.role) || (a.component ?? "").localeCompare(b.component ?? "") || a.path.localeCompare(b.path)),
    })),
    pipelines: [...(source.pipelines ?? [])],
    autoCommitPaths: [...(source.autoCommitPaths ?? DEFAULT_AUTO_COMMIT_PATHS)],
    policy: source.policy ?? { harnesses: [...MEMBER_HARNESSES], requireCommitTrailer: true },
  };
}
