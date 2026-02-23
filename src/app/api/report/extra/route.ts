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
      data: { row_dim: request.nextUrl.searchParams.get("row_dim"), col_dim: request.nextUrl.searchParams.get("col_dim") },
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
  const rowDim = searchParams.get("row_dim")?.trim() || "source";
  const colDim = searchParams.get("col_dim")?.trim() || "responsible";
  /** Ano opcional: quando informado, o resumo mensal usa apenas o ano (1 jan - 31 dez), ignorando o período start/end. */
  const yearParam = searchParams.get("year");
  const yearForMonthly = yearParam != null && yearParam !== "" ? Number(yearParam) : null;
  const yearStartMs = yearForMonthly != null && Number.isFinite(yearForMonthly)
    ? new Date(yearForMonthly, 0, 1, 0, 0, 0, 0).getTime()
    : null;
  const yearEndMs = yearForMonthly != null && Number.isFinite(yearForMonthly)
    ? new Date(yearForMonthly, 11, 31, 23, 59, 59, 999).getTime()
    : null;

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
    getKey: (o: { utm_campaign: string | null; utm_medium: string | null; utm_content: string | null }) => string
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
    return Array.from(map.entries())
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.leads - a.leads);
  };
  const utmCampaign = utmAgg((o) => o.utm_campaign ?? "");
  const utmMedium = utmAgg((o) => o.utm_medium ?? "");
  const utmContent = utmAgg((o) => o.utm_content ?? "");

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

  const availableDimensions: { id: string; label: string }[] = [
    { id: "source", label: "Origem" },
    { id: "responsible", label: "Responsável" },
    { id: "utm_campaign", label: "UTM Campaign" },
    { id: "utm_medium", label: "UTM Medium" },
    { id: "utm_content", label: "UTM Content" },
    ...customDimensions.map((d) => ({ id: d.col, label: d.name })),
  ];

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

  const sourceSet = new Set<string>();
  const respSet = new Set<string>();
  const crossMap = new Map<string, { leads: number; sales: number }>();
  const crossGenericMap = new Map<string, Map<string, { leads: number; sales: number }>>();
  for (const o of opportunities) {
    const ms = getOppDateMs(o);
    if (!inRange(ms, startMs, endMs)) continue;
    const src = o.source ?? "—";
    const resp = resolveResponsible(o.assigned_to);
    sourceSet.add(src);
    respSet.add(resp);
    const k = `${src}\0${resp}`;
    const cur = crossMap.get(k) ?? { leads: 0, sales: 0 };
    cur.leads += 1;
    if (o.status === STATUS_WON && hasSaleDate(o)) cur.sales += 1;
    crossMap.set(k, cur);

    const rowKey = getDimValue(o, rowDim);
    const colKey = getDimValue(o, colDim);
    let rowMap = crossGenericMap.get(rowKey);
    if (!rowMap) {
      rowMap = new Map();
      crossGenericMap.set(rowKey, rowMap);
    }
    const cell = rowMap.get(colKey) ?? { leads: 0, sales: 0 };
    cell.leads += 1;
    if (o.status === STATUS_WON && hasSaleDate(o)) cell.sales += 1;
    rowMap.set(colKey, cell);
  }
  const crossSources = Array.from(sourceSet).sort();
  const crossResponsibles = Array.from(respSet).sort();
  const crossLeads = crossSources.map((src) =>
    crossResponsibles.map((resp) => crossMap.get(`${src}\0${resp}`)?.leads ?? 0)
  );
  const crossSales = crossSources.map((src) =>
    crossResponsibles.map((resp) => crossMap.get(`${src}\0${resp}`)?.sales ?? 0)
  );

  const crossRowLabels = Array.from(crossGenericMap.keys()).sort();
  const crossColLabelSet = new Set<string>();
  for (const rowMap of crossGenericMap.values()) {
    for (const colKey of rowMap.keys()) crossColLabelSet.add(colKey);
  }
  const crossColLabels = Array.from(crossColLabelSet).sort();
  const crossMatrixLeads = crossRowLabels.map((rowKey) =>
    crossColLabels.map((colKey) => crossGenericMap.get(rowKey)?.get(colKey)?.leads ?? 0)
  );
  const crossMatrixSales = crossRowLabels.map((rowKey) =>
    crossColLabels.map((colKey) => crossGenericMap.get(rowKey)?.get(colKey)?.sales ?? 0)
  );

  return NextResponse.json({
    series,
    monthly,
    byResponsible,
    utmCampaign,
    utmMedium,
    utmContent,
    bySource,
    revenueByRange,
    crossSourceResponsible: {
      sources: crossSources,
      responsibles: crossResponsibles,
      leads: crossLeads,
      sales: crossSales,
    },
    availableDimensions,
    crossMatrix: {
      rowDim,
      colDim,
      rowLabels: crossRowLabels,
      colLabels: crossColLabels,
      leads: crossMatrixLeads,
      sales: crossMatrixSales,
    },
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
