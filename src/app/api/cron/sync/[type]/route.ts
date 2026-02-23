import { createServiceClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

/** Retorna a hora atual (0–23) no fuso America/Sao_Paulo. */
function getHourAmericaSaoPaulo(): number {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    hour: "numeric",
    hour12: false,
  });
  return parseInt(formatter.format(new Date()), 10);
}

/** Entre 21:00 e 05:59 BRT a atualização incremental automática fica pausada (apenas manual permitida). */
function isIncrementalPausedNightWindow(): boolean {
  const hour = getHourAmericaSaoPaulo();
  return hour >= 21 || hour < 6;
}

/**
 * Cron: atualização automática.
 * GET com header x-cron-secret = CRON_SECRET.
 * Path: /api/cron/sync/hourly (de hora em hora) ou /api/cron/sync/daily (1x/dia às 01:00 BRT).
 * Entre 21:00 e 06:00 BRT o cron hourly não executa (incremental pausado); apenas atualização manual é permitida.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ type: string }> }
) {
  const expected = process.env.CRON_SECRET;
  const secret = request.headers.get("x-cron-secret") ?? request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!expected || secret !== expected) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const type = (await params).type;
  if (type !== "hourly" && type !== "daily") {
    return NextResponse.json({ error: "Path deve ser /api/cron/sync/hourly ou /api/cron/sync/daily" }, { status: 400 });
  }

  const mode = type === "hourly" ? "incremental_1h" : "daily_reprocess";

  if (type === "hourly" && isIncrementalPausedNightWindow()) {
    return NextResponse.json({
      type,
      mode,
      paused: true,
      reason: "Janela noturna 21h–06h BRT: atualização incremental automática pausada. Apenas atualização manual permitida.",
      processed: 0,
      results: [],
    });
  }

  const origin = request.nextUrl.origin;
  const service = createServiceClient();
  const { data: clients } = await service
    .from("clients")
    .select("id")
    .not("ghl_api_key", "is", null)
    .not("ghl_location_id", "is", null);

  const results: { client_id: string; ok: boolean; status: number; error?: string }[] = [];

  for (const c of clients ?? []) {
    try {
      const res = await fetch(`${origin}/api/ghl/sync`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-cron-secret": expected,
        },
        body: JSON.stringify({ client_id: c.id, mode }),
      });
      const data = await res.json().catch(() => ({}));
      results.push({
        client_id: c.id,
        ok: res.ok,
        status: res.status,
        error: data.error ?? (res.ok ? undefined : "Erro"),
      });
    } catch (e) {
      results.push({ client_id: c.id, ok: false, status: 0, error: e instanceof Error ? e.message : "Erro" });
    }
  }

  return NextResponse.json({ type, mode, processed: results.length, results });
}
