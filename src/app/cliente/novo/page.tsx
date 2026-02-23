"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";

const STEPS = ["Dados do cliente", "Contato", "Confirmação"];

export default function NovoClientePage() {
  const router = useRouter();
  const { user, loading: authLoading, isAdm } = useAuth();
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({
    nome: "",
    documento: "",
    email: "",
    telefone: "",
    plano: "",
    observacoes: "",
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

  const canNextStep1 = form.nome.trim() && form.email.trim();
  const canNextStep2 = form.telefone.trim();

  const handleNext = () => {
    setMessage(null);
    if (step === 1 && !canNextStep1) {
      setMessage({ type: "error", text: "Preencha nome e e-mail." });
      return;
    }
    if (step === 2 && !canNextStep2) {
      setMessage({ type: "error", text: "Preencha o telefone." });
      return;
    }
    if (step < 3) setStep(step + 1);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (step !== 3) return handleNext();
    setSubmitting(true);
    setMessage(null);
    try {
      // TODO: API para criar conta do cliente
      await new Promise((r) => setTimeout(r, 1000));
      setMessage({ type: "ok", text: "Cliente criado com sucesso!" });
      setTimeout(() => router.push("/clientes"), 1500);
    } catch {
      setMessage({ type: "error", text: "Erro ao criar cliente. Tente novamente." });
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
    <div className="min-h-screen px-4 py-8" style={{ backgroundColor: "#f8fafc" }}>
      <div className="mx-auto max-w-2xl">
        <Link href="/dashboard" className="text-sm text-slate-500 hover:text-slate-700">
          ← Dashboard
        </Link>

        <div className="mt-4 flex gap-2">
          {STEPS.map((label, i) => (
            <div
              key={label}
              className={`flex-1 rounded-lg py-2 text-center text-sm font-medium ${
                i + 1 === step
                  ? "bg-blue-600 text-white"
                  : i + 1 < step
                    ? "bg-blue-100 text-blue-800"
                    : "bg-slate-100 text-slate-500"
              }`}
            >
              {i + 1}. {label}
            </div>
          ))}
        </div>

        <div className="card mt-6 p-6 sm:p-8">
          <h1 className="text-xl font-bold text-slate-800">Nova conta de cliente</h1>
          <p className="mt-1 text-sm text-slate-600">{STEPS[step - 1]}</p>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            {step === 1 && (
              <>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Nome do cliente *</label>
                  <input
                    type="text"
                    className="input-field"
                    value={form.nome}
                    onChange={(e) => update("nome", e.target.value)}
                    placeholder="Nome ou razão social"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">CPF/CNPJ</label>
                  <input
                    type="text"
                    className="input-field"
                    value={form.documento}
                    onChange={(e) => update("documento", e.target.value)}
                    placeholder="Apenas números"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">E-mail *</label>
                  <input
                    type="email"
                    className="input-field"
                    value={form.email}
                    onChange={(e) => update("email", e.target.value)}
                    placeholder="email@cliente.com"
                  />
                </div>
              </>
            )}

            {step === 2 && (
              <>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Telefone *</label>
                  <input
                    type="tel"
                    className="input-field"
                    value={form.telefone}
                    onChange={(e) => update("telefone", e.target.value)}
                    placeholder="(00) 00000-0000"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Plano</label>
                  <select
                    className="input-field"
                    value={form.plano}
                    onChange={(e) => update("plano", e.target.value)}
                  >
                    <option value="">Selecione</option>
                    <option value="basico">Básico</option>
                    <option value="profissional">Profissional</option>
                    <option value="empresarial">Empresarial</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Observações</label>
                  <textarea
                    className="input-field min-h-[80px] resize-y"
                    value={form.observacoes}
                    onChange={(e) => update("observacoes", e.target.value)}
                    placeholder="Observações internas"
                  />
                </div>
              </>
            )}

            {step === 3 && (
              <div className="space-y-2 rounded-lg bg-slate-50 p-4 text-sm">
                <p><span className="font-medium text-slate-600">Nome:</span> {form.nome || "—"}</p>
                <p><span className="font-medium text-slate-600">Documento:</span> {form.documento || "—"}</p>
                <p><span className="font-medium text-slate-600">E-mail:</span> {form.email || "—"}</p>
                <p><span className="font-medium text-slate-600">Telefone:</span> {form.telefone || "—"}</p>
                <p><span className="font-medium text-slate-600">Plano:</span> {form.plano || "—"}</p>
                {form.observacoes && (
                  <p><span className="font-medium text-slate-600">Observações:</span> {form.observacoes}</p>
                )}
              </div>
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
              {step > 1 && (
                <button
                  type="button"
                  className="btn-secondary flex-1 py-2.5"
                  onClick={() => setStep(step - 1)}
                >
                  Voltar
                </button>
              )}
              <button
                type="submit"
                className="btn-primary flex-1 py-2.5 disabled:opacity-60"
                disabled={submitting}
              >
                {submitting ? "Salvando..." : step === 3 ? "Criar cliente" : "Continuar"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
