import type { MemberAssociationClaim } from "@kintsugi/domain";

export interface PendingMemberAssociation {
  serverId: string;
  repositoryId: string;
  providerRepositoryId: string;
  providerPullRequestId: string;
  pullRequestNumber: number;
  state: "open" | "closed" | "merged";
  authorProviderActorId?: string;
  headSha: string;
  headRef: string;
  baseRef: string;
  claimStatus: "absent" | "invalid" | "valid" | "project-mismatch";
  claim?: MemberAssociationClaim;
  associationState?: "needs_confirmation" | "rejected";
}

export interface MemberAssociationConfirmation {
  serverId: string;
  providerRepositoryId: string;
  providerPullRequestId: string;
  projectId: string;
  unitId: string;
  contextRevision: string;
  deliverableIds: string[];
  confirmedBy: string;
}

export type MemberAssociationConfirmationResult =
  | { status: "confirmed" | "unchanged" }
  | { status: "observation-not-found" | "task-not-found" | "repository-not-linked" | "context-unavailable" | "invalid-association" | "association-conflict" };

export type ProviderActorMappingResult =
  | { status: "created" | "unchanged" }
  | { status: "repository-not-linked" | "user-not-authorized" | "mapping-conflict" };

export abstract class MemberAssociationRepository {
  abstract listNeedsConfirmation(projectId: string, limit: number, offset: number): Promise<{
    items: PendingMemberAssociation[];
    hasMore: boolean;
  }>;
  abstract mapProviderActor(input: {
    projectId: string;
    serverId: string;
    providerActorId: string;
    userId: string;
    confirmedBy: string;
  }): Promise<ProviderActorMappingResult>;
  abstract confirm(input: MemberAssociationConfirmation): Promise<MemberAssociationConfirmationResult>;
}
