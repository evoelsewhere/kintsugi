// Authentication state for the portal (ADR-0008): session token + current user with
// roles and effective permissions. Token storage and expiry live in ./session.

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { apiGet, apiSend } from "./api";
import { getToken, onSessionExpired, setToken } from "./session";

export interface SessionUser {
  id: string;
  username: string;
  displayName: string;
  roleIds: string[];
  permissions: string[];
}

interface AuthState {
  user: SessionUser | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  can: (permission: string) => boolean;
}

const AuthContext = createContext<AuthState | null>(null);

export function useAuth(): AuthState {
  const state = useContext(AuthContext);
  if (state === null) throw new Error("useAuth must be used inside AuthProvider");
  return state;
}

export function AuthProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => onSessionExpired(() => setUser(null)), []);

  useEffect(() => {
    if (getToken() === null) {
      setLoading(false);
      return;
    }
    apiGet<SessionUser>("/api/auth/me")
      .then(setUser)
      .catch(() => {
        setToken(null);
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      user,
      loading,
      login: async (username, password) => {
        const result = await apiSend<{ token: string; user: SessionUser }>("/api/auth/login", "POST", { username, password });
        setToken(result.token);
        setUser(result.user);
      },
      logout: async () => {
        try {
          await apiSend<void>("/api/auth/logout", "POST");
        } catch {
          // Session may already be gone — clearing local state is enough.
        }
        setToken(null);
        setUser(null);
      },
      can: (permission) => user?.permissions.includes(permission) ?? false,
    }),
    [user, loading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
