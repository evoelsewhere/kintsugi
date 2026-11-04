// Registers the Brain with the Git module: when a repository's default branch changes, the Brain of the wiki projects
// that use it moves to the new branch.

import { Injectable, type OnModuleInit } from "@nestjs/common";
import { DefaultBranchObservers } from "#modules/admin/git/index.js";
import { BrainService } from "./brain.service.js";

@Injectable()
export class WikiBranchFollower implements OnModuleInit {
  constructor(
    private readonly observers: DefaultBranchObservers,
    private readonly brain: BrainService,
  ) {}

  onModuleInit(): void {
    this.observers.register((change, actor) => this.brain.followDefaultBranch(change.repositoryId, change.branch, actor));
  }
}
