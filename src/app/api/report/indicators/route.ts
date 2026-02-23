import { getGhlCredentials } from "@/lib/ghl-credentials";
import { createServiceClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

const KEY_SALE_DATE_FIELD_ID = "sale_date_field_id";
const KEY_FACEBOOK_UTM_SOURCE_TERMS = "facebook_utm_source_terms";
const STATUS_WON = "won";

function parseMs(value: string | null): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseJsonStringArray(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Retorna indicadores calculados apenas com dados já salvos no banco.
 * Não chama a API do GHL. Período em ms (start, end); pipeline_ids opcional.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const clientId = searchParams.get("client_id");
  const startMs = parseMs(searchParams.get("start"));
  const endMs = parseMs(searchParams.get("end"));
  const pipelineIdsParam = searchParams.get("pipeline_ids");
  const pipelineIds = pipelineIdsParam ? pipelineIdsParam.split(",").map((s) => s.trim()).filter(Boolean) : [];
  const sourcesParam = searchParams.get("sources");
  const sourcesFilter = sourcesParam ? sourcesParam.split(",").map((s) => s.trim()).filter(Boolean) : [];

  const cred = await getGhlCredentials(request, clientId);
  if ("error" in cred) return NextResponse.json({ error: cred.error }, { status: cred.status });
  if (startMs == null || endMs == null) {
    return NextResponse.json({ error: "Query start e end (ms) são obrigatórios" }, { status: 400 });
  }

  const periodLength = endMs - startMs;
  const previousEndMs = startMs - 1;
  const previousStartMs = previousEndMs - periodLength;
  const previousPeriod = periodLength > 0 ? { start: previousStartMs, end: previousEndMs } : null;

  const service = createServiceClient();
  const errors: string[] = [];

  let saleDateFieldId: string | null = null;
  const { data: predef } = await service
    .from("location_predefinitions")
    .select("value")
    .eq("client_id", cred.client_id)
    .eq("key", KEY_SALE_DATE_FIELD_ID)
    .eq("active", true)
    .maybeSingle();
  if (predef?.value) saleDateFieldId = predef.value;

  const { data: paidTermsPredef } = await service
    .from("location_predefinitions")
    .select("value")
    .eq("client_id", cred.client_id)
    .eq("key", KEY_FACEBOOK_UTM_SOURCE_TERMS)
    .eq("active", true)
    .maybeSingle();
  const paidUtmSourceTerms = new Set(parseJsonStringArray(paidTermsPredef?.value));

  const oppRows: {
    id: string;
    pipeline_id: string | null;
    status: string | null;
    monetary_value: number | null;
    date_added: string | null;
    created_at: string;
    sale_date_value: string | null;
    contact_id: string | null;
    source: string | null;
    utm_source: string | null;
    utm_campaign: string | null;
    utm_medium: string | null;
    utm_content: string | null;
  }[] = [];
  let oppOffset = 0;
  const OPP_PAGE = 1000;
  const oppSelectBase =
    "id, pipeline_id, status, monetary_value, date_added, created_at, contact_id, sale_date_value, source, utm_source, utm_campaign, utm_medium, utm_content";
  while (true) {
    const { data: page, error: oppErr } = await service
      .from("opportunities")
      .select(oppSelectBase)
      .eq("client_id", cred.client_id)
      .range(oppOffset, oppOffset + OPP_PAGE - 1);
    if (oppErr) {
      // #region agent log
      fetch("http://127.0.0.1:7737/ingest/74e9cf05-eff5-440a-8210-2ba42cb1884f", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "d41e01" },
        body: JSON.stringify({
          sessionId: "d41e01",
          location: "report/indicators/route.ts:opp-query-error",
          message: "opportunities query error",
          data: { error: oppErr.message, code: oppErr.code },
          timestamp: Date.now(),
          hypothesisId: "H2",
        }),
      }).catch(() => {});
      // #endregion
      errors.push(oppErr.message ?? "Erro ao buscar oportunidades");
      break;
    }
    if (!page?.length) break;
    oppRows.push(...page);
    if (page.length < OPP_PAGE) break;
    oppOffset += OPP_PAGE;
  }

  const toMs = (v: string | null | undefined): number | null => {
    if (v == null) return null;
    const ms = new Date(v).getTime();
    return Number.isFinite(ms) ? ms : null;
  };
  const inRange = (ms: number | null, start: number, end: number) => ms != null && ms >= start && ms <= end;
  const byPipeline = (pipelineId: string | null) =>
    pipelineIds.length === 0 || (pipelineId != null && pipelineIds.includes(pipelineId));
  const bySource = (o: (typeof oppRows)[number]) =>
    sourcesFilter.length === 0 || sourcesFilter.includes((o.source ?? "").toString().trim() || "—");

  const opportunities = oppRows.filter((o) => byPipeline(o.pipeline_id ?? null) && bySource(o));

  const getOppDateMs = (o: (typeof opportunities)[number]) =>
    saleDateFieldId && (o as { sale_date_value?: string | null }).sale_date_value != null
      ? toMs((o as { sale_date_value?: string | null }).sale_date_value)
      : toMs(o.date_added ?? o.created_at);
  const hasSaleDate = (o: (typeof opportunities)[number]) =>
    !saleDateFieldId || (o as { sale_date_value?: string | null }).sale_date_value === undefined || toMs((o as { sale_date_value?: string | null }).sale_date_value) != null;

  const oppPeriod = opportunities.filter((o) => inRange(getOppDateMs(o), startMs, endMs));
  const isAdOpportunity = (opp: (typeof opportunities)[number]) => {
    const source = String(opp.utm_source ?? "").trim().toLowerCase();
    return source !== "" && paidUtmSourceTerms.has(source);
  };
  const oppPeriodAds = oppPeriod.filter((o) => isAdOpportunity(o));
  const oppPeriodWon = oppPeriod.filter((o) => o.status === STATUS_WON);
  const oppPeriodWonWithSaleDate = oppPeriodWon.filter(hasSaleDate);
  const oppPeriodAdsWon = oppPeriodAds.filter((o) => o.status === STATUS_WON);
  const oppPeriodAdsWonWithSaleDate = oppPeriodAdsWon.filter(hasSaleDate);
  const sales = oppPeriodWonWithSaleDate.length;
  const revenue = oppPeriodWonWithSaleDate.reduce((sum, o) => sum + (Number(o.monetary_value) || 0), 0);
  const salesAds = oppPeriodAdsWonWithSaleDate.length;
  const revenueAds = oppPeriodAdsWonWithSaleDate.reduce((sum, o) => sum + (Number(o.monetary_value) || 0), 0);
  const adContactIds = new Set(oppPeriodAds.map((o) => o.contact_id).filter((id): id is string => Boolean(id)));

  const oppPrev = previousPeriod
    ? opportunities.filter((o) => inRange(getOppDateMs(o), previousStartMs, previousEndMs))
    : [];
  const oppPrevAds = previousPeriod ? oppPrev.filter((o) => isAdOpportunity(o)) : [];
  const oppPrevWon = oppPrev.filter((o) => o.status === STATUS_WON);
  const oppPrevWonWithSaleDate = oppPrevWon.filter(hasSaleDate);
  const oppPrevAdsWon = oppPrevAds.filter((o) => o.status === STATUS_WON);
  const oppPrevAdsWonWithSaleDate = oppPrevAdsWon.filter(hasSaleDate);
  const prevSales = previousPeriod ? oppPrevWonWithSaleDate.length : null;
  const prevRevenue = previousPeriod ? oppPrevWonWithSaleDate.reduce((sum, o) => sum + (Number(o.monetary_value) || 0), 0) : null;
  const prevSalesAds = previousPeriod ? oppPrevAdsWonWithSaleDate.length : null;
  const prevRevenueAds = previousPeriod ? oppPrevAdsWonWithSaleDate.reduce((sum, o) => sum + (Number(o.monetary_value) || 0), 0) : null;
  const prevAdContactIds = new Set(oppPrevAds.map((o) => o.contact_id).filter((id): id is string => Boolean(id)));

  const leadsQualified = oppPeriod.length;
  const leadsQualifiedPrev = previousPeriod ? oppPrev.length : null;

  const eventRows: { id: string; start_time: string | null; status: string | null; created_at: string }[] = [];
  let evOffset = 0;
  const EV_PAGE = 1000;
  while (true) {
    const { data: evPage, error: evErr } = await service
      .from("calendar_events")
      .select("id, start_time, status, created_at")
      .eq("client_id", cred.client_id)
      .not("start_time", "is", null)
      .range(evOffset, evOffset + EV_PAGE - 1);
    if (evErr) {
      errors.push(evErr.message ?? "Erro ao buscar eventos de calendário");
      break;
    }
    if (!evPage?.length) break;
    eventRows.push(...evPage);
    if (evPage.length < EV_PAGE) break;
    evOffset += EV_PAGE;
  }

  const events = eventRows as { start_time: string | null; status: string | null; created_at: string }[];
  const eventsByStartTime = events.filter((e) => {
    const ms = toMs(e.start_time);
    return inRange(ms, startMs, endMs);
  });
  const eventsByStartTimePrev =
    previousPeriod ?
      events.filter((e) => {
        const ms = toMs(e.start_time);
        return ms != null && ms >= previousStartMs && ms <= previousEndMs;
      })
    : [];
  const eventsByCreatedAt = events.filter((e) => {
    const ms = toMs(e.created_at);
    return inRange(ms, startMs, endMs);
  });
  const eventsByCreatedAtPrev =
    previousPeriod ?
      events.filter((e) => {
        const ms = toMs(e.created_at);
        return ms != null && ms >= previousStartMs && ms <= previousEndMs;
      })
    : [];

  const showed = eventsByStartTime.filter((e) => String(e.status ?? "").toLowerCase() === "showed").length;
  const showedPrev = eventsByStartTimePrev.filter((e) => String(e.status ?? "").toLowerCase() === "showed").length;
  const showedAds = eventsByStartTime.filter((e) => {
    if (!e.contact_id) return false;
    return adContactIds.has(e.contact_id) && String(e.status ?? "").toLowerCase() === "showed";
  }).length;
  const showedPrevAds = eventsByStartTimePrev.filter((e) => {
    if (!e.contact_id) return false;
    return prevAdContactIds.has(e.contact_id) && String(e.status ?? "").toLowerCase() === "showed";
  }).length;
  const callsScheduled = eventsByStartTime.length;
  const callsScheduledPrev = eventsByStartTimePrev.length;
  const callsScheduledAds = eventsByStartTime.filter((e) => {
    if (!e.contact_id) return false;
    return adContactIds.has(e.contact_id);
  }).length;
  const callsScheduledPrevAds = eventsByStartTimePrev.filter((e) => {
    if (!e.contact_id) return false;
    return prevAdContactIds.has(e.contact_id);
  }).length;
  const conversionRate = showed > 0 ? (sales / showed) * 100 : null;
  const showRate = callsScheduled > 0 ? (showed / callsScheduled) * 100 : null;
  const appointmentsCreated = eventsByCreatedAt.length;
  const appointmentsCreatedPrev = previousPeriod ? eventsByCreatedAtPrev.length : null;
  const appointmentsCreatedAds = eventsByCreatedAt.filter((e) => {
    if (!e.contact_id) return false;
    return adContactIds.has(e.contact_id);
  }).length;
  const appointmentsCreatedPrevAds = previousPeriod
    ? eventsByCreatedAtPrev.filter((e) => {
        if (!e.contact_id) return false;
        return prevAdContactIds.has(e.contact_id);
      }).length
    : null;

  const payload = {
    saleDateFieldId,
    indicators: {
      sales: errors.some((x) => x.includes("oportunidades")) ? null : sales,
      revenue: errors.some((x) => x.includes("oportunidades")) ? null : revenue,
      salesAds: errors.some((x) => x.includes("oportunidades")) ? null : salesAds,
      revenueAds: errors.some((x) => x.includes("oportunidades")) ? null : revenueAds,
      callsRealized: errors.some((x) => x.includes("calendário")) ? null : showed,
      callsRealizedAds: errors.some((x) => x.includes("calendário")) ? null : showedAds,
      conversionRate:
        errors.some((x) => x.includes("oportunidades")) || errors.some((x) => x.includes("calendário")) ?
          null
        : conversionRate,
      callsScheduled: errors.some((x) => x.includes("calendário")) ? null : callsScheduled,
      callsScheduledAds: errors.some((x) => x.includes("calendário")) ? null : callsScheduledAds,
      showRate: errors.some((x) => x.includes("calendário")) ? null : showRate,
      appointmentsCreated: errors.some((x) => x.includes("calendário")) ? null : appointmentsCreated,
      appointmentsCreatedAds: errors.some((x) => x.includes("calendário")) ? null : appointmentsCreatedAds,
      leadsQualified: errors.some((x) => x.includes("oportunidades")) ? null : leadsQualified,
      leadsQualifiedAds: errors.some((x) => x.includes("oportunidades")) ? null : oppPeriodAds.length,
    },
    previousIndicators: previousPeriod
      ? {
          sales: prevSales,
          revenue: prevRevenue,
          salesAds: prevSalesAds,
          revenueAds: prevRevenueAds,
          callsRealized: showedPrev,
          callsRealizedAds: showedPrevAds,
          callsScheduled: callsScheduledPrev,
          callsScheduledAds: callsScheduledPrevAds,
          appointmentsCreated: appointmentsCreatedPrev,
          appointmentsCreatedAds: appointmentsCreatedPrevAds,
          leadsQualified: leadsQualifiedPrev,
          leadsQualifiedAds: oppPrevAds.length,
        }
      : null,
    errors,
  };

  return NextResponse.json(payload);
}
