import type { TaskContinuationEvent, TaskEvent, TaskEventQuery } from "@kintsugi/harness-sdk";
import type { MemberPrincipal } from "#modules/core/auth/index.js";

export interface MemberEventEnvelope {
  event: TaskEvent;
  /** Monotonic project event cursor used internally; never sent to clients. */
  sequence: string;
}

export abstract class MemberEventReader {
  /** Returns the newest retained continuation notification for this exact task, if one exists. */
  abstract latestContinuation(projectId: string, unitId: string): Promise<TaskContinuationEvent | undefined>;
  /** Latest project sequence at subscription start, so a new watch follows future events only. */
  abstract latestSequence(projectId: string): Promise<string>;
  /** Resolves only a retained event from this exact project and task. */
  abstract resolveCursor(projectId: string, unitId: string, eventId: string): Promise<string | undefined>;
  /** Reads a bounded page after the internal sequence, within the seven-day replay window. */
  abstract readAfter(projectId: string, unitId: string, sequence: string, limit: number): Promise<MemberEventEnvelope[]>;
}

export abstract class MemberEventPrincipalRevalidator {
  /** Rechecks the bearer credential, current member.read permission, token scope and Project Access. */
  abstract revalidate(principal: MemberPrincipal, projectId: string, bearerToken: string): Promise<void>;
}

export interface PreparedMemberEventStream {
  principal: MemberPrincipal;
  query: TaskEventQuery;
  sequence: string;
}
