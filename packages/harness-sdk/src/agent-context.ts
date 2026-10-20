import type {
  GateId,
  Phase,
  WorkItemStatus,
} from "@kintsugi/domain";
import type {

  MemberActivity,
  ReadinessBlocker,
  ReadinessResult,
  SourceApproval,
  SourceAvailability,
  SourcePublication,
} from "@kintsugi/domain";

export type AgentContextSchemaVersion = "1";

export interface ProjectQuery {
  schemaVersion?: AgentContextSchemaVersion;
  limit?: number;
  cursor?: string;
}

export interface TaskIdentity {
  schemaVersion?: AgentContextSchemaVersion;
  projectId: string;
  unitId: string;
}

export interface TaskQuery extends ProjectQuery {
  projectId: string;
  mine?: boolean;
  readyFor?: MemberActivity;
}

export interface TaskBriefQuery extends TaskIdentity {
  activity: MemberActivity;
  snapshotId?: string;
  maxBytes?: number;
}

export interface DocumentQuery extends TaskIdentity {
  snapshotId: string;
  sourceId: string;
  sectionId?: string;
  cursor?: string;
  maxBytes?: number;
}

export interface DocumentSearchQuery extends TaskIdentity {
  snapshotId: string;
  query: string;
  limit?: number;
  cursor?: string;
}

export interface ReviewQuery {
  schemaVersion?: AgentContextSchemaVersion;
  projectId: string;
  reviewId: string;
}

export interface TaskEventQuery extends TaskIdentity {
  afterEventId?: string;
  limit?: number;
}

export interface ListResult<T> {
  schemaVersion: AgentContextSchemaVersion;
  items: T[];
  limit: number;
  nextCursor?: string;
}

export interface ProjectSummary {
  projectId: string;
  name: string;
  role?: string;
}

export interface TaskSummary {
  projectId: string;
  unitId: string;
  title: string;
  phase: Phase;
  status: WorkItemStatus;
  assignee?: string;
  readiness: ReadinessResult;
}

export interface ContextSource {
  sourceId: string;
  role: string;
  repositoryId: string;
  path: string;
  availability: SourceAvailability;
  publication: SourcePublication;
  approval: { status: SourceApproval; recordId?: string };
  commit?: string;
  contentHash?: string;
}

export interface OmittedSection {
  sourceId: string;
  sectionId: string;
  required: boolean;
}

export interface ContextSection {
  sourceId: string;
  sectionId: string;
  title: string;
  text: string;
  required: boolean;
  citation: Citation;
}

export interface TaskBrief extends TaskIdentity {
  schemaVersion: AgentContextSchemaVersion;
  activity: MemberActivity;
  title: string;
  objective: string;
  acceptanceCriteria: string[];
  snapshotId: string;
  contextRevision: string;
  documentRepoCommit: string;
  sources: ContextSource[];
  requiredDeliverableIds: string[];
  readiness: ReadinessResult;
  blockers: ReadinessBlocker[];
  requiredContextStatus: "complete" | "partial";
  sections: ContextSection[];
  omittedSections: OmittedSection[];
  freshness: { isCurrent: boolean; observedAt: string; newerContextRevision?: string };
  fetchedAt: string;
  nextCursor?: string;
}

export interface Citation {
  sourceId: string;
  path: string;
  startLine?: number;
  endLine?: number;
}

export interface DocumentPage extends TaskIdentity {
  schemaVersion: AgentContextSchemaVersion;
  snapshotId: string;
  sourceId: string;
  repositoryId: string;
  commit: string;
  path: string;
  contentHash: string;
  text: string;
  citations: Citation[];
  complete: boolean;
  requiredSectionsRemaining: string[];
  nextCursor?: string;
}

export interface SourceHit {
  sourceId: string;
  sectionId: string;
  role: string;
  excerpt: string;
  citation: Citation;
}

export interface ReviewQueryResultIdentity {
  projectId: string;
  unitId: string;
}

export interface ReviewFinding {
  findingId: string;
  severity: "critical" | "high" | "medium" | "low" | "info";
  title: string;
  rationale: string;
  citation?: Citation;
  currentness: "current" | "superseded";
}

export interface ReviewReport extends ReviewQueryResultIdentity {
  schemaVersion: AgentContextSchemaVersion;
  reviewId: string;
  generation: number;
  currentness: "current" | "superseded" | "inconclusive";
  verdict: "pass" | "fail" | "inconclusive";
  reviewedHead: string;
  reviewedBase: string;
  mergeBase?: string;
  contextRevision: string;
  policyRevision: string;
  agentVersion: string;
  coverage: "complete" | "partial";
  findings: ReviewFinding[];
}

export interface TaskPullRequest {
  repositoryId: string;
  pullRequestId: string;
  state: "open" | "closed" | "merged" | "unknown";
  headRevision: string;
  updatedAt?: string;
}

export interface TaskGateStatus {
  gateId: GateId | (string & {});
  status: "pending" | "approved" | "rejected" | "unknown";
  publication: "pending" | "published" | "unknown";
}

export interface TaskStatus extends TaskIdentity {
  schemaVersion: AgentContextSchemaVersion;
  status: WorkItemStatus;
  pullRequests: TaskPullRequest[];
  currentReviewIds: string[];
  gates: TaskGateStatus[];
  nextAction: string;
}

export interface TaskEvent extends TaskIdentity {
  id: string;
  kind: string;
  occurredAt: string;
  metadata: Record<string, string | number | boolean | null>;
}

/** Shared member operations used by the CLI, local MCP adapter and API composition. */
export interface CodingAgentContextPort {
  listProjects(query: ProjectQuery): Promise<ListResult<ProjectSummary>>;
  listTasks(query: TaskQuery): Promise<ListResult<TaskSummary>>;
  briefTask(query: TaskBriefQuery): Promise<TaskBrief>;
  getDocument(query: DocumentQuery): Promise<DocumentPage>;
  searchDocuments(query: DocumentSearchQuery): Promise<ListResult<SourceHit>>;
  getReview(query: ReviewQuery): Promise<ReviewReport>;
  taskStatus(query: TaskIdentity): Promise<TaskStatus>;
  watchTask(query: TaskEventQuery, signal: AbortSignal): AsyncIterable<TaskEvent>;
}

/** Narrow feature flags let a local adapter omit capabilities it cannot really serve. */
export interface AgentContextCapabilities {
  reviews: boolean;
}
