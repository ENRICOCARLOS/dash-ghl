/**
 * Mapeamento oportunidade GHL → linha Supabase (opportunities).
 * Usado pelo sync geral (upsert completo).
 */
import type { GHLOpportunity } from "./ghl";

export function toTimestamp(value: string | number | null | undefined): string | null {
  if (value == null) return null;
  const ms = typeof value === "number" ? value : new Date(value).getTime();
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function toNum(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function oppStageId(opp: GHLOpportunity & { pipelineStageId?: string; pipeline_stage_id?: string }): string | null {
  const v = opp.stageId ?? opp.pipelineStageId ?? opp.pipeline_stage_id ?? null;
  return v != null && String(v).trim() !== "" ? String(v).trim() : null;
}

export function oppDateAdded(opp: GHLOpportunity & { dateAdded?: string; date_added?: string; dateCreated?: string }): string | number | null | undefined {
  return (opp as { dateAdded?: string }).dateAdded ?? (opp as { date_added?: string }).date_added ?? (opp as { dateCreated?: string }).dateCreated ?? opp.createdAt;
}

export function oppDateUpdated(opp: GHLOpportunity & { date_updated?: string }): string | number | null | undefined {
  return opp.dateUpdated ?? (opp as { date_updated?: string }).date_updated ?? null;
}

/** GHL LeadConnector retorna customFields como array com fieldValueString (texto) e variações. */
export function normalizeCustomFields(
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
        fieldValue?: string | number | null;
        field_value?: string | number | null;
        value?: string | number | null;
        values?: (string | number | null)[];
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
          (item as { fieldValue?: string | number | null }).fieldValue ??
          (item as { field_value?: string | number | null }).field_value ??
          item.value ??
          (Array.isArray(item.values) && item.values.length > 0 ? item.values[0] : null) ??
          null;
        const v = rawVal == null || rawVal === "" ? null : typeof rawVal === "string" ? rawVal.trim() : String(rawVal);
        out[String(id)] = v === "" ? null : v;
      }
    }
    return Object.keys(out).length ? out : undefined;
  }
  return raw as Record<string, string | number | null>;
}

export type OppRow = {
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
  utm_source: string | null;
  utm_campaign: string | null;
  utm_medium: string | null;
  utm_term: string | null;
  utm_content: string | null;
};

export function buildOpportunityRow(
  opp: GHLOpportunity,
  clientId: string,
  utmFieldIds: { utm_source: string | null; utm_campaign: string | null; utm_medium: string | null; utm_term: string | null; utm_content: string | null }
): OppRow {
  const cf = normalizeCustomFields(
    opp.customFields as Record<string, string | number | null> | Array<{ id?: string; fieldId?: string; value?: string | number | null }> | undefined
  );
  const getUtm = (c: Record<string, string | number | null> | undefined, fieldId: string | null): string | null => {
    if (!fieldId || !c || c[fieldId] == null) return null;
    const v = c[fieldId];
    return typeof v === "string" ? v : String(v);
  };
  return {
    client_id: clientId,
    ghl_opportunity_id: opp.id,
    pipeline_id: (opp as { pipelineId?: string }).pipelineId ?? (opp as { pipeline_id?: string }).pipeline_id ?? null,
    stage_id: oppStageId(opp as GHLOpportunity & { pipelineStageId?: string; pipeline_stage_id?: string }),
    name: opp.name ?? null,
    status: opp.status ?? null,
    monetary_value: toNum(opp.monetaryValue),
    contact_id: (opp as { contactId?: string }).contactId ?? (opp as { contact_id?: string }).contact_id ?? null,
    assigned_to: (opp as { assignedTo?: string }).assignedTo ?? (opp as { assigned_to?: string }).assigned_to ?? null,
    source: (opp as { source?: string }).source ?? null,
    date_added: toTimestamp(oppDateAdded(opp)),
    date_updated: toTimestamp(oppDateUpdated(opp)),
    utm_source: getUtm(cf, utmFieldIds.utm_source),
    utm_campaign: getUtm(cf, utmFieldIds.utm_campaign),
    utm_medium: getUtm(cf, utmFieldIds.utm_medium),
    utm_term: getUtm(cf, utmFieldIds.utm_term),
    utm_content: getUtm(cf, utmFieldIds.utm_content),
  };
}
