import {
  GATE_KEY_PATTERN,
  PHASES,
  WORK_ITEM_STATUSES,
  type GateId,
  type Phase,
  type WorkItemFile,
  type WorkItemStatus,
} from "./index.js";
import { ITEM_SEGMENT_PATTERN } from "./catalog.js";
import { DomainValidationReader, type ValidationResult } from "./validation.js";

/** Activities a member can request from a task brief; these are not pipeline phases. */
export const MEMBER_ACTIVITIES = ["design", "implementation", "verification"] as const;
export type MemberActivity = (typeof MEMBER_ACTIVITIES)[number];

export type SourceAvailability = "present" | "missing";
export type SourcePublication = "draft" | "published" | "unknown";
export type SourceApproval = "approved" | "pending" | "rejected" | "unknown" | "not-required";

/** A task input with publication and approval represented as independent facts. */
export interface RequiredTaskInput {
  sourceId: string;
  role: string;
  requiredFor: readonly MemberActivity[];
  availability: SourceAvailability;
  publication: SourcePublication;
  approval: SourceApproval;
  /** The activity that produces this source; its output is not a prerequisite to begin. */
  producedBy?: MemberActivity;
}

export interface PredecessorGate {
  /** The unit whose gate is authoritative; omitted for a gate on the current unit. */
  unitId?: string;
  gateId: GateId | (string & {});
  status: "pending" | "approved" | "rejected" | "unknown";
  requiredFor: readonly MemberActivity[];
}

export type ReadinessBlockerCode =
  | "SOURCE_MISSING"
  | "SOURCE_DRAFT"
  | "SOURCE_PUBLICATION_UNKNOWN"
  | "SOURCE_APPROVAL_PENDING"
  | "SOURCE_APPROVAL_REJECTED"
  | "SOURCE_APPROVAL_UNKNOWN"
  | "GATE_PENDING"
  | "GATE_REJECTED"
  | "GATE_UNKNOWN";

export interface ReadinessBlocker {
  activity: MemberActivity;
  code: ReadinessBlockerCode;
  message: string;
  sourceId?: string;
  gateId?: string;
}

export interface ActivityReadiness {
  ready: boolean;
  blockers: ReadinessBlocker[];
}

export interface TaskReadinessInput {
  workItem: WorkItemFile;
  requiredInputs: readonly RequiredTaskInput[];
  predecessorGates: readonly PredecessorGate[];
}

/** Deterministic readiness projection for design, implementation and verification. */
export interface ReadinessResult {
  readyFor: MemberActivity[];
  blockers: ReadinessBlocker[];
  byActivity: Record<MemberActivity, ActivityReadiness>;
}

/** A full document-repository unit identity: application/module/unit. */
export function isFullUnitId(value: string): boolean {
  const segments = value.split("/");
  return segments.length === 3 && segments.every((segment) => ITEM_SEGMENT_PATTERN.test(segment));
}

/** Strictly validates unit frontmatter without trusting a tolerant YAML/view parser. */
export function parseWorkItemFile(value: unknown): ValidationResult<WorkItemFile> {
  const reader = new DomainValidationReader();
  const keys = [
    "id", "application", "module", "kind", "title", "wave", "pilot", "phase", "stage", "status",
    "assignee", "harness", "complexity", "dependsOn", "source", "target", "links", "gates",
  ];
  const source = reader.object(value, "", keys);
  if (source === undefined) return reader.result({} as WorkItemFile);

  const id = reader.string(source["id"], "id");
  const application = reader.string(source["application"], "application", { pattern: ITEM_SEGMENT_PATTERN });
  const module = reader.string(source["module"], "module", { pattern: ITEM_SEGMENT_PATTERN });
  const kind = reader.string(source["kind"], "kind");
  const title = reader.string(source["title"], "title");
  const phase = reader.oneOf(source["phase"], "phase", PHASES) as Phase | undefined;
  const status = reader.oneOf(source["status"], "status", WORK_ITEM_STATUSES) as WorkItemStatus | undefined;

  if (id !== undefined) {
    const segments = id.split("/");
    if (
      !isFullUnitId(id) ||
      (application !== undefined && segments[0] !== application) ||
      (module !== undefined && segments[1] !== module)
    ) {
      reader.problem("id", "must be the full application/module/unit identity matching its fields");
    }
  }

  const waveValue = source["wave"];
  let wave: number | string | undefined;
  if (waveValue !== undefined) {
    wave = typeof waveValue === "string" ? reader.string(waveValue, "wave") : reader.finiteNumber(waveValue, "wave");
  }
  const pilot = source["pilot"] === undefined ? undefined : reader.boolean(source["pilot"], "pilot");
  const stage = reader.optionalString(source["stage"], "stage");
  const assignee = reader.optionalString(source["assignee"], "assignee");
  const harness = reader.optionalString(source["harness"], "harness");
  const complexity = source["complexity"] === undefined
    ? undefined
    : reader.oneOf(source["complexity"], "complexity", ["low", "medium", "high"] as const);

  const dependsOn = source["dependsOn"] === undefined
    ? undefined
    : reader.strings(source["dependsOn"], "dependsOn", { unique: true });
  const sourceRefs = source["source"] === undefined ? undefined : parseRepositoryReferences(reader, source["source"], "source");
  const targetRefs = source["target"] === undefined ? undefined : parseRepositoryReferences(reader, source["target"], "target");
  const links = source["links"] === undefined ? undefined : parseWorkItemLinks(reader, source["links"]);
  const gates = source["gates"] === undefined ? undefined : parseWorkItemGates(reader, source["gates"]);

  const workItem: WorkItemFile = {
    id: id ?? "",
    application: application ?? "",
    module: module ?? "",
    kind: kind ?? "",
    title: title ?? "",
    phase: phase ?? PHASES[0],
    status: status ?? WORK_ITEM_STATUSES[0],
    ...(wave !== undefined ? { wave } : {}),
    ...(pilot !== undefined ? { pilot } : {}),
    ...(stage !== undefined ? { stage } : {}),
    ...(assignee !== undefined ? { assignee } : {}),
    ...(harness !== undefined ? { harness } : {}),
    ...(complexity !== undefined ? { complexity } : {}),
    ...(dependsOn !== undefined ? { dependsOn } : {}),
    ...(sourceRefs !== undefined ? { source: sourceRefs } : {}),
    ...(targetRefs !== undefined ? { target: targetRefs } : {}),
    ...(links !== undefined ? { links } : {}),
    ...(gates !== undefined ? { gates } : {}),
  };
  return reader.result(workItem);
}

function parseRepositoryReferences(
  reader: DomainValidationReader,
  value: unknown,
  path: string,
): { repo: string; paths: string[] }[] | undefined {
  const list = reader.array(value, path);
  if (list === undefined) return undefined;
  return list.map((entry, index) => {
    const at = path + "[" + index + "]";
    const item = reader.object(entry, at, ["repo", "paths"]);
    if (item === undefined) return { repo: "", paths: [] };
    return {
      repo: reader.string(item["repo"], at + ".repo") ?? "",
      paths: reader.strings(item["paths"], at + ".paths", { nonEmpty: true }) ?? [],
    };
  });
}

function parseWorkItemLinks(
  reader: DomainValidationReader,
  value: unknown,
): NonNullable<WorkItemFile["links"]> | undefined {
  const item = reader.object(value, "links", ["taskPack", "asIs", "mappings", "businessRules", "pullRequests"]);
  if (item === undefined) return undefined;
  const taskPack = reader.optionalString(item["taskPack"], "links.taskPack");
  const asIs = reader.optionalString(item["asIs"], "links.asIs");
  const mappings = item["mappings"] === undefined ? undefined : reader.strings(item["mappings"], "links.mappings", { unique: true });
  const businessRules = item["businessRules"] === undefined ? undefined : reader.strings(item["businessRules"], "links.businessRules", { unique: true });
  const pullRequests = item["pullRequests"] === undefined ? undefined : reader.strings(item["pullRequests"], "links.pullRequests", { unique: true });
  return {
    ...(taskPack !== undefined ? { taskPack } : {}),
    ...(asIs !== undefined ? { asIs } : {}),
    ...(mappings !== undefined ? { mappings } : {}),
    ...(businessRules !== undefined ? { businessRules } : {}),
    ...(pullRequests !== undefined ? { pullRequests } : {}),
  };
}

function parseWorkItemGates(
  reader: DomainValidationReader,
  value: unknown,
): NonNullable<WorkItemFile["gates"]> | undefined {
  const entries = reader.record(value, "gates");
  if (entries === undefined) return undefined;
  const result: Record<string, { status: "pending" | "approved" | "rejected"; by?: string; at?: string; review?: string }> = {};
  for (const [gateId, raw] of Object.entries(entries)) {
    const at = "gates." + gateId;
    if (!GATE_KEY_PATTERN.test(gateId)) reader.problem(at, "has an invalid gate key");
    const entry = reader.object(raw, at, ["status", "by", "at", "review"]);
    if (entry === undefined) continue;
    const gateStatus = reader.oneOf(entry["status"], at + ".status", ["pending", "approved", "rejected"] as const);
    const by = reader.optionalString(entry["by"], at + ".by");
    const date = reader.optionalString(entry["at"], at + ".at");
    const review = reader.optionalString(entry["review"], at + ".review");
    if (gateStatus !== undefined) {
      result[gateId] = {
        status: gateStatus,
        ...(by !== undefined ? { by } : {}),
        ...(date !== undefined ? { at: date } : {}),
        ...(review !== undefined ? { review } : {}),
      };
    }
  }
  return result;
}

/** Computes entry readiness without treating publication, task status or an exit gate as approval. */
export function evaluateReadiness(input: TaskReadinessInput): ReadinessResult {
  const byActivity = {} as Record<MemberActivity, ActivityReadiness>;
  const allBlockers: ReadinessBlocker[] = [];

  for (const activity of MEMBER_ACTIVITIES) {
    const blockers: ReadinessBlocker[] = [];
    for (const required of input.requiredInputs) {
      if (!required.requiredFor.includes(activity) || required.producedBy === activity) continue;
      if (required.availability === "missing") {
        blockers.push({
          activity,
          code: "SOURCE_MISSING",
          sourceId: required.sourceId,
          message: "Required source is missing: " + required.role,
        });
        continue;
      }
      if (required.publication === "draft") {
        blockers.push({
          activity,
          code: "SOURCE_DRAFT",
          sourceId: required.sourceId,
          message: "Required source is a draft: " + required.role,
        });
      } else if (required.publication === "unknown") {
        blockers.push({
          activity,
          code: "SOURCE_PUBLICATION_UNKNOWN",
          sourceId: required.sourceId,
          message: "Publication state is unknown for source: " + required.role,
        });
      }
      if (required.approval === "pending") {
        blockers.push({
          activity,
          code: "SOURCE_APPROVAL_PENDING",
          sourceId: required.sourceId,
          message: "Required source approval is pending: " + required.role,
        });
      } else if (required.approval === "rejected") {
        blockers.push({
          activity,
          code: "SOURCE_APPROVAL_REJECTED",
          sourceId: required.sourceId,
          message: "Required source was rejected: " + required.role,
        });
      } else if (required.approval === "unknown") {
        blockers.push({
          activity,
          code: "SOURCE_APPROVAL_UNKNOWN",
          sourceId: required.sourceId,
          message: "Approval state is unknown for source: " + required.role,
        });
      }
    }

    for (const gate of input.predecessorGates) {
      if (!gate.requiredFor.includes(activity) || gate.status === "approved") continue;
      const code = gate.status === "pending" ? "GATE_PENDING" : gate.status === "rejected" ? "GATE_REJECTED" : "GATE_UNKNOWN";
      blockers.push({
        activity,
        code,
        gateId: gate.gateId,
        message: "Required predecessor gate " + gate.gateId + " is " + gate.status,
      });
    }

    byActivity[activity] = { ready: blockers.length === 0, blockers };
    allBlockers.push(...blockers);
  }

  return {
    readyFor: MEMBER_ACTIVITIES.filter((activity) => byActivity[activity].ready),
    blockers: allBlockers,
    byActivity,
  };
}
