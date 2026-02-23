import { GhlApiError } from "@/lib/ghl";
import { syncLog } from "@/lib/sync-log";
import { NextResponse } from "next/server";

/** Converte erro da API GHL em resposta HTTP (401 com mensagem clara quando JWT inválido). */
export function ghlErrorResponse(e: unknown, fallbackMessage: string): NextResponse {
  if (e instanceof GhlApiError) {
    const msg =
      e.statusCode === 401
        ? "API Key do cliente inválida ou expirada. Atualize em Gerenciar Clientes."
        : e.message;
    syncLog.error("ghlErrorResponse (GhlApiError)", e, { statusCode: e.statusCode, message: msg });
    return NextResponse.json({ error: msg }, { status: e.statusCode });
  }
  const message = e instanceof Error ? e.message : fallbackMessage;
  syncLog.error("ghlErrorResponse", e, { fallbackMessage, message });
  return NextResponse.json({ error: message }, { status: 502 });
}
