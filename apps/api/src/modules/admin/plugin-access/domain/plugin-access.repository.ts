// Port for the use of member plugins per project. Implementations live in infrastructure only.

/** The grant that covers every member with Project Access to the project. */
export const ALL_MEMBERS = "*";

export interface PluginAccessGrant {
  projectId: string;
  pluginName: string;
  /** A user id, or ALL_MEMBERS. */
  userId: string;
  grantedAt: string;
  grantedBy?: string;
}

export abstract class PluginAccessRepository {
  abstract list(projectId: string): Promise<PluginAccessGrant[]>;
  /** The plugins a user may use in a project: granted to them or to all members. */
  abstract pluginsFor(userId: string, projectId: string): Promise<string[]>;
  abstract projectExists(projectId: string): Promise<boolean>;
  abstract userExists(userId: string): Promise<boolean>;
  /** Returns true when this call created the grant. */
  abstract grant(projectId: string, pluginName: string, userId: string, actorId: string): Promise<boolean>;
  /** Returns true when this call removed a grant. */
  abstract revoke(projectId: string, pluginName: string, userId: string): Promise<boolean>;
}
