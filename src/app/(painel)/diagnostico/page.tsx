"use client";

import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useActiveClient } from "@/contexts/ActiveClientContext";

export default function DiagnosticoPage() {
  const { authFetch, isAdm } = useAuth();
  const { activeClient } = useActiveClient();
  const [opportunityId, setOpportunityId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ raw: Record<string, unknown>; parsed: Record<string, unknown> } | null>(null);

  if (!isAdm) {
    return (
      <div>
        <h1 className="page-title">Diagnóstico</h1>
        <p className="mt-2 text-[#E05C5C]">Acesso restrito a administradores.</p>
      </div>
    );
  }

  const handleBuscar = async () => {
    const id = opportunityId.trim();
    if (!id) {
      setError("Informe o ID da oportunidade.");
      return;
    }
    if (!activeClient?.id) {
      setError("Selecione uma conta no topo da página.");
      return;
    }
    setError(null);
    setResult(null);
    setLoading(true);
    try {
      const res = await authFetch("/api/ghl/diagnostico-opportunity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: activeClient.id, opportunity_id: id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Erro ao buscar oportunidade");
      setResult({ raw: data.raw ?? {}, parsed: data.parsed ?? {} });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao buscar oportunidade");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <h1 className="page-title">Diagnóstico</h1>
      <p className="mt-1 text-sm text-[#7B8099]">
        Busque uma oportunidade pelo ID no GHL e veja o retorno bruto da API e como o sistema interpreta os dados.
      </p>

      <div className="card mt-4 max-w-2xl p-5">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[200px] flex-1">
            <label className="mb-1 block text-xs font-medium text-[#7B8099]">ID da oportunidade (GHL)</label>
            <input
              type="text"
              value={opportunityId}
              onChange={(e) => setOpportunityId(e.target.value)}
              placeholder="Ex: jowyHcHoVYVLHQfXPyc2"
              className="w-full rounded border border-[#1F2330] bg-[#1A1F2E] px-3 py-2 text-sm text-[#E8EAF0] placeholder:text-[#7B8099]"
            />
          </div>
          <button
            type="button"
            onClick={handleBuscar}
            disabled={loading || !activeClient}
            className="btn-primary px-4 py-2 text-sm"
          >
            {loading ? "Buscando…" : "Buscar"}
          </button>
        </div>
        {activeClient && (
          <p className="mt-2 text-xs text-[#7B8099]">Conta: <strong className="text-[#E8EAF0]">{activeClient.name}</strong></p>
        )}
        {error && <p className="mt-2 text-sm text-[#E05C5C]">{error}</p>}
      </div>

      {result && (
        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="card overflow-hidden">
            <div className="card-header">
              <h2 className="card-title">Retorno do GHL (raw)</h2>
            </div>
            <pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap break-words rounded bg-[#0a0c10] p-3 text-xs text-[#E8EAF0]">
              {JSON.stringify(result.raw, null, 2)}
            </pre>
          </div>
          <div className="card overflow-hidden">
            <div className="card-header">
              <h2 className="card-title">Nossa interpretação (parsed)</h2>
            </div>
            <pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap break-words rounded bg-[#0a0c10] p-3 text-xs text-[#E8EAF0]">
              {JSON.stringify(result.parsed, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
