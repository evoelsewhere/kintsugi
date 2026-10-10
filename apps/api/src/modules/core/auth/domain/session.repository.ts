// Port of sign-in sessions (ADR-0008). Implemented by infrastructure adapters; the
// application layer depends only on this contract.

/** How long a session lives after sign-in. The session cookie uses the same lifetime. */
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

export abstract class SessionRepository {
  /** Creates a session and returns its raw token — shown to the caller once, never stored. */
  abstract create(userId: string): Promise<string>;
  /** The session's user id, or undefined when the token is unknown or expired. */
  abstract validate(token: string): Promise<string | undefined>;
  abstract revoke(token: string): Promise<void>;
}
