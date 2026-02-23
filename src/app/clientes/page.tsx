"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";

export default function ClientesPage() {
  const router = useRouter();
  const { user, loading, isAdm } = useAuth();

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace("/");
      return;
    }
    if (!isAdm) {
      router.replace("/dashboard");
      return;
    }
  }, [user, loading, isAdm, router]);

  if (loading || !user || !isAdm) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="min-h-screen px-4 py-8" style={{ backgroundColor: "#f8fafc" }}>
      <div className="mx-auto max-w-4xl">
        <div className="flex items-center justify-between">
          <div>
            <Link href="/dashboard" className="text-sm text-slate-500 hover:text-slate-700">
              ← Dashboard
            </Link>
            <h1 className="mt-2 text-2xl font-bold text-slate-800">Clientes</h1>
            <p className="text-slate-600">Lista de contas de clientes cadastradas.</p>
          </div>
          <Link
            href="/cliente/novo"
            className="btn-primary inline-flex items-center gap-2 px-4 py-2.5 text-sm"
          >
            + Novo cliente
          </Link>
        </div>

        <div className="card mt-6 p-6">
          <p className="text-sm text-slate-500">
            Nenhum cliente cadastrado ainda.{" "}
            <Link href="/cliente/novo" className="font-medium text-blue-600 hover:text-blue-700">
              Criar primeiro cliente
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
