"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useActiveClient } from "@/contexts/ActiveClientContext";

/**
 * Redireciona para a página de relatório da conta ativa.
 * Um único item "Relatório" no menu; a URL é sempre /relatorio/[clientId] da conta selecionada.
 */
export default function RelatorioRedirectPage() {
  const router = useRouter();
  const { activeClient } = useActiveClient();

  useEffect(() => {
    if (activeClient) {
      router.replace(`/relatorio/${activeClient.id}`);
    }
  }, [activeClient, router]);

  if (!activeClient) {
    return (
      <div>
        <h1 className="page-title">Relatório</h1>
        <p className="mt-1 text-[var(--text-secondary)]">Selecione uma conta no topo da página para ver o relatório.</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-[200px] items-center justify-center">
      <p className="text-[var(--text-secondary)]">Redirecionando para o relatório da conta...</p>
    </div>
  );
}
