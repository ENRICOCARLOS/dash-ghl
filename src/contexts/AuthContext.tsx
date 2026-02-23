"use client";

import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Client } from "@/types/database";
import type { Session } from "@supabase/supabase-js";

export type Role = "ADM" | "user";

export type AuthProfile = {
  id: string;
  email: string;
  full_name: string | null;
  role: Role;
};

type AuthContextValue = {
  user: AuthProfile | null;
  clients: Client[];
  loading: boolean;
  login: (email: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  logout: () => void;
  refreshClients: (accessToken?: string | null) => Promise<{ user: AuthProfile | null; clients: Client[] }>;
  isAdm: boolean;
  getAccessToken: () => Promise<string | null>;
  authFetch: (url: string, init?: RequestInit) => Promise<Response>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

async function fetchSession(accessToken?: string | null) {
  const headers: HeadersInit = {};
  if (accessToken) headers["Authorization"] = `Bearer ${accessToken}`;
  const res = await fetch("/api/auth/session", { headers });
  if (!res.ok) return { user: null, clients: [] };
  const data = await res.json();
  return { user: data.user, clients: data.clients ?? [] };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthProfile | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const tokenCache = useRef<string | null>(null);

  const refreshSession = useCallback(async (accessToken?: string | null) => {
    const token = accessToken ?? tokenCache.current;
    const { user: u, clients: c } = await fetchSession(token);
    setUser(u);
    setClients(c ?? []);
    if (token) tokenCache.current = token;
    return { user: u, clients: c ?? [] };
  }, []);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    const TIMEOUT_MS = 2_000;

    (async () => {
      try {
        const session = await Promise.race([
          supabase.auth.getSession().then((r) => r.data.session),
          new Promise<null>((_, reject) => setTimeout(() => reject(new Error("timeout")), TIMEOUT_MS)),
        ]);
        if (cancelled) return;
        if (session) {
          tokenCache.current = session.access_token;
          await refreshSession(session.access_token);
        } else {
          setUser(null);
          setClients([]);
        }
      } catch {
        if (!cancelled) {
          setUser(null);
          setClients([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session: Session | null) => {
      if (session?.access_token) {
        tokenCache.current = session.access_token;
        refreshSession(session.access_token).catch(() => {});
      } else {
        setUser(null);
        setClients([]);
      }
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [refreshSession]);

  const login = useCallback(async (email: string, password: string) => {
    const supabase = createClient();
    const SIGN_IN_TIMEOUT_MS = 15_000;

    let resolved: Awaited<ReturnType<typeof supabase.auth.signInWithPassword>>;
    try {
      resolved = await Promise.race([
        supabase.auth.signInWithPassword({ email: email.trim(), password }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("signin_timeout")), SIGN_IN_TIMEOUT_MS)
        ),
      ]);
    } catch {
      return { ok: false, error: "Tempo esgotado. Tente novamente." };
    }

    const { data, error } = resolved;
    if (error) return { ok: false, error: error.message };
    if (!data?.session) return { ok: false, error: "Sessão não retornada. Tente novamente." };

    const token = data.session.access_token;
    const u = data.session.user;
    tokenCache.current = token;

    const REFRESH_TIMEOUT_MS = 5_000;
    try {
      await Promise.race([
        refreshSession(token),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("refresh_timeout")), REFRESH_TIMEOUT_MS)
        ),
      ]);
    } catch {
      setUser({
        id: u.id,
        email: u.email ?? "",
        full_name: (u.user_metadata?.full_name ?? u.user_metadata?.name) as string | null ?? null,
        role: "user",
      });
      setClients([]);
    }

    return { ok: true };
  }, [refreshSession]);

  const logout = useCallback((): void => {
    tokenCache.current = null;
    setUser(null);
    setClients([]);
    createClient().auth.signOut().catch(() => {});
  }, []);

  const getAccessToken = useCallback(async () => {
    if (tokenCache.current) return tokenCache.current;
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (session) tokenCache.current = session.access_token;
    return session?.access_token ?? null;
  }, []);

  const authFetch = useCallback(async (url: string, init?: RequestInit) => {
    const token = tokenCache.current ?? await getAccessToken();
    const headers = new Headers(init?.headers);
    if (token) headers.set("Authorization", `Bearer ${token}`);
    return fetch(url, { ...init, headers });
  }, [getAccessToken]);

  const value: AuthContextValue = {
    user,
    clients,
    loading,
    login,
    logout,
    refreshClients: refreshSession,
    isAdm: user?.role === "ADM",
    getAccessToken,
    authFetch,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth deve ser usado dentro de AuthProvider");
  return ctx;
}
