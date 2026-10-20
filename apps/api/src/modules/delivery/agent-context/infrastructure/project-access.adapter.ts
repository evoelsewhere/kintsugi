// Adapts the admin module's public Project Access use case to this feature's domain port.

import { Injectable } from "@nestjs/common";
import { ProjectAccessService } from "#modules/admin/project-access/index.js";
import { ProjectAccessPort } from "../domain/project-access.ports.js";

@Injectable()
export class ProjectAccessAdapter extends ProjectAccessPort {
  constructor(private readonly projects: ProjectAccessService) {
    super();
  }

  requireRead(userId: string, projectId: string): Promise<void> {
    return this.projects.requireRead(userId, projectId);
  }

  listReadableProjects(userId: string, projectIds: readonly string[]): Promise<{ projectId: string; name: string }[]> {
    return this.projects.listReadableProjects(userId, projectIds);
  }
}
