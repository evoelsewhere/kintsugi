// Port for explicit project grants. Implementations live in infrastructure only.

export interface ProjectAccessGrant {
  projectId: string;
  userId: string;
  grantedAt: string;
  grantedBy?: string;
}

export abstract class ProjectAccessRepository {
  abstract list(projectId: string): Promise<ProjectAccessGrant[]>;
  abstract has(userId: string, projectId: string): Promise<boolean>;
  abstract projectExists(projectId: string): Promise<boolean>;
  abstract userExists(userId: string): Promise<boolean>;
  /** Returns true when this call created the grant. */
  abstract grant(projectId: string, userId: string, actorId: string): Promise<boolean>;
  /** Returns true when this call removed a grant. */
  abstract revoke(projectId: string, userId: string): Promise<boolean>;
}
