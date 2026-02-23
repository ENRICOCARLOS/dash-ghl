import { getAuthUser } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getGhlCredentialsByClientId } from "@/lib/ghl-credentials";
import { getOpportunityById } from "@/lib/ghl";
import { NextRequest, NextResponse } from "next/server";

const UTM_FIELD_KEYS = [
  "utm_source_field_id",
  "utm_campaign_field_id",
  "utm_medium_field_id",
  "utm_term_field_id",
  "utm_content_field_id",
] as const;

/** GHL LeadConnector retorna customFields como array com fieldValueString (texto) e variações. */
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
        fieldValue?: string | number | null;
        field_value?: string | number | null;
        value?: string | number | null;
        values?: (string | number | null)[];
        val?: string | number | null;
      }>
    | undefined
): Record<string, string | null> {
  if (raw == null) return {};
  if (Array.isArray(raw)) {
    const out: Record<string, string | null> = {};
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
          (item as { val?: string | number | null }).val ??
          null;
        const v = rawVal == null || rawVal === "" ? null : typeof rawVal === "string" ? rawVal.trim() : String(rawVal);
        out[String(id)] = v === "" ? null : v;
      }
    }
    return out;
  }
  const obj = raw as Record<string, string | number | null>;
  const result: Record<string, string | null> = {};
  for (const [k, v] of Object.entries(obj)) {
    result[k] = v == null || v === "" ? null : typeof v === "string" ? v.trim() : String(v);
  }
  return result;
}

/**
 * POST: Diagnóstico de uma oportunidade por ID (somente ADM).
 * Body: { client_id, opportunity_id }
 * Retorna: { raw } = corpo completo do GHL; { parsed } = como interpretamos (pipeline_id, stage_id, UTMs, customFields normalizados).
 */
export async function POST(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const service = createServiceClient();
  const { data: profile } = await service.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "ADM") return NextResponse.json({ error: "Acesso restrito a administradores" }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const clientId = (body.client_id as string) ?? null;
  const opportunityId = (body.opportunity_id as string) ?? null;
  if (!clientId || !opportunityId) {
    return NextResponse.json({ error: "client_id e opportunity_id são obrigatórios" }, { status: 400 });
  }

  const cred = await getGhlCredentialsByClientId(clientId);
  if ("error" in cred) return NextResponse.json({ error: cred.error }, { status: cred.status });

  try {
    const raw = await getOpportunityById(cred.ghl_api_key, cred.ghl_location_id, opportunityId.trim());

    // API pode retornar { opportunity: { ... } } ou { data: { ... } }; usamos o objeto interno para interpretar
    const r = raw as { opportunity?: Record<string, unknown>; data?: Record<string, unknown> };
    const opp: Record<string, unknown> = (r.opportunity ?? r.data ?? raw) as Record<string, unknown>;

    const { data: utmPredefRows } = await service
      .from("location_predefinitions")
      .select("key, value")
      .eq("client_id", cred.client_id)
      .in("key", UTM_FIELD_KEYS)
      .eq("active", true);

    const utmFieldIds: Record<string, string | null> = {};
    for (const k of UTM_FIELD_KEYS) {
      const col = k.replace("_field_id", "");
      utmFieldIds[col] = (utmPredefRows ?? []).find((x) => x.key === k)?.value ?? null;
    }

    const rawCf = opp.customFields ?? opp.custom_fields;
    const cf = normalizeCustomFields(
      rawCf as Record<string, string | number | null> | Array<{ id?: string; fieldId?: string; field_id?: string; key?: string; value?: string | number | null; fieldValue?: string | number | null; field_value?: string | number | null; values?: (string | number | null)[]; val?: string | number | null }> | undefined
    );

    const getUtm = (fieldId: string | null): string | null => {
      if (!fieldId || cf[fieldId] == null) return null;
      return cf[fieldId];
    };

    const parsed = {
      ghl_opportunity_id: opp.id ?? null,
      pipeline_id: opp.pipelineId ?? opp.pipeline_id ?? null,
      stage_id: opp.stageId ?? opp.pipelineStageId ?? opp.pipeline_stage_id ?? null,
      name: opp.name ?? null,
      status: opp.status ?? null,
      monetary_value: opp.monetaryValue ?? opp.monetary_value ?? null,
      contact_id: opp.contactId ?? opp.contact_id ?? null,
      assigned_to: opp.assignedTo ?? opp.assigned_to ?? null,
      source: opp.source ?? null,
      date_added: opp.dateAdded ?? opp.date_added ?? opp.dateCreated ?? opp.createdAt ?? null,
      date_updated: opp.dateUpdated ?? opp.date_updated ?? null,
      utm_source: getUtm(utmFieldIds.utm_source ?? null),
      utm_campaign: getUtm(utmFieldIds.utm_campaign ?? null),
      utm_medium: getUtm(utmFieldIds.utm_medium ?? null),
      utm_term: getUtm(utmFieldIds.utm_term ?? null),
      utm_content: getUtm(utmFieldIds.utm_content ?? null),
      customFields_normalized: cf,
      utmFieldIds_used: utmFieldIds,
    };

    return NextResponse.json({ raw, parsed });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Erro ao buscar oportunidade no GHL";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
