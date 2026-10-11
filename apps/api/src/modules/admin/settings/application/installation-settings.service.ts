// Application layer: installation settings. The commit identity is validated with the same
// rules the worker applies before committing (@kintsugi/git); the worker reads it per write and
// falls back to the defaults when it is unset.

import { BadRequestException, Injectable } from "@nestjs/common";
import { COMMIT_IDENTITY_SETTING, DEFAULT_COMMIT_IDENTITY, commitIdentityProblems } from "@kintsugi/git";
import type { Actor } from "#common/auth/decorators.js";
import { type CommitIdentity, type CommitIdentityView, InstallationSettings } from "../domain/installation-settings.js";

@Injectable()
export class InstallationSettingsService {
  constructor(private readonly settings: InstallationSettings) {}

  async commitIdentity(): Promise<CommitIdentityView> {
    const stored = await this.settings.get<Partial<CommitIdentity>>(COMMIT_IDENTITY_SETTING);
    const value = stored?.value;
    if (stored === undefined || typeof value?.name !== "string" || typeof value.email !== "string") return { ...DEFAULT_COMMIT_IDENTITY, isDefault: true };
    return {
      name: value.name,
      email: value.email,
      isDefault: false,
      ...(stored.updatedBy === undefined ? {} : { updatedBy: stored.updatedBy }),
      updatedAt: stored.updatedAt,
    };
  }

  async setCommitIdentity(input: CommitIdentity, actor: Actor): Promise<CommitIdentityView> {
    const identity = { name: input.name.trim(), email: input.email.trim() };
    const problems = commitIdentityProblems(identity);
    if (problems.length > 0) throw new BadRequestException(problems.map((problem) => `Commit identity: ${problem}`));
    await this.settings.put(COMMIT_IDENTITY_SETTING, identity, actor.username ?? actor.id);
    return this.commitIdentity();
  }
}
