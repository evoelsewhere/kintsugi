// Application layer: installation settings. The commit identity is validated with the same
// rules the worker applies before committing (@kintsugi/git); the worker reads it per write and
// falls back to the defaults when it is unset.

import { BadRequestException, Injectable } from "@nestjs/common";
import { COMMIT_IDENTITY_SETTING, DEFAULT_COMMIT_IDENTITY, commitIdentityProblems } from "@kintsugi/git";
import { SANDBOX_SETTING, type SandboxSettings, resolveSandbox, sandboxProblems } from "@kintsugi/domain";
import { AUDIT_ACTIONS, AuditTrail, auditRecord } from "#common/audit/audit-trail.js";
import type { Actor } from "#common/auth/decorators.js";
import {
  CODING_AGENT_CONNECTION_LIFETIME_SETTING,
  DEFAULT_CODING_AGENT_CONNECTION_LIFETIME,
  type CodingAgentConnectionLifetime,
  type CodingAgentConnectionLifetimeView,
  type CommitIdentity,
  type CommitIdentityView,
  InstallationSettings,
  type SandboxSettingsView,
} from "../domain/installation-settings.js";

@Injectable()
export class InstallationSettingsService {
  constructor(
    private readonly settings: InstallationSettings,
    private readonly audit: AuditTrail,
  ) {}

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

  /** The sandbox settings in effect: what an administrator stored, field by field, else the defaults (ADR-0055). */
  async sandbox(): Promise<SandboxSettingsView> {
    const stored = await this.settings.get<unknown>(SANDBOX_SETTING);
    return {
      ...resolveSandbox(stored?.value),
      isDefault: stored === undefined,
      ...(stored?.updatedBy === undefined ? {} : { updatedBy: stored.updatedBy }),
      ...(stored === undefined ? {} : { updatedAt: stored.updatedAt }),
    };
  }

  async setSandbox(input: SandboxSettings, actor: Actor): Promise<SandboxSettingsView> {
    const problems = sandboxProblems(input);
    if (problems.length > 0) throw new BadRequestException(problems);
    const settings: SandboxSettings = {
      checkoutHours: input.checkoutHours,
      retentionDays: input.retentionDays,
      scriptTimeoutSec: input.scriptTimeoutSec,
      agentTimeoutSec: input.agentTimeoutSec,
      agentIdleTimeoutSec: input.agentIdleTimeoutSec,
      maxOutputBytes: input.maxOutputBytes,
      maxTurns: input.maxTurns,
      maxCostUsd: input.maxCostUsd,
      markReadOnly: input.markReadOnly,
    };
    await this.settings.put(SANDBOX_SETTING, settings, actor.username ?? actor.id);
    // Numbers and a switch, no secrets.
    await this.audit.recordChange(auditRecord(actor, AUDIT_ACTIONS.sandboxUpdate, { subject: SANDBOX_SETTING, detail: { ...settings } }));
    return this.sandbox();
  }

  async setCommitIdentity(input: CommitIdentity, actor: Actor): Promise<CommitIdentityView> {
    const identity = { name: input.name.trim(), email: input.email.trim() };
    const problems = commitIdentityProblems(identity);
    if (problems.length > 0) throw new BadRequestException(problems.map((problem) => `Commit identity: ${problem}`));
    await this.settings.put(COMMIT_IDENTITY_SETTING, identity, actor.username ?? actor.id);
    // Name and email are public commit metadata, not secrets.
    await this.audit.recordChange(auditRecord(actor, AUDIT_ACTIONS.commitIdentityUpdate, { subject: COMMIT_IDENTITY_SETTING, detail: identity }));
    return this.commitIdentity();
  }

  async codingAgentConnectionLifetime(): Promise<CodingAgentConnectionLifetimeView> {
    const stored = await this.settings.get<{ maxAgeDays?: unknown }>(CODING_AGENT_CONNECTION_LIFETIME_SETTING);
    const maxAgeDays = stored?.value.maxAgeDays;
    if (stored === undefined || (maxAgeDays !== 15 && maxAgeDays !== 30)) {
      return { maxAgeDays: DEFAULT_CODING_AGENT_CONNECTION_LIFETIME, isDefault: true };
    }
    return {
      maxAgeDays,
      isDefault: false,
      ...(stored.updatedBy === undefined ? {} : { updatedBy: stored.updatedBy }),
      updatedAt: stored.updatedAt,
    };
  }

  async setCodingAgentConnectionLifetime(maxAgeDays: CodingAgentConnectionLifetime, actor: Actor): Promise<CodingAgentConnectionLifetimeView> {
    if (maxAgeDays !== 15 && maxAgeDays !== 30) {
      throw new BadRequestException("Coding Agent Workflow connection age must be 15 or 30 days.");
    }
    await this.settings.put(CODING_AGENT_CONNECTION_LIFETIME_SETTING, { maxAgeDays }, actor.username ?? actor.id);
    await this.audit.recordChange(
      auditRecord(actor, AUDIT_ACTIONS.codingAgentConnectionLifetimeUpdate, {
        subject: CODING_AGENT_CONNECTION_LIFETIME_SETTING,
        detail: { maxAgeDays },
      }),
    );
    return this.codingAgentConnectionLifetime();
  }
}
