"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";

export default function CadastroPage() {
  const router = useRouter();
  const { user, loading: authLoading, isAdm } = useAuth();
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({
    nome: "",
    email: "",
    senha: "",
    confirmarSenha: "",
    empresa: "",
    telefone: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.replace("/");
      return;
    }
    if (!isAdm) {
      router.replace("/dashboard");
      return;
    }
  }, [user, authLoading, isAdm, router]);

  const update = (key: string, value: string) => {
    setForm((p) => ({ ...p, [key]: value }));
    setMessage(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);
    if (step === 1) {
      if (!form.nome.trim() || !form.email.trim() || !form.senha.trim()) {
        setMessage({ type: "error", text: "Preencha nome, e-mail e senha." });
        return;
      }
      if (form.senha !== form.confirmarSenha) {
        setMessage({ type: "error", text: "As senhas não coincidem." });
        return;
      }
      if (form.senha.length < 6) {
        setMessage({ type: "error", text: "A senha deve ter no mínimo 6 caracteres." });
        return;
      }
      setStep(2);
      return;
    }
    setSubmitting(true);
    try {
      // TODO: integrar com API de criação de conta
      await new Promise((r) => setTimeout(r, 800));
      setMessage({ type: "ok", text: "Usuário criado com sucesso! Redirecionando..." });
      setTimeout(() => router.push("/dashboard"), 1500);
    } catch {
      setMessage({ type: "error", text: "Erro ao criar conta. Tente novamente." });
    } finally {
      setSubmitting(false);
    }
  };

  if (authLoading || !user || !isAdm) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-8" style={{ backgroundColor: "#f8fafc" }}>
      <div className="card w-full max-w-md p-6 sm:p-8">
        <Link href="/dashboard" className="text-sm text-slate-500 hover:text-slate-700">
          ← Dashboard
        </Link>
        <div
          className="mx-auto mt-4 mb-6 flex h-12 w-12 items-center justify-center rounded-xl text-lg font-bold text-white"
          style={{ background: "linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)" }}
        >
          G
        </div>
        <h1 className="text-xl font-bold text-slate-800">Criar novo usuário</h1>
        <p className="mt-1 text-sm text-slate-600">
          {step === 1 ? "Dados de acesso" : "Dados do usuário"}
        </p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          {step === 1 && (
            <>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Nome</label>
                <input
                  type="text"
                  className="input-field"
                  value={form.nome}
                  onChange={(e) => update("nome", e.target.value)}
                  placeholder="Seu nome"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">E-mail</label>
                <input
                  type="email"
                  className="input-field"
                  value={form.email}
                  onChange={(e) => update("email", e.target.value)}
                  placeholder="seu@email.com"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Senha</label>
                <input
                  type="password"
                  className="input-field"
                  value={form.senha}
                  onChange={(e) => update("senha", e.target.value)}
                  placeholder="Mínimo 6 caracteres"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Confirmar senha</label>
                <input
                  type="password"
                  className="input-field"
                  value={form.confirmarSenha}
                  onChange={(e) => update("confirmarSenha", e.target.value)}
                  placeholder="Repita a senha"
                />
              </div>
            </>
          )}
          {step === 2 && (
            <>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Nome da empresa</label>
                <input
                  type="text"
                  className="input-field"
                  value={form.empresa}
                  onChange={(e) => update("empresa", e.target.value)}
                  placeholder="Razão social ou nome fantasia"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Telefone</label>
                <input
                  type="tel"
                  className="input-field"
                  value={form.telefone}
                  onChange={(e) => update("telefone", e.target.value)}
                  placeholder="(00) 00000-0000"
                />
              </div>
            </>
          )}

          {message && (
            <div
              className={`rounded-lg px-3 py-2 text-sm ${
                message.type === "ok" ? "bg-green-50 text-green-800" : "bg-red-50 text-red-800"
              }`}
            >
              {message.text}
            </div>
          )}

          <div className="flex gap-3 pt-2">
            {step === 2 && (
              <button
                type="button"
                className="btn-secondary flex-1 py-2.5"
                onClick={() => setStep(1)}
              >
                Voltar
              </button>
            )}
            <button
              type="submit"
              className="btn-primary flex-1 py-2.5 disabled:opacity-60"
              disabled={submitting}
            >
              {submitting ? "Salvando..." : step === 1 ? "Continuar" : "Criar conta"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
