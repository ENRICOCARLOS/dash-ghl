import { getGhlCredentials } from "@/lib/ghl-credentials";
import { createServiceClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

const KEY_SALE_DATE_FIELD_ID = "sale_date_field_id";
const KEY_OPPORTUNITY_IMPORT_CUSTOM_FIELDS = "opportunity_import_custom_fields";
const STATUS_WON = "won";

function sanitizeCfColumn(fieldId: string): string {
  let out = "cf_";
  for (let i = 0; i < fieldId.length; i++) {
    const c = fieldId[i];
    out += /[a-zA-Z0-9_]/.test(c) ? c : "_";
  }
  return out;
}

function parseMs(value: string | null): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toMs(v: string | null | undefined): number | null {
  if (v == null) return null;
  const ms = new Date(v).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Retorna: series (para gráfico linha), monthly (resumo mensal), byResponsible, utmCampaign, utmMedium, utmContent, bySource.
 * Query: client_id, start, end (ms), pipeline_ids (opcional).
 */
export async function GET(request: NextRequest) {
  // #region agent log
  fetch("http://127.0.0.1:7737/ingest/74e9cf05-eff5-440a-8210-2ba42cb1884f", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "d41e01" },
    body: JSON.stringify({
      sessionId: "d41e01",
      location: "report/extra/route.ts:GET:entry",
      message: "report/extra GET entry",
      data: {},
      timestamp: Date.now(),
      hypothesisId: "H1",
    }),
  }).catch(() => {});
  // #endregion
  try {
  const { searchParams } = new URL(request.url);
  const clientId = searchParams.get("client_id");
  const startMs = parseMs(searchParams.get("start"));
  const endMs = parseMs(searchParams.get("end"));
  const pipelineIdsParam = searchParams.get("pipeline_ids");
  const pipelineIds = pipelineIdsParam ? pipelineIdsParam.split(",").map((s) => s.trim()).filter(Boolean) : [];
  const sourcesParam = searchParams.get("sources");
  const sourcesFilter = sourcesParam ? sourcesParam.split(",").map((s) => s.trim()).filter(Boolean) : [];
  /** Ano opcional: quando informado, o resumo mensal usa apenas o ano (1 jan - 31 dez), ignorando o período start/end. */
  const yearParam = searchParams.get("year");
  const yearForMonthly = yearParam != null && yearParam !== "" ? Number(yearParam) : null;
  const yearStartMs = yearForMonthly != null && Number.isFinite(yearForMonthly)
    ? new Date(yearForMonthly, 0, 1, 0, 0, 0, 0).getTime()
    : null;
  const yearEndMs = yearForMonthly != null && Number.isFinite(yearForMonthly)
    ? new Date(yearForMonthly, 11, 31, 23, 59, 59, 999).getTime()
    : null;
  /** Filtro para splitByField: só oportunidades/eventos que tenham este valor neste campo (filtra as demais tabelas ao clicar em um card). */
  const splitFilterDim = searchParams.get("split_filter_dim")?.trim() || null;
  const splitFilterValueParam = searchParams.get("split_filter_value");
  const splitFilterValue = splitFilterDim && splitFilterValueParam !== null ? String(splitFilterValueParam) : null;

  const cred = await getGhlCredentials(request, clientId);
  if ("error" in cred) return NextResponse.json({ error: cred.error }, { status: cred.status });
  if (startMs == null || endMs == null) {
    return NextResponse.json({ error: "Query start e end (ms) são obrigatórios" }, { status: 400 });
  }

  const service = createServiceClient();
  let saleDateFieldId: string | null = null;
  const { data: saleDatePredef } = await service
    .from("location_predefinitions")
    .select("value")
    .eq("client_id", cred.client_id)
    .eq("key", KEY_SALE_DATE_FIELD_ID)
    .eq("active", true)
    .maybeSingle();
  if (saleDatePredef?.value) saleDateFieldId = String(saleDatePredef.value).trim() || null;

  const inRange = (ms: number | null, start: number, end: number) => ms != null && ms >= start && ms <= end;
  const byPipeline = (pipelineId: string | null) =>
    pipelineIds.length === 0 || (pipelineId != null && pipelineIds.includes(pipelineId));
  const matchesSourceFilter = (o: { source?: string | null }) =>
    sourcesFilter.length === 0 || sourcesFilter.includes((o.source ?? "").toString().trim() || "—");

  // Nome do responsável para Performance por responsável e análise cruzada (opportunities.assigned_to = ghl_users.ghl_user_id)
  const { data: ghlUsers } = await service
    .from("ghl_users")
    .select("ghl_user_id, name")
    .eq("client_id", cred.client_id)
    .eq("active", true);
  const ghlUserIdToName = new Map<string, string>();
  for (const u of ghlUsers ?? []) {
    const id = (u as { ghl_user_id: string }).ghl_user_id;
    const name = (u as { name: string | null }).name;
    ghlUserIdToName.set(id, name ?? id);
  }
  const resolveResponsible = (assignedTo: string | null): string =>
    assignedTo ? (ghlUserIdToName.get(assignedTo) ?? assignedTo) : "Não atribuído";

  type CustomDim = { id: string; col: string; name: string };
  let customDimensions: CustomDim[] = [];
  const { data: importPredef } = await service
    .from("location_predefinitions")
    .select("value")
    .eq("client_id", cred.client_id)
    .eq("key", KEY_OPPORTUNITY_IMPORT_CUSTOM_FIELDS)
    .eq("active", true)
    .maybeSingle();
  try {
    const raw = importPredef?.value;
    const parsed = raw && typeof raw === "string" ? (JSON.parse(raw) as unknown) : [];
    const arr = Array.isArray(parsed) ? (parsed as Array<{ id?: string; name?: string }>) : [];
    customDimensions = arr
      .filter((x) => x && typeof (x as { id?: string }).id === "string" && String((x as { id?: string }).id).trim() !== "")
      .map((x) => {
        const id = String((x as { id: string }).id).trim();
        const name = String((x as { name?: string }).name ?? id).trim() || id;
        return { id, col: sanitizeCfColumn(id), name };
      });
  } catch {
    customDimensions = [];
  }

  const startDate = new Date(startMs);
  const endDate = new Date(endMs);
  const periodDays = Math.ceil((endMs - startMs) / (24 * 60 * 60 * 1000));
  const groupByMonth = periodDays > 30;

  type OppRow = {
    id: string;
    pipeline_id: string | null;
    status: string | null;
    monetary_value: number | null;
    date_added: string | null;
    created_at: string;
    sale_date_value: string | null;
    assigned_to: string | null;
    source: string | null;
    contact_id: string | null;
    utm_campaign: string | null;
    utm_medium: string | null;
    utm_content: string | null;
    [key: string]: string | number | null | undefined;
  };
  const oppRows: OppRow[] = [];
  const cfCols = customDimensions.map((d) => d.col).filter(Boolean);
  const oppSelect =
    "id, pipeline_id, status, monetary_value, date_added, created_at, assigned_to, source, contact_id, sale_date_value, utm_campaign, utm_medium, utm_content" +
    (cfCols.length > 0 ? ", " + cfCols.join(", ") : "");
  // #region agent log
  fetch("http://127.0.0.1:7737/ingest/74e9cf05-eff5-440a-8210-2ba42cb1884f", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "d41e01" },
    body: JSON.stringify({
      sessionId: "d41e01",
      location: "report/extra/route.ts:before-opp-select",
      message: "before opportunities select",
      data: { oppSelect: oppSelect.slice(0, 120), cfColsLen: cfCols.length },
      timestamp: Date.now(),
      hypothesisId: "H1",
    }),
  }).catch(() => {});
  // #endregion
  let oppOffset = 0;
  const OPP_PAGE = 1000;
  while (true) {
    const result = await service
      .from("opportunities")
      .select(oppSelect)
      .eq("client_id", cred.client_id)
      .range(oppOffset, oppOffset + OPP_PAGE - 1);
    const page = result.data;
    const oppErr = result.error;
    // #region agent log
    if (oppErr) {
      fetch("http://127.0.0.1:7737/ingest/74e9cf05-eff5-440a-8210-2ba42cb1884f", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "d41e01" },
        body: JSON.stringify({
          sessionId: "d41e01",
          location: "report/extra/route.ts:opp-query-error",
          message: "opportunities query error",
          data: { error: oppErr.message, code: oppErr.code },
          timestamp: Date.now(),
          hypothesisId: "H1",
        }),
      }).catch(() => {});
    }
    // #endregion
    if (oppErr) break;
    const pageData: unknown = page;
    if (!Array.isArray(pageData) || pageData.length === 0) break;
    oppRows.push(...(pageData as OppRow[]));
    if (pageData.length < OPP_PAGE) break;
    oppOffset += OPP_PAGE;
  }

  const eventRows: { id: string; start_time: string | null; status: string | null; created_at: string; contact_id: string | null }[] = [];
  let evOffset = 0;
  const EV_PAGE = 1000;
  while (true) {
    const { data: evPage } = await service
      .from("calendar_events")
      .select("id, start_time, status, created_at, contact_id")
      .eq("client_id", cred.client_id)
      .range(evOffset, evOffset + EV_PAGE - 1);
    if (!evPage?.length) break;
    eventRows.push(...evPage);
    if (evPage.length < EV_PAGE) break;
    evOffset += EV_PAGE;
  }

  const { data: spendRows } = await service
    .from("facebook_ads_daily_insights")
    .select("date, spend")
    .eq("client_id", cred.client_id)
    .gte("date", startDate.toISOString().slice(0, 10))
    .lte("date", endDate.toISOString().slice(0, 10));

  /** Spend por nome (Campanha ↔ utm_campaign, Conjunto ↔ utm_medium, Criativo ↔ utm_content) para investimento por UTM. */
  const { data: spendByMetaRows } = await service
    .from("facebook_ads_daily_insights")
    .select("campaign_name, adset_name, ad_name, spend")
    .eq("client_id", cred.client_id)
    .gte("date", startDate.toISOString().slice(0, 10))
    .lte("date", endDate.toISOString().slice(0, 10));

  const spendByCampaignName = new Map<string, number>();
  const spendByAdsetName = new Map<string, number>();
  const spendByAdName = new Map<string, number>();
  for (const r of spendByMetaRows ?? []) {
    const spend = Number((r as { spend?: unknown }).spend ?? 0) || 0;
    const camp = String((r as { campaign_name?: string }).campaign_name ?? "").trim() || "—";
    const adset = String((r as { adset_name?: string }).adset_name ?? "").trim() || "—";
    const ad = String((r as { ad_name?: string }).ad_name ?? "").trim() || "—";
    spendByCampaignName.set(camp, (spendByCampaignName.get(camp) ?? 0) + spend);
    spendByAdsetName.set(adset, (spendByAdsetName.get(adset) ?? 0) + spend);
    spendByAdName.set(ad, (spendByAdName.get(ad) ?? 0) + spend);
  }

  /** Para resumo mensal: quando year é informado, buscar spend do ano inteiro. */
  let spendRowsForMonthly: { date: string; spend: number }[] = [];
  if (yearForMonthly != null && Number.isFinite(yearForMonthly)) {
    const y = String(yearForMonthly);
    const { data: yearSpend } = await service
      .from("facebook_ads_daily_insights")
      .select("date, spend")
      .eq("client_id", cred.client_id)
      .gte("date", `${y}-01-01`)
      .lte("date", `${y}-12-31`);
    spendRowsForMonthly = (yearSpend ?? []) as { date: string; spend: number }[];
  }

  const opportunities = (oppRows ?? []).filter((o) => byPipeline(o.pipeline_id ?? null) && matchesSourceFilter(o));
  const events = (eventRows ?? []) as { start_time: string | null; status: string | null; created_at: string; contact_id: string | null }[];

  const getOppDateMs = (o: OppRow) =>
    saleDateFieldId && o.sale_date_value != null ? toMs(o.sale_date_value) : toMs(o.date_added ?? o.created_at);
  const hasSaleDate = (o: OppRow) =>
    !saleDateFieldId || o.sale_date_value === undefined || toMs(o.sale_date_value) != null;

  const key = (d: Date) => (groupByMonth ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}` : d.toISOString().slice(0, 10));
  const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  const seriesMap = new Map<string, { leads: number; appointments: number; sales: number; investment: number }>();

  for (const o of opportunities) {
    const ms = getOppDateMs(o);
    if (!inRange(ms, startMs, endMs)) continue;
    const d = new Date(ms!);
    const k = key(d);
    const cur = seriesMap.get(k) ?? { leads: 0, appointments: 0, sales: 0, investment: 0 };
    cur.leads += 1;
    if (o.status === STATUS_WON && hasSaleDate(o)) cur.sales += 1;
    seriesMap.set(k, cur);
  }
  for (const e of events) {
    const ms = toMs(e.start_time);
    if (!inRange(ms, startMs, endMs)) continue;
    const k = key(new Date(ms!));
    const cur = seriesMap.get(k) ?? { leads: 0, appointments: 0, sales: 0, investment: 0 };
    cur.appointments += 1;
    seriesMap.set(k, cur);
  }
  for (const r of spendRows ?? []) {
    const k = groupByMonth ? (r.date as string).slice(0, 7) : (r.date as string);
    const cur = seriesMap.get(k) ?? { leads: 0, appointments: 0, sales: 0, investment: 0 };
    cur.investment += Number(r.spend ?? 0);
    seriesMap.set(k, cur);
  }

  const series = Array.from(seriesMap.entries())
    .map(([date, v]) => ({ date, ...v }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const emptyMonth = () => ({ sales: 0, revenue: 0, investment: 0, callsRealized: 0, appointments: 0, leads: 0 });
  /** Resumo mensal: usa apenas o ano do período (yearStartMs/yearEndMs) quando informado; senão usa start/end. */
  const monthlyStart = yearStartMs ?? startMs;
  const monthlyEnd = yearEndMs ?? endMs;
  const monthlySpendRows = yearForMonthly != null ? spendRowsForMonthly : (spendRows ?? []);
  const monthlyMap = new Map<string, { sales: number; revenue: number; investment: number; callsRealized: number; appointments: number; leads: number }>();
  for (const o of opportunities) {
    const ms = getOppDateMs(o);
    if (!inRange(ms, monthlyStart, monthlyEnd)) continue;
    const m = monthKey(new Date(ms!));
    const cur = monthlyMap.get(m) ?? emptyMonth();
    cur.leads += 1;
    if (o.status === STATUS_WON && hasSaleDate(o)) {
      cur.sales += 1;
      cur.revenue += Number(o.monetary_value ?? 0);
    }
    monthlyMap.set(m, cur);
  }
  for (const e of events) {
    const ms = toMs(e.start_time);
    if (!inRange(ms, monthlyStart, monthlyEnd)) continue;
    const m = monthKey(new Date(ms!));
    const cur = monthlyMap.get(m) ?? emptyMonth();
    cur.appointments += 1;
    if (String(e.status ?? "").toLowerCase() === "showed") cur.callsRealized += 1;
    monthlyMap.set(m, cur);
  }
  for (const r of monthlySpendRows) {
    const m = (r.date as string).slice(0, 7);
    const cur = monthlyMap.get(m) ?? emptyMonth();
    cur.investment += Number(r.spend ?? 0);
    monthlyMap.set(m, cur);
  }
  const monthly = Array.from(monthlyMap.entries())
    .map(([month, v]) => ({
      month,
      ...v,
      cpl: v.leads > 0 ? v.investment / v.leads : 0,
      cpa: v.sales > 0 ? v.investment / v.sales : 0,
    }))
    .sort((a, b) => a.month.localeCompare(b.month));

  // Performance por responsável: agrupa por nome do responsável (ghl_users.name via assigned_to = ghl_user_id)
  const respMap = new Map<string, { sales: number; revenue: number; opportunities: number }>();
  for (const o of opportunities) {
    const ms = getOppDateMs(o);
    if (!inRange(ms, startMs, endMs)) continue;
    const responsibleName = resolveResponsible(o.assigned_to);
    const cur = respMap.get(responsibleName) ?? { sales: 0, revenue: 0, opportunities: 0 };
    cur.opportunities += 1;
    if (o.status === STATUS_WON && hasSaleDate(o)) {
      cur.sales += 1;
      cur.revenue += Number(o.monetary_value ?? 0);
    }
    respMap.set(responsibleName, cur);
  }
  const byResponsible = Array.from(respMap.entries())
    .map(([name, v]) => ({ name, ...v, conversionRate: v.opportunities > 0 ? (v.sales / v.opportunities) * 100 : 0 }))
    .sort((a, b) => b.sales - a.sales);

  // Por contact_id, UTM da primeira oportunidade no período (para atribuir agendamentos/calls ao UTM)
  const contactToUtm = new Map<string, { utm_campaign: string; utm_medium: string; utm_content: string }>();
  const oppsInRange = opportunities
    .filter((o) => inRange(getOppDateMs(o), startMs, endMs))
    .sort((a, b) => (getOppDateMs(a) ?? 0) - (getOppDateMs(b) ?? 0));
  for (const o of oppsInRange) {
    const cid = o.contact_id ?? "";
    if (!cid || contactToUtm.has(cid)) continue;
    contactToUtm.set(cid, {
      utm_campaign: (o.utm_campaign ?? "").trim() || "—",
      utm_medium: (o.utm_medium ?? "").trim() || "—",
      utm_content: (o.utm_content ?? "").trim() || "—",
    });
  }

  type UtmRow = { leads: number; sales: number; revenue: number; investment: number; appointments: number; callsRealized: number };
  const utmAgg = (
    getKey: (o: { utm_campaign: string | null; utm_medium: string | null; utm_content: string | null }) => string,
    getSpendByUtmName?: (name: string) => number
  ) => {
    const map = new Map<string, UtmRow>();
    const empty = (): UtmRow => ({ leads: 0, sales: 0, revenue: 0, investment: 0, appointments: 0, callsRealized: 0 });
    for (const o of opportunities) {
      const ms = getOppDateMs(o);
      if (!inRange(ms, startMs, endMs)) continue;
      const k = getKey(o) || "—";
      const cur = map.get(k) ?? empty();
      cur.leads += 1;
      if (o.status === STATUS_WON && hasSaleDate(o)) {
        cur.sales += 1;
        cur.revenue += Number(o.monetary_value ?? 0);
      }
      map.set(k, cur);
    }
    for (const e of events) {
      const ms = toMs(e.start_time);
      if (!inRange(ms, startMs, endMs)) continue;
      const utm = e.contact_id ? contactToUtm.get(e.contact_id) : null;
      if (!utm) continue;
      const k = getKey(utm) || "—";
      const cur = map.get(k) ?? empty();
      cur.appointments += 1;
      if (String(e.status ?? "").toLowerCase() === "showed") cur.callsRealized += 1;
      map.set(k, cur);
    }
    if (getSpendByUtmName) {
      for (const [name, row] of map) row.investment += getSpendByUtmName(name) ?? 0;
    }
    return Array.from(map.entries())
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.leads - a.leads);
  };
  const utmCampaign = utmAgg((o) => (o.utm_campaign ?? "").trim() || "—", (name) => spendByCampaignName.get(name) ?? 0);
  const utmMedium = utmAgg((o) => (o.utm_medium ?? "").trim() || "—", (name) => spendByAdsetName.get(name) ?? 0);
  const utmContent = utmAgg((o) => (o.utm_content ?? "").trim() || "—", (name) => spendByAdName.get(name) ?? 0);

  const sourceMap = new Map<string, { opportunities: number; sales: number; revenue: number }>();
  for (const o of opportunities) {
    const ms = getOppDateMs(o);
    if (!inRange(ms, startMs, endMs)) continue;
    const s = o.source ?? "—";
    const cur = sourceMap.get(s) ?? { opportunities: 0, sales: 0, revenue: 0 };
    cur.opportunities += 1;
    if (o.status === STATUS_WON && hasSaleDate(o)) {
      cur.sales += 1;
      cur.revenue += Number(o.monetary_value ?? 0);
    }
    sourceMap.set(s, cur);
  }
  const bySource = Array.from(sourceMap.entries())
    .map(([source, v]) => ({
      source,
      ...v,
      conversion: v.opportunities > 0 ? (v.sales / v.opportunities) * 100 : 0,
    }))
    .sort((a, b) => b.opportunities - a.opportunities);

  const FAIXAS = [
    { key: "0 - 1.000", min: 0, max: 1000 },
    { key: "1.000 - 5.000", min: 1000, max: 5000 },
    { key: "5.000 - 10.000", min: 5000, max: 10000 },
    { key: "10.000 - 50.000", min: 10000, max: 50000 },
    { key: "50.000+", min: 50000, max: Infinity },
  ];
  const faixaMap = new Map<string, { count: number; revenue: number }>();
  for (const f of FAIXAS) faixaMap.set(f.key, { count: 0, revenue: 0 });
  for (const o of opportunities) {
    const ms = getOppDateMs(o);
    if (!inRange(ms, startMs, endMs) || o.status !== STATUS_WON || !hasSaleDate(o)) continue;
    const val = Number(o.monetary_value ?? 0);
    const faixa = FAIXAS.find((f) => val >= f.min && val < f.max) ?? FAIXAS[FAIXAS.length - 1];
    const cur = faixaMap.get(faixa.key)!;
    cur.count += 1;
    cur.revenue += val;
    faixaMap.set(faixa.key, cur);
  }
  const revenueByRange = FAIXAS.map((f) => ({
    range: f.key,
    count: faixaMap.get(f.key)?.count ?? 0,
    revenue: faixaMap.get(f.key)?.revenue ?? 0,
  })).filter((r) => r.count > 0 || r.revenue > 0);

  /** Valor normalizado para agrupamento: trim + "—" quando vazio, para evitar linhas/colunas duplicadas. */
  const getDimValue = (o: OppRow, dimId: string): string => {
    const empty = "—";
    let raw: string;
    switch (dimId) {
      case "source":
        raw = (o.source ?? "").toString().trim();
        return raw || empty;
      case "responsible":
        raw = resolveResponsible(o.assigned_to).trim();
        return raw || empty;
      case "utm_campaign":
        raw = (o.utm_campaign ?? "").toString().trim();
        return raw || empty;
      case "utm_medium":
        raw = (o.utm_medium ?? "").toString().trim();
        return raw || empty;
      case "utm_content":
        raw = (o.utm_content ?? "").toString().trim();
        return raw || empty;
      default:
        if (dimId.startsWith("cf_")) {
          const v = o[dimId];
          raw = v != null ? String(v).trim() : "";
          return raw || empty;
        }
        return empty;
    }
  };

  /** splitByField: agregação por campo personalizado (e faixa de faturamento) para a visualização "dividir por campo". Com filtro (split_filter_dim/value), só considera oportunidades/eventos que tenham esse valor nesse campo. */
  type SplitRow = { value: string; opportunities: number; sales: number; revenue: number; appointments: number; callsRealized: number; pctOpportunities: number; pctRevenue: number };
  const oppsForSplit =
    splitFilterDim && splitFilterValue !== null
      ? opportunities.filter(
          (o) => inRange(getOppDateMs(o), startMs, endMs) && getDimValue(o, splitFilterDim) === splitFilterValue
        )
      : opportunities.filter((o) => inRange(getOppDateMs(o), startMs, endMs));
  const contactIdsForSplit = new Set<string>(oppsForSplit.map((o) => o.contact_id ?? "").filter(Boolean));
  const oppsInRangeForSplit = [...oppsForSplit].sort((a, b) => (getOppDateMs(a) ?? 0) - (getOppDateMs(b) ?? 0));

  const totalRevenueAll = oppsForSplit
    .filter((o) => o.status === STATUS_WON && hasSaleDate(o))
    .reduce((s, o) => s + Number(o.monetary_value ?? 0), 0);
  const totalOppAll = oppsForSplit.length;

  const splitByFieldPanels: { dimId: string; label: string; totalOpportunities: number; totalRevenue: number; rows: SplitRow[] }[] = [];

  for (const d of customDimensions) {
    const dimCol = d.col;
    const contactToValue = new Map<string, string>();
    for (const o of oppsInRangeForSplit) {
      const cid = o.contact_id ?? "";
      if (!cid || contactToValue.has(cid)) continue;
      contactToValue.set(cid, getDimValue(o, dimCol));
    }
    const map = new Map<string, { opportunities: number; sales: number; revenue: number; appointments: number; callsRealized: number }>();
    const empty = () => ({ opportunities: 0, sales: 0, revenue: 0, appointments: 0, callsRealized: 0 });
    for (const o of oppsForSplit) {
      const v = getDimValue(o, dimCol);
      const cur = map.get(v) ?? empty();
      cur.opportunities += 1;
      if (o.status === STATUS_WON && hasSaleDate(o)) {
        cur.sales += 1;
        cur.revenue += Number(o.monetary_value ?? 0);
      }
      map.set(v, cur);
    }
    for (const e of events) {
      const ms = toMs(e.start_time);
      if (!inRange(ms, startMs, endMs)) continue;
      if (e.contact_id && !contactIdsForSplit.has(e.contact_id)) continue;
      const v = e.contact_id ? contactToValue.get(e.contact_id) : null;
      if (!v || !map.has(v)) continue;
      const cur = map.get(v)!;
      cur.appointments += 1;
      if (String(e.status ?? "").toLowerCase() === "showed") cur.callsRealized += 1;
    }
    const rows: SplitRow[] = Array.from(map.entries())
      .map(([value, r]) => ({
        value,
        opportunities: r.opportunities,
        sales: r.sales,
        revenue: r.revenue,
        appointments: r.appointments,
        callsRealized: r.callsRealized,
        pctOpportunities: totalOppAll > 0 ? (r.opportunities / totalOppAll) * 100 : 0,
        pctRevenue: totalRevenueAll > 0 ? (r.revenue / totalRevenueAll) * 100 : 0,
      }))
      .sort((a, b) => b.revenue - a.revenue);
    splitByFieldPanels.push({
      dimId: dimCol,
      label: d.name,
      totalOpportunities: totalOppAll,
      totalRevenue: totalRevenueAll,
      rows,
    });
  }

  const revenueByRangeWithPct = FAIXAS.map((f) => {
    const r = faixaMap.get(f.key)!;
    const revenue = r?.revenue ?? 0;
    const count = r?.count ?? 0;
    return {
      value: f.key,
      opportunities: 0,
      sales: count,
      revenue,
      appointments: 0,
      callsRealized: 0,
      pctOpportunities: 0,
      pctRevenue: totalRevenueAll > 0 ? (revenue / totalRevenueAll) * 100 : 0,
    };
  }).filter((r) => r.sales > 0 || r.revenue > 0);
  splitByFieldPanels.push({
    dimId: "revenue_range",
    label: "Faixa de faturamento",
    totalOpportunities: totalOppAll,
    totalRevenue: totalRevenueAll,
    rows: revenueByRangeWithPct,
  });

  return NextResponse.json({
    series,
    monthly,
    byResponsible,
    utmCampaign,
    utmMedium,
    utmContent,
    bySource,
    revenueByRange,
    splitByField: splitByFieldPanels,
  });
  } catch (e) {
    // #region agent log
    const errMsg = e instanceof Error ? e.message : String(e);
    const errStack = e instanceof Error ? e.stack : undefined;
    fetch("http://127.0.0.1:7737/ingest/74e9cf05-eff5-440a-8210-2ba42cb1884f", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "d41e01" },
      body: JSON.stringify({
        sessionId: "d41e01",
        location: "report/extra/route.ts:GET:catch",
        message: "report/extra GET exception",
        data: { error: errMsg, stack: errStack?.slice(0, 500) },
        timestamp: Date.now(),
        hypothesisId: "H1",
      }),
    }).catch(() => {});
    // #endregion
    return NextResponse.json(
      { error: errMsg },
      { status: 500 }
    );
  }
}
