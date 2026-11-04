// Wiring of the wiki's editing side (ADR-0098, ADR-0099): drafts, page-id counters, edit restrictions, and the routes
// that answer who may write. Published documents stay in Git; the Brain module owns the wiki switch.

import { Module } from "@nestjs/common";
import { DocumentWritesModule } from "#modules/admin/document-writes/index.js";
import { ProjectAccessModule } from "#modules/admin/project-access/index.js";
import { BrainModule } from "#modules/delivery/brain/index.js";
import { DocumentsModule } from "#modules/delivery/documents/index.js";
import { WikiAccessService } from "./application/wiki-access.service.js";
import { WikiAttachmentService } from "./application/wiki-attachment.service.js";
import { WikiCommentService } from "./application/wiki-comment.service.js";
import { WikiDeleteService } from "./application/wiki-delete.service.js";
import { WikiDraftService } from "./application/wiki-draft.service.js";
import { WikiMoveService } from "./application/wiki-move.service.js";
import { WikiPageService } from "./application/wiki-page.service.js";
import { WikiPeopleService } from "./application/wiki-people.service.js";
import { WikiPublishService } from "./application/wiki-publish.service.js";
import { WikiRestrictionService } from "./application/wiki-restriction.service.js";
import { WikiWatchService } from "./application/wiki-watch.service.js";
import { WikiAttachments, WikiComments, WikiDirectPublish, WikiDrafts, WikiIdCounters, WikiPageLocks, WikiPeople, WikiRestrictions, WikiSubjects, WikiWatches } from "./domain/wiki.ports.js";
import { ManifestDirectPublish } from "./infrastructure/manifest-direct-publish.js";
import { PgWikiComments } from "./infrastructure/pg-wiki.comments.js";
import { PgWikiIdCounters } from "./infrastructure/pg-wiki.counters.js";
import { PgWikiPeople } from "./infrastructure/pg-wiki.people.js";
import { PgWikiPageLocks } from "./infrastructure/pg-wiki.locks.js";
import { PgWikiAttachments, PgWikiDrafts } from "./infrastructure/pg-wiki.drafts.js";
import { PgWikiRestrictions } from "./infrastructure/pg-wiki.restrictions.js";
import { PgWikiSubjects } from "./infrastructure/pg-wiki.subjects.js";
import { PgWikiWatches } from "./infrastructure/pg-wiki.watches.js";
import { WikiAccessController } from "./interface/wiki-access.controller.js";
import { WikiAttachmentController } from "./interface/wiki-attachment.controller.js";
import { WikiCommentController } from "./interface/wiki-comment.controller.js";
import { WikiDraftController } from "./interface/wiki-draft.controller.js";
import { WikiMoveController } from "./interface/wiki-move.controller.js";
import { WikiPageController } from "./interface/wiki-page.controller.js";
import { WikiPeopleController } from "./interface/wiki-people.controller.js";
import { WikiPublishController } from "./interface/wiki-publish.controller.js";
import { WikiRestrictionController } from "./interface/wiki-restriction.controller.js";
import { WikiWatchController } from "./interface/wiki-watch.controller.js";

@Module({
  imports: [ProjectAccessModule, DocumentsModule, DocumentWritesModule, BrainModule],
  controllers: [WikiAccessController, WikiAttachmentController, WikiCommentController, WikiDraftController, WikiMoveController, WikiPageController, WikiPeopleController, WikiPublishController, WikiRestrictionController, WikiWatchController],
  providers: [
    WikiAccessService,
    WikiDraftService,
    WikiMoveService,
    WikiPageService,
    WikiPeopleService,
    WikiRestrictionService,
    WikiPublishService,
    WikiDeleteService,
    WikiAttachmentService,
    WikiWatchService,
    WikiCommentService,
    { provide: WikiDrafts, useClass: PgWikiDrafts },
    { provide: WikiAttachments, useClass: PgWikiAttachments },
    { provide: WikiIdCounters, useClass: PgWikiIdCounters },
    { provide: WikiPeople, useClass: PgWikiPeople },
    { provide: WikiComments, useClass: PgWikiComments },
    { provide: WikiRestrictions, useClass: PgWikiRestrictions },
    { provide: WikiSubjects, useClass: PgWikiSubjects },
    { provide: WikiWatches, useClass: PgWikiWatches },
    { provide: WikiPageLocks, useClass: PgWikiPageLocks },
    { provide: WikiDirectPublish, useClass: ManifestDirectPublish },
  ],
  exports: [WikiWatchService, WikiPeopleService, WikiAccessService, WikiAttachmentService, WikiDraftService, WikiPublishService, WikiDeleteService, WikiRestrictionService, WikiDrafts, WikiAttachments, WikiIdCounters, WikiRestrictions],
})
export class WikiModule {}
