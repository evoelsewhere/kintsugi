import type { ProjectMemoryView } from "@kintsugi/domain";

export abstract class ProjectMemoryRepository {
  abstract view(projectId: string, offset: number, limit: number): Promise<ProjectMemoryView | undefined>;
  abstract configure(projectId: string, enabled: boolean): Promise<void>;
  abstract reset(projectId: string): Promise<void>;
  abstract forgetManaged(projectId: string, id: string): Promise<{ recoveryId: string } | undefined>;
  abstract restoreManaged(projectId: string, recoveryId: string): Promise<{ id: string } | undefined>;
  abstract review(projectId: string, id: string, state: "approved" | "rejected", actor: string): Promise<boolean>;
}
