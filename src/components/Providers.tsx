"use client";

import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { ActiveClientProvider } from "@/contexts/ActiveClientContext";

function ActiveClientWrapper({ children }: { children: React.ReactNode }) {
  const { clients, authFetch } = useAuth();
  return <ActiveClientProvider clients={clients} authFetch={authFetch}>{children}</ActiveClientProvider>;
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <ActiveClientWrapper>{children}</ActiveClientWrapper>
    </AuthProvider>
  );
}
