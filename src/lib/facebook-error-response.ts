import { FacebookAdsApiError } from "@/lib/facebook-ads";
import { NextResponse } from "next/server";

/** Converte erro da API Facebook em resposta HTTP. */
export function facebookErrorResponse(e: unknown, fallbackMessage: string): NextResponse {
  if (e instanceof FacebookAdsApiError) {
    const msg =
      e.statusCode === 401 || e.code === 190
        ? "Token Facebook inválido ou expirado. Gere um novo token em Meta for Developers e atualize em Gerenciar Clientes."
        : e.message;
    return NextResponse.json({ error: msg }, { status: e.statusCode >= 400 ? e.statusCode : 502 });
  }
  const message = e instanceof Error ? e.message : fallbackMessage;
  return NextResponse.json({ error: message }, { status: 502 });
}
