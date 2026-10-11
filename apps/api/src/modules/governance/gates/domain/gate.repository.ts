// Port of gates — the DI token of this module.

import type { Gate, GateFilter, GateStatus, NewGate } from "./gate.js";

export abstract class GateRepository {
  /** Newest request first, with the total. */
  abstract list(filter: GateFilter, limit: number, offset: number): Promise<{ items: Gate[]; total: number }>;
  abstract get(id: string): Promise<Gate | undefined>;
  /** The pending gate of the same project, application, key and subject, if any. */
  abstract findPending(gate: Pick<NewGate, "projectId" | "applicationId" | "gateKey" | "subject">): Promise<Gate | undefined>;
  /** Inserts a pending gate; undefined when an equal one is already pending. */
  abstract create(gate: NewGate): Promise<Gate | undefined>;
  /** Decides a pending gate; undefined when it is no longer pending. */
  abstract decide(id: string, status: Exclude<GateStatus, "pending">, decidedBy: string, note: string | undefined): Promise<Gate | undefined>;
  /** Every gate of the same project, application and key, newest first. */
  abstract history(gate: Pick<Gate, "projectId" | "applicationId" | "gateKey">, limit: number): Promise<Gate[]>;
}
