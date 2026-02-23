"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { useActiveClient } from "@/contexts/ActiveClientContext";

/* ── Icons ── */
const Icon = {
  report: (
    <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
    </svg>
  ),
  funnel: (
    <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
    </svg>
  ),
  clients: (
    <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  ),
  predef: (
    <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
    </svg>
  ),
  diagnostico: (
    <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
    </svg>
  ),
  settings: (
    <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  ),
  logout: (
    <svg width="15" height="15" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
    </svg>
  ),
};

type NavItemDef = {
  href: string;
  label: string;
  icon: React.ReactNode;
  matchPrefix?: string | null;
  badge?: string;
};

type NavSection = {
  label: string;
  items: NavItemDef[];
};

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, isAdm, logout, clients } = useAuth();
  const { activeClient } = useActiveClient();

  const relatorioHref = activeClient ? `/relatorio/${activeClient.id}` : "/relatorio";

  const sections: NavSection[] = [
    {
      label: "Principal",
      items: [
        { href: relatorioHref, label: "Relatório", icon: Icon.report, matchPrefix: "/relatorio" },
      ],
    },
    ...(isAdm
      ? [
          {
            label: "Gestão",
            items: [
              {
                href: "/gerenciar-clientes",
                label: "Gerenciar Clientes",
                icon: Icon.clients,
                matchPrefix: "/gerenciar-clientes",
                badge: clients.length > 0 ? String(clients.length) : undefined,
              },
              { href: "/visao-funil", label: "Predefinições", icon: Icon.predef, matchPrefix: null },
            ],
          },
          {
            label: "Ferramentas",
            items: [
              { href: "/diagnostico", label: "Diagnóstico", icon: Icon.diagnostico, matchPrefix: "/diagnostico" },
            ],
          },
        ]
      : []),
  ];

  const handleLogout = () => {
    logout();
    router.replace("/");
    fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
  };

  const initials = user?.full_name
    ? user.full_name.split(" ").map((n) => n[0]).slice(0, 2).join("")
    : "U";

  return (
    <aside
      style={{
        width: "var(--sidebar-w)",
        background: "var(--bg-sidebar)",
        borderRight: "1px solid var(--border)",
      }}
      className="fixed left-0 top-0 z-40 flex h-screen flex-col"
    >
      {/* Logo */}
      <div
        style={{ height: "var(--topbar-h)", borderBottom: "1px solid var(--border)" }}
        className="flex shrink-0 items-center gap-2.5 px-4"
      >
        <div
          style={{
            background: "var(--accent)",
            boxShadow: "0 2px 12px rgba(0,212,180,0.25)",
          }}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-sm font-extrabold text-white"
        >
          G
        </div>
        <div>
          <div
            style={{ fontFamily: "var(--font-sans)" }}
            className="text-[13px] font-bold tracking-[0.06em] text-[var(--text-primary)]"
          >
            DASH{" "}
            <span style={{ color: "var(--accent)" }}>GHL</span>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-2.5 py-3">
        {sections.map((section) => (
          <div key={section.label}>
            <div
              style={{ fontFamily: "var(--font-mono)" }}
              className="mb-1.5 mt-3.5 px-2 text-[7px] uppercase tracking-[0.3em] text-[var(--text-dim)]"
            >
              {section.label}
            </div>
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const isActive = item.matchPrefix
                  ? pathname === item.matchPrefix || pathname.startsWith(item.matchPrefix + "/")
                  : pathname === item.href || pathname.startsWith(item.href + "/");

                return (
                  <li key={item.href + item.label}>
                    <Link
                      href={item.href}
                      style={
                        isActive
                          ? {
                              background: "var(--accent-dim)",
                              color: "var(--accent)",
                              borderColor: "var(--accent-border)",
                            }
                          : {}
                      }
                      className={`flex items-center gap-2.5 rounded-[10px] border px-2.5 py-2 text-[13px] font-medium transition-all duration-[180ms] ${
                        isActive
                          ? "border-[var(--accent-border)]"
                          : "border-transparent text-[var(--text-secondary)] hover:bg-[rgba(255,255,255,0.04)] hover:text-[var(--text-primary)]"
                      }`}
                    >
                      <span style={{ opacity: isActive ? 1 : 0.8 }}>{item.icon}</span>
                      <span className="flex-1">{item.label}</span>
                      {item.badge && (
                        <span
                          style={{ fontFamily: "var(--font-mono)", background: "var(--accent-dim)", color: "var(--accent)", border: "1px solid var(--accent-border)" }}
                          className="rounded-full px-1.5 py-0.5 text-[7.5px]"
                        >
                          {item.badge}
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* Footer */}
      <footer
        style={{ borderTop: "1px solid var(--border)" }}
        className="shrink-0 px-3 py-3.5"
      >
        {/* User info */}
        <div className="mb-2.5 flex items-center gap-2.5">
          <div
            style={{
              background: "linear-gradient(135deg, #1a2a2a, var(--accent))",
            }}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[12px] font-bold text-white"
          >
            {initials}
          </div>
          <div className="min-w-0">
            <p
              className="truncate text-[13px] font-semibold text-[var(--text-primary)]"
              title={user?.full_name ?? undefined}
            >
              {user?.full_name || "Usuário"}
            </p>
            <p
              className="truncate text-[11px] text-[var(--text-dim)]"
              title={user?.email ?? undefined}
            >
              {user?.email ?? ""}
            </p>
            <span
              style={{
                fontFamily: "var(--font-mono)",
                background: "var(--accent-dim)",
                color: "var(--accent)",
                border: "1px solid var(--accent-border)",
              }}
              className="mt-1 inline-block rounded-full px-2 py-0.5 text-[7px] uppercase tracking-[0.2em]"
            >
              {isAdm ? "Master" : "Usuário"}
            </span>
          </div>
        </div>

        {/* Logout */}
        <button
          type="button"
          onClick={handleLogout}
          className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12.5px] text-[var(--text-dim)] transition-all duration-150 hover:bg-[rgba(255,255,255,0.04)] hover:text-[var(--text-primary)]"
        >
          {Icon.logout}
          Sair
        </button>
      </footer>
    </aside>
  );
}
