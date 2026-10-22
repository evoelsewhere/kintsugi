// Version pins for the Kintsugi Runtime (ADR-0018). `PI_VERSION` must always match
// the exact `@earendil-works/*` pins in package.json; `engine` reports it on every job.

/** Pinned pi release. Bump deliberately: exact pin + the kernel smoke suite (ADR-0023). */
export const PI_VERSION = "1.3.0";

/** Kintsugi Runtime release; travels in job provenance and telemetry. */
export const RUNTIME_VERSION = "0.0.0";

/** Value of `AgentRuntime.engine` for the pi backend. */
export const PI_ENGINE_ID = `pi@${PI_VERSION}` as const;
