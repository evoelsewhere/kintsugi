// Domain contracts for the Coding Agent Workflow task projection. Git remains authoritative.

import type {
  PredecessorGate,
  ReadinessResult,
  RequiredTaskInput,
  WorkItemFile,
} from "@kintsugi/domain";

export interface TaskSourceRevision {
  repositoryId: string;
  commit: string;
}

export interface TaskSourceReference extends RequiredTaskInput {
  repositoryId: string;
  path: string;
  contentHash?: string;
}

export interface TaskIndexIssue {
  path: string;
  messages: string[];
}

export interface MemberTaskProjection {
  projectId: string;
  unitId: string;
  repositoryId: string;
  sourceCommit: string;
  sourcePath: string;
  sourceHash: string;
  workItem: WorkItemFile;
  requiredInputs: RequiredTaskInput[];
  sourceReferences: TaskSourceReference[];
  predecessorGates: PredecessorGate[];
}

export type AssignmentState = "unassigned" | "resolved" | "unresolved";

export interface IndexedMemberTask extends MemberTaskProjection {
  assignedUserId?: string;
  assignmentState: AssignmentState;
}

export interface ProjectTaskSnapshot extends TaskSourceRevision {
  projectId: string;
  tasks: MemberTaskProjection[];
  issues: TaskIndexIssue[];
}

export abstract class TaskSourceReader {
  abstract currentRevision(projectId: string): Promise<TaskSourceRevision>;
  abstract readProject(projectId: string, revision: TaskSourceRevision): Promise<ProjectTaskSnapshot>;
}

export abstract class TaskProjectionRepository {
  abstract indexRevision(projectId: string): Promise<TaskSourceRevision | undefined>;
  abstract replaceProject(snapshot: ProjectTaskSnapshot): Promise<void>;
  abstract list(projectId: string): Promise<IndexedMemberTask[]>;
  abstract get(projectId: string, unitId: string): Promise<IndexedMemberTask | undefined>;
}

export abstract class TaskApprovalEvidenceReader {
  abstract sourceApproval(projectId: string, path: string, commit: string): Promise<RequiredTaskInput["approval"]>;
  abstract predecessorStatus(
    projectId: string,
    unitId: string,
    gateId: PredecessorGate["gateId"],
    commit: string,
  ): Promise<PredecessorGate["status"]>;
}

export interface MemberTaskRecord extends IndexedMemberTask {
  readiness: ReadinessResult;
}
