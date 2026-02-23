import { getGhlCredentials, getGhlCredentialsByClientId } from "@/lib/ghl-credentials";
import { ghlErrorResponse } from "@/lib/ghl-error-response";
import { syncLog } from "@/lib/sync-log";
import {
  getPipelines,
  getStagesByPipeline,
  getCalendars,
  getLocationUsers,
  getOpportunities,
  getOpportunityById,
  getCalendarEventsForCalendars,
  type GHLOpportunity,
  type GHLCalendarEvent,
  type GHLPipeline,
  type GHLCalendar,
  type GHLUser,
} from "@/lib/ghl";
import { createServiceClient, getAuthUser } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { appendFileSync } from "fs";
import { join } from "path";

function debugLog(payload: { hypothesisId: string; location: string; message: string; data: unknown }) {
  const line = JSON.stringify({ sessionId: "3e2132", ...payload, timestamp: Date.now() }) + "\n";
  try {
    appendFileSync(join(process.cwd(), "debug-3e2132.log"), line);
  } catch {
    // ignore
  }
  fetch("http://127.0.0.1:7737/ingest/74e9cf05-eff5-440a-8210-2ba42cb1884f", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "3e2132" },
    body: JSON.stringify({ sessionId: "3e2132", ...payload, timestamp: Date.now() }),
  }).catch(() => {});
}

/** Janela ampla para "Atualizar tudo" (sem filtro de período): 2 anos atrás até 1 ano à frente. */
const FULL_SYNC_EVENTS_MS = 2 * 365 * 24 * 60 * 60 * 1000;
const FULL_SYNC_EVENTS_END_MS = 365 * 24 * 60 * 60 * 1000;

/** Cooldown ADM / full: 5 min. Cooldown USER "Atualizar agora" (incremental_1h): 2 min. */
const SYNC_COOLDOWN_ADM_MS = 5 * 60 * 1000;
const SYNC_COOLDOWN_USER_MS = 2 * 60 * 1000;
const lastSyncByClient = new Map<string, number>();

/** Máximo de linhas (oportunidades + eventos) para USER em sync incremental; acima disso bloqueia. */
const USER_INCREMENTAL_MAX_ROWS = 3000;

/** 1 hora em ms */
const ONE_HOUR_MS = 60 * 60 * 1000;

function toTimestamp(value: string | number | null | undefined): string | null {
  if (value == null) return null;
  const ms = typeof value === "number" ? value : new Date(value).getTime();
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function toNum(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** API GHL pode retornar stage em pipelineStageId ou stageId; data de criação em dateAdded, dateCreated ou createdAt. */
function oppStageId(opp: GHLOpportunity & { pipelineStageId?: string; pipeline_stage_id?: string }): string | null {
  const v = opp.stageId ?? opp.pipelineStageId ?? opp.pipeline_stage_id ?? null;
  return v != null && String(v).trim() !== "" ? String(v).trim() : null;
}

/** Data de criação da oportunidade no GHL. Grava em date_added no Supabase. */
function oppDateAdded(opp: GHLOpportunity & { dateAdded?: string; date_added?: string; dateCreated?: string }): string | number | null | undefined {
  return (opp as { dateAdded?: string }).dateAdded ?? (opp as { date_added?: string }).date_added ?? (opp as { dateCreated?: string }).dateCreated ?? opp.createdAt;
}

/** Data da última atualização da oportunidade no GHL. Grava em date_updated no Supabase; usada no sync horário. */
function oppDateUpdated(opp: GHLOpportunity & { date_updated?: string }): string | number | null | undefined {
  return opp.dateUpdated ?? (opp as { date_updated?: string }).date_updated ?? null;
}

/** Converte customFields da API (objeto ou array) para Record<fieldId, value> para leitura de UTM.
 *  GHL LeadConnector costuma retornar array por item com:
 *  - { id, fieldValueString } (texto)
 *  - { id, fieldValueNumber } / { id, fieldValueBoolean } / { id, fieldValueDate } (data)
 *  e em alguns casos fieldValue / field_value / value / values[0]. */
function normalizeCustomFields(
  raw:
    | Record<string, string | number | null>
    | Array<{
        id?: string;
        fieldId?: string;
        field_id?: string;
        key?: string;
        fieldValueString?: string | null;
        fieldValueNumber?: number | null;
        fieldValueBoolean?: boolean | null;
        fieldValueDate?: string | null;
        fieldValue?: string | number | null;
        field_value?: string | number | null;
        value?: string | number | null;
        values?: (string | number | null)[];
        val?: string | number | null;
      }>
    | undefined
): Record<string, string | number | null> | undefined {
  if (raw == null) return undefined;
  if (Array.isArray(raw)) {
    const out: Record<string, string | number | null> = {};
    for (const item of raw) {
      const id = item.id ?? item.fieldId ?? (item as { field_id?: string }).field_id ?? (item as { key?: string }).key;
      if (id != null && id !== "") {
        const rawVal =
          (item as { fieldValueString?: string | null }).fieldValueString ??
          (item as { fieldValueNumber?: number | null }).fieldValueNumber ??
          (item as { fieldValueBoolean?: boolean | null }).fieldValueBoolean ??
          (item as { fieldValueDate?: string | null }).fieldValueDate ??
          (item as { fieldValue?: string | number | null }).fieldValue ??
          (item as { field_value?: string | number | null }).field_value ??
          item.value ??
          (Array.isArray(item.values) && item.values.length > 0 ? item.values[0] : null) ??
          (item as { val?: string | number | null }).val ??
          null;
        const v = rawVal == null || rawVal === "" ? null : typeof rawVal === "string" ? rawVal.trim() : String(rawVal);
        out[String(id)] = v === "" ? null : v;
      }
    }
    return Object.keys(out).length ? out : undefined;
  }
  return raw as Record<string, string | number | null>;
}

/** Extrai valor da data da venda do customFields (objeto ou array). Tenta por id/fieldId e todas as variantes de valor (incl. fieldValueDate). */
function getSaleDateValueFromCustomFields(
  rawCf: unknown,
  saleDateFieldId: string | null
): string | number | null {
  if (!saleDateFieldId || rawCf == null) return null;
  const idStr = String(saleDateFieldId).trim();
  if (!idStr) return null;
  if (Array.isArray(rawCf)) {
    for (const item of rawCf as Array<Record<string, unknown>>) {
      const id = item.id ?? item.fieldId ?? item.field_id ?? item.key;
      if (id == null) continue;
      if (String(id).trim() !== idStr) continue;
      const rawVal =
        item.fieldValueDate ?? item.fieldValueString ?? item.fieldValueNumber ?? item.fieldValueBoolean ??
        item.fieldValue ?? item.field_value ?? item.value ??
        (Array.isArray(item.values) && item.values.length > 0 ? item.values[0] : null) ?? item.val ?? null;
      if (rawVal == null || rawVal === "") return null;
      return typeof rawVal === "number" ? rawVal : typeof rawVal === "string" ? rawVal.trim() : String(rawVal);
    }
    return null;
  }
  const obj = rawCf as Record<string, string | number | null>;
  const v = obj[saleDateFieldId] ?? obj[idStr];
  if (v == null || v === "") return null;
  return typeof v === "number" ? v : typeof v === "string" ? v.trim() : String(v);
}

/** Retorna início e fim do dia anterior em America/Sao_Paulo (ms). 00:00 e 23:59:59.999 BRT. */
function getYesterdayBoundsAmericaSaoPaulo(): { startMs: number; endMs: number } {
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(yesterday);
  const y = parseInt(parts.find((p) => p.type === "year")?.value ?? "0", 10);
  const m = parseInt(parts.find((p) => p.type === "month")?.value ?? "0", 10) - 1;
  const d = parseInt(parts.find((p) => p.type === "day")?.value ?? "0", 10);
  const startMs = Date.UTC(y, m, d, 3, 0, 0, 0);
  const endMs = Date.UTC(y, m, d + 1, 2, 59, 59, 999);
  return { startMs, endMs };
}

type SyncMode = "incremental_1h" | "daily_reprocess" | "full";

/**
 * Sincroniza dados do GHL para o Supabase.
 * Body: client_id, mode? (incremental_1h | daily_reprocess | full), full_sync? (legado = full).
 * USER: só pode usar incremental_1h ("Atualizar agora"); cooldown 2 min; bloqueio se > 3000 linhas.
 * ADM: todos os modos; full cooldown 5 min.
 * Oportunidades: incremental_1h = por dateUpdated (última 1h); Supabase date_added = criação, date_updated = última atualização.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const clientId = (body.client_id as string) || null;
  const fullSyncLegacy = body.full_sync === true;
  const mode: SyncMode = body.mode ?? (fullSyncLegacy ? "full" : "incremental_1h");
  const modules = (body.modules as string[] | undefined) ?? ["pipelines", "calendars", "users", "opportunities", "calendar_events"];

  const cronSecret = request.headers.get("x-cron-secret");
  const isCron = typeof process.env.CRON_SECRET === "string" && process.env.CRON_SECRET.length > 0 && cronSecret === process.env.CRON_SECRET;

  let cred: { ghl_api_key: string; ghl_location_id: string; client_id: string } | { error: string; status: number };
  let isAdm = false;

  if (isCron) {
    if (!clientId) return NextResponse.json({ error: "client_id obrigatório para cron", status: 400 });
    cred = await getGhlCredentialsByClientId(clientId);
    isAdm = true;
  } else {
    const user = await getAuthUser(request);
    if (!user) {
      syncLog.error("Sync: não autorizado", null, { clientId });
      return NextResponse.json({ error: "Não autorizado", status: 401 });
    }
    const service = createServiceClient();
    const { data: profile } = await service.from("profiles").select("role").eq("id", user.id).single();
    isAdm = profile?.role === "ADM";

    if (mode === "full") {
      if (!isAdm) {
        syncLog.error("Sync: apenas ADM pode usar full", null, { clientId, mode });
        return NextResponse.json({ error: "Apenas ADM pode usar atualização full.", status: 403 });
      }
    }

    cred = await getGhlCredentials(request, clientId);
  }

  if ("error" in cred) {
    syncLog.error("Sync: credenciais inválidas", null, { clientId, status: cred.status });
    return NextResponse.json({ error: cred.error }, { status: cred.status });
  }

  syncLog.info("Sync iniciado", { mode, client_id: cred.client_id });
  const now = Date.now();
  if (!isCron) {
    const cooldownKey = `${cred.client_id}:${mode}`;
    const cooldownMs = mode === "incremental_1h" && !isAdm ? SYNC_COOLDOWN_USER_MS : SYNC_COOLDOWN_ADM_MS;
    const last = lastSyncByClient.get(cooldownKey);
    if (last != null && now - last < cooldownMs) {
      const retryAfterSec = Math.ceil((cooldownMs - (now - last)) / 1000);
      syncLog.info("Sync: cooldown", { client_id: cred.client_id, mode, retryAfterSec });
      return NextResponse.json(
        {
          error: mode === "incremental_1h" ? "Aguarde 2 minutos antes de atualizar novamente." : "Aguarde antes de atualizar novamente.",
          retry_after_seconds: retryAfterSec,
        },
        { status: 429, headers: { "Retry-After": String(retryAfterSec) } }
      );
    }
    lastSyncByClient.set(cooldownKey, now);
  }

  const { ghl_api_key, ghl_location_id, client_id } = cred;
  const service = createServiceClient();

  const errors: string[] = [];
  const BATCH_SIZE = 200;
  const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
  let opportunitiesSynced = 0;
  let calendarEventsSynced = 0;

  const doPipelines = modules.includes("pipelines");
  const doCalendars = modules.includes("calendars");
  const doUsers = modules.includes("users");
  const doOpportunities = modules.includes("opportunities");
  const doCalendarEvents = modules.includes("calendar_events");

  try {
    let startOppMs: number;
    let startEventMs: number;
    let untilMs: number;
    let opportunitiesList: GHLOpportunity[];
    let eventsList: GHLCalendarEvent[];
    let pipelinesWithStages: GHLPipeline[];
    let calendarsRes: GHLCalendar[];
    let usersRes: GHLUser[];

    const fullSync = mode === "full";

    // ——— Mapeamento UTM (location_predefinitions, por cliente) ———
    // Regras: (1) Carregar uma vez por execução do sync e reutilizar para todas as oportunidades.
    // (2) Não usar nomes de campo hardcoded — só o que está em location_predefinitions (key = *_field_id, value = ID do campo no GHL).
    // (3) Para cada oportunidade: localizar no payload (customFields) o campo com aquele ID, extrair value, gravar na coluna correspondente.
    // (4) Se o campo estiver ausente no payload → gravar null (regra única).
    // Aplica tanto ao sync normal (atualizadas recentemente) quanto à atualização avançada (criadas no período / full).
    const UTM_FIELD_KEYS = [
      "utm_source_field_id",
      "utm_campaign_field_id",
      "utm_medium_field_id",
      "utm_term_field_id",
      "utm_content_field_id",
    ] as const;
    const { data: utmPredefRows } = await service
      .from("location_predefinitions")
      .select("key, value")
      .eq("client_id", client_id)
      .in("key", UTM_FIELD_KEYS)
      .eq("active", true);
    const utmFieldIds: Record<string, string | null> = {};
    for (const k of UTM_FIELD_KEYS) {
      const col = k.replace("_field_id", "");
      utmFieldIds[col] = (utmPredefRows ?? []).find((x) => x.key === k)?.value ?? null;
    }
    // #region agent log
    debugLog({
      hypothesisId: "H1",
      location: "sync/route.ts:utmFieldIds",
      message: "utmFieldIds e predef rows",
      data: {
        client_id,
        utmFieldIds,
        predefRowKeys: (utmPredefRows ?? []).map((r) => r.key),
        predefRowValueTypes: (utmPredefRows ?? []).map((r) => (r.value ? (r.value.length > 20 ? "long" : "short") : "empty")),
      },
    });
    // #endregion
    const getUtm = (cf: Record<string, string | number | null> | undefined, fieldId: string | null): string | null => {
      if (!fieldId || !cf || cf[fieldId] == null) return null;
      const v = cf[fieldId];
      return typeof v === "string" ? v : String(v);
    };

    // ——— Campos customizados selecionados para importar (location_predefinitions) ———
    // key = opportunity_import_custom_fields, value = JSON [{id,name}...]
    const KEY_OPPORTUNITY_IMPORT_CUSTOM_FIELDS = "opportunity_import_custom_fields";
    const { data: importPredef } = await service
      .from("location_predefinitions")
      .select("value")
      .eq("client_id", client_id)
      .eq("key", KEY_OPPORTUNITY_IMPORT_CUSTOM_FIELDS)
      .eq("active", true)
      .maybeSingle();
    let importFieldIds: string[] = [];
    try {
      const raw = importPredef?.value;
      const parsed = raw && typeof raw === "string" ? (JSON.parse(raw) as unknown) : [];
      importFieldIds = Array.isArray(parsed)
        ? (parsed as Array<{ id?: unknown }>).map((x) => (x as { id?: unknown })?.id).filter((v): v is string => typeof v === "string" && v.trim() !== "").map((s) => s.trim())
        : [];
    } catch {
      importFieldIds = [];
    }

    const sanitizeCfColumn = (fieldId: string): string => {
      // espelha public.sanitize_custom_field_column_name: prefix cf_ e troca chars fora [a-zA-Z0-9_] por _
      let out = "cf_";
      for (let i = 0; i < fieldId.length; i++) {
        const c = fieldId[i];
        out += /[a-zA-Z0-9_]/.test(c) ? c : "_";
      }
      return out;
    };

    const importColumns = importFieldIds.map((id) => ({ id, col: sanitizeCfColumn(id) }));

    const KEY_SALE_DATE_FIELD_ID = "sale_date_field_id";
    const { data: saleDatePredef } = await service
      .from("location_predefinitions")
      .select("value")
      .eq("client_id", client_id)
      .eq("key", KEY_SALE_DATE_FIELD_ID)
      .eq("active", true)
      .maybeSingle();
    const saleDateFieldId = (saleDatePredef?.value as string)?.trim() || null;

    if (mode === "incremental_1h") {
      // Atualizar agora (USER): incremental. Regra fixa = data/hora atual e 1h para trás (não consultamos Supabase).
      // Consulta na API do GHL com esse intervalo (date/endDate para oportunidades); filtro pela coluna de última atualização (dateUpdated/date_updated) no GHL.
      // Oportunidades: API recebe date/endDate = última 1h; resposta filtrada por dateUpdated → grava date_updated no Supabase.
      // Eventos: API não suporta filtro por atualização; buscamos por janela de tempo e filtramos no código por dateUpdated/date_updated → grava date_updated no Supabase.
      const sinceMs = now - ONE_HOUR_MS;
      const [pipelinesRes, calendars, users, allOpps] = await Promise.all([
        doPipelines ? getPipelines(ghl_api_key, ghl_location_id) : Promise.resolve([] as GHLPipeline[]),
        doCalendars ? getCalendars(ghl_api_key, ghl_location_id) : Promise.resolve([] as GHLCalendar[]),
        doUsers ? getLocationUsers(ghl_api_key, ghl_location_id) : Promise.resolve([] as GHLUser[]),
        doOpportunities ? getOpportunities(ghl_api_key, ghl_location_id, { fullFetch: true, updatedSinceMs: sinceMs, updatedUntilMs: now }) : Promise.resolve([] as GHLOpportunity[]),
      ]);
      calendarsRes = calendars;
      usersRes = users;
      opportunitiesList = allOpps;
      const calendarIds = calendars.map((c) => c.id);
      eventsList = doCalendarEvents && calendarIds.length > 0
        ? await getCalendarEventsForCalendars(ghl_api_key, ghl_location_id, {
            startTime: now - 7 * 24 * ONE_HOUR_MS,
            endTime: now + 24 * 60 * 60 * 1000,
            calendarIds,
          }).then((evs) =>
            evs.filter((e) => {
              const updated = (e as { dateUpdated?: string }).dateUpdated ?? (e as { date_updated?: string }).date_updated;
              const ms = updated ? new Date(updated).getTime() : null;
              if (ms == null || !Number.isFinite(ms)) return false;
              return ms >= sinceMs && ms <= now;
            })
          )
        : [];
      pipelinesWithStages = await Promise.all(
        pipelinesRes.map(async (p) => {
          try {
            const stages = await getStagesByPipeline(ghl_api_key, ghl_location_id, p.id);
            return { ...p, stages };
          } catch {
            return { ...p, stages: [] };
          }
        })
      );
      if (!isAdm && opportunitiesList.length + eventsList.length > USER_INCREMENTAL_MAX_ROWS) {
        return NextResponse.json(
          {
            error: "Volume de dados na última hora excede o limite. Contate o administrador para atualização.",
            code: "volume_exceeded",
          },
          { status: 429 }
        );
      }
      startEventMs = 0;
      untilMs = 0;
    } else if (mode === "daily_reprocess") {
      const { startMs: dayStart, endMs: dayEnd } = getYesterdayBoundsAmericaSaoPaulo();
      const [pipelinesRes, calendars, users, allOpps] = await Promise.all([
        doPipelines ? getPipelines(ghl_api_key, ghl_location_id) : Promise.resolve([] as GHLPipeline[]),
        doCalendars ? getCalendars(ghl_api_key, ghl_location_id) : Promise.resolve([] as GHLCalendar[]),
        doUsers ? getLocationUsers(ghl_api_key, ghl_location_id) : Promise.resolve([] as GHLUser[]),
        doOpportunities ? getOpportunities(ghl_api_key, ghl_location_id, { fullFetch: true, updatedSinceMs: dayStart, updatedUntilMs: dayEnd }) : Promise.resolve([] as GHLOpportunity[]),
      ]);
      calendarsRes = calendars;
      usersRes = users;
      opportunitiesList = allOpps;
      const calendarIds = calendars.map((c) => c.id);
      eventsList = doCalendarEvents && calendarIds.length > 0
        ? await getCalendarEventsForCalendars(ghl_api_key, ghl_location_id, {
            startTime: dayStart - 24 * ONE_HOUR_MS,
            endTime: dayEnd + 24 * ONE_HOUR_MS,
            calendarIds,
          }).then((evs) =>
            evs.filter((e) => {
              const up = (e as { dateUpdated?: string }).dateUpdated ?? (e as { dateAdded?: string }).dateAdded ?? e.createdAt;
              const ms = up ? new Date(up).getTime() : 0;
              return ms >= dayStart && ms <= dayEnd;
            })
          )
        : [];
      pipelinesWithStages = await Promise.all(
        pipelinesRes.map(async (p) => {
          try {
            const stages = await getStagesByPipeline(ghl_api_key, ghl_location_id, p.id);
            return { ...p, stages };
          } catch {
            return { ...p, stages: [] };
          }
        })
      );
      startEventMs = 0;
      untilMs = 0;
    } else if (fullSync) {
      startEventMs = now - FULL_SYNC_EVENTS_MS;
      untilMs = now + FULL_SYNC_EVENTS_END_MS;
      const [pipelinesRes, calendars, users, oppsList] = await Promise.all([
        doPipelines ? getPipelines(ghl_api_key, ghl_location_id) : Promise.resolve([] as GHLPipeline[]),
        doCalendars ? getCalendars(ghl_api_key, ghl_location_id) : Promise.resolve([] as GHLCalendar[]),
        doUsers ? getLocationUsers(ghl_api_key, ghl_location_id) : Promise.resolve([] as GHLUser[]),
        doOpportunities ? getOpportunities(ghl_api_key, ghl_location_id, { fullFetch: true }) : Promise.resolve([] as GHLOpportunity[]),
        Promise.resolve([] as GHLCalendarEvent[]),
      ]);
      opportunitiesList = oppsList;
      calendarsRes = calendars;
      usersRes = users;
      const calendarIdsToFetch = calendarsRes.map((c) => c.id);
      const [pipelinesWithStagesForFull, eventsListFull] = await Promise.all([
        Promise.all(
          (pipelinesRes as GHLPipeline[]).map(async (p) => {
            try {
              const stages = await getStagesByPipeline(ghl_api_key, ghl_location_id, p.id);
              return { ...p, stages };
            } catch {
              return { ...p, stages: [] };
            }
          })
        ),
        doCalendarEvents && calendarIdsToFetch.length > 0
          ? getCalendarEventsForCalendars(ghl_api_key, ghl_location_id, { startTime: startEventMs, endTime: untilMs, calendarIds: calendarIdsToFetch })
          : Promise.resolve([] as GHLCalendarEvent[]),
      ]);
      eventsList = eventsListFull;
      pipelinesWithStages = pipelinesWithStagesForFull;
    } else {
      const [lastOppRow, lastEventRow] = await Promise.all([
        service.from("opportunities").select("date_added").eq("client_id", client_id).not("date_added", "is", null).order("date_added", { ascending: false }).limit(1).maybeSingle(),
        service.from("calendar_events").select("start_time, created_at").eq("client_id", client_id).order("start_time", { ascending: false }).limit(1).maybeSingle(),
      ]);
      const lastOppMs = lastOppRow?.data?.date_added ? new Date(lastOppRow.data.date_added).getTime() : null;
      const lastEventMs = lastEventRow?.data?.start_time ? new Date(lastEventRow.data.start_time).getTime() : lastEventRow?.data?.created_at ? new Date(lastEventRow.data.created_at).getTime() : null;
      startOppMs = lastOppMs != null ? Math.min(lastOppMs, now - NINETY_DAYS_MS) : now - NINETY_DAYS_MS;
      startEventMs = lastEventMs != null ? Math.min(lastEventMs, now - NINETY_DAYS_MS) : now - NINETY_DAYS_MS;
      untilMs = now + 24 * 60 * 60 * 1000;
      const [pipelinesRes, calendars, users, oppsList] = await Promise.all([
        doPipelines ? getPipelines(ghl_api_key, ghl_location_id) : Promise.resolve([] as GHLPipeline[]),
        doCalendars ? getCalendars(ghl_api_key, ghl_location_id) : Promise.resolve([] as GHLCalendar[]),
        doUsers ? getLocationUsers(ghl_api_key, ghl_location_id) : Promise.resolve([] as GHLUser[]),
        doOpportunities ? getOpportunities(ghl_api_key, ghl_location_id, { sinceMs: startOppMs, untilMs: now }) : Promise.resolve([] as GHLOpportunity[]),
      ]);
      opportunitiesList = oppsList;
      calendarsRes = calendars;
      usersRes = users;
      const calendarIdsToFetch = calendarsRes.map((c) => c.id);
      const [pipelinesWithStagesNorm, eventsListNorm] = await Promise.all([
        Promise.all(
          (pipelinesRes as GHLPipeline[]).map(async (p) => {
            try {
              const stages = await getStagesByPipeline(ghl_api_key, ghl_location_id, p.id);
              return { ...p, stages };
            } catch {
              return { ...p, stages: [] };
            }
          })
        ),
        doCalendarEvents && calendarIdsToFetch.length > 0
          ? getCalendarEventsForCalendars(ghl_api_key, ghl_location_id, { startTime: startEventMs, endTime: untilMs, calendarIds: calendarIdsToFetch })
          : Promise.resolve([] as GHLCalendarEvent[]),
      ]);
      eventsList = eventsListNorm;
      pipelinesWithStages = pipelinesWithStagesNorm;
    }

    const ghlPipelineIds = pipelinesWithStages.map((p) => p.id);
    const ghlUserIds = usersRes.map((u) => u.id);

    // ——— Pipelines: batch upsert, depois estágios em batch ———
    const pipelineRows = pipelinesWithStages.map((p) => ({
      client_id,
      ghl_pipeline_id: p.id,
      name: p.name,
    }));
    if (pipelineRows.length > 0) {
      const { data: pipeRows, error: pipeErr } = await service
        .from("pipelines")
        .upsert(pipelineRows, { onConflict: "client_id,ghl_pipeline_id" })
        .select("id, ghl_pipeline_id");
      if (pipeErr) errors.push(`Pipelines: ${pipeErr.message}`);
      else if (pipeRows?.length) {
        const pipelineIdByGhl = new Map(pipeRows.map((r) => [r.ghl_pipeline_id, r.id]));
        const stageRows: { pipeline_id: string; ghl_stage_id: string; name: string; position: number }[] = [];
        for (const p of pipelinesWithStages) {
          const pipelineId = pipelineIdByGhl.get(p.id);
          if (!pipelineId) continue;
          (p.stages ?? []).forEach((s, i) => {
            stageRows.push({
              pipeline_id: pipelineId,
              ghl_stage_id: s.id,
              name: s.name,
              position: i,
            });
          });
        }
        if (stageRows.length > 0) {
          const { error: stageErr } = await service
            .from("pipeline_stages")
            .upsert(stageRows, { onConflict: "pipeline_id,ghl_stage_id" });
          if (stageErr) errors.push(`Stages: ${stageErr.message}`);
        }
        // Não deletar stages que não vieram do GHL: regra de excluir é só no painel de predefinições.
      }
    }
    // Não deletar pipelines que não vieram do GHL: regra de excluir é só no painel de predefinições.

    // ——— Calendários: batch upsert e batch delete ———
    if (calendarsRes.length > 0) {
      await service.from("ghl_calendars").upsert(
        calendarsRes.map((c) => ({ client_id, ghl_calendar_id: c.id, name: c.name })),
        { onConflict: "client_id,ghl_calendar_id" }
      );
    }
    const { data: existingCals } = await service
      .from("ghl_calendars")
      .select("id, ghl_calendar_id")
      .eq("client_id", client_id);
    const ghlCalendarIdSet = new Set(calendarsRes.map((c) => c.id));
    const toDeleteCalIds = (existingCals ?? []).filter((r) => !ghlCalendarIdSet.has(r.ghl_calendar_id)).map((r) => r.id);
    if (toDeleteCalIds.length > 0) {
      await service.from("ghl_calendars").delete().in("id", toDeleteCalIds);
    }

    // ——— Usuários GHL: batch upsert e batch delete ———
    if (usersRes.length > 0) {
      await service.from("ghl_users").upsert(
        usersRes.map((u) => ({
          client_id,
          ghl_user_id: u.id,
          name: u.name ?? "",
          email: u.email ?? null,
        })),
        { onConflict: "client_id,ghl_user_id" }
      );
    }
    const { data: existingUsers } = await service
      .from("ghl_users")
      .select("id, ghl_user_id")
      .eq("client_id", client_id);
    const toDeleteUserIds = (existingUsers ?? []).filter((r) => !ghlUserIds.includes(r.ghl_user_id)).map((r) => r.id);
    if (toDeleteUserIds.length > 0) {
      await service.from("ghl_users").delete().in("id", toDeleteUserIds);
    }

    // ——— Oportunidades: upsert. UTMs preenchidos por ID do campo GHL (mapeamento em location_predefinitions); campo ausente no payload → null. ———
    try {
      let firstOppLogged = false;
      let sampleOppId: string | null = null;
      const filteredOpps = opportunitiesList.filter((o) => o.id);
      type OppRow = {
        client_id: string;
        ghl_opportunity_id: string;
        pipeline_id: string | null;
        stage_id: string | null;
        name: string | null;
        status: string | null;
        monetary_value: number | null;
        contact_id: string | null;
        assigned_to: string | null;
        source: string | null;
        date_added: string | null;
        date_updated: string | null;
        sale_date_value: string | null;
        utm_source: string | null;
        utm_campaign: string | null;
        utm_medium: string | null;
        utm_term: string | null;
        utm_content: string | null;
        [k: string]: string | number | null | undefined;
      };
      const oppRows: OppRow[] = [];
      const needEnrichment: { index: number; oppId: string }[] = [];
      for (const opp of filteredOpps) {
        const rawCf = (opp as { customFields?: unknown }).customFields ?? (opp as { custom_fields?: unknown }).custom_fields;
        const cf = normalizeCustomFields(
          rawCf as
            | Record<string, string | number | null>
            | Array<{
                id?: string;
                fieldId?: string;
                field_id?: string;
                key?: string;
                fieldValueString?: string | null;
                fieldValueNumber?: number | null;
                fieldValueBoolean?: boolean | null;
                value?: string | number | null;
                fieldValue?: string | number | null;
                field_value?: string | number | null;
                values?: (string | number | null)[];
                val?: string | number | null;
              }>
            | undefined
        );
        const uSource = getUtm(cf, utmFieldIds.utm_source ?? null);
        const uCampaign = getUtm(cf, utmFieldIds.utm_campaign ?? null);
        const uMedium = getUtm(cf, utmFieldIds.utm_medium ?? null);
        const uTerm = getUtm(cf, utmFieldIds.utm_term ?? null);
        const uContent = getUtm(cf, utmFieldIds.utm_content ?? null);

        const dynamicCf: Record<string, string> = {};
        if (importColumns.length > 0 && cf) {
          for (const { id, col } of importColumns) {
            const v = (cf as Record<string, string | number | null>)[id];
            if (v == null) continue;
            const s = typeof v === "string" ? v : String(v);
            const trimmed = s.trim();
            if (trimmed !== "") dynamicCf[col] = trimmed;
          }
        }
        if (!firstOppLogged) {
          firstOppLogged = true;
          sampleOppId = opp.id;
          const oppKeys = Object.keys(opp as Record<string, unknown>);
          debugLog({
            hypothesisId: "H2_H3_H4",
            location: "sync/route.ts:firstOpp",
            message: "primeira opp: rawCf, cf keys, getUtm results, opp top keys",
            data: {
              oppId: opp.id,
              oppTopLevelKeys: oppKeys,
              rawCfUndefined: rawCf === undefined,
              rawCfIsArray: Array.isArray(rawCf),
              rawCfKeys: rawCf != null && !Array.isArray(rawCf) ? Object.keys(rawCf as object) : (Array.isArray(rawCf) ? `arrayLen=${(rawCf as unknown[]).length}` : null),
              firstRawCfItemKeys: Array.isArray(rawCf) && rawCf.length > 0 ? Object.keys((rawCf as unknown[])[0] as object) : null,
              cfKeys: cf ? Object.keys(cf) : null,
              utmFieldIdsUsed: { utm_source: utmFieldIds.utm_source ?? null, utm_campaign: utmFieldIds.utm_campaign ?? null, utm_medium: utmFieldIds.utm_medium ?? null, utm_term: utmFieldIds.utm_term ?? null, utm_content: utmFieldIds.utm_content ?? null },
              getUtmResults: { utm_source: uSource, utm_campaign: uCampaign, utm_medium: uMedium, utm_term: uTerm, utm_content: uContent },
              importFieldIdsCount: importFieldIds.length,
              importFirstCols: importColumns.slice(0, 5),
              dynamicCfKeys: Object.keys(dynamicCf),
            },
          });
        }
        let sale_date_value: string | null = null;
        const saleDateRaw = getSaleDateValueFromCustomFields(rawCf, saleDateFieldId);
        if (saleDateRaw != null && saleDateRaw !== "") {
          const ms = typeof saleDateRaw === "number" ? (Number.isFinite(saleDateRaw) ? saleDateRaw : null) : typeof saleDateRaw === "string" ? new Date(saleDateRaw.trim()).getTime() : null;
          if (ms != null && Number.isFinite(ms)) sale_date_value = new Date(ms).toISOString();
        }
        const row: OppRow = {
          client_id,
          ghl_opportunity_id: opp.id,
          pipeline_id: (opp as { pipelineId?: string }).pipelineId ?? (opp as { pipeline_id?: string }).pipeline_id ?? null,
          stage_id: oppStageId(opp),
          name: opp.name ?? null,
          status: opp.status ?? null,
          monetary_value: toNum(opp.monetaryValue),
          contact_id: (opp as { contactId?: string }).contactId ?? (opp as { contact_id?: string }).contact_id ?? null,
          assigned_to: (opp as { assignedTo?: string }).assignedTo ?? (opp as { assigned_to?: string }).assigned_to ?? null,
          source: (opp as { source?: string }).source ?? null,
          date_added: toTimestamp(oppDateAdded(opp)),
          date_updated: toTimestamp(oppDateUpdated(opp)),
          sale_date_value,
          utm_source: uSource,
          utm_campaign: uCampaign,
          utm_medium: uMedium,
          utm_term: uTerm,
          utm_content: uContent,
          ...dynamicCf,
        };
        oppRows.push(row);
        // Se o search não trouxe customFields e temos campo de data da venda configurado, enriquecer depois via GET por ID (como no diagnóstico).
        const hasNoCf = rawCf == null || (Array.isArray(rawCf) && rawCf.length === 0);
        if (saleDateFieldId && hasNoCf) needEnrichment.push({ index: oppRows.length - 1, oppId: opp.id });
      }
      // Enriquecimento: buscar por ID as oportunidades sem customFields no search para preencher sale_date_value
      const ENRICH_BATCH = 10;
      if (needEnrichment.length > 0 && saleDateFieldId && ghl_api_key && ghl_location_id) {
        for (let i = 0; i < needEnrichment.length; i += ENRICH_BATCH) {
          const chunk = needEnrichment.slice(i, i + ENRICH_BATCH);
          const enriched = await Promise.all(
            chunk.map(({ oppId }) =>
              getOpportunityById(ghl_api_key, ghl_location_id, oppId).catch(() => null)
            )
          );
          for (let j = 0; j < chunk.length; j++) {
            const full = enriched[j] as { customFields?: unknown; custom_fields?: unknown } | null;
            if (!full) continue;
            const rawCfEnriched = full.customFields ?? full.custom_fields;
            const saleDateRawEnriched = getSaleDateValueFromCustomFields(rawCfEnriched, saleDateFieldId);
            if (saleDateRawEnriched == null || saleDateRawEnriched === "") continue;
            const ms = typeof saleDateRawEnriched === "number" ? (Number.isFinite(saleDateRawEnriched) ? saleDateRawEnriched : null) : typeof saleDateRawEnriched === "string" ? new Date(saleDateRawEnriched.trim()).getTime() : null;
            if (ms != null && Number.isFinite(ms)) oppRows[chunk[j].index].sale_date_value = new Date(ms).toISOString();
          }
        }
      }
      for (let i = 0; i < oppRows.length; i += BATCH_SIZE) {
        const chunk = oppRows.slice(i, i + BATCH_SIZE);
        const { error: oppErr } = await service.from("opportunities").upsert(chunk, {
          onConflict: "client_id,ghl_opportunity_id",
        });
        if (oppErr) {
          const msg = oppErr.message;
          errors.push(`Oportunidades chunk: ${msg}`);
          if (msg.includes("date_updated") || msg.includes("column") || msg.includes("does not exist")) {
            syncLog.error("Sync: upsert oportunidades falhou (coluna?). Rode add-opportunity-date-updated.sql se ainda não rodou.", oppErr, { client_id });
          }
        } else opportunitiesSynced += chunk.length;
      }

      // #region agent log
      if (sampleOppId) {
        const { data: savedRow, error: savedErr } = await service
          .from("opportunities")
          .select("ghl_opportunity_id, pipeline_id, stage_id, utm_source, utm_campaign, utm_medium, utm_term, utm_content, date_updated")
          .eq("client_id", client_id)
          .eq("ghl_opportunity_id", sampleOppId)
          .maybeSingle();
        debugLog({
          hypothesisId: "H5",
          location: "sync/route.ts:dbCheck",
          message: "checagem pós-upsert no Supabase (opportunities)",
          data: {
            client_id,
            sampleOppId,
            savedErr: savedErr ? { message: savedErr.message } : null,
            savedRow,
          },
        });
      }
      // #endregion
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Erro ao gravar oportunidades";
      errors.push(msg);
      syncLog.error("Sync: exceção ao gravar oportunidades", e, { client_id });
    }

    // ——— Eventos de calendário: batch upsert em chunks ———
    if (eventsList.length > 0) {
      try {
        const eventRows = eventsList
          .filter((ev) => ev.id)
          .map((ev) => {
            const evAny = ev as Record<string, unknown>;
            const status =
              ev.status ?? (evAny.appointmentStatus as string) ?? (evAny.eventStatus as string) ?? null;
            return {
              client_id,
              ghl_event_id: ev.id,
              ghl_calendar_id: ev.calendarId ?? null,
              start_time: toTimestamp(ev.startTime),
              end_time: toTimestamp(ev.endTime),
              status,
              title: (evAny.title as string) ?? null,
              contact_id: (evAny.contactId as string) ?? null,
              assigned_user_id: (evAny.assignedUserId as string) ?? null,
              notes: (evAny.notes as string) ?? null,
              source: (evAny.source as string) ?? null,
              date_added: toTimestamp(evAny.dateAdded as string),
              date_updated: toTimestamp((evAny.dateUpdated ?? evAny.date_updated) as string),
            };
          });
        for (let i = 0; i < eventRows.length; i += BATCH_SIZE) {
          const chunk = eventRows.slice(i, i + BATCH_SIZE);
          const { error: evErr } = await service.from("calendar_events").upsert(chunk, {
            onConflict: "client_id,ghl_event_id",
          });
          if (!evErr) calendarEventsSynced += chunk.length;
          else errors.push(`Eventos chunk: ${evErr.message}`);
        }
      } catch (e) {
        errors.push(e instanceof Error ? e.message : "Erro ao gravar eventos de calendário");
      }
    }

    if (errors.length > 0) {
      syncLog.error("Sync: erros ao gravar no banco", null, { client_id: cred.client_id, mode, details: errors });
      const errText = errors.join("; ");
      const hint =
        errText.includes("date_updated") || errText.includes("does not exist")
          ? " Execute no Supabase a migration add-opportunity-date-updated.sql (coluna date_updated)."
          : "";
      return NextResponse.json(
        { error: "Erro ao gravar no banco: " + errText + hint, details: errors },
        { status: 502 }
      );
    }

    syncLog.info("Sync concluído", {
      client_id: cred.client_id,
      mode,
      pipelines: pipelinesWithStages.length,
      calendars: calendarsRes.length,
      users: usersRes.length,
      opportunities: opportunitiesSynced,
      calendar_events: calendarEventsSynced,
    });
    return NextResponse.json({
      ok: true,
      pipelines: pipelinesWithStages.length,
      calendars: calendarsRes.length,
      users: usersRes.length,
      opportunities: opportunitiesSynced,
      calendar_events: calendarEventsSynced,
    });
  } catch (e) {
    syncLog.error("Sync: exceção", e, { clientId, mode });
    return ghlErrorResponse(e, "Erro ao sincronizar");
  }
}
