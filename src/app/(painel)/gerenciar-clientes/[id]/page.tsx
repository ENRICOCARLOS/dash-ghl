"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";

export default function EditarClientePage() {
  const params = useParams();
  const id = params.id as string;
  const { authFetch } = useAuth();
  const [form, setForm] = useState({
    name: "",
    ghl_api_key: "",
    ghl_location_id: "",
    report_slug: "padrao",
    fb_access_token: "",
    fb_ad_account_id: "",
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    authFetch("/api/clients")
      .then((r) => r.json())
      .then((list: { id: string; name: string; ghl_api_key: string; ghl_location_id: string; report_slug?: string; fb_access_token?: string | null; fb_ad_account_id?: string | null }[]) => {
        const c = list.find((x) => x.id === id);
        if (c)
          setForm({
            name: c.name,
            ghl_api_key: c.ghl_api_key,
            ghl_location_id: c.ghl_location_id,
            report_slug: c.report_slug ?? "padrao",
            fb_access_token: c.fb_access_token ?? "",
            fb_ad_account_id: c.fb_ad_account_id ?? "",
          });
      })
      .finally(() => setLoading(false));
  }, [id, authFetch]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);
    setSaving(true);
    try {
      const res = await authFetch(`/api/clients/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          fb_access_token: form.fb_access_token || null,
          fb_ad_account_id: form.fb_ad_account_id || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage({ type: "error", text: data.error ?? "Erro ao atualizar." });
        return;
      }
      setMessage({ type: "ok", text: "Cliente atualizado." });
    } catch {
      setMessage({ type: "error", text: "Erro de conexão." });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-[#7B8099]">
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-[#4F6EF7] border-t-transparent" />
        Carregando...
      </div>
    );
  }

  return (
    <div>
      <Link href="/gerenciar-clientes" className="btn-ghost text-sm">← Voltar</Link>
      <h1 className="page-title mt-2">Editar cliente</h1>

      <form onSubmit={handleSubmit} className="card mt-6 max-w-lg space-y-4 p-6">
        <div>
          <label className="input-label">Nome do cliente</label>
          <input
            type="text"
            className="input-field"
            value={form.name}
            onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
          />
        </div>
        <div>
          <label className="input-label">GHL API Key</label>
          <input
            type="text"
            className="input-field"
            value={form.ghl_api_key}
            onChange={(e) => setForm((p) => ({ ...p, ghl_api_key: e.target.value }))}
          />
        </div>
        <div>
          <label className="input-label">GHL Location ID</label>
          <input
            type="text"
            className="input-field"
            value={form.ghl_location_id}
            onChange={(e) => setForm((p) => ({ ...p, ghl_location_id: e.target.value }))}
          />
        </div>
        <div>
          <label className="input-label">Relatório (slug)</label>
          <input
            type="text"
            className="input-field"
            value={form.report_slug}
            onChange={(e) => setForm((p) => ({ ...p, report_slug: e.target.value || "padrao" }))}
            placeholder="padrao"
          />
          <p className="mt-1 text-xs text-[#7B8099]">Visualização do relatório só para este cliente. Padrão: <code className="text-[#E8EAF0]">padrao</code>. Altere só se houver uma variação criada para este cliente.</p>
        </div>
        <div className="border-t border-[#2D3254] pt-4">
          <h3 className="text-sm font-medium text-[#E8EAF0] mb-3">Facebook Ads (opcional)</h3>
          <div className="space-y-4">
            <div>
              <label className="input-label">Token de acesso Facebook (Marketing API)</label>
              <input
                type="password"
                className="input-field"
                value={form.fb_access_token}
                onChange={(e) => setForm((p) => ({ ...p, fb_access_token: e.target.value }))}
                placeholder="EAA..."
                autoComplete="off"
              />
              <p className="mt-1 text-xs text-[#7B8099]">Token com permissão <code className="text-[#E8EAF0]">ads_read</code>. Gere em Meta for Developers → Ferramentas → Graph API Explorer.</p>
            </div>
            <div>
              <label className="input-label">ID da conta de anúncios (Ad Account ID)</label>
              <input
                type="text"
                className="input-field"
                value={form.fb_ad_account_id}
                onChange={(e) => setForm((p) => ({ ...p, fb_ad_account_id: e.target.value }))}
                placeholder="act_123456789"
              />
              <p className="mt-1 text-xs text-[#7B8099]">Formato: <code className="text-[#E8EAF0]">act_</code> + número. Use a rota <code className="text-[#E8EAF0">/api/facebook-ads/ad-accounts</code> para listar contas disponíveis.</p>
            </div>
          </div>
        </div>
        {message && (
          <div
            className="rounded-lg border-l-4 px-3 py-2 text-sm"
            style={{
              borderLeftColor: message.type === "ok" ? "#2DD4A0" : "#E05C5C",
              background: message.type === "ok" ? "#2DD4A015" : "#E05C5C15",
              color: message.type === "ok" ? "#2DD4A0" : "#E05C5C",
            }}
          >
            {message.text}
          </div>
        )}
        <div className="flex gap-3">
          <Link href="/gerenciar-clientes" className="btn-secondary px-4 py-2 text-sm">Cancelar</Link>
          <button type="submit" className="btn-primary px-4 py-2 text-sm disabled:opacity-60" disabled={saving}>
            {saving ? "Salvando..." : "Salvar"}
          </button>
        </div>
      </form>
    </div>
  );
}
