// One publish of a page at a time: a transaction-scoped advisory lock on the project and page path, held while the
// caller works. It waits (it does not fail), so the second of two simultaneous publishes sees the first one's open write.

import { Injectable } from "@nestjs/common";
import { withTransaction } from "#common/db/pool.js";
import { WikiPageLocks } from "../domain/wiki.ports.js";

@Injectable()
export class PgWikiPageLocks extends WikiPageLocks {
  async withLock<T>(projectId: string, path: string, work: () => Promise<T>): Promise<T> {
    return withTransaction(async (tx) => {
      await tx.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [JSON.stringify(["wiki-page", projectId, path])]);
      return work();
    });
  }
}
