import { Module } from "@nestjs/common";
import { EventsController } from "./events.controller.js";

/** The portal's live-update stream: which topics changed, over Server-Sent Events. */
@Module({ controllers: [EventsController] })
export class EventsModule {}
