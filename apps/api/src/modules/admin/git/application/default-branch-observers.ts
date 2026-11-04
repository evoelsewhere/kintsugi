// Who is told when the branch Kintsugi follows in a repository changes (the repository's "default branch"). A feature
// module that keeps something per branch registers an observer when it starts; Git knows none of them, so the modules
// stay free of cycles. An observer that fails is logged and never fails the change that was already made.

import { Injectable, Logger } from "@nestjs/common";
import type { Actor } from "#common/auth/decorators.js";

export interface DefaultBranchChange {
  repositoryId: string;
  /** The new default branch. */
  branch: string;
}

export type DefaultBranchObserver = (change: DefaultBranchChange, actor: Actor) => Promise<void>;

@Injectable()
export class DefaultBranchObservers {
  readonly #observers: DefaultBranchObserver[] = [];
  readonly #logger = new Logger(DefaultBranchObservers.name);

  register(observer: DefaultBranchObserver): void {
    this.#observers.push(observer);
  }

  async notify(change: DefaultBranchChange, actor: Actor): Promise<void> {
    for (const observer of this.#observers) {
      try {
        await observer(change, actor);
      } catch (error) {
        this.#logger.warn(`An observer of the default branch of ${change.repositoryId} failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
}
