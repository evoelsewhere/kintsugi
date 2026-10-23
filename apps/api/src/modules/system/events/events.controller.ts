import { Controller, Get, Req, Res } from "@nestjs/common";
import { ApiOperation, ApiProduces, ApiTags } from "@nestjs/swagger";
import type { Request, Response } from "express";
import { openEventStream } from "#common/interface/sse.js";
import { type Change, ChangeFeed } from "#common/realtime/change-feed.js";

/** Changes that come in a burst leave as one event this long after the first. */
const FLUSH_MS = 400;
/** Topics the portal follows. `job-events` (one per log line) is not one of them: a run's own stream carries those. */
const TOPICS: ReadonlySet<string> = new Set(["job-runs", "document-writes", "repositories", "workers", "gates", "audit", "telemetry"]);

@ApiTags("system")
@Controller("events")
export class EventsController {
  constructor(private readonly feed: ChangeFeed) {}

  @Get()
  @ApiProduces("text/event-stream")
  @ApiOperation({
    summary: "Follow what changes in the installation (Server-Sent Events), so views refresh when it does instead of on a timer",
    description:
      "Events: `ready` (the stream is open), `change` ({ changes: [{ topic, scope }] }: what changed since the last event, " +
      "deduplicated; `scope` is a project id, or empty), `resync` (the connection to the database was lost and restored: read everything again). " +
      "Carries topic names and ids only, never data. Needs a session.",
  })
  events(@Req() request: Request, @Res() response: Response): void {
    const stream = openEventStream(request, response);
    const pending = new Map<string, Change>();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const flush = (): void => {
      timer = undefined;
      if (pending.size === 0) return;
      stream.send("change", { changes: [...pending.values()] });
      pending.clear();
    };
    const unsubscribe = this.feed.subscribe((change) => {
      if (change === "resync") {
        stream.send("resync", {});
        return;
      }
      if (!TOPICS.has(change.topic)) return;
      pending.set(`${change.topic}\u0000${change.scope}`, change);
      timer ??= setTimeout(flush, FLUSH_MS);
    });
    stream.signal.addEventListener(
      "abort",
      () => {
        unsubscribe();
        clearTimeout(timer);
      },
      { once: true },
    );
    stream.send("ready", {});
  }
}
