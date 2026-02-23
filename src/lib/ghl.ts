/**
 * Cliente para API GoHighLevel (LeadConnector)
 * Base: https://services.leadconnectorhq.com
 * Docs: https://marketplace.gohighlevel.com/docs
 */

const GHL_BASE = "https://services.leadconnectorhq.com";

/** Erro retornado pela API GoHighLevel (ex.: 401 Invalid JWT). */
export class GhlApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number
  ) {
    super(message);
    this.name = "GhlApiError";
  }
}

/** Valida e normaliza locationId (usado em header e query). */
function normalizeLocationId(locationId: string): string {
  const lid = locationId != null ? String(locationId).trim() : "";
  if (!lid || lid === "undefined") {
    throw new GhlApiError("locationId is required and must be a non-empty string", 400);
  }
  return lid;
}

function headers(apiKey: string, locationId: string) {
  const key = apiKey != null ? String(apiKey).trim() : "";
  if (!key) throw new GhlApiError("ghl_api_key is required", 400);
  const lid = normalizeLocationId(locationId);
  return {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    Accept: "application/json",
    Version: "2021-07-28",
    "Location-Id": lid,
  };
}

export type GHLPipeline = { id: string; name: string; stages?: GHLStage[] };
export type GHLStage = { id: string; name: string; pipelineId?: string };

/**
 * Oportunidade retornada pela API GET /opportunities/search (LeadConnector).
 * Mapeamento usado no código (confirmar no payload real do endpoint):
 * - id → ghl_opportunity_id
 * - pipelineId (ou pipeline_id) → pipeline_id
 * - stageId | pipelineStageId | pipeline_stage_id → stage_id
 * - status → status (won/lost/open)
 * - monetaryValue → monetary_value
 * - dateAdded | dateCreated | createdAt | date_added → date_added (data de criação)
 * - dateUpdated | date_updated → date_updated (data de última atualização)
 * - contactId | contact_id, assignedTo | assigned_to, source → contact_id, assigned_to, source
 * - customFields (objeto ou array) → UTMs e cf_* conforme predefinições
 */
export type GHLOpportunity = {
  id: string;
  pipelineId?: string;
  /** Estágio da pipeline; API pode retornar como stageId ou pipelineStageId. */
  stageId?: string;
  name?: string;
  status?: string;
  monetaryValue?: number;
  /** Data de criação; API pode retornar como createdAt, dateCreated, dateAdded ou date_added. */
  createdAt?: string;
  dateCreated?: string;
  dateAdded?: string;
  /** Data da última atualização no GHL (dateUpdated/date_updated). Usada no sync horário (alteradas na última hora). */
  dateUpdated?: string;
  /** Campos customizados: objeto { [fieldId]: value } ou array [{ id/fieldId, value }]. */
  customFields?: Record<string, string | number | null> | Array<{ id?: string; fieldId?: string; value?: string | number | null }>;
};

export type GHLCalendar = { id: string; name: string };
export type GHLUser = { id: string; name: string; email?: string };

/** Campo customizado de oportunidade (para pré-definição "data da venda" e importação). */
export type GHLOpportunityCustomField = {
  id: string;
  name: string;
  dataType?: string;
};

/** Evento/agendamento do calendário GHL. startTime/createdAt em ISO ou ms conforme API. status pode vir como status ou appointmentStatus. */
export type GHLCalendarEvent = {
  id: string;
  calendarId?: string;
  startTime?: string;
  endTime?: string;
  createdAt?: string;
  /** Status do compromisso (ex: showed, no_show, scheduled). API pode retornar como status ou appointmentStatus. */
  status?: string;
  appointmentStatus?: string;
  [key: string]: unknown;
};

/** Lista todas as pipelines da location (com estágios quando a API retornar). */
export async function getPipelines(apiKey: string, locationId: string): Promise<GHLPipeline[]> {
  const lid = normalizeLocationId(locationId);
  const res = await fetch(`${GHL_BASE}/opportunities/pipelines/?locationId=${encodeURIComponent(lid)}`, {
    headers: headers(apiKey, locationId),
  });
  if (!res.ok) {
    const t = await res.text();
    const parsed = parseGhlError(t, res.status);
    throw new GhlApiError(parsed.message, parsed.statusCode);
  }
  const data = await res.json();
  const pipelines = (data.pipelines ?? data ?? []) as GHLPipeline[];
  return Array.isArray(pipelines) ? pipelines : [];
}

/** Lista estágios de uma pipeline (ou todos se a API já vier em getPipelines). */
export async function getStagesByPipeline(
  apiKey: string,
  locationId: string,
  pipelineId: string
): Promise<GHLStage[]> {
  const lid = normalizeLocationId(locationId);
  const res = await fetch(
    `${GHL_BASE}/opportunities/pipelines/${pipelineId}/stages/?locationId=${encodeURIComponent(lid)}`,
    { headers: headers(apiKey, locationId) }
  );
  if (!res.ok) {
    const t = await res.text();
    const parsed = parseGhlError(t, res.status);
    throw new GhlApiError(parsed.message, parsed.statusCode);
  }
  const data = await res.json();
  const stages = (data.stages ?? data ?? []) as GHLStage[];
  return (Array.isArray(stages) ? stages : []).map((s) => ({ ...s, pipelineId }));
}

/** Converte data (ISO ou ms) para timestamp em ms. */
function toMs(value: string | number | null | undefined): number | null {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/** Tamanho de página pedido à API (máx comum 100). API pode retornar menos (ex.: 20 por padrão). */
const OPPORTUNITIES_PAGE_SIZE = 100;
/** Máximo de páginas para não ficar em loop (ex.: 500 * 100 = 50k oportunidades). */
const OPPORTUNITIES_MAX_PAGES = 500;

type GetOpportunitiesOpts = {
  pipelineId?: string;
  stageId?: string;
  sinceMs?: number;
  untilMs?: number;
  updatedSinceMs?: number;
  updatedUntilMs?: number;
  fullFetch?: boolean;
  onProgress?: (page: number, processed: number) => void;
};

type GetOpportunitiesOptsWithOnPage = GetOpportunitiesOpts & {
  onPage: (page: GHLOpportunity[]) => void | Promise<void>;
};

/** Formata data para a API GHL: MM-DD-YYYY (ex.: 02-01-2026). */
function formatDateForGHL(ms: number): string {
  const d = new Date(ms);
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  const year = d.getUTCFullYear();
  return `${month}-${day}-${year}`;
}

/**
 * Lista oportunidades com paginação por página numérica (page=1, 2, 3...).
 * A API GHL usa page + limit; para quando opportunities.length < limit ou meta.nextPage == null.
 * - Com onPage: fluxo página a página, sem acumular em memória.
 * - Sem onPage: acumula, filtra por data se sinceMs/untilMs, retorna array.
 */
export async function getOpportunities(
  apiKey: string,
  locationId: string,
  opts: GetOpportunitiesOptsWithOnPage
): Promise<{ pageCount: number }>;
export async function getOpportunities(
  apiKey: string,
  locationId: string,
  opts?: GetOpportunitiesOpts & { onPage?: (page: GHLOpportunity[]) => void | Promise<void> }
): Promise<GHLOpportunity[]>;
export async function getOpportunities(
  apiKey: string,
  locationId: string,
  opts?: GetOpportunitiesOpts & { onPage?: (page: GHLOpportunity[]) => void | Promise<void> }
): Promise<GHLOpportunity[] | { pageCount: number }> {
  const lid = locationId != null ? String(locationId).trim() : "";
  if (!lid || lid === "undefined") throw new GhlApiError("locationId is required", 400);
  const h = headers(apiKey, locationId);
  const fullFetch = opts?.fullFetch !== false;
  let pageCount = 0;
  let totalProcessed = 0;

  const normalizePage = (page: unknown[]): GHLOpportunity[] => {
    const out: GHLOpportunity[] = [];
    for (const o of page) {
      if (o && typeof o === "object" && (o as { id?: string }).id) {
        const raw = o as { dateUpdated?: string; date_updated?: string };
        if (raw.dateUpdated !== undefined) (o as GHLOpportunity).dateUpdated = raw.dateUpdated;
        else if (raw.date_updated !== undefined) (o as GHLOpportunity).dateUpdated = raw.date_updated;
        out.push(o as GHLOpportunity);
      }
    }
    return out;
  };

  const buildParams = (pageNum: number): Record<string, string> => {
    const params: Record<string, string> = {
      location_id: lid,
      limit: String(OPPORTUNITIES_PAGE_SIZE),
      page: String(pageNum),
    };
    if (opts?.pipelineId) params.pipeline_id = opts.pipelineId;
    if (opts?.stageId) params.pipeline_stage_id = opts.stageId;
    // Incremental (última hora): enviar à API GHL o intervalo por data de atualização (date/endDate).
    // A API pode filtrar por esse intervalo; em todo caso filtramos no código por dateUpdated.
    if (opts?.updatedSinceMs != null) params.date = formatDateForGHL(opts.updatedSinceMs);
    if (opts?.updatedUntilMs != null) params.endDate = formatDateForGHL(opts.updatedUntilMs);
    if (opts?.sinceMs != null && opts?.updatedSinceMs == null) params.date = formatDateForGHL(opts.sinceMs);
    if (opts?.untilMs != null && opts?.updatedUntilMs == null) params.endDate = formatDateForGHL(opts.untilMs);
    return params;
  };

  type PageResponse = {
    opportunities?: unknown[];
    data?: unknown[];
    meta?: { nextPage?: number | null };
  };

  const fetchPage = async (pageNum: number): Promise<{ items: GHLOpportunity[]; data: PageResponse }> => {
    const params = buildParams(pageNum);
    const res = await fetch(`${GHL_BASE}/opportunities/search?${new URLSearchParams(params)}`, { method: "GET", headers: h });
    if (!res.ok) {
      const t = await res.text();
      const parsed = parseGhlError(t, res.status);
      throw new GhlApiError(parsed.message, parsed.statusCode);
    }
    const data = (await res.json()) as PageResponse;
    let raw = data.opportunities ?? data?.data ?? [];
    if (!Array.isArray(raw)) raw = [];
    const items = normalizePage(raw);
    return { items, data };
  };

  if (opts?.onPage) {
    let currentPage = 1;
    let hasMore = true;
    let previousFirstId: string | null = null;
    while (hasMore) {
      const { items, data } = await fetchPage(currentPage);
      const firstId = items[0]?.id ?? null;
      if (currentPage > 1 && firstId != null && firstId === previousFirstId) break;
      previousFirstId = firstId;
      pageCount++;
      totalProcessed += items.length;
      opts.onProgress?.(pageCount, totalProcessed);
      await opts.onPage(items);
      if (!fullFetch || items.length === 0 || pageCount >= OPPORTUNITIES_MAX_PAGES) break;
      if (items.length < OPPORTUNITIES_PAGE_SIZE) hasMore = false;
      else if (data.meta != null && data.meta.nextPage === null) hasMore = false;
      else currentPage++;
    }
    return { pageCount };
  }

  const all: GHLOpportunity[] = [];
  let currentPage = 1;
  let hasMore = true;
  while (hasMore) {
    const { items, data } = await fetchPage(currentPage);
    let added = 0;
    for (const o of items) {
      if (o?.id && !all.some((x) => x.id === o.id)) {
        all.push(o);
        added++;
      }
    }
    pageCount++;
    opts?.onProgress?.(pageCount, all.length);
    if (!fullFetch || items.length === 0 || pageCount >= OPPORTUNITIES_MAX_PAGES) break;
    if (items.length < OPPORTUNITIES_PAGE_SIZE) hasMore = false;
    else if (data.meta != null && data.meta.nextPage === null) hasMore = false;
    else if (added === 0 && items.length === OPPORTUNITIES_PAGE_SIZE) hasMore = false;
    else currentPage++;
  }

  const updatedSinceMs = opts?.updatedSinceMs;
  const updatedUntilMs = opts?.updatedUntilMs;
  if (updatedSinceMs != null || updatedUntilMs != null) {
    return all.filter((o) => {
      const updated = toMs((o as { dateUpdated?: string }).dateUpdated) ?? toMs((o as { date_updated?: string }).date_updated);
      if (updated == null) return true;
      if (updatedSinceMs != null && updated < updatedSinceMs) return false;
      if (updatedUntilMs != null && updated > updatedUntilMs) return false;
      return true;
    });
  }
  const sinceMs = opts?.sinceMs;
  const untilMs = opts?.untilMs;
  if (sinceMs != null || untilMs != null) {
    return all.filter((o) => {
      const created = toMs((o as { dateAdded?: string }).dateAdded) ?? toMs((o as { dateCreated?: string }).dateCreated) ?? toMs(o.createdAt);
      if (created == null) return true;
      if (sinceMs != null && created < sinceMs) return false;
      if (untilMs != null && created > untilMs) return false;
      return true;
    });
  }
  return all;
}

/** Lista calendários da location. */
export async function getCalendars(apiKey: string, locationId: string): Promise<GHLCalendar[]> {
  const lid = normalizeLocationId(locationId);
  const res = await fetch(`${GHL_BASE}/calendars/?locationId=${encodeURIComponent(lid)}`, {
    headers: headers(apiKey, locationId),
  });
  if (!res.ok) {
    const t = await res.text();
    const parsed = parseGhlError(t, res.status);
    throw new GhlApiError(parsed.message, parsed.statusCode);
  }
  const data = await res.json();
  const calendars = (data.calendars ?? data ?? []) as GHLCalendar[];
  return Array.isArray(calendars) ? calendars : [];
}

/** Lista usuários da location. */
export async function getLocationUsers(apiKey: string, locationId: string): Promise<GHLUser[]> {
  const lid = normalizeLocationId(locationId);
  const res = await fetch(`${GHL_BASE}/users/?locationId=${encodeURIComponent(lid)}`, {
    headers: headers(apiKey, locationId),
  });
  if (!res.ok) {
    const t = await res.text();
    const parsed = parseGhlError(t, res.status);
    throw new GhlApiError(parsed.message, parsed.statusCode);
  }
  const data = await res.json();
  const users = (data.users ?? data ?? []) as GHLUser[];
  return Array.isArray(users) ? users : [];
}

/** Lista campos customizados de oportunidades da location (para pré-definição "data da venda"). */
export async function getOpportunityCustomFields(
  apiKey: string,
  locationId: string
): Promise<GHLOpportunityCustomField[]> {
  const lid = normalizeLocationId(locationId);
  const url = `${GHL_BASE}/locations/${lid}/customFields?model=opportunity`;
  const res = await fetch(url, { headers: headers(apiKey, locationId) });
  if (!res.ok) {
    const t = await res.text();
    const parsed = parseGhlError(t, res.status);
    throw new GhlApiError(parsed.message, parsed.statusCode);
  }
  const data = await res.json();
  const list = data.customFields ?? data?.data ?? data ?? [];
  const arr = Array.isArray(list) ? list : [];
  return arr.map((f: { id?: string; name?: string; dataType?: string }) => ({
    id: f.id ?? "",
    name: f.name ?? "",
    dataType: f.dataType,
  }));
}

/** Busca uma oportunidade por ID (LeadConnector GET /opportunities/:id). Retorna o corpo da resposta como recebido. */
export async function getOpportunityById(
  apiKey: string,
  locationId: string,
  opportunityId: string
): Promise<Record<string, unknown>> {
  const lid = normalizeLocationId(locationId);
  const oid = opportunityId != null ? String(opportunityId).trim() : "";
  if (!oid) throw new GhlApiError("opportunityId is required", 400);
  const res = await fetch(`${GHL_BASE}/opportunities/${encodeURIComponent(oid)}?locationId=${encodeURIComponent(lid)}`, {
    method: "GET",
    headers: headers(apiKey, locationId),
  });
  if (!res.ok) {
    const t = await res.text();
    const parsed = parseGhlError(t, res.status);
    throw new GhlApiError(parsed.message, parsed.statusCode);
  }
  return (await res.json()) as Record<string, unknown>;
}

/** Lista eventos/agendamentos do calendário no intervalo (sem limit/page). startTime/endTime em milissegundos. */
export async function getCalendarEvents(
  apiKey: string,
  locationId: string,
  opts: { startTime: number; endTime: number; calendarId: string }
): Promise<GHLCalendarEvent[]> {
  const lid = normalizeLocationId(locationId);
  const h = headers(apiKey, locationId);
  const params: Record<string, string> = {
    locationId: lid,
    startTime: String(opts.startTime),
    endTime: String(opts.endTime),
    calendarId: opts.calendarId,
  };
  const res = await fetch(`${GHL_BASE}/calendars/events?${new URLSearchParams(params)}`, {
    headers: h,
  });
  if (!res.ok) {
    const t = await res.text();
    const parsed = parseGhlError(t, res.status);
    throw new GhlApiError(parsed.message, parsed.statusCode);
  }
  const data = (await res.json()) as {
    events?: GHLCalendarEvent[];
    appointments?: GHLCalendarEvent[];
    data?: GHLCalendarEvent[];
  };
  const list = data.events ?? data.appointments ?? data?.data ?? [];
  const page = Array.isArray(list) ? list : [];
  return page.map((ev) => ({
    ...ev,
    status: ev.status ?? ev.appointmentStatus ?? undefined,
  }));
}

/** Busca eventos em vários calendários e retorna lista única (por startTime para Indicadores 2 e 3). */
export async function getCalendarEventsForCalendars(
  apiKey: string,
  locationId: string,
  opts: { startTime: number; endTime: number; calendarIds: string[] }
): Promise<GHLCalendarEvent[]> {
  if (opts.calendarIds.length === 0) return [];
  const results = await Promise.all(
    opts.calendarIds.map((calendarId) =>
      getCalendarEvents(apiKey, locationId, {
        startTime: opts.startTime,
        endTime: opts.endTime,
        calendarId,
      })
    )
  );
  const byId = new Map<string, GHLCalendarEvent>();
  for (const list of results) {
    for (const ev of list) {
      if (ev.id && !byId.has(ev.id)) byId.set(ev.id, ev);
    }
  }
  return Array.from(byId.values());
}

function parseGhlError(body: string, status: number): { statusCode: number; message: string } {
  try {
    const j = JSON.parse(body) as { statusCode?: number; message?: string };
    return {
      statusCode: j.statusCode ?? status,
      message: j.message ?? (body || `GHL API: ${status}`),
    };
  } catch {
    return { statusCode: status, message: body || `GHL API: ${status}` };
  }
}
