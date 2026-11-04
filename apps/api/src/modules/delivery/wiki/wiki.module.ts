// Wiring of the wiki's editing side (ADR-0098, ADR-0099): drafts, page-id counters, edit restrictions, and the routes
// that answer who may write. Published documents stay in Git; the Brain module owns the wiki switch.

import { Module } from "@nestjs/common";
import { ProjectAccessModule } from "#modules/admin/project-access/index.js";
import { WikiAccessService } from "./application/wiki-access.service.js";
import { WikiAttachments, WikiDrafts, WikiIdCounters, WikiRestrictions } from "./domain/wiki.ports.js";
import { PgWikiIdCounters } from "./infrastructure/pg-wiki.counters.js";
import { PgWikiAttachments, PgWikiDrafts } from "./infrastructure/pg-wiki.drafts.js";
import { PgWikiRestrictions } from "./infrastructure/pg-wiki.restrictions.js";
import { WikiAccessController } from "./interface/wiki-access.controller.js";

@Module({
  imports: [ProjectAccessModule],
  controllers: [WikiAccessController],
  providers: [
    WikiAccessService,
    { provide: WikiDrafts, useClass: PgWikiDrafts },
    { provide: WikiAttachments, useClass: PgWikiAttachments },
    { provide: WikiIdCounters, useClass: PgWikiIdCounters },
    { provide: WikiRestrictions, useClass: PgWikiRestrictions },
  ],
  exports: [WikiAccessService, WikiDrafts, WikiAttachments, WikiIdCounters, WikiRestrictions],
})
export class WikiModule {}
