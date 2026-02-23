"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";

const LOGIN_LOADING_TIMEOUT_MS = 1_000;

export default function LoginPage() {
  const router = useRouter();
  const { user, loading, login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);
  const [showFormForced, setShowFormForced] = useState(false);

  useEffect(() => {
    if (!user) return;
    router.replace("/relatorio");
  }, [user, router]);

  useEffect(() => {
    if (loading && !showFormForced) {
      const t = setTimeout(() => setShowFormForced(true), LOGIN_LOADING_TIMEOUT_MS);
      return () => clearTimeout(t);
    }
  }, [loading, showFormForced]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);
    setSubmitting(true);
    try {
      const result = await login(email, password);
      if (result.ok) { router.replace("/relatorio"); return; }
      setMessage({ type: "error", text: result.error ?? "E-mail ou senha inválidos." });
    } catch {
      setMessage({ type: "error", text: "Erro ao entrar. Tente novamente." });
    } finally {
      setSubmitting(false);
    }
  };

  if (loading && !showFormForced) {
    return (
      <div
        style={{ background: "var(--bg-base)" }}
        className="flex min-h-screen flex-col items-center justify-center gap-4"
      >
        <div
          style={{ borderColor: "var(--accent)", borderTopColor: "transparent" }}
          className="h-8 w-8 animate-spin rounded-full border-2"
        />
        <p
          style={{ fontFamily: "var(--font-mono)", color: "var(--text-dim)" }}
          className="text-[9px] uppercase tracking-[0.2em]"
        >
          Verificando sessão...
        </p>
      </div>
    );
  }

  if (user) return null;

  return (
    <div
      style={{ background: "var(--bg-base)" }}
      className="flex min-h-screen items-center justify-center px-4"
    >
      <div
        style={{
          background: "var(--bg-card)",
          border: "1px solid var(--border)",
          borderRadius: 16,
        }}
        className="w-full max-w-md p-8"
      >
        {/* Logo */}
        <div className="mb-6 flex flex-col items-center gap-3">
          <div
            style={{
              background: "var(--accent)",
              boxShadow: "0 2px 20px rgba(0,212,180,0.3)",
            }}
            className="flex h-12 w-12 items-center justify-center rounded-xl text-lg font-extrabold text-white"
          >
            G
          </div>
          <div className="text-center">
            <h1
              style={{ fontFamily: "var(--font-sans)" }}
              className="text-xl font-bold tracking-[0.04em] text-[var(--text-primary)]"
            >
              DASH{" "}
              <span style={{ color: "var(--accent)" }}>GHL</span>
            </h1>
            <p
              style={{ fontFamily: "var(--font-mono)", color: "var(--text-dim)" }}
              className="mt-1.5 text-[8.5px] uppercase tracking-[0.18em]"
            >
              Acesse com seu e-mail e senha
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="input-label">E-mail</label>
            <input
              type="email"
              autoComplete="email"
              className="input-field"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="seu@email.com"
            />
          </div>
          <div>
            <label className="input-label">Senha</label>
            <input
              type="password"
              autoComplete="current-password"
              className="input-field"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
          </div>

          {message && (
            <div
              className="rounded-lg border-l-4 px-3 py-2 text-sm"
              style={{
                borderLeftColor: message.type === "ok" ? "var(--accent)" : "var(--danger)",
                background:      message.type === "ok" ? "var(--accent-dim)" : "var(--danger-muted)",
                color:           message.type === "ok" ? "var(--accent)" : "var(--danger)",
              }}
            >
              {message.text}
            </div>
          )}

          <button
            type="submit"
            className="btn-primary w-full justify-center py-2.5 disabled:opacity-60"
            style={{ borderRadius: 10 }}
            disabled={submitting}
          >
            {submitting ? "Entrando..." : "Entrar"}
          </button>
        </form>
      </div>
    </div>
  );
}
