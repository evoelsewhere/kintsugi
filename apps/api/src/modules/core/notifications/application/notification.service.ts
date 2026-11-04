// Notifications: made by the wiki's use cases and the notify job, read by the person they are for. A person reads only
// their own, only of projects they can open now, and the names (page, project, who) are looked up when they read.

import { Injectable } from "@nestjs/common";
import type { Actor } from "#common/auth/decorators.js";
import { ProjectAccessService } from "#modules/admin/project-access/index.js";
import { BrainService } from "#modules/delivery/brain/index.js";
import { checkSubject, type NewNotification, type NotificationList, type NotificationRow, type NotificationSubject, type NotificationView } from "../domain/notification.js";
import { NotificationStore } from "../domain/notification.store.js";

/** The most a page of the inbox holds. */
export const INBOX_MAX = 100;

export type MakeNotification = Omit<NewNotification, "subject"> & { subject: Readonly<Record<string, unknown>> };

@Injectable()
export class NotificationService {
  constructor(
    private readonly store: NotificationStore,
    private readonly access: ProjectAccessService,
    private readonly brain: BrainService,
  ) {}

  /** Makes a notification once; false when the same one was made before. Refuses a subject that holds more than ids. */
  async create(input: MakeNotification): Promise<boolean> {
    const subject: NotificationSubject = checkSubject(input.subject);
    return this.store.insert({ ...input, subject });
  }

  async list(actor: Actor, query: { unread: boolean; limit: number; before?: string | undefined }): Promise<NotificationList> {
    const projectIds = await this.access.readableProjectIds(actor.id);
    if (projectIds.length === 0) return { items: [], unread: 0 };
    const limit = Math.min(Math.max(query.limit, 1), INBOX_MAX);
    const [rows, unread] = await Promise.all([this.store.list(actor.id, projectIds, { unread: query.unread, limit, before: query.before }), this.store.countUnread(actor.id, projectIds)]);
    return { items: await this.view(actor.id, rows), unread };
  }

  async unreadCount(actor: Actor): Promise<{ unread: number }> {
    const projectIds = await this.access.readableProjectIds(actor.id);
    return { unread: projectIds.length === 0 ? 0 : await this.store.countUnread(actor.id, projectIds) };
  }

  async markRead(actor: Actor, target: { ids: readonly string[] } | { all: true }): Promise<void> {
    const projectIds = await this.access.readableProjectIds(actor.id);
    if (projectIds.length === 0) return;
    await this.store.markRead(actor.id, projectIds, target);
  }

  /** The rows with the names the inbox shows: project, page (from the Brain) and who did it. */
  private async view(userId: string, rows: readonly NotificationRow[]): Promise<NotificationView[]> {
    if (rows.length === 0) return [];
    const [projects, people] = await Promise.all([
      this.access.listReadableProjects(userId, rows.map((row) => row.projectId)),
      this.store.users(rows.flatMap((row) => (row.subject.actorId === undefined ? [] : [row.subject.actorId]))),
    ]);
    const projectNames = new Map(projects.map((project) => [project.projectId, project.name]));
    const pages = new Map<string, Promise<{ key: string; path: string; title: string } | null>>();
    const pageOf = (projectId: string, key: string): Promise<{ key: string; path: string; title: string } | null> => {
      const cacheKey = `${projectId}\u0000${key}`;
      let page = pages.get(cacheKey);
      if (page === undefined) {
        page = this.brain.lookup(projectId, key.startsWith("path:") ? key.slice("path:".length) : key).then(
          (found) => {
            const document = found.matches.find((match) => match.kind === "document");
            return document === undefined ? null : { key, path: document.path, title: document.title };
          },
          // The Brain is off or not built, or the page is gone: the notification is still shown, without a page.
          () => null,
        );
        pages.set(cacheKey, page);
      }
      return page;
    };
    return Promise.all(
      rows.map(async (row): Promise<NotificationView> => {
        const actor = row.subject.actorId === undefined ? undefined : people.get(row.subject.actorId);
        return {
          id: row.id,
          kind: row.kind,
          projectId: row.projectId,
          projectName: projectNames.get(row.projectId) ?? row.projectId,
          page: row.subject.pageKey === undefined ? null : await pageOf(row.projectId, row.subject.pageKey),
          actor: actor ?? { username: "", displayName: "Someone" },
          ...(row.subject.commentId === undefined ? {} : { commentId: row.subject.commentId }),
          at: row.createdAt,
          read: row.readAt !== null,
        };
      }),
    );
  }
}
