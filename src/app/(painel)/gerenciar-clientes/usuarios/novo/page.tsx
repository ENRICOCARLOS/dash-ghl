"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import type { Client } from "@/types/database";

export default function NovoUsuarioPage() {
  const router = useRouter();
  const { authFetch } = useAuth();
  const [clients, setClients] = useState<Client[]>([]);
  const [form, setForm] = useState({ email: "", senha: "", full_name: "", client_ids: [] as string[] });
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    authFetch("/api/clients")
      .then((r) => r.json())
      .then(setClients)
      .catch(() => {});
  }, [authFetch]);

  const toggleClient = (clientId: string) => {
    setForm((p) => ({
      ...p,
      client_ids: p.client_ids.includes(clientId) ? p.client_ids.filter((id) => id !== clientId) : [...p.client_ids, clientId],
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);
    if (!form.email?.trim() || !form.senha?.trim()) {
      setMessage({ type: "error", text: "E-mail e senha obrigatórios." });
      return;
    }
    if (form.senha.length < 6) {
      setMessage({ type: "error", text: "Senha com no mínimo 6 caracteres." });
      return;
    }
    setLoading(true);
    try {
      const res = await authFetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: form.email.trim(),
          senha: form.senha,
          full_name: form.full_name.trim() || undefined,
          client_ids: form.client_ids.length ? form.client_ids : undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage({ type: "error", text: data.error ?? "Erro ao criar usuário." });
        return;
      }
      setMessage({ type: "ok", text: "Usuário criado. Redirecionando..." });
      setTimeout(() => router.push("/gerenciar-clientes"), 1500);
    } catch {
      setMessage({ type: "error", text: "Erro de conexão." });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <Link href="/gerenciar-clientes" className="btn-ghost text-sm">← Voltar</Link>
      <h1 className="page-title mt-2">Criar usuário (adicional)</h1>
      <p className="mt-1 text-[#7B8099]">Use esta tela para adicionar usuários a contas já existentes. Para criar uma nova conta (cliente) com seu usuário principal, use Cadastrar cliente. Aqui você pode vincular o novo usuário a uma ou mais contas abaixo.</p>

      <form onSubmit={handleSubmit} className="card mt-6 max-w-lg space-y-4 p-6">
        <div>
          <label className="input-label">E-mail (login)</label>
          <input
            type="email"
            className="input-field"
            value={form.email}
            onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
            placeholder="usuario@email.com"
          />
        </div>
        <div>
          <label className="input-label">Senha</label>
          <input
            type="password"
            className="input-field"
            value={form.senha}
            onChange={(e) => setForm((p) => ({ ...p, senha: e.target.value }))}
            placeholder="Mínimo 6 caracteres"
          />
        </div>
        <div>
          <label className="input-label">Nome</label>
          <input
            type="text"
            className="input-field"
            value={form.full_name}
            onChange={(e) => setForm((p) => ({ ...p, full_name: e.target.value }))}
            placeholder="Nome completo"
          />
        </div>
        {clients.length > 0 && (
          <div>
            <label className="input-label">Vincular a clientes</label>
            <div className="mt-2 space-y-2">
              {clients.map((c) => (
                <label key={c.id} className="flex cursor-pointer items-center gap-2 text-sm text-[#E8EAF0]">
                  <input
                    type="checkbox"
                    checked={form.client_ids.includes(c.id)}
                    onChange={() => toggleClient(c.id)}
                    className="rounded border-[#1F2330] bg-[#0D0F14] text-[#4F6EF7] focus:ring-[#4F6EF7]"
                  />
                  {c.name}
                </label>
              ))}
            </div>
          </div>
        )}
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
            {loading ? "Salvando..." : "Criar usuário"}
          </button>
        </div>
      </form>
    </div>
  );
}
