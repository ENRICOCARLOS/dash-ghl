import { getGhlCredentials } from "@/lib/ghl-credentials";
import { ghlErrorResponse } from "@/lib/ghl-error-response";
import {
  getCalendarEventsForCalendars,
  type GHLCalendarEvent,
} from "@/lib/ghl";
import { createServiceClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

/** Intervalo extra para buscar eventos quando filtro é por createdAt (API GHL filtra por startTime). */
const CREATED_AT_LOOKBACK_MS = 365 * 24 * 60 * 60 * 1000;

function parseMs(value: string | null): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return n;
}

/**
 * GET: eventos/agendamentos da location no período.
 * - start e end em milissegundos (query: start, end).
 * - filterBy=startTime (default): eventos cujo startTime está no período (Indicadores 2 e 3).
 * - filterBy=createdAt: eventos cujo createdAt está no período (Indicador 4); internamente pede um range maior à API e filtra.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const clientId = searchParams.get("client_id");
  const startMs = parseMs(searchParams.get("start"));
  const endMs = parseMs(searchParams.get("end"));
  const filterBy = searchParams.get("filterBy") === "createdAt" ? "createdAt" : "startTime";

  const cred = await getGhlCredentials(request, clientId);
  if ("error" in cred) return NextResponse.json({ error: cred.error }, { status: cred.status });
  if (startMs == null || endMs == null) {
    return NextResponse.json(
      { error: "Query start e end (milissegundos) são obrigatórios" },
      { status: 400 }
    );
  }

  const service = createServiceClient();
  const { data: calendars } = await service
    .from("ghl_calendars")
    .select("ghl_calendar_id")
    .eq("client_id", cred.client_id)
    .eq("active", true);
  const calendarIds = (calendars ?? []).map((c) => c.ghl_calendar_id).filter(Boolean);
  if (calendarIds.length === 0) {
    return NextResponse.json({ events: [] });
  }

  try {
    let requestStart = startMs;
    let requestEnd = endMs;
    if (filterBy === "createdAt") {
      requestStart = Math.max(0, startMs - CREATED_AT_LOOKBACK_MS);
      requestEnd = endMs + 86400000;
    }

    const events = await getCalendarEventsForCalendars(cred.ghl_api_key, cred.ghl_location_id, {
      startTime: requestStart,
      endTime: requestEnd,
      calendarIds,
    });

    let result: GHLCalendarEvent[];
    if (filterBy === "createdAt") {
      result = events.filter((ev) => {
        const created = ev.createdAt;
        if (created == null) return false;
        const createdMs = typeof created === "string" ? new Date(created).getTime() : Number(created);
        if (!Number.isFinite(createdMs)) return false;
        return createdMs >= startMs && createdMs <= endMs;
      });
    } else {
      result = events.filter((ev) => {
        const start = ev.startTime;
        if (start == null) return false;
        const startMsEv = typeof start === "string" ? new Date(start).getTime() : Number(start);
        if (!Number.isFinite(startMsEv)) return false;
        return startMsEv >= startMs && startMsEv <= endMs;
      });
    }

    return NextResponse.json({ events: result });
  } catch (e) {
    return ghlErrorResponse(e, "Erro ao buscar agendamentos");
  }
}
