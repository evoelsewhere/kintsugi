// Wiring of the Git module: interface + application + the infrastructure adapters
// bound to the domain ports.

import { Module } from "@nestjs/common";
import { GitService } from "./application/git.service.js";
import { GitRegistry, GitRemote } from "./domain/git.ports.js";
import { CliGitRemote } from "./infrastructure/cli-git.remote.js";
import { PgGitRegistry } from "./infrastructure/pg-git.registry.js";
import { GitRepositoriesController, GitServersController } from "./interface/git.controllers.js";

/** admin · Git servers and repositories — docs/architecture/05-building-block-view.md (A3). */
@Module({
  controllers: [GitServersController, GitRepositoriesController],
  providers: [GitService, { provide: GitRegistry, useClass: PgGitRegistry }, { provide: GitRemote, useClass: CliGitRemote }],
  exports: [GitService, GitRegistry],
})
export class GitModule {}
