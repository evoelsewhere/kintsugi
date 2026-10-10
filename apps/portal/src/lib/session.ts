// Session token storage (ADR-0008) shared by the API client and the auth context.
// The token lives in localStorage and rides every request as a bearer header. When
// the API rejects it (expired, revoked, member disabled), the session ends here and
// listeners — the auth context — drop the user, which routes back to sign-in.

const TOKEN_KEY = "kintsugi-token";

type ExpiredListener = () => void;
const expiredListeners = new Set<ExpiredListener>();

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (token === null) localStorage.removeItem(TOKEN_KEY);
  else localStorage.setItem(TOKEN_KEY, token);
}

/** Clears the stored token and notifies listeners that the session is gone. */
export function expireSession(): void {
  setToken(null);
  for (const listener of expiredListeners) listener();
}

/** Subscribes to session expiry; returns the unsubscribe function. */
export function onSessionExpired(listener: ExpiredListener): () => void {
  expiredListeners.add(listener);
  return () => {
    expiredListeners.delete(listener);
  };
}
