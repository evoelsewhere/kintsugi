// Application layer for personal, project-scoped Coding Agent Workflow credentials.

import { randomBytes } from "node:crypto";
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { AUDIT_ACTIONS, AuditTrail, auditRecord } from "#common/audit/audit-trail.js";
import type { Actor } from "#common/auth/decorators.js";
import { newId } from "#common/domain/ids.js";
import { hashToken } from "#common/security/token-hash.js";
import { ProjectAccessService } from "#modules/admin/project-access/index.js";
import { MemberTokenRepository, type MemberTokenMetadata } from "../domain/member-token.repository.js";

export const MEMBER_TOKEN_PREFIX = "knt_pat_";
export const MAX_MEMBER_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface MemberPrincipal {
  readonly userId: string;
  readonly tokenId: string;
  readonly projectIds: readonly string[];
  readonly credentialKind: "coding-agent-read";
}

export interface IssueMemberTokenInput {
  name: string;
  projectIds: string[];
  expiresAt: Date;
}

@Injectable()
export class MemberTokenService {
  constructor(
    private readonly tokens: MemberTokenRepository,
    private readonly projects: ProjectAccessService,
    private readonly audit: AuditTrail,
  ) {}

  async issue(actor: Actor, input: IssueMemberTokenInput): Promise<{ token: string; metadata: MemberTokenMetadata }> {
    this.#requireOwnTokenPermission(actor);
    if (!actor.permissions.includes("member.read")) throw new ForbiddenException("Coding Agent Workflow read permission is required");
    if (input.name.trim().length === 0 || input.name.length > 80) throw new BadRequestException("Token name must contain 1 to 80 characters");
    if (input.projectIds.length === 0 || input.projectIds.length > 100 || new Set(input.projectIds).size !== input.projectIds.length) {
      throw new BadRequestException("Select between 1 and 100 distinct projects");
    }
    const expiry = input.expiresAt.getTime();
    const now = Date.now();
    if (!Number.isFinite(expiry) || expiry <= now || expiry > now + MAX_MEMBER_TOKEN_TTL_MS) {
      throw new BadRequestException("Token expiry must be in the next 30 days");
    }

    const projectIds = [...input.projectIds].sort();
    for (const projectId of projectIds) await this.projects.requireRead(actor.id, projectId);

    const token = MEMBER_TOKEN_PREFIX + randomBytes(32).toString("base64url");
    const metadata = await this.tokens.create({
      id: newId(),
      userId: actor.id,
      name: input.name.trim(),
      tokenHash: hashToken(token),
      projectIds,
      expiresAt: input.expiresAt,
    });
    await this.audit.recordChange(
      auditRecord(actor, AUDIT_ACTIONS.memberTokenIssue, {
        subject: metadata.id,
        detail: { name: metadata.name, projectCount: metadata.projectIds.length, expiresAt: metadata.expiresAt },
      }),
    );
    return { token, metadata };
  }

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
    if (!new RegExp(`^${MEMBER_TOKEN_PREFIX}[A-Za-z0-9_-]{43}$`).test(token)) return undefined;
    const identity = await this.tokens.authenticate(hashToken(token));
    if (identity === undefined) return undefined;
    return Object.freeze({
      userId: identity.userId,
      tokenId: identity.tokenId,
      projectIds: Object.freeze([...identity.projectIds]),
      credentialKind: "coding-agent-read" as const,
    });
  }
}
