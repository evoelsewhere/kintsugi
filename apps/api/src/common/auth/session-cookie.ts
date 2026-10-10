// HTTP transport of sign-in sessions (ADR-0008): the portal's session rides an
// httpOnly, SameSite=Strict cookie scoped to /api — page scripts never see the token.
// Non-browser clients (CLI, MCP) send `Authorization: Bearer <token>` instead.
//
// CSRF: browsers attach the cookie automatically, so every unsafe request that is not
// bearer-authenticated must also carry CSRF_HEADER. A cross-site form cannot set custom
// headers, and a cross-origin fetch that sets one needs a CORS preflight the API never
// grants; SameSite=Strict is the second layer.

import type { Request, Response } from "express";

export const SESSION_COOKIE = "kintsugi_session";
export const CSRF_HEADER = "x-kintsugi-csrf";

const COOKIE_PATH = "/api";
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function bearerToken(request: Request): string | undefined {
  const header = request.headers.authorization;
  return header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;
}

export function sessionCookie(request: Request): string | undefined {
  for (const part of (request.headers.cookie ?? "").split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() === SESSION_COOKIE) return decodeURIComponent(part.slice(separator + 1).trim());
  }
  return undefined;
}

/** The session token from either transport; the bearer header wins. */
export function sessionToken(request: Request): string | undefined {
  return bearerToken(request) ?? sessionCookie(request);
}

/** True when the request may change state: safe method, bearer-authenticated, or carrying the CSRF header. */
export function passesCsrfCheck(request: Request): boolean {
  return SAFE_METHODS.has(request.method) || bearerToken(request) !== undefined || request.headers[CSRF_HEADER] === "1";
}

export function setSessionCookie(response: Response, token: string, options: { maxAgeSeconds: number; secure: boolean }): void {
  response.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "strict",
    secure: options.secure,
    path: COOKIE_PATH,
    maxAge: options.maxAgeSeconds * 1000,
  });
}

export function clearSessionCookie(response: Response, options: { secure: boolean }): void {
  response.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: "strict", secure: options.secure, path: COOKIE_PATH });
}
