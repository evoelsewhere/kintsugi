// Authentication state for the portal (ADR-0008): the current user with roles and
// effective permissions. The session is an httpOnly cookie; expiry lives in ./session.

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { apiGet, apiSend } from "./api";
import { onSessionExpired } from "./session";

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

// The provider and its hook belong together; fast refresh reloads this module fully.
// eslint-disable-next-line react-refresh/only-export-components
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
    // The session cookie is invisible to scripts: ask the API who is signed in.
    apiGet<SessionUser>("/api/auth/me")
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      user,
      loading,
      login: async (username, password) => {
        const result = await apiSend<{ user: SessionUser }>("/api/auth/login", "POST", { username, password });
        setUser(result.user);
      },
      logout: async () => {
        try {
          await apiSend<void>("/api/auth/logout", "POST");
        } catch {
          // Session may already be gone — clearing local state is enough.
        }
        setUser(null);
      },
      can: (permission) => user?.permissions.includes(permission) ?? false,
    }),
    [user, loading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
