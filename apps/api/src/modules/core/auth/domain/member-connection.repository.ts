export interface AuthorizationCodeRecord {
  userId: string;
  clientName: string;
  redirectUri: string;
  codeChallenge: string;
  projectIds: string[];
  expiresAt: Date;
  consumedAt: Date | null;
}

export interface AuthorizationCodeInput {
  codeHash: string;
  userId: string;
  clientName: string;
  redirectUri: string;
  codeChallenge: string;
  projectIds: string[];
  expiresAt: Date;
}

export interface ConnectionAccessTokenInput {
  id: string;
  tokenHash: string;
  expiresAt: Date;
}

export interface ExchangeAuthorizationCodeInput {
  codeHash: string;
  redirectUri: string;
  verifierChallenge: string;
  connectionId: string;
  accessToken: ConnectionAccessTokenInput;
  refreshTokenHash: string;
}

export interface ConnectionAuthorizationResult {
  connectionId: string;
  userId: string;
  clientName: string;
  projectIds: string[];
}

export interface RefreshCredentialSnapshot {
  connectionId: string;
  userId: string;
  clientName: string;
  projectIds: string[];
  createdAt: Date;
  revokedAt: Date | null;
  consumedAt: Date | null;
}

export interface RotateRefreshCredentialInput {
  tokenHash: string;
  maxAgeDays: 15 | 30;
  refreshTokenHash: string;
  accessToken: ConnectionAccessTokenInput;
}

export type RotateRefreshCredentialResult =
  | { status: "rotated"; connectionId: string; userId: string; clientName: string; projectIds: string[] }
  | { status: "replayed" | "expired" | "invalid" };

export interface MemberConnectionMetadata {
  id: string;
  clientName: string;
  projectIds: string[];
  createdAt: string;
  lastUsedAt?: string;
  revokedAt?: string;
}

export abstract class MemberConnectionRepository {
  abstract createAuthorizationCode(input: AuthorizationCodeInput): Promise<void>;
  abstract findAuthorizationCode(codeHash: string): Promise<AuthorizationCodeRecord | undefined>;
  abstract exchangeAuthorizationCode(input: ExchangeAuthorizationCodeInput): Promise<ConnectionAuthorizationResult | undefined>;
  abstract getRefreshCredential(tokenHash: string): Promise<RefreshCredentialSnapshot | undefined>;
  abstract rotateRefreshCredential(input: RotateRefreshCredentialInput): Promise<RotateRefreshCredentialResult>;
  abstract revokeByRefreshCredential(tokenHash: string): Promise<{ connectionId: string; userId: string } | undefined>;
  abstract listByUser(userId: string): Promise<MemberConnectionMetadata[]>;
  abstract listAll(): Promise<MemberConnectionMetadata[]>;
  abstract revokeByUser(userId: string, connectionId: string): Promise<boolean>;
  abstract revokeByAdmin(actorId: string, connectionId: string): Promise<boolean>;
}
