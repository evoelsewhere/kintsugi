// Application layer for personal, project-scoped Coding Agent Workflow credentials.

import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { AUDIT_ACTIONS, AuditTrail, auditRecord } from "#common/audit/audit-trail.js";
import type { Actor } from "#common/auth/decorators.js";
import { hashToken } from "#common/security/token-hash.js";
import { InstallationSettingsService } from "#modules/admin/settings/index.js";
import { MemberTokenRepository, type MemberTokenMetadata } from "../domain/member-token.repository.js";

export const MEMBER_TOKEN_PREFIX = "knt_pat_";
export const MEMBER_OAUTH_ACCESS_PREFIX = "knt_caw_";
const MEMBER_TOKEN_PATTERN = /^knt_(?:pat|caw)_[A-Za-z0-9_-]{43}$/;

export function isMemberTokenCredential(token: string): boolean {
  return MEMBER_TOKEN_PATTERN.test(token);
}

export interface MemberPrincipal {
  readonly userId: string;
  readonly tokenId: string;
  readonly projectIds: readonly string[];
  readonly connectionId?: string;
  readonly credentialKind: "coding-agent-read";
}

@Injectable()
export class MemberTokenService {
  constructor(
    private readonly tokens: MemberTokenRepository,
    private readonly settings: InstallationSettingsService,
    private readonly audit: AuditTrail,
  ) {}

  listOwn(actor: Actor): Promise<MemberTokenMetadata[]> {
    this.#requireOwnTokenPermission(actor);
    return this.tokens.listByUser(actor.id);
  }

  async revoke(userId: string, tokenId: string, actor: Actor): Promise<void> {
    this.#requireOwnTokenPermission(actor);
    if (userId !== actor.id) throw new ForbiddenException("Tokens can only be managed by their owner");
    const revoked = await this.tokens.revoke(actor.id, tokenId);
    if (!revoked) throw new NotFoundException("Token not found");
    await this.audit.recordChange(auditRecord(actor, AUDIT_ACTIONS.memberTokenRevoke, { subject: tokenId }));
  }

  #requireOwnTokenPermission(actor: Actor): void {
    if (!actor.permissions.includes("tokens.manage-own")) throw new ForbiddenException("Missing permission: tokens.manage-own");
  }

  async authenticateMemberToken(token: string): Promise<MemberPrincipal | undefined> {
    if (!isMemberTokenCredential(token)) return undefined;
    const oauthCredential = token.startsWith(MEMBER_OAUTH_ACCESS_PREFIX);
    const maxAgeDays = oauthCredential ? (await this.settings.codingAgentConnectionLifetime()).maxAgeDays : undefined;
    const identity = await this.tokens.authenticate(hashToken(token), maxAgeDays);
    if (identity === undefined) return undefined;
    return Object.freeze({
      userId: identity.userId,
      tokenId: identity.tokenId,
      projectIds: Object.freeze([...identity.projectIds]),
      ...(identity.connectionId === undefined ? {} : { connectionId: identity.connectionId }),
      credentialKind: "coding-agent-read" as const,
    });
  }
}
