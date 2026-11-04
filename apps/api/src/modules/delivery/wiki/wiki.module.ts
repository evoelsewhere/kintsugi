// Wiring of the wiki's editing side (ADR-0098, ADR-0099): drafts, page-id counters, edit restrictions, and the routes
// that answer who may write. Published documents stay in Git; the Brain module owns the wiki switch.

import { Module } from "@nestjs/common";
import { DocumentWritesModule } from "#modules/admin/document-writes/index.js";
import { ProjectAccessModule } from "#modules/admin/project-access/index.js";
import { BrainModule } from "#modules/delivery/brain/index.js";
import { DocumentsModule } from "#modules/delivery/documents/index.js";
import { WikiAccessService } from "./application/wiki-access.service.js";
import { WikiAttachmentService } from "./application/wiki-attachment.service.js";
import { WikiDeleteService } from "./application/wiki-delete.service.js";
import { WikiDraftService } from "./application/wiki-draft.service.js";
import { WikiPublishService } from "./application/wiki-publish.service.js";
import { WikiRestrictionService } from "./application/wiki-restriction.service.js";
import { WikiAttachments, WikiDirectPublish, WikiDrafts, WikiIdCounters, WikiPageLocks, WikiRestrictions, WikiSubjects } from "./domain/wiki.ports.js";
import { ManifestDirectPublish } from "./infrastructure/manifest-direct-publish.js";
import { PgWikiIdCounters } from "./infrastructure/pg-wiki.counters.js";
import { PgWikiPageLocks } from "./infrastructure/pg-wiki.locks.js";
import { PgWikiAttachments, PgWikiDrafts } from "./infrastructure/pg-wiki.drafts.js";
import { PgWikiRestrictions } from "./infrastructure/pg-wiki.restrictions.js";
import { PgWikiSubjects } from "./infrastructure/pg-wiki.subjects.js";
import { WikiAccessController } from "./interface/wiki-access.controller.js";
import { WikiAttachmentController } from "./interface/wiki-attachment.controller.js";
import { WikiDraftController } from "./interface/wiki-draft.controller.js";
import { WikiPublishController } from "./interface/wiki-publish.controller.js";
import { WikiRestrictionController } from "./interface/wiki-restriction.controller.js";

@Module({
  imports: [ProjectAccessModule, DocumentsModule, DocumentWritesModule, BrainModule],
  controllers: [WikiAccessController, WikiAttachmentController, WikiDraftController, WikiPublishController, WikiRestrictionController],
  providers: [
    WikiAccessService,
    WikiDraftService,
    WikiRestrictionService,
    WikiPublishService,
    WikiDeleteService,
    WikiAttachmentService,
    { provide: WikiDrafts, useClass: PgWikiDrafts },
    { provide: WikiAttachments, useClass: PgWikiAttachments },
    { provide: WikiIdCounters, useClass: PgWikiIdCounters },
    { provide: WikiRestrictions, useClass: PgWikiRestrictions },
    { provide: WikiSubjects, useClass: PgWikiSubjects },
    { provide: WikiPageLocks, useClass: PgWikiPageLocks },
    { provide: WikiDirectPublish, useClass: ManifestDirectPublish },
  ],
  exports: [WikiAccessService, WikiAttachmentService, WikiDraftService, WikiPublishService, WikiDeleteService, WikiRestrictionService, WikiDrafts, WikiAttachments, WikiIdCounters, WikiRestrictions],
})
export class WikiModule {}
