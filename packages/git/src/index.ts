// Git core (ADR-0025): every Git operation Kintsugi performs, over the system `git` CLI.
// Used by the worker (sync, writer, job worktrees) and by the API for "Test access".

export { GitError, isLoopbackUrl, runGit, type GitCredential, type GitResult, type GitRunOptions } from "./cli.js";
export {
  MIN_GIT_VERSION,
  addWorktree,
  assertSafeRemoteUrl,
  checkGitVersion,
  cloneMirror,
  fetchMirror,
  lsRemote,
  parseGitVersion,
  pruneWorktrees,
  removeWorktree,
  worktreeIsAt,
  isAncestor,
  resolveCommit,
  type MirrorOptions,
  type RemoteBranch,
  type RemoteInfo,
  type RemoteOptions,
} from "./repository.js";
export { CheckoutStorage, dataDirFromEnv, stepFolder, type JobPaths, type StepPaths } from "./storage.js";
export {
  BOT_NAME,
  COMMIT_IDENTITY_SETTING,
  DEFAULT_BOT_EMAIL,
  DEFAULT_COMMIT_IDENTITY,
  commitIdentityProblems,
  WRITER_BRANCH_PREFIX,
  assertSafeRepoPath,
  assertWritableBranch,
  commitFiles,
  commitMessage,
  hasBranch,
  pushWithRebase,
  writeFiles,
  type CommitIdentity,
  type CommitInput,
  type FileWrite,
  type PushInput,
  type PushResult,
  type Trailer,
  type WriteFilesInput,
  type WriteFilesResult,
} from "./write.js";
export {
  PullRequestsUnsupportedError,
  pullRequestProvider,
  type OpenPullRequest,
  type PullRequest,
  type PullRequestProvider,
  type PullRequestState,
  type PullRequestStatusQuery,
  type PullRequestServerKind,
} from "./pull-requests.js";
export {
  GITHUB_REST_API_VERSION,
  GitHubAppError,
  GitHubInstallationCredentialProvider,
  GitHubProviderCredentialProvider,
  githubApiTarget,
  githubRepositoryPathFromRemote,
  type GitHubAppConnection,
  type GitHubAppPurpose,
  type GitHubCredentialResolver,
  type GitHubObservationConnection,
  type GitHubPermission,
  type GitHubProviderCredential,
  type GitHubRepositoryConnection,
  type GitHubTokenConnection,
  type GitHubApiTarget,
} from "./github-app.js";
export { GitHubPullRequestObserver } from "./github-observer.js";
export type {
  CapabilityState,
  ChangePage,
  ObservedCheckRun,
  ObservedPullRequest,
  ObservedPullRequestState,
  ObservedPullRequestSummary,
  ObservedReview,
  ProviderCapabilities,
  ProviderCapability,
  PullRequestIdentity,
  PullRequestObserver,
} from "./pull-request-observer.js";
export { fetchPullRequestRefs, listChangedPaths, type PullRequestRevision, type PullRequestRevisionRequest } from "./github-review.js";
