"use client";

import { useState, useCallback } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { useActiveClient } from "@/contexts/ActiveClientContext";

export type SyncMessage = { type: "ok" | "error" | "rate_limit"; text: string } | null;

/* ── Breadcrumb map ── */
const BREADCRUMBS: Record<string, string> = {
  "/relatorio":          "Relatório",
  "/visao-funil":        "Visão Funil",
  "/gerenciar-clientes": "Gerenciar Clientes",
  "/diagnostico":        "Diagnóstico",
};

function getBreadcrumb(pathname: string): string {
  for (const [prefix, label] of Object.entries(BREADCRUMBS)) {
    if (pathname === prefix || pathname.startsWith(prefix + "/")) return label;
  }
  return "Painel";
}

/* ── Icons ── */
const SyncIcon = (
  <svg width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
  </svg>
);
const SpinIcon = (
  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
);
const SpinIconSecondary = (
  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-[var(--accent)] border-t-transparent" />
);
const BuildingIcon = (
  <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
  </svg>
);
const ChevronIcon = (
  <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
  </svg>
);
const CheckIcon = (
  <svg width="14" height="14" fill="currentColor" viewBox="0 0 20 20" aria-hidden>
    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
  </svg>
);

export function Topbar() {
  const router = useRouter();
  const pathname = usePathname();
  const { authFetch, clients, isAdm } = useAuth();
  const { activeClient, setActiveClientId } = useActiveClient();
  const [switcherOpen, setSwitcherOpen] = useState(false);

  const [syncingGhl, setSyncingGhl] = useState(false);
  const [syncGhlMessage, setSyncGhlMessage] = useState<SyncMessage>(null);
  const [syncingMeta, setSyncingMeta] = useState(false);
  const [syncMetaMessage, setSyncMetaMessage] = useState<SyncMessage>(null);
  const [metaDateModalOpen, setMetaDateModalOpen] = useState(false);
  const [metaDateStart, setMetaDateStart] = useState("");
  const [metaDateEnd, setMetaDateEnd] = useState("");

  const [syncingUser, setSyncingUser] = useState(false);
  const [syncUserMessage, setSyncUserMessage] = useState<SyncMessage>(null);

  const clientId = activeClient?.id ?? null;
  const breadcrumb = getBreadcrumb(pathname);

  const handleSyncGhl = useCallback(async () => {
    if (!clientId) return;
    setSyncingGhl(true);
    setSyncGhlMessage(null);
    try {
      const res = await authFetch("/api/ghl/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: clientId, mode: "full" }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 429) {
        const sec = data.retry_after_seconds ?? 300;
        setSyncGhlMessage({ type: "rate_limit", text: `Aguarde ${Math.ceil(sec / 60)} min para atualizar novamente.` });
        return;
      }
      if (!res.ok) { setSyncGhlMessage({ type: "error", text: data.error ?? "Erro ao atualizar dados" }); return; }
      const parts = [
        data.pipelines != null && `${data.pipelines} pipelines`,
        data.calendars != null && `${data.calendars} calendários`,
        data.users != null && `${data.users} usuários`,
        data.opportunities != null && `${data.opportunities} oportunidades`,
        data.calendar_events != null && `${data.calendar_events} eventos`,
      ].filter(Boolean);
      setSyncGhlMessage({ type: "ok", text: parts.length > 0 ? `GHL: ${parts.join(", ")}.` : "Dados GHL atualizados." });
      setTimeout(() => setSyncGhlMessage(null), 5000);
      window.dispatchEvent(new CustomEvent("dash-ghl-sync-complete"));
    } catch { setSyncGhlMessage({ type: "error", text: "Erro ao atualizar dados GHL." }); }
    finally { setSyncingGhl(false); }
  }, [clientId, authFetch]);

  const handleUserAtualizarAgora = useCallback(async () => {
    if (!clientId) return;
    setSyncingUser(true);
    setSyncUserMessage(null);
    try {
      const res = await authFetch("/api/ghl/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: clientId, mode: "incremental_1h" }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 429) {
        if (data.code === "volume_exceeded") {
          setSyncUserMessage({ type: "error", text: "Volume excedido. Contate o administrador." });
        } else {
          const sec = data.retry_after_seconds ?? 120;
          setSyncUserMessage({ type: "rate_limit", text: `Aguarde ${Math.ceil(sec / 60)} min antes de atualizar.` });
        }
        return;
      }
      if (!res.ok) { setSyncUserMessage({ type: "error", text: data.error ?? "Erro ao atualizar." }); return; }
      const parts = [
        data.opportunities != null && `${data.opportunities} oportunidades`,
        data.calendar_events != null && `${data.calendar_events} eventos`,
      ].filter(Boolean);
      setSyncUserMessage({ type: "ok", text: parts.length > 0 ? `Atualizado: ${parts.join(", ")}.` : "Atualização concluída." });
      setTimeout(() => setSyncUserMessage(null), 5000);
      window.dispatchEvent(new CustomEvent("dash-ghl-sync-complete"));
    } catch { setSyncUserMessage({ type: "error", text: "Erro ao atualizar." }); }
    finally { setSyncingUser(false); }
  }, [clientId, authFetch]);

  const openMetaDateModal = useCallback(() => {
    const today = new Date();
    const defaultEnd = today.toISOString().slice(0, 10);
    const defaultStart = new Date(today);
    defaultStart.setDate(defaultStart.getDate() - 30);
    setMetaDateStart(defaultStart.toISOString().slice(0, 10));
    setMetaDateEnd(defaultEnd);
    setMetaDateModalOpen(true);
  }, []);

  const handleSyncMeta = useCallback(
    async (dateStart: string, dateEnd: string) => {
      if (!clientId) return;
      setSyncingMeta(true);
      setSyncMetaMessage(null);
      setMetaDateModalOpen(false);
      try {
        const res = await authFetch("/api/facebook-ads/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            client_id: clientId,
            date_start: dateStart,
            date_end: dateEnd,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.status === 429) {
          const sec = data.retry_after_seconds ?? 300;
          setSyncMetaMessage({ type: "rate_limit", text: `Aguarde ${Math.ceil(sec / 60)} min antes de atualizar Meta.` });
          return;
        }
        if (!res.ok) {
          setSyncMetaMessage({ type: "error", text: data.error ?? "Erro ao atualizar dados Meta." });
          return;
        }
        setSyncMetaMessage({ type: "ok", text: data.message ?? `Meta: ${data.rows_upserted ?? 0} registros.` });
        setTimeout(() => setSyncMetaMessage(null), 5000);
        window.dispatchEvent(new CustomEvent("dash-ghl-sync-complete"));
      } catch {
        setSyncMetaMessage({ type: "error", text: "Erro ao atualizar dados Meta." });
      } finally {
        setSyncingMeta(false);
      }
    },
    [clientId, authFetch]
  );

  const confirmMetaDateRange = useCallback(() => {
    const start = metaDateStart.trim();
    const end = metaDateEnd.trim();
    if (!start || !end) return;
    const dStart = new Date(start);
    const dEnd = new Date(end);
    if (Number.isNaN(dStart.getTime()) || Number.isNaN(dEnd.getTime())) return;
    if (dStart > dEnd) {
      setSyncMetaMessage({ type: "error", text: "Data início deve ser anterior à data fim." });
      return;
    }
    handleSyncMeta(start, end);
  }, [metaDateStart, metaDateEnd, handleSyncMeta]);

  const activeMessage = syncGhlMessage || syncMetaMessage || syncUserMessage;

  const msgColor = {
    ok:         "var(--accent)",
    error:      "var(--danger)",
    rate_limit: "var(--warning)",
  };

  return (
    <header
      style={{
        height: "var(--topbar-h)",
        background: "rgba(8,9,9,0.95)",
        backdropFilter: "blur(12px)",
        borderBottom: "1px solid var(--border)",
      }}
      className="sticky top-0 z-30 flex shrink-0 items-center justify-between px-6"
    >
      {/* Left: client picker + breadcrumb */}
      <div className="flex items-center gap-3">
        {/* Client picker */}
        {clients.length > 0 ? (
          <div className="relative">
            <button
              type="button"
              onClick={() => setSwitcherOpen(!switcherOpen)}
              style={{
                background: "var(--bg-card)",
                border: "1px solid var(--border)",
              }}
              className="flex items-center gap-2 rounded-[10px] px-3 py-1.5 text-[13px] font-semibold text-[var(--text-primary)] transition-all duration-150 hover:border-[var(--border-subtle)]"
            >
              <span style={{ color: "var(--text-dim)" }}>{BuildingIcon}</span>
              <span>{activeClient ? activeClient.name : "Selecione a conta"}</span>
              <span style={{ color: "var(--text-dim)" }}>{ChevronIcon}</span>
            </button>
            {switcherOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setSwitcherOpen(false)} aria-hidden />
                <ul
                  style={{ background: "var(--bg-card)", border: "1px solid var(--border)" }}
                  className="absolute left-0 top-full z-20 mt-1 max-h-60 w-56 overflow-auto rounded-xl py-1 shadow-[0_8px_28px_rgba(0,0,0,0.6)]"
                  role="listbox"
                >
                  {clients.map((c) => (
                    <li key={c.id} role="option">
                      <button
                        type="button"
                        className="flex w-full items-center justify-between px-3 py-2 text-left text-[13px] transition-colors"
                        style={
                          activeClient?.id === c.id
                            ? { background: "var(--accent-dim)", color: "var(--accent)", fontWeight: 600 }
                            : { color: "var(--text-primary)" }
                        }
                        onClick={() => {
                          setActiveClientId(c.id);
                          setSwitcherOpen(false);
                          if (pathname.startsWith("/relatorio")) router.push(`/relatorio/${c.id}`);
                        }}
                      >
                        {c.name}
                        {activeClient?.id === c.id && (
                          <span style={{ color: "var(--accent)" }}>{CheckIcon}</span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        ) : (
          <span className="text-[13px] text-[var(--text-dim)]">Nenhuma conta vinculada</span>
        )}

        {/* Breadcrumb */}
        <div
          style={{ fontFamily: "var(--font-mono)" }}
          className="flex items-center gap-1.5 text-[8.5px] uppercase tracking-[0.18em] text-[var(--text-dim)]"
        >
          Painel
          <span style={{ color: "var(--text-secondary)" }}>/</span>
          <span style={{ color: "var(--text-secondary)" }}>{breadcrumb}</span>
        </div>
      </div>

      {/* Right: sync buttons + live badge */}
      <div className="flex items-center gap-2">
        {/* Feedback message */}
        {activeMessage && (
          <div
            className="mr-1 max-w-xs rounded-lg border-l-4 px-3 py-1.5 text-xs"
            style={{
              borderLeftColor: msgColor[activeMessage.type],
              background: `${msgColor[activeMessage.type]}15`,
              color: msgColor[activeMessage.type],
            }}
          >
            {activeMessage.text}
          </div>
        )}

        {isAdm ? (
          <>
            <button
              type="button"
              onClick={handleSyncGhl}
              disabled={syncingGhl || !clientId}
              className="btn-primary disabled:opacity-50"
            >
              {syncingGhl ? SpinIcon : SyncIcon}
              {syncingGhl ? "Atualizando..." : "Atualizar GHL"}
            </button>
            <button
              type="button"
              onClick={openMetaDateModal}
              disabled={syncingMeta || !clientId}
              className="btn-secondary disabled:opacity-50"
            >
              {syncingMeta ? SpinIconSecondary : SyncIcon}
              {syncingMeta ? "Atualizando..." : "Atualizar Meta"}
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={handleUserAtualizarAgora}
            disabled={syncingUser || !clientId}
            className="btn-secondary disabled:opacity-50"
          >
            {syncingUser ? SpinIconSecondary : SyncIcon}
            {syncingUser ? "Atualizando..." : "Atualizar agora"}
          </button>
        )}

        {/* Live badge */}
        <div
          style={{
            fontFamily: "var(--font-mono)",
            border: "1px solid var(--accent-border)",
            background: "var(--accent-dim)",
            color: "var(--accent)",
          }}
          className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[8px] uppercase tracking-[0.18em]"
        >
          <span
            style={{
              width: 5, height: 5, borderRadius: "50%",
              background: "var(--accent)",
              boxShadow: "0 0 6px var(--accent-glow)",
              animation: "blink 1.8s ease infinite",
              display: "inline-block",
              flexShrink: 0,
            }}
          />
          Ao vivo
        </div>
      </div>

      {/* Modal: período para atualizar Meta (dd/mm/aaaa) */}
      {metaDateModalOpen && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/60"
            onClick={() => setMetaDateModalOpen(false)}
            aria-hidden
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="meta-date-modal-title"
            style={{
              background: "var(--bg-card)",
              border: "1px solid var(--border)",
              boxShadow: "0 12px 40px rgba(0,0,0,0.5)",
            }}
            className="fixed left-1/2 top-1/2 z-50 w-[min(90vw,340px)] -translate-x-1/2 -translate-y-1/2 rounded-xl p-5"
          >
            <h2 id="meta-date-modal-title" className="text-sm font-semibold text-[var(--text-primary)] mb-4">
              Período para atualizar dados Meta
            </h2>
            <p className="text-xs text-[var(--text-dim)] mb-4">
              Defina a data de início e fim. Os dados serão atualizados dia a dia (formato dd/mm/aaaa).
            </p>
            <div className="flex flex-col gap-3 mb-5">
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-[var(--text-secondary)]">Data início</span>
                <input
                  type="date"
                  value={metaDateStart}
                  onChange={(e) => setMetaDateStart(e.target.value)}
                  className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-[13px] text-[var(--text-primary)]"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-[var(--text-secondary)]">Data fim</span>
                <input
                  type="date"
                  value={metaDateEnd}
                  onChange={(e) => setMetaDateEnd(e.target.value)}
                  className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-[13px] text-[var(--text-primary)]"
                />
              </label>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setMetaDateModalOpen(false)}
                className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-[13px] text-[var(--text-secondary)] hover:bg-[var(--bg)]"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={confirmMetaDateRange}
                className="btn-primary px-3 py-1.5 text-[13px]"
              >
                Atualizar
              </button>
            </div>
          </div>
        </>
      )}
    </header>
  );
}
