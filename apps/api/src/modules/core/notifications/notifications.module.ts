// Wiring of the notifications module: the use cases, the Postgres store bound to the port, and the inbox routes.

import { Module } from "@nestjs/common";
import { ProjectAccessModule } from "#modules/admin/project-access/index.js";
import { BrainModule } from "#modules/delivery/brain/index.js";
import { NotificationService } from "./application/notification.service.js";
import { NotificationStore } from "./domain/notification.store.js";
import { PgNotificationStore } from "./infrastructure/pg-notification.store.js";
import { NotificationsController } from "./interface/notifications.controller.js";

/** core · notifications (ADR-0099 decision 3): the inbox, and the service the wiki's use cases and the notify job make notifications with. */
@Module({
  imports: [ProjectAccessModule, BrainModule],
  controllers: [NotificationsController],
  providers: [NotificationService, { provide: NotificationStore, useClass: PgNotificationStore }],
  exports: [NotificationService],
})
export class NotificationsModule {}
