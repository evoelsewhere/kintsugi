// Git core (ADR-0025): every Git operation Kintsugi performs, over the system `git` CLI.
// Used by the worker (sync, writer, job worktrees) and by the API for "Test access".

export { GitError, runGit, type GitCredential, type GitResult, type GitRunOptions } from "./cli.js";
export {
  MIN_GIT_VERSION,
  addWorktree,
  assertSafeRemoteUrl,
  checkGitVersion,
  cloneMirror,
  fetchMirror,
  lsRemote,
  parseGitVersion,
  removeWorktree,
  resolveCommit,
  type MirrorOptions,
  type RemoteBranch,
  type RemoteInfo,
  type RemoteOptions,
} from "./repository.js";
export { CheckoutStorage, dataDirFromEnv, type JobPaths } from "./storage.js";
