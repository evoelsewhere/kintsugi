// Port for scoped Kintsugi member tokens. Raw credentials never cross this boundary.

export interface MemberTokenMetadata {
  id: string;
  name: string;
  projectIds: string[];
  createdAt: string;
  expiresAt: string;
  lastUsedAt?: string;
  revokedAt?: string;
}

export interface MemberTokenRecordInput {
  id: string;
  userId: string;
  name: string;
  tokenHash: string;
  projectIds: string[];
  expiresAt: Date;
  connectionId?: string;
}

export interface MemberTokenIdentity {
  tokenId: string;
  userId: string;
  projectIds: string[];
  connectionId?: string;
}

export abstract class MemberTokenRepository {
  abstract create(input: MemberTokenRecordInput): Promise<MemberTokenMetadata>;
  abstract listByUser(userId: string): Promise<MemberTokenMetadata[]>;
  /** Marks a token revoked only when it belongs to the user. */
  abstract revoke(userId: string, tokenId: string): Promise<boolean>;
  /** Returns an active token identity and updates last_used_at, or undefined. */
  abstract authenticate(tokenHash: string, maxConnectionAgeDays?: 15 | 30): Promise<MemberTokenIdentity | undefined>;
}
