"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";

export default function NovoClientePage() {
  const router = useRouter();
  const { authFetch } = useAuth();
  const [form, setForm] = useState({
    name: "",
    usuario: "",
    senha: "",
    ghl_api_key: "",
    ghl_location_id: "",
  });
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);
    if (!form.name?.trim() || !form.usuario?.trim() || !form.senha?.trim() || !form.ghl_api_key?.trim() || !form.ghl_location_id?.trim()) {
      setMessage({ type: "error", text: "Preencha todos os campos." });
      return;
    }
    setLoading(true);
    const timeoutMs = 45000;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await authFetch("/api/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage({ type: "error", text: data.error ?? "Erro ao criar cliente." });
        return;
      }
      setMessage({ type: "ok", text: "Cliente e usuário principal criados." });
      setTimeout(() => router.push("/gerenciar-clientes"), 1500);
    } catch (err) {
      clearTimeout(timeoutId);
      if (err instanceof Error && err.name === "AbortError") {
        setMessage({ type: "error", text: "Demorou demais. Tente novamente." });
      } else {
        setMessage({ type: "error", text: "Erro de conexão. Tente novamente." });
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <Link href="/gerenciar-clientes" className="btn-ghost text-sm">← Voltar</Link>
      <h1 className="page-title mt-2">Cadastrar cliente (conta)</h1>
      <p className="mt-1 text-[#7B8099]">Cada cliente é uma conta com credenciais GHL. Aqui você cria a conta e o usuário principal — esse usuário já poderá fazer login e ver os dados da Location. Depois você pode adicionar mais usuários à mesma conta em Editar → Usuários.</p>

      <form onSubmit={handleSubmit} className="card mt-6 max-w-lg space-y-4 p-6">
        <div>
          <label className="input-label">Nome do cliente</label>
          <input
            type="text"
            className="input-field"
            value={form.name}
            onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
            placeholder="Nome de exibição da conta"
          />
        </div>
        <div>
          <label className="input-label">Usuário (e-mail)</label>
          <input
            type="email"
            className="input-field"
            value={form.usuario}
            onChange={(e) => setForm((p) => ({ ...p, usuario: e.target.value }))}
            placeholder="E-mail do usuário principal"
          />
        </div>
        <div>
          <label className="input-label">Senha</label>
          <input
            type="password"
            className="input-field"
            value={form.senha}
            onChange={(e) => setForm((p) => ({ ...p, senha: e.target.value }))}
            placeholder="Senha inicial (ADM pode alterar depois)"
          />
        </div>
        <div>
          <label className="input-label">GHL API Key</label>
          <input
            type="text"
            className="input-field"
            value={form.ghl_api_key}
            onChange={(e) => setForm((p) => ({ ...p, ghl_api_key: e.target.value }))}
            placeholder="Chave de API do GoHighLevel"
          />
        </div>
        <div>
          <label className="input-label">GHL Location ID</label>
          <input
            type="text"
            className="input-field"
            value={form.ghl_location_id}
            onChange={(e) => setForm((p) => ({ ...p, ghl_location_id: e.target.value }))}
            placeholder="ID da Location no GHL"
          />
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
          <button type="submit" className="btn-primary px-4 py-2 text-sm disabled:opacity-60" disabled={loading}>
            {loading ? "Salvando..." : "Cadastrar"}
          </button>
        </div>
      </form>
    </div>
  );
}
