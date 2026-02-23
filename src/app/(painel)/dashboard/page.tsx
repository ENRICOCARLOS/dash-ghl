"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Redireciona para Relatório; o painel Dashboard foi removido. */
export default function DashboardRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/relatorio");
  }, [router]);
  return (
    <div className="flex min-h-[200px] items-center justify-center">
      <p className="text-[#7B8099]">Redirecionando para Relatório...</p>
    </div>
  );
}
