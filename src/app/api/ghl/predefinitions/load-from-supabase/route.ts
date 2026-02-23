import { getGhlCredentials } from "@/lib/ghl-credentials";
import { createServiceClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

const UTM_KEYS = [
  "utm_source_field_id",
  "utm_campaign_field_id",
  "utm_medium_field_id",
  "utm_term_field_id",
  "utm_content_field_id",
] as const;
const FACEBOOK_UTM_KEYS = ["facebook_campaign_utm", "facebook_adset_utm", "facebook_creative_utm"] as const;
const FACEBOOK_SOURCE_TERMS_KEY = "facebook_utm_source_terms";
const KEY_OPPORTUNITY_IMPORT = "opportunity_import_custom_fields";
const KEY_SALE_DATE_FIELD = "sale_date_field_id";
const KEY_LAST_SAVED = "predefinitions_last_saved_at";
const KEY_OPPORTUNITY_ADS_LINK_OPP = "opportunity_ads_link_opportunity_column";
const KEY_OPPORTUNITY_ADS_LINK_ADS = "opportunity_ads_link_ads_column";

/**
 * GET: retorna todas as predefinições apenas do Supabase (sem chamar a API do GHL).
 * Usado ao abrir a tela de Predefinições. Para dados atualizados do GHL, o usuário clica em "Atualizar dados".
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const clientId = searchParams.get("client_id");
  const cred = await getGhlCredentials(request, clientId ?? undefined);
  if ("error" in cred) return NextResponse.json({ error: cred.error }, { status: cred.status });

  const service = createServiceClient();
  const cid = cred.client_id;

  const [
    dbPipelines,
    dbCalendars,
    dbUsers,
    predefRows,
    oppUtmSources,
  ] = await Promise.all([
    service
      .from("pipelines")
      .select("id, ghl_pipeline_id, name")
      .eq("client_id", cid)
      .eq("active", true)
      .order("created_at", { ascending: true }),
    service
      .from("ghl_calendars")
      .select("ghl_calendar_id, name")
      .eq("client_id", cid)
      .eq("active", true)
      .order("created_at", { ascending: true }),
    service
      .from("ghl_users")
      .select("ghl_user_id, name, email")
      .eq("client_id", cid)
      .eq("active", true)
      .order("created_at", { ascending: true }),
    service
      .from("location_predefinitions")
      .select("key, value")
      .eq("client_id", cid)
      .eq("active", true)
      .in("key", [
        KEY_LAST_SAVED,
        KEY_SALE_DATE_FIELD,
        KEY_OPPORTUNITY_IMPORT,
        ...UTM_KEYS,
        ...FACEBOOK_UTM_KEYS,
        FACEBOOK_SOURCE_TERMS_KEY,
        KEY_OPPORTUNITY_ADS_LINK_OPP,
        KEY_OPPORTUNITY_ADS_LINK_ADS,
      ]),
    service
      .from("opportunities")
      .select("utm_source")
      .eq("client_id", cid)
      .not("utm_source", "is", null),
  ]);

  const pipelines = (dbPipelines?.data ?? []) as { id: string; ghl_pipeline_id: string; name: string }[];
  const pipelineIds = pipelines.map((p) => p.id);

  let stages: { pipeline_id: string; ghl_stage_id: string; name: string; position: number }[] = [];
  if (pipelineIds.length > 0) {
    const stagesRes = await service
      .from("pipeline_stages")
      .select("pipeline_id, ghl_stage_id, name, position")
      .in("pipeline_id", pipelineIds)
      .eq("active", true)
      .order("position", { ascending: true });
    stages = (stagesRes.data ?? []) as typeof stages;
  }

  const stagesByPipeline = new Map<string, { id: string; name: string }[]>();
  for (const s of stages) {
    const list = stagesByPipeline.get(s.pipeline_id) ?? [];
    list.push({ id: s.ghl_stage_id, name: s.name });
    stagesByPipeline.set(s.pipeline_id, list);
  }

  const byKey = new Map<string, string>();
  for (const r of predefRows?.data ?? []) {
    const row = r as { key: string; value: string | null };
    if (row.key && row.value != null) byKey.set(row.key, row.value);
  }

  let opportunityImportSelected: { id: string; name: string }[] = [];
  const rawImport = byKey.get(KEY_OPPORTUNITY_IMPORT);
  if (rawImport) {
    try {
      const parsed = JSON.parse(rawImport) as unknown;
      opportunityImportSelected = Array.isArray(parsed)
        ? (parsed as { id: string; name: string }[]).filter((x) => x && typeof x.id === "string")
        : [];
    } catch {
      opportunityImportSelected = [];
    }
  }

  const facebookSourceTermsRaw = byKey.get(FACEBOOK_SOURCE_TERMS_KEY);
  let facebook_utm_source_terms: string[] = [];
  if (facebookSourceTermsRaw) {
    try {
      const parsed = JSON.parse(facebookSourceTermsRaw) as unknown;
      facebook_utm_source_terms = Array.isArray(parsed)
        ? (parsed as string[]).filter((x): x is string => typeof x === "string").map((s) => s.trim()).filter(Boolean)
        : [];
    } catch {
      facebook_utm_source_terms = [];
    }
  }

  const utmSourceTerms = Array.from(
    new Set(
      (oppUtmSources?.data ?? [])
        .map((r) => (r as { utm_source: string | null }).utm_source?.trim())
        .filter((v): v is string => typeof v === "string" && v.length > 0)
    )
  ).sort((a, b) => a.localeCompare(b));

  return NextResponse.json({
    pipelines: pipelines.map((p) => ({
      id: p.ghl_pipeline_id,
      name: p.name,
      stages: stagesByPipeline.get(p.id) ?? [],
    })),
    calendars: (dbCalendars?.data ?? []).map((c: { ghl_calendar_id: string; name: string }) => ({
      id: c.ghl_calendar_id,
      name: c.name,
    })),
    users: (dbUsers?.data ?? []).map((u: { ghl_user_id: string; name: string; email: string | null }) => ({
      id: u.ghl_user_id,
      name: u.name,
      email: u.email ?? undefined,
    })),
    last_saved_at: byKey.get(KEY_LAST_SAVED) ?? null,
    sale_date_field_id: byKey.get(KEY_SALE_DATE_FIELD) ?? null,
    opportunity_import_selected: opportunityImportSelected,
    utm_mapping: {
      utm_source_field_id: byKey.get("utm_source_field_id") ?? null,
      utm_campaign_field_id: byKey.get("utm_campaign_field_id") ?? null,
      utm_medium_field_id: byKey.get("utm_medium_field_id") ?? null,
      utm_term_field_id: byKey.get("utm_term_field_id") ?? null,
      utm_content_field_id: byKey.get("utm_content_field_id") ?? null,
      facebook_campaign_utm: byKey.get("facebook_campaign_utm") ?? null,
      facebook_adset_utm: byKey.get("facebook_adset_utm") ?? null,
      facebook_creative_utm: byKey.get("facebook_creative_utm") ?? null,
      facebook_utm_source_terms,
      opportunity_ads_link_opportunity_column: byKey.get(KEY_OPPORTUNITY_ADS_LINK_OPP) ?? null,
      opportunity_ads_link_ads_column: byKey.get(KEY_OPPORTUNITY_ADS_LINK_ADS) ?? null,
    },
    utm_source_suggestions: utmSourceTerms,
    customFields: [], // Só preenchido ao clicar "Atualizar dados" (GHL)
    opportunity_import_custom_fields: [], // idem
  });
}
