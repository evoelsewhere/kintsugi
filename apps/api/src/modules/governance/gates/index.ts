// Public surface of the gates module: other modules import only from here.

export { GatesModule } from "./gates.module.js";
export { GatesService, type RequestGate } from "./application/gates.service.js";
export type { Gate, GateStatus } from "./domain/gate.js";
