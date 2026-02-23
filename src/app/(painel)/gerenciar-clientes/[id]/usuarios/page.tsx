"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";

type Profile = { id: string; email: string; full_name: string | null; role: string; clients: { id: string; name: string }[] };

export default function ClienteUsuariosPage() {
  const params = useParams();
  const clientId = params.id as string;
  const { authFetch } = useAuth();
  const [clientName, setClientName] = useState("");
  const [users, setUsers] = useState<Profile[]>([]);
  const [allUsers, setAllUsers] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [resetting, setResetting] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState<Record<string, string>>({});

  useEffect(() => {
    Promise.all([authFetch("/api/clients").then((r) => r.json()), authFetch("/api/users").then((r) => r.json())])
      .then(([clients, usersList]: [{ id: string; name: string }[], Profile[]]) => {
        const c = clients.find((x: { id: string }) => x.id === clientId);
        if (c) setClientName(c.name);
        setAllUsers(usersList);
        setUsers(usersList.filter((u) => u.clients?.some((cl) => cl.id === clientId)));
      })
      .finally(() => setLoading(false));
  }, [clientId, authFetch]);

  const linkUser = async (userId: string) => {
    const res = await authFetch("/api/users/link-client", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: userId, client_id: clientId }),
    });
    if (res.ok) {
      setUsers((prev) => {
        const u = allUsers.find((x) => x.id === userId);
        return u ? [...prev, { ...u, clients: [...(u.clients || []), { id: clientId, name: clientName }] }] : prev;
      });
    }
  };

  const unlinkUser = async (userId: string) => {
    if (!confirm("Desvincular este usuário do cliente?")) return;
    const res = await authFetch(`/api/users/link-client?user_id=${userId}&client_id=${clientId}`, { method: "DELETE" });
    if (res.ok) setUsers((prev) => prev.filter((u) => u.id !== userId));
  };

  const resetPassword = async (userId: string) => {
    const pwd = newPassword[userId]?.trim();
    if (!pwd || pwd.length < 6) {
      alert("Senha com no mínimo 6 caracteres.");
      return;
    }
    setResetting(userId);
    const res = await authFetch("/api/users/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: userId, new_password: pwd }),
    });
    setResetting(null);
    if (res.ok) {
      setNewPassword((prev) => ({ ...prev, [userId]: "" }));
    } else {
      const d = await res.json();
      alert(d.error ?? "Erro ao redefinir senha.");
    }
  };

  const linkedIds = new Set(users.map((u) => u.id));
  const availableToLink = allUsers.filter((u) => u.role !== "ADM" && !linkedIds.has(u.id));

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
      <Link href="/gerenciar-clientes" className="btn-ghost text-sm">← Clientes</Link>
      <h1 className="page-title mt-2">Usuários — {clientName}</h1>
      <p className="mt-1 text-[#7B8099]">Vincule usuários a este cliente. Eles poderão ver os dados desta Location no switcher.</p>

      <div className="card mt-6 p-6">
        <h2 className="card-title">Vinculados</h2>
        {users.length === 0 ? (
          <p className="mt-2 text-sm text-[#7B8099]">Nenhum usuário vinculado.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {users.map((u) => (
              <li key={u.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#1F2330] bg-[#0D0F14] p-3 hover:bg-[#1A1F2E]">
                <div>
                  <span className="font-medium text-[#E8EAF0]">{u.full_name || u.email}</span>
                  <span className="ml-2 text-sm text-[#7B8099]">{u.email}</span>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="password"
                    placeholder="Nova senha"
                    className="input-field w-32 text-sm"
                    value={newPassword[u.id] ?? ""}
                    onChange={(e) => setNewPassword((p) => ({ ...p, [u.id]: e.target.value }))}
                  />
                  <button
                    type="button"
                    className="btn-secondary py-1.5 px-2 text-xs"
                    onClick={() => resetPassword(u.id)}
                    disabled={resetting === u.id}
                  >
                    {resetting === u.id ? "..." : "Redefinir senha"}
                  </button>
                  <button type="button" className="btn-ghost text-sm text-[#E05C5C] hover:text-[#E05C5C]" onClick={() => unlinkUser(u.id)}>
                    Desvincular
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {availableToLink.length > 0 && (
        <div className="card mt-6 p-6">
          <h2 className="card-title">Vincular usuário</h2>
          <ul className="mt-2 space-y-2">
            {availableToLink.map((u) => (
              <li key={u.id} className="flex items-center justify-between rounded-lg border border-[#1F2330] p-3 hover:bg-[#1A1F2E]">
                <span className="text-[#E8EAF0]">{u.full_name || u.email} <span className="text-[#7B8099]">({u.email})</span></span>
                <button type="button" className="btn-primary py-1.5 px-3 text-sm" onClick={() => linkUser(u.id)}>
                  Vincular
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
