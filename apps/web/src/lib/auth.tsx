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

/**
 * Copia del perfil (nombre, rol y permisos; nada secreto) para poder abrir la aplicación sin internet.
 * No concede acceso: el servidor valida la sesión en cada solicitud, y la copia se borra al cerrar sesión.
 */
const PROFILE_KEY = "credismart.profile.v1";

function saveProfile(user: SessionUser | null): void {
  try {
    if (user) window.localStorage.setItem(PROFILE_KEY, JSON.stringify(user));
    else window.localStorage.removeItem(PROFILE_KEY);
  } catch {
    // Sin almacenamiento disponible: la aplicación funciona igual, solo que no abre sin internet.
  }
}

function savedProfile(): SessionUser | null {
  try {
    const raw = window.localStorage.getItem(PROFILE_KEY);
    return raw ? (JSON.parse(raw) as SessionUser) : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null | undefined>(undefined);
  const queryClient = useQueryClient();

  useEffect(() => {
    let active = true;
    api<{ user: SessionUser }>("/auth/me")
      .then((result) => {
        saveProfile(result.user);
        if (active) setUser(result.user);
      })
      .catch((error: unknown) => {
        if (!active) return;
        if (error instanceof ApiError && error.status === 0) {
          // Sin internet al abrir: se usa la copia del perfil para que la persona pueda seguir trabajando.
          setUser(savedProfile());
          return;
        }
        if (error instanceof ApiError ? error.status === 401 : true) {
          saveProfile(null);
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
        saveProfile(null);
        setUser(null);
      }),
    [queryClient],
  );

  const login = useCallback(
    async (credentials: LoginRequest) => {
      const result = await api<{ user: SessionUser }>("/auth/login", { method: "POST", body: credentials });
      queryClient.clear();
      saveProfile(result.user);
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
      saveProfile(null);
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
