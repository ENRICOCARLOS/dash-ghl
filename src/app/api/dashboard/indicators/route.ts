import { getGhlCredentials } from "@/lib/ghl-credentials";
import { createServiceClient } from "@/lib/supabase/server";
import {
  getOpportunities,
  getCalendarEventsForCalendars,
  type GHLOpportunity,
  type GHLCalendarEvent,
} from "@/lib/ghl";
import { NextRequest, NextResponse } from "next/server";

const KEY_SALE_DATE_FIELD_ID = "sale_date_field_id";
const STATUS_WON = "won";

function parseMs(value: string | null): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function getOpportunityDate(opp: GHLOpportunity, saleDateFieldId: string | null): number | null {
  const cf = opp.customFields as Record<string, string | number | null> | undefined;
  if (saleDateFieldId && cf?.[saleDateFieldId] != null) {
    const v = cf[saleDateFieldId];
    if (typeof v === "string") {
      const ms = new Date(v).getTime();
      return Number.isFinite(ms) ? ms : null;
    }
    if (typeof v === "number") return v;
    return null;
  }
  if (opp.createdAt) {
    const ms = new Date(opp.createdAt).getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

/** Só considera que a oportunidade tem "data da venda" se o campo configurado estiver preenchido. Se não houver campo configurado, usa createdAt. */
function hasSaleDateForIndicator(opp: GHLOpportunity, saleDateFieldId: string | null): boolean {
  if (!saleDateFieldId) return true;
  const cf = opp.customFields as Record<string, string | number | null> | undefined;
  const v = cf?.[saleDateFieldId];
  if (v == null || v === "") return false;
  if (typeof v === "string") return Number.isFinite(new Date(v).getTime());
  if (typeof v === "number") return Number.isFinite(v);
  return false;
}

function inRange(ms: number | null, start: number, end: number): boolean {
  if (ms == null) return false;
  return ms >= start && ms <= end;
}

function filterOpportunitiesByPeriodAndPipeline(
  opportunities: GHLOpportunity[],
  startMs: number,
  endMs: number,
  saleDateFieldId: string | null,
  pipelineIds: string[]
): GHLOpportunity[] {
  return opportunities.filter((opp) => {
    const dateMs = getOpportunityDate(opp, saleDateFieldId);
    if (!inRange(dateMs, startMs, endMs)) return false;
    if (pipelineIds.length > 0 && opp.pipelineId && !pipelineIds.includes(opp.pipelineId)) return false;
    return true;
  });
}

function filterEventsByStartTime(events: GHLCalendarEvent[], startMs: number, endMs: number): GHLCalendarEvent[] {
  return events.filter((ev) => {
    const start = ev.startTime;
    if (start == null) return false;
    const ms = typeof start === "string" ? new Date(start).getTime() : Number(start);
    return Number.isFinite(ms) && ms >= startMs && ms <= endMs;
  });
}

function filterEventsByCreatedAt(events: GHLCalendarEvent[], startMs: number, endMs: number): GHLCalendarEvent[] {
  return events.filter((ev) => {
    const created = ev.createdAt;
    if (created == null) return false;
    const ms = typeof created === "string" ? new Date(created).getTime() : Number(created);
    return Number.isFinite(ms) && ms >= startMs && ms <= endMs;
  });
}

export type DashboardIndicatorsPayload = {
  saleDateFieldId: string | null;
  period: { start: number; end: number };
  previousPeriod: { start: number; end: number } | null;
  indicators: {
    sales: number | null;
    revenue: number | null;
    callsRealized: number | null;
    conversionRate: number | null;
    callsScheduled: number | null;
    showRate: number | null;
    appointmentsCreated: number | null;
    leadsQualified: number | null;
  };
  previousIndicators: {
    sales: number | null;
    revenue: number | null;
    callsRealized: number | null;
    callsScheduled: number | null;
    appointmentsCreated: number | null;
    leadsQualified: number | null;
  } | null;
  errors: string[];
};

/**
 * GET: indicadores do dashboard para o período e funis selecionados.
 * Query: client_id, start, end (ms), pipeline_ids (opcional, separado por vírgula).
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const clientId = searchParams.get("client_id");
  const startMs = parseMs(searchParams.get("start"));
  const endMs = parseMs(searchParams.get("end"));
  const pipelineIdsParam = searchParams.get("pipeline_ids");
  const pipelineIds = pipelineIdsParam ? pipelineIdsParam.split(",").map((s) => s.trim()).filter(Boolean) : [];

  const cred = await getGhlCredentials(request, clientId);
  if ("error" in cred) return NextResponse.json({ error: cred.error }, { status: cred.status });
  if (startMs == null || endMs == null) {
    return NextResponse.json({ error: "Query start e end (ms) são obrigatórios" }, { status: 400 });
  }

  const periodLength = endMs - startMs;
  const previousEndMs = startMs - 1;
  const previousStartMs = previousEndMs - periodLength;
  const previousPeriod = periodLength > 0 ? { start: previousStartMs, end: previousEndMs } : null;

  const errors: string[] = [];
  const service = createServiceClient();

  let saleDateFieldId: string | null = null;
  const { data: predef } = await service
    .from("location_predefinitions")
    .select("value")
    .eq("client_id", cred.client_id)
    .eq("key", KEY_SALE_DATE_FIELD_ID)
    .eq("active", true)
    .maybeSingle();
  if (predef?.value) saleDateFieldId = predef.value;

  let opportunities: GHLOpportunity[] = [];
  try {
    opportunities = await getOpportunities(cred.ghl_api_key, cred.ghl_location_id, {});
  } catch (e) {
    errors.push(e instanceof Error ? e.message : "Erro ao buscar oportunidades");
  }

  const { data: calendars } = await service
    .from("ghl_calendars")
    .select("ghl_calendar_id")
    .eq("client_id", cred.client_id)
    .eq("active", true);
  const calendarIds = (calendars ?? []).map((c) => c.ghl_calendar_id).filter(Boolean);

  let eventsByStartTime: GHLCalendarEvent[] = [];
  let eventsByStartTimePrev: GHLCalendarEvent[] = [];
  let eventsByCreatedAt: GHLCalendarEvent[] = [];
  let eventsByCreatedAtPrev: GHLCalendarEvent[] = [];
  const CREATED_LOOKBACK_MS = 365 * 24 * 60 * 60 * 1000;

  if (calendarIds.length > 0) {
    try {
      const wideStart = Math.max(0, (previousPeriod?.start ?? startMs) - CREATED_LOOKBACK_MS);
      const wideEnd = endMs + 86400000;
      const [currByStart, prevByStart, wideForCreated] = await Promise.all([
        getCalendarEventsForCalendars(cred.ghl_api_key, cred.ghl_location_id, {
          startTime: startMs,
          endTime: endMs,
          calendarIds,
        }),
        previousPeriod
          ? getCalendarEventsForCalendars(cred.ghl_api_key, cred.ghl_location_id, {
              startTime: previousStartMs,
              endTime: previousEndMs,
              calendarIds,
            })
          : Promise.resolve([]),
        getCalendarEventsForCalendars(cred.ghl_api_key, cred.ghl_location_id, {
          startTime: wideStart,
          endTime: wideEnd,
          calendarIds,
        }),
      ]);
      eventsByStartTime = filterEventsByStartTime(currByStart, startMs, endMs);
      eventsByStartTimePrev = previousPeriod
        ? filterEventsByStartTime(prevByStart, previousStartMs, previousEndMs)
        : [];
      eventsByCreatedAt = filterEventsByCreatedAt(wideForCreated, startMs, endMs);
      eventsByCreatedAtPrev = previousPeriod
        ? filterEventsByCreatedAt(wideForCreated, previousStartMs, previousEndMs)
        : [];
    } catch (e) {
      errors.push(e instanceof Error ? e.message : "Erro ao buscar agendamentos");
    }
  }

  const oppPeriod = filterOpportunitiesByPeriodAndPipeline(
    opportunities,
    startMs,
    endMs,
    saleDateFieldId,
    pipelineIds
  );
  const oppPeriodWon = oppPeriod.filter((o) => o.status === STATUS_WON);
  const oppPeriodWonWithSaleDate = oppPeriodWon.filter((o) => hasSaleDateForIndicator(o, saleDateFieldId));
  const sales = oppPeriodWonWithSaleDate.length;
  const revenue = oppPeriodWonWithSaleDate.reduce((sum, o) => sum + (Number(o.monetaryValue) || 0), 0);

  const oppPrev = previousPeriod
    ? filterOpportunitiesByPeriodAndPipeline(
        opportunities,
        previousStartMs,
        previousEndMs,
        saleDateFieldId,
        pipelineIds
      )
    : [];
  const oppPrevWon = oppPrev.filter((o) => o.status === STATUS_WON);
  const oppPrevWonWithSaleDate = oppPrevWon.filter((o) => hasSaleDateForIndicator(o, saleDateFieldId));
  const prevSales = previousPeriod ? oppPrevWonWithSaleDate.length : null;
  const prevRevenue = previousPeriod ? oppPrevWonWithSaleDate.reduce((sum, o) => sum + (Number(o.monetaryValue) || 0), 0) : null;

  const showed = eventsByStartTime.filter((e) => String(e.status).toLowerCase() === "showed").length;
  const showedPrev = eventsByStartTimePrev.filter((e) => String(e.status).toLowerCase() === "showed").length;
  const callsScheduled = eventsByStartTime.length;
  const callsScheduledPrev = eventsByStartTimePrev.length;
  const conversionRate = showed > 0 ? (sales / showed) * 100 : null;
  const showRate = callsScheduled > 0 ? (showed / callsScheduled) * 100 : null;
  const appointmentsCreated = eventsByCreatedAt.length;
  const appointmentsCreatedPrev = previousPeriod ? eventsByCreatedAtPrev.length : null;
  const leadsQualified = oppPeriod.length;
  const leadsQualifiedPrev = previousPeriod ? oppPrev.length : null;

  const payload: DashboardIndicatorsPayload = {
    saleDateFieldId,
    period: { start: startMs, end: endMs },
    previousPeriod,
    indicators: {
      sales: errors.some((x) => x.includes("oportunidades")) ? null : sales,
      revenue: errors.some((x) => x.includes("oportunidades")) ? null : revenue,
      callsRealized: errors.some((x) => x.includes("agendamentos")) ? null : showed,
      conversionRate: errors.some((x) => x.includes("oportunidades")) || errors.some((x) => x.includes("agendamentos")) ? null : conversionRate,
      callsScheduled: errors.some((x) => x.includes("agendamentos")) ? null : callsScheduled,
      showRate: errors.some((x) => x.includes("agendamentos")) ? null : showRate,
      appointmentsCreated: errors.some((x) => x.includes("agendamentos")) ? null : appointmentsCreated,
      leadsQualified: errors.some((x) => x.includes("oportunidades")) ? null : leadsQualified,
    },
    previousIndicators: previousPeriod
      ? {
          sales: prevSales,
          revenue: prevRevenue,
          callsRealized: showedPrev,
          callsScheduled: callsScheduledPrev,
          appointmentsCreated: appointmentsCreatedPrev,
          leadsQualified: leadsQualifiedPrev,
        }
      : null,
    errors,
  };

  return NextResponse.json(payload);
}
