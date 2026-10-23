import { Global, Module } from "@nestjs/common";
import { ChangeFeed } from "./change-feed.js";

/** One LISTEN connection for the whole API (migration 026); global so any module can follow changes. */
@Global()
@Module({ providers: [ChangeFeed], exports: [ChangeFeed] })
export class RealtimeModule {}
