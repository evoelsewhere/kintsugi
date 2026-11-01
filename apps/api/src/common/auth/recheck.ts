// How to check again, later in a long-lived request (an event stream), that its credentials still hold: the
// authentication guard records it on the request, the stream asks it on each heartbeat. Signing out, a password
// reset or disabling a member end their sessions; an open stream then ends too.

import type { Request } from "express";

const RECHECK = Symbol("kintsugi.recheck");

type RecheckingRequest = Request & { [RECHECK]?: () => Promise<boolean> };

/** Records how to re-authenticate the request: true while its session or token is still valid. */
export function setRecheck(request: Request, recheck: () => Promise<boolean>): void {
  (request as RecheckingRequest)[RECHECK] = recheck;
}

/** The re-check the authentication guard recorded, or undefined for a public route. */
export function recheckOf(request: Request): (() => Promise<boolean>) | undefined {
  return (request as RecheckingRequest)[RECHECK];
}
