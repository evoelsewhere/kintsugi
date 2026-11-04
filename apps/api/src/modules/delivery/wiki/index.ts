// Public surface of the wiki module: other modules import only from here.

export { WikiModule } from "./wiki.module.js";
export { WikiAccessService } from "./application/wiki-access.service.js";
export { WikiAttachments, WikiDrafts, WikiIdCounters, WikiRestrictions } from "./domain/wiki.ports.js";
export type { NewWikiDraft, WikiAttachment, WikiDraft, WikiRestriction, WikiRestrictionKind, WikiSubjectKind } from "./domain/wiki.js";
