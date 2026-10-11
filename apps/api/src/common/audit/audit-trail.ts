// Shared kernel: the audit trail port. Use cases record who did what, when, on which subject
// through this one port (governance · audit binds it to governance.audit_event, append-only);
// feature modules inject `AuditTrail` without importing the audit module. Entries never carry
// the content that was acted on, credentials or key values: only ids, names and small detail.

import type { Actor } from "#common/auth/decorators.js";

/** Actions recorded in the audit log. New actions are added here (the portal lists them). */
export const AUDIT_ACTIONS = {
  restrictedRead: "restricted.read",
  stageRun: "stage.run",
  jobRunCancel: "job-run.cancel",
  manifestPublish: "manifest.publish",
  projectCreate: "project.create",
  projectUpdate: "project.update",
  projectDelete: "project.delete",
  applicationCreate: "application.create",
  applicationUpdate: "application.update",
  applicationDelete: "application.delete",
  repositoryLink: "repository.link",
  repositoryUnlink: "repository.unlink",
  gitServerCreate: "git-server.create",
  gitServerUpdate: "git-server.update",
  gitServerDelete: "git-server.delete",
  gitRepositoryCreate: "git-repository.create",
  gitRepositoryUpdate: "git-repository.update",
  gitRepositoryDelete: "git-repository.delete",
  llmProviderCreate: "llm-provider.create",
  llmProviderUpdate: "llm-provider.update",
  llmProviderDelete: "llm-provider.delete",
  modelBindingsSave: "model-bindings.save",
  agentCreate: "agent.create",
  agentUpdate: "agent.update",
  agentDelete: "agent.delete",
  agentEnable: "agent.enable",
  agentDisable: "agent.disable",
  agentImport: "agent.import",
  agentCopy: "agent.copy",
  agentRestore: "agent.restore",
  skillCreate: "skill.create",
  skillUpdate: "skill.update",
  skillDelete: "skill.delete",
  commitIdentityUpdate: "commit-identity.update",
  gateRequest: "gate.request",
  gateDecide: "gate.decide",
  roleCreate: "role.create",
  rolePermissionsUpdate: "role.permissions",
  roleDelete: "role.delete",
  userCreate: "user.create",
  userUpdate: "user.update",
  userPasswordReset: "user.password",
  userDelete: "user.delete",
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

/** Every action, sorted: the audit log's filter list. */
export const AUDIT_ACTION_LIST: readonly AuditAction[] = Object.values(AUDIT_ACTIONS).sort();

export interface AuditRecord {
  /** User id of who acted (or `system` for the worker). */
  actor: string;
  action: string;
  projectId?: string;
  /** What was acted on, e.g. a job run, project or agent id. */
  subject?: string;
  /** Small detail such as a path or changed field names; never content or secrets. */
  detail?: Record<string, unknown>;
}

export interface AuditTarget {
  projectId?: string | undefined;
  subject?: string | undefined;
  detail?: Record<string, unknown>;
}

/** An entry for `actor`; the sign-in name is kept in the detail for readability. */
export function auditRecord(actor: Actor, action: AuditAction, target: AuditTarget = {}): AuditRecord {
  return {
    actor: actor.id,
    action,
    ...(target.projectId === undefined ? {} : { projectId: target.projectId }),
    ...(target.subject === undefined ? {} : { subject: target.subject }),
    detail: { ...(target.detail ?? {}), ...(actor.username === undefined ? {} : { username: actor.username }) },
  };
}

/** The names of the fields a change touched (never their values): for update entries. */
export function changedFields(patch: object): string[] {
  return Object.entries(patch)
    .filter(([, value]) => value !== undefined)
    .map(([key]) => key)
    .sort();
}

export abstract class AuditTrail {
  /**
   * Fail-closed: appends the entries (all or none) and throws when they cannot be stored. Call
   * it before returning protected content (a restricted-record read): no entry, no content.
   */
  abstract record(entries: readonly AuditRecord[]): Promise<void>;

  /**
   * After a change succeeded: appends the entry and never throws (the change already happened;
   * a failed append is logged as an error so operators see the gap).
   */
  abstract recordChange(entry: AuditRecord): Promise<void>;
}
