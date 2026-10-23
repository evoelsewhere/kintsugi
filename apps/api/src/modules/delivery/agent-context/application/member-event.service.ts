import { ConflictException, ForbiddenException, Injectable, InternalServerErrorException } from "@nestjs/common";
import { taskEventQuerySchema, taskEventSchema, type TaskEvent, type TaskEventQuery } from "@kintsugi/harness-sdk";
import type { MemberPrincipal } from "#modules/core/auth/index.js";
import { ProjectAccessPort } from "../domain/project-access.ports.js";
import { MemberEventPrincipalRevalidator, MemberEventReader, type PreparedMemberEventStream } from "../domain/member-event.port.js";

const MAX_EVENT_BATCH = 100;
const POLL_INTERVAL_MS = 1_000;
const REAUTHORIZE_INTERVAL_MS = 10_000;

@Injectable()
export class MemberEventService {
  constructor(
    private readonly events: MemberEventReader,
    private readonly projectAccess: ProjectAccessPort,
    private readonly revalidator: MemberEventPrincipalRevalidator,
  ) {}

  async prepare(principal: MemberPrincipal, query: TaskEventQuery, lastEventId?: string): Promise<PreparedMemberEventStream> {
    const parsed = taskEventQuerySchema.parse({
      ...query,
      ...(lastEventId === undefined ? {} : { afterEventId: lastEventId }),
    });
    if (!principal.projectIds.includes(parsed.projectId)) throw new ForbiddenException("The token is not scoped to this project");
    await this.projectAccess.requireRead(principal.userId, parsed.projectId);

    const sequence = parsed.afterEventId === undefined
      // A first connection replays the retained task history. This also makes a
      // reconnect safe if the transport fails before the client receives an ID.
      ? "0"
      : await this.events.resolveCursor(parsed.projectId, parsed.unitId, parsed.afterEventId);
    if (sequence === undefined) {
      throw new ConflictException({
        message: "The task event cursor is no longer available; fetch task_status and start a new watch.",
        details: { code: "MEMBER_EVENT_CURSOR_EXPIRED" },
      });
    }
    return { principal, query: parsed, sequence };
  }

  async *follow(prepared: PreparedMemberEventStream, bearerToken: string, signal: AbortSignal): AsyncGenerator<TaskEvent> {
    let sequence = prepared.sequence;
    let delivered = 0;
    let lastAuthorizedAt = 0;
    while (!signal.aborted && (prepared.query.limit === undefined || delivered < prepared.query.limit)) {
      if (Date.now() - lastAuthorizedAt >= REAUTHORIZE_INTERVAL_MS) {
        await this.authorizeAgain(prepared, bearerToken);
        lastAuthorizedAt = Date.now();
      }

      const remaining = prepared.query.limit === undefined
        ? MAX_EVENT_BATCH
        : Math.min(MAX_EVENT_BATCH, prepared.query.limit - delivered);
      const batch = await this.events.readAfter(prepared.query.projectId, prepared.query.unitId, sequence, remaining);
      if (batch.length === 0) {
        await waitForPoll(signal);
        continue;
      }

      for (const envelope of batch) {
        if (signal.aborted) return;
        // Recheck before every delivery so a revoked token or Project Access grant
        // cannot receive the remainder of a batch. Idle streams are checked above.
        await this.authorizeAgain(prepared, bearerToken);
        lastAuthorizedAt = Date.now();
        const event = taskEventSchema.parse(envelope.event);
        if (
          event.projectId !== prepared.query.projectId ||
          event.unitId !== prepared.query.unitId ||
          !/^(0|[1-9]\d*)$/.test(envelope.sequence) ||
          BigInt(envelope.sequence) <= BigInt(sequence)
        ) {
          throw new InternalServerErrorException("The stored task event does not match its stream cursor");
        }
        sequence = envelope.sequence;
        delivered += 1;
        yield event;
        if (prepared.query.limit !== undefined && delivered >= prepared.query.limit) return;
      }
    }
  }

  private async authorizeAgain(prepared: PreparedMemberEventStream, bearerToken: string): Promise<void> {
    await this.revalidator.revalidate(prepared.principal, prepared.query.projectId, bearerToken);
    await this.projectAccess.requireRead(prepared.principal.userId, prepared.query.projectId);
  }
}

async function waitForPoll(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, POLL_INTERVAL_MS);
    const abort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      resolve();
    };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
}
