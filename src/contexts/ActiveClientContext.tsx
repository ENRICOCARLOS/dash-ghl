"use client";

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import type { Client } from "@/types/database";

type ActiveClientContextValue = {
  activeClient: Client | null;
  setActiveClient: (client: Client | null) => void;
  activeClientId: string | null;
  setActiveClientId: (id: string) => void;
  loading: boolean;
};

const ActiveClientContext = createContext<ActiveClientContextValue | null>(null);

const noAuthFetch = (url: string, init?: RequestInit) => fetch(url, init);

export function ActiveClientProvider({
  children,
  clients,
  authFetch = noAuthFetch,
}: {
  children: ReactNode;
  clients: Client[];
  authFetch?: (url: string, init?: RequestInit) => Promise<Response>;
}) {
  const [activeClient, setActiveClientState] = useState<Client | null>(null);
  const [loading, setLoading] = useState(true);

  const persistActive = useCallback((clientId: string | null) => {
    authFetch("/api/auth/active-client", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: clientId ?? "" }),
    }).catch(() => {});
  }, [authFetch]);

  const setActiveClient = useCallback((client: Client | null) => {
    setActiveClientState(client);
    persistActive(client?.id ?? null);
  }, [persistActive]);

  const setActiveClientId = useCallback((id: string) => {
    const client = clients.find((c) => c.id === id) ?? null;
    setActiveClientState(client);
    persistActive(client?.id ?? null);
  }, [clients, persistActive]);

  useEffect(() => {
    if (clients.length === 0) {
      setActiveClientState(null);
      setLoading(false);
      return;
    }
    const first = clients[0];
    setActiveClientState(first);
    setLoading(false);
    authFetch("/api/auth/active-client")
      .then((r) => r.json())
      .then((data) => {
        const id = data.client_id;
        if (id && clients.some((c) => c.id === id)) {
          setActiveClientState(clients.find((c) => c.id === id) ?? first);
        } else {
          authFetch("/api/auth/active-client", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ client_id: first.id }),
          }).catch(() => {});
        }
      })
      .catch(() => {});
  }, [clients, authFetch]);

  const value: ActiveClientContextValue = {
    activeClient,
    setActiveClient,
    activeClientId: activeClient?.id ?? null,
    setActiveClientId,
    loading,
  };

  return <ActiveClientContext.Provider value={value}>{children}</ActiveClientContext.Provider>;
}

export function useActiveClient(): ActiveClientContextValue {
  const ctx = useContext(ActiveClientContext);
  if (!ctx) throw new Error("useActiveClient deve ser usado dentro de ActiveClientProvider");
  return ctx;
}
