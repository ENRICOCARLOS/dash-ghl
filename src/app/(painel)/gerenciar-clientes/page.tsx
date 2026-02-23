"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import type { Client } from "@/types/database";

export default function GerenciarClientesPage() {
  const { authFetch } = useAuth();
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    authFetch("/api/clients")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Não autorizado"))))
      .then(setClients)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [authFetch]);

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Excluir o cliente "${name}"?`)) return;
    const res = await authFetch(`/api/clients/${id}`, { method: "DELETE" });
    if (res.ok) setClients((prev) => prev.filter((c) => c.id !== id));
    else setError((await res.json()).error);
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-[#7B8099]">
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-[#4F6EF7] border-t-transparent" />
        Carregando...
      </div>
    );
  }
  if (error) {
    return (
      <div>
        <h1 className="page-title">Gerenciar Clientes</h1>
        <p className="mt-2 text-[#E05C5C]">{error}</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="page-title">Gerenciar Clientes</h1>
        <div className="flex gap-2">
          <Link href="/gerenciar-clientes/usuarios/novo" className="btn-secondary px-4 py-2 text-sm">
            + Criar usuário
          </Link>
          <Link href="/gerenciar-clientes/novo" className="btn-primary px-4 py-2 text-sm">
            + Cadastrar cliente
          </Link>
        </div>
      </div>
      <p className="mt-1 text-[#7B8099]">
        Cada cliente é uma conta (credenciais GHL, Location ID). Cadastrar cliente cria a conta e o usuário principal; depois você pode adicionar mais usuários em Editar → Usuários.
      </p>

      <div className="card mt-6 overflow-hidden">
        {clients.length === 0 ? (
          <div className="empty-state">
            <div className="mx-auto mb-3 h-10 w-10 rounded-full border-2 border-[#1F2330]" style={{ background: "transparent" }} />
            <p className="text-[#7B8099]">Nenhum cliente cadastrado.</p>
            <Link href="/gerenciar-clientes/novo" className="btn-primary mt-4 px-4 py-2 text-sm">
              Cadastrar cliente
            </Link>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table-ui">
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>Location ID</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {clients.map((c) => (
                  <tr key={c.id}>
                    <td className="font-medium text-[#E8EAF0]">{c.name}</td>
                    <td className="text-[#7B8099]">{c.ghl_location_id}</td>
                    <td>
                      <Link href={`/gerenciar-clientes/${c.id}`} className="btn-ghost mr-2">
                        Editar
                      </Link>
                      <Link href={`/gerenciar-clientes/${c.id}/usuarios`} className="btn-ghost mr-2">
                        Usuários
                      </Link>
                      <button type="button" onClick={() => handleDelete(c.id, c.name)} className="btn-ghost text-[#E05C5C] hover:text-[#E05C5C]">
                        Excluir
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
