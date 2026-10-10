// Session lifecycle in the portal (ADR-0008). The session itself is an httpOnly
// cookie set by the API — page scripts never see the token. When the API rejects a
// request with 401 (expired, revoked, member disabled), the session ends here and
// listeners — the auth context — drop the user, which routes back to sign-in.

type ExpiredListener = () => void;
const expiredListeners = new Set<ExpiredListener>();

/** Notifies listeners that the session is gone. */
export function expireSession(): void {
  for (const listener of expiredListeners) listener();
}

/** Subscribes to session expiry; returns the unsubscribe function. */
export function onSessionExpired(listener: ExpiredListener): () => void {
  expiredListeners.add(listener);
  return () => {
    expiredListeners.delete(listener);
  };
}

// Earlier builds kept a bearer token in localStorage; never leave one behind.
localStorage.removeItem("kintsugi-token");
