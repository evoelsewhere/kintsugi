// Who may write a page. The write routes ask `assertCanWrite`; the rules grow here (restrictions, the refusal audit)
// without the routes changing. `access` is a placeholder until then and grants nothing.

import { ForbiddenException, Injectable } from "@nestjs/common";
import type { Actor } from "#common/auth/decorators.js";
import type { WikiAccessPlaceholder } from "../domain/wiki.js";

/** The permission to write wiki pages (ADR-0099 decision 5). Checked here, not by a route decorator, which would mean any-of. */
const WIKI_WRITE = "wiki.write";

@Injectable()
export class WikiAccessService {
  /** Throws 403 unless the caller may write wiki pages. */
  assertCanWrite(actor: Actor, _path: string): void {
    if (!actor.permissions.includes(WIKI_WRITE)) throw new ForbiddenException(`Missing permission: ${WIKI_WRITE}`);
  }

  access(_projectId: string, _path: string): WikiAccessPlaceholder {
    return { canWrite: false, canPublish: false, reason: "not-implemented" };
  }
}
