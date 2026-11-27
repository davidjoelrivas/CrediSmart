import type { LoginRequest, SessionUser } from "@app/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, ApiError, onUnauthorized } from "./api";

interface AuthState {
  /** undefined = todavía comprobando la sesión; null = sin sesión. */
  user: SessionUser | null | undefined;
  login(credentials: LoginRequest): Promise<SessionUser>;
  logout(): Promise<void>;
  can(permission: string): boolean;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null | undefined>(undefined);
  const queryClient = useQueryClient();

  useEffect(() => {
    let active = true;
    api<{ user: SessionUser }>("/auth/me")
      .then((result) => active && setUser(result.user))
      .catch((error: unknown) => {
        if (active && (error instanceof ApiError ? error.status === 401 : true)) {
          setUser(null);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(
    () =>
      onUnauthorized(() => {
        queryClient.clear();
        setUser(null);
      }),
    [queryClient],
  );

  const login = useCallback(
    async (credentials: LoginRequest) => {
      const result = await api<{ user: SessionUser }>("/auth/login", { method: "POST", body: credentials });
      queryClient.clear();
      setUser(result.user);
      return result.user;
    },
    [queryClient],
  );

  const logout = useCallback(async () => {
    try {
      await api("/auth/logout", { method: "POST", body: {} });
    } finally {
      queryClient.clear();
      setUser(null);
    }
  }, [queryClient]);

  const value = useMemo<AuthState>(
    () => ({ user, login, logout, can: (permission) => user?.permissions.includes(permission) ?? false }),
    [user, login, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth debe usarse dentro de AuthProvider");
  }
  return context;
}
