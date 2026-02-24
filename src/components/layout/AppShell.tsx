"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { Sidebar } from "@/components/layout/Sidebar";
import { Topbar } from "@/components/layout/Topbar";

export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { user, loading } = useAuth();

  useEffect(() => {
    if (loading) return;
    if (!user) router.replace("/");
  }, [loading, user, router]);

  if (loading || !user) {
    return (
      <div
        style={{ background: "var(--bg-base)" }}
        className="flex min-h-screen flex-col items-center justify-center gap-3"
      >
        <div
          style={{ borderColor: "var(--accent)", borderTopColor: "transparent" }}
          className="h-8 w-8 animate-spin rounded-full border-2"
        />
        <p
          style={{ fontFamily: "var(--font-mono)", color: "var(--text-dim)" }}
          className="text-[9px] uppercase tracking-[0.2em]"
        >
          Carregando...
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen" style={{ background: "var(--bg-base)" }}>
      <Sidebar />
      {/* Main area — offset by sidebar width */}
      <div
        style={{ marginLeft: "var(--sidebar-w)" }}
        className="flex min-h-screen flex-1 flex-col"
      >
        <Topbar />
        <main
          style={{ position: "relative", zIndex: 1, minWidth: 0 }}
          className="flex-1 overflow-y-auto overflow-x-hidden px-6 py-5 text-[var(--text-primary)]"
        >
          {children}
        </main>
      </div>
    </div>
  );
}
