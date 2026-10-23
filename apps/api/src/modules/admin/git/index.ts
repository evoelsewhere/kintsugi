/** Public Git module surface for feature modules that resolve registered Git connections. */
export { GitModule } from "./git.module.js";
export { GitRegistry, GitRemote } from "./domain/git.ports.js";
export { GitService } from "./application/git.service.js";
export type {
  GitRepositoryRecord,
  GitServerRecord,
  RegisterGitRepository,
  RegisterGitServer,
} from "./domain/git.js";
