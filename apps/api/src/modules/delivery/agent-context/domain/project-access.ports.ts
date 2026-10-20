// Domain port for checking current Project Access without depending on the admin module.

export abstract class ProjectAccessPort {
  abstract requireRead(userId: string, projectId: string): Promise<void>;
}
