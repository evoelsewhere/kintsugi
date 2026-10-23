import { createHash, randomBytes } from "node:crypto";
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { AUDIT_ACTIONS, AuditTrail, auditRecord } from "#common/audit/audit-trail.js";
import type { Actor } from "#common/auth/decorators.js";
import { newId } from "#common/domain/ids.js";
import { hashToken } from "#common/security/token-hash.js";
import { InstallationSettingsService } from "#modules/admin/settings/index.js";
import { ProjectAccessService } from "#modules/admin/project-access/index.js";
import { AuthService } from "./auth.service.js";
import { MemberConnectionRepository, type MemberConnectionMetadata } from "../domain/member-connection.repository.js";

const AUTHORIZATION_CODE_PREFIX = "knt_ac_";
const ACCESS_TOKEN_PREFIX = "knt_caw_";
const REFRESH_TOKEN_PREFIX = "knt_crt_";
const AUTHORIZATION_CODE_TTL_MS = 5 * 60 * 1000;
const ACCESS_TOKEN_TTL_SECONDS = 5 * 60;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export interface AuthorizeCodingAgentInput {
  projectId: string;
  clientName: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  codeChallengeMethod: "S256";
}

export type CodingAgentTokenGrant =
  | { grantType: "authorization_code"; code: string; codeVerifier: string; redirectUri: string }
  | { grantType: "refresh_token"; refreshToken: string };

export interface CodingAgentTokenResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  connectionId: string;
  projectIds: string[];
}

@Injectable()
export class CodingAgentOAuthService {
  constructor(
    private readonly connections: MemberConnectionRepository,
    private readonly auth: AuthService,
    private readonly projects: ProjectAccessService,
    private readonly settings: InstallationSettingsService,
    private readonly audit: AuditTrail,
  ) {}

  async authorize(actor: Actor, input: AuthorizeCodingAgentInput): Promise<{ redirectTo: string }> {
    if (!actor.permissions.includes("member.read")) throw new ForbiddenException("Kintsugi member read permission is required");
    if (input.projectId.trim().length === 0 || input.clientName.trim().length === 0 || input.clientName.length > 80) {
      throw new BadRequestException("A project and client name are required");
    }
    if (!TOKEN_PATTERN.test(input.state) || !TOKEN_PATTERN.test(input.codeChallenge)) {
      throw new BadRequestException("Invalid authorization state or PKCE challenge");
    }
    const redirect = parseLoopbackRedirect(input.redirectUri);
    await this.projects.requireRead(actor.id, input.projectId);

    const code = AUTHORIZATION_CODE_PREFIX + randomBytes(32).toString("base64url");
    await this.connections.createAuthorizationCode({
      codeHash: hashToken(code),
      userId: actor.id,
      clientName: input.clientName.trim(),
      redirectUri: redirect.toString(),
      codeChallenge: input.codeChallenge,
      projectIds: [input.projectId],
      expiresAt: new Date(Date.now() + AUTHORIZATION_CODE_TTL_MS),
    });
    redirect.searchParams.set("code", code);
    redirect.searchParams.set("state", input.state);
    return { redirectTo: redirect.toString() };
  }

  async token(grant: CodingAgentTokenGrant): Promise<CodingAgentTokenResponse> {
    if (grant.grantType === "authorization_code") return this.#exchangeCode(grant);
    return this.#refresh(grant.refreshToken);
  }

  async listOwn(actor: Actor): Promise<MemberConnectionMetadata[]> {
    return this.connections.listByUser(actor.id);
  }

  async revokeOwn(connectionId: string, actor: Actor): Promise<void> {
    const revoked = await this.connections.revokeByUser(actor.id, connectionId);
    if (!revoked) throw new NotFoundException("Connection not found");
    await this.audit.recordChange(auditRecord(actor, AUDIT_ACTIONS.codingAgentConnectionRevoke, { subject: connectionId, detail: { scope: "member" } }));
  }

  async revokeByRefreshCredential(refreshToken: string): Promise<void> {
    if (!refreshToken.startsWith(REFRESH_TOKEN_PREFIX) || !TOKEN_PATTERN.test(refreshToken.slice(REFRESH_TOKEN_PREFIX.length))) return;
    const revoked = await this.connections.revokeByRefreshCredential(hashToken(refreshToken));
    if (revoked === undefined) return;
    const actor = await this.auth.authenticateUser(revoked.userId);
    if (actor === undefined) {
      await this.audit.recordChange({
        actor: "system",
        action: AUDIT_ACTIONS.codingAgentConnectionRevoke,
        subject: revoked.connectionId,
        detail: { scope: "member", via: "refresh-credential" },
      });
      return;
    }
    await this.audit.recordChange(auditRecord(actor, AUDIT_ACTIONS.codingAgentConnectionRevoke, {
      subject: revoked.connectionId,
      detail: { scope: "member", via: "refresh-credential" },
    }));
  }

  async listAll(): Promise<MemberConnectionMetadata[]> {
    return this.connections.listAll();
  }

  async revokeAny(connectionId: string, actor: Actor): Promise<void> {
    const revoked = await this.connections.revokeByAdmin(actor.id, connectionId);
    if (!revoked) throw new NotFoundException("Connection not found");
    await this.audit.recordChange(auditRecord(actor, AUDIT_ACTIONS.codingAgentConnectionRevoke, { subject: connectionId, detail: { scope: "installation" } }));
  }

  async #exchangeCode(grant: Extract<CodingAgentTokenGrant, { grantType: "authorization_code" }>): Promise<CodingAgentTokenResponse> {
    if (!grant.code.startsWith(AUTHORIZATION_CODE_PREFIX) || !TOKEN_PATTERN.test(grant.code.slice(AUTHORIZATION_CODE_PREFIX.length))) {
      throw new BadRequestException("Invalid or expired authorization code");
    }
    if (!isPkceVerifier(grant.codeVerifier)) throw new BadRequestException("Invalid or expired authorization code");
    const codeHash = hashToken(grant.code);
    const code = await this.connections.findAuthorizationCode(codeHash);
    if (code === undefined || code.consumedAt !== null || code.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException("Invalid or expired authorization code");
    }
    const user = await this.auth.authenticateUser(code.userId);
    if (user === undefined) throw new BadRequestException("Invalid or expired authorization code");
    if (!user.permissions.includes("member.read")) throw new ForbiddenException("Kintsugi member read permission is required");
    for (const projectId of code.projectIds) await this.projects.requireRead(user.id, projectId);

    const verifierChallenge = pkceChallengeForVerifier(grant.codeVerifier);
    const rawTokens = this.#newTokens();
    const connectionId = newId();
    const created = await this.connections.exchangeAuthorizationCode({
      codeHash,
      redirectUri: grant.redirectUri,
      verifierChallenge,
      connectionId,
      accessToken: { id: newId(), tokenHash: hashToken(rawTokens.accessToken), expiresAt: rawTokens.expiresAt },
      refreshTokenHash: hashToken(rawTokens.refreshToken),
    });
    if (created === undefined) throw new BadRequestException("Invalid or expired authorization code");
    const actor: Actor = { id: user.id, username: user.username, permissions: user.permissions };
    await this.audit.recordChange(
      auditRecord(actor, AUDIT_ACTIONS.codingAgentConnectionAuthorize, {
        subject: created.connectionId,
        detail: { clientName: created.clientName, projectCount: created.projectIds.length },
      }),
    );
    return {
      accessToken: rawTokens.accessToken,
      refreshToken: rawTokens.refreshToken,
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      connectionId: created.connectionId,
      projectIds: created.projectIds,
    };
  }

  async #refresh(rawRefreshToken: string): Promise<CodingAgentTokenResponse> {
    if (!rawRefreshToken.startsWith(REFRESH_TOKEN_PREFIX) || !TOKEN_PATTERN.test(rawRefreshToken.slice(REFRESH_TOKEN_PREFIX.length))) {
      throw new BadRequestException("Invalid or expired refresh credential");
    }
    const tokenHash = hashToken(rawRefreshToken);
    const current = await this.connections.getRefreshCredential(tokenHash);
    if (current === undefined) throw new BadRequestException("Invalid or expired refresh credential");
    const maxAgeDays = (await this.settings.codingAgentConnectionLifetime()).maxAgeDays;
    const rawTokens = this.#newTokens();

    // A consumed credential is always sent to the atomic rotation method so reuse revokes
    // the owning connection, even if the member has since been disabled or lost permissions.
    if (current.consumedAt === null && current.revokedAt === null) {
      const user = await this.auth.authenticateUser(current.userId);
      if (user === undefined) throw new ForbiddenException("The Kintsugi member is disabled or unavailable");
      if (!user.permissions.includes("member.read")) throw new ForbiddenException("Kintsugi member read permission is required");
      for (const projectId of current.projectIds) await this.projects.requireRead(user.id, projectId);
    }

    const result = await this.connections.rotateRefreshCredential({
      tokenHash,
      maxAgeDays,
      refreshTokenHash: hashToken(rawTokens.refreshToken),
      accessToken: { id: newId(), tokenHash: hashToken(rawTokens.accessToken), expiresAt: rawTokens.expiresAt },
    });
    if (result.status === "replayed") {
      await this.audit.recordChange({
        actor: "system",
        action: AUDIT_ACTIONS.codingAgentConnectionReplay,
        subject: current.connectionId,
        detail: { reason: "refresh-token-reuse" },
      });
      throw new BadRequestException("Invalid or expired refresh credential");
    }
    if (result.status !== "rotated") throw new BadRequestException("Invalid or expired refresh credential");
    return {
      accessToken: rawTokens.accessToken,
      refreshToken: rawTokens.refreshToken,
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      connectionId: result.connectionId,
      projectIds: result.projectIds,
    };
  }

  #newTokens(): { accessToken: string; refreshToken: string; expiresAt: Date } {
    return {
      accessToken: ACCESS_TOKEN_PREFIX + randomBytes(32).toString("base64url"),
      refreshToken: REFRESH_TOKEN_PREFIX + randomBytes(32).toString("base64url"),
      expiresAt: new Date(Date.now() + ACCESS_TOKEN_TTL_SECONDS * 1000),
    };
  }
}

function isPkceVerifier(verifier: string): boolean {
  return verifier.length >= 43 && verifier.length <= 128 && /^[A-Za-z0-9._~-]+$/.test(verifier);
}

export function pkceChallengeForVerifier(verifier: string): string {
  if (!isPkceVerifier(verifier)) throw new BadRequestException("Invalid or expired authorization code");
  return createHash("sha256").update(verifier).digest("base64url");
}

export function parseLoopbackRedirect(value: string): URL {
  let uri: URL;
  try {
    uri = new URL(value);
  } catch {
    throw new BadRequestException("The redirect URI must use a local loopback address");
  }
  const hostname = uri.hostname.toLowerCase();
  const loopback = hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1";
  const validPort = uri.port.length > 0 && Number(uri.port) >= 1 && Number(uri.port) <= 65535;
  if (uri.protocol !== "http:" || !loopback || !validPort || uri.username !== "" || uri.password !== "" || uri.pathname !== "/oauth/callback" || uri.search !== "" || uri.hash !== "") {
    throw new BadRequestException("The redirect URI must use a local loopback address and the OAuth callback path");
  }
  return uri;
}
