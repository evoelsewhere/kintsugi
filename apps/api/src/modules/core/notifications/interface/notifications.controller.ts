// The inbox of the signed-in person: their own notifications, nobody else's. No permission code: it is their own business.
// Notifications of a project they can no longer open are left out of the list and the count.

import { Body, Controller, Get, HttpCode, Post, Query } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { type Actor, CurrentActor } from "#common/auth/decorators.js";
import { NotificationService } from "../application/notification.service.js";
import type { NotificationList } from "../domain/notification.js";
import { type ListNotificationsQuery, listNotificationsQuerySchema, type MarkReadBody, markReadSchema } from "./notifications.dto.js";

@ApiTags("core · notifications")
@Controller("notifications")
export class NotificationsController {
  constructor(private readonly notifications: NotificationService) {}

  @Get()
  @ApiOperation({
    summary: "The caller's notifications, newest first (the wiki pages they watch changed, comments on them, mentions of them)",
    description: "Each has its kind, project, who did it, the page (title and path looked up now, only for a project the caller can open) and the time. `unread` counts what is not read.",
  })
  list(@Query({ schema: listNotificationsQuerySchema }) query: ListNotificationsQuery, @CurrentActor() actor: Actor): Promise<NotificationList> {
    return this.notifications.list(actor, query);
  }

  @Get("unread-count")
  @ApiOperation({ summary: "How many notifications of the caller are not read" })
  unread(@CurrentActor() actor: Actor): Promise<{ unread: number }> {
    return this.notifications.unreadCount(actor);
  }

  @Post("read")
  @HttpCode(204)
  @ApiOperation({ summary: "Mark some of the caller's notifications (by id), or all of them, read" })
  async read(@Body({ schema: markReadSchema }) body: MarkReadBody, @CurrentActor() actor: Actor): Promise<void> {
    await this.notifications.markRead(actor, body);
  }
}
