// Public surface of the notifications module: other modules import only from here.

export { NotificationsModule } from "./notifications.module.js";
export { NotificationService, type MakeNotification } from "./application/notification.service.js";
export { NOTIFICATION_KINDS, type NotificationKind, type NotificationList, type NotificationView } from "./domain/notification.js";
