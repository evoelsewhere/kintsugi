// Who may write a page. A placeholder until the permission and restriction rules are in place; it grants nothing.

import { Injectable } from "@nestjs/common";
import type { WikiAccessPlaceholder } from "../domain/wiki.js";

@Injectable()
export class WikiAccessService {
  access(_projectId: string, _path: string): WikiAccessPlaceholder {
    return { canWrite: false, canPublish: false, reason: "not-implemented" };
  }
}
