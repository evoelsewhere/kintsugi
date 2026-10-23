import type { GitHubObservationConnection } from "./github-app.js";
import type { MemberAssociationClaim, MemberAssociationClaimParseResult } from "@kintsugi/domain";

export type ObservedPullRequestState = "open" | "closed" | "merged";
export type CapabilityState = "supported" | "unsupported" | "unknown";

export interface ProviderCapability {
  state: CapabilityState;
  reason?: "pilot-scope" | "permission-unavailable" | "provider-unavailable";
}

export interface ProviderCapabilities {
  pullRequests: ProviderCapability;
  reviews: ProviderCapability;
  checks: ProviderCapability;
  mergeQueue: ProviderCapability;
}

/** Stable identity returned by a provider; actor IDs are provider IDs, never display-name guesses. */
export interface PullRequestIdentity {
  host: string;
  repositoryId: string;
  repositoryPath: string;
  pullRequestId: string;
  number: number;
}

export interface ObservedReview {
  id: string;
  actorId?: string;
  actorLogin?: string;
  state: string;
  commitSha?: string;
  submittedAt?: string;
}

export interface ObservedCheckRun {
  id: string;
  name: string;
  appId?: string;
  appSlug?: string;
  /** The commit the provider says this run evaluated. Keep mismatches intact for policy evaluation. */
  headSha: string;
  /** GitHub supplies started_at rather than a check-run run_attempt number. */
  startedAt?: string;
  status: string;
  conclusion?: string;
  completedAt?: string;
}

export interface ObservedPullRequestSummary extends PullRequestIdentity {
  provider: "github" | "github-enterprise";
  htmlUrl: string;
  /** Stable Git-provider author identity; logins are display data and never authorize association. */
  authorId?: string;
  authorLogin?: string;
  /** Parsed identifiers from the bounded Kintsugi PR-body block. This claim is untrusted. */
  associationClaimStatus: MemberAssociationClaimParseResult["status"];
  associationClaim?: MemberAssociationClaim;
  state: ObservedPullRequestState;
  draft: boolean;
  updatedAt: string;
  headSha: string;
  headRef: string;
  baseSha: string;
  baseRef: string;
  /** Provider merge base is often unavailable from the PR endpoint and must remain absent. */
  mergeBaseSha?: string;
  /** GitHub's merge_commit_sha is the temporary test merge while an open PR remains unmerged. */
  testMergeSha?: string;
  /** Final provider merge SHA, distinct from the temporary test merge SHA. */
  mergeCommitSha?: string;
  mergedAt?: string;
}

export interface ObservedPullRequest extends ObservedPullRequestSummary {
  reviews: ObservedReview[];
  checks: ObservedCheckRun[];
}

export interface ChangePage {
  items: ObservedPullRequestSummary[];
  /** Opaque, host- and route-bound provider pagination URL. */
  nextCursor?: string;
  /** Highest provider `updated_at` seen on this page, or the input watermark if empty. */
  latestUpdatedAt: string;
  /** False means the caller must fetch `nextCursor` before advancing a durable watermark. */
  complete: boolean;
}

export interface PullRequestObserver<Connection = GitHubObservationConnection> {
  capabilities(connection: Connection): Promise<ProviderCapabilities>;
  listChanged(connection: Connection, watermark: string, cursor?: string): Promise<ChangePage>;
  /** Full, stable-order all-state scan used for periodic recovery when update-sorted pages move. */
  listAll(connection: Connection, cursor?: string): Promise<ChangePage>;
  get(connection: Connection, identity: PullRequestIdentity): Promise<ObservedPullRequest>;
}
