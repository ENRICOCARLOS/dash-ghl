import { getGhlCredentials } from "@/lib/ghl-credentials";
import { createServiceClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

/**
 * Keys em location_predefinitions: value = ID do campo customizado no GHL (não nome).
 * O sync usa só os field_id para mapear customFields → colunas UTM.
 * O nome do campo no GHL (ex.: "UTM Content", "UTM Content Field") é apenas exibição na UI;
 * o mapeamento e o sync usam somente o ID armazenado em value — nome diferente no GHL não impacta a regra.
 */
const UTM_KEYS = [
  "utm_source_field_id",
  "utm_campaign_field_id",
  "utm_medium_field_id",
  "utm_term_field_id",
  "utm_content_field_id",
] as const;

const FACEBOOK_UTM_KEYS = ["facebook_campaign_utm", "facebook_adset_utm", "facebook_creative_utm"] as const;
const FACEBOOK_SOURCE_TERMS_KEY = "facebook_utm_source_terms";
/** Coluna da oportunidade que liga à tabela de anúncios Meta (para puxar investimento). */
const OPPORTUNITY_ADS_LINK_OPP_COLUMN = "opportunity_ads_link_opportunity_column";
/** Coluna da tabela facebook_ads_daily_insights que liga à oportunidade. */
const OPPORTUNITY_ADS_LINK_ADS_COLUMN = "opportunity_ads_link_ads_column";

const UTM_COLUMNS = ["utm_source", "utm_campaign", "utm_medium", "utm_term", "utm_content"] as const;
const OPPORTUNITY_ADS_LINK_OPP_OPTIONS = [...UTM_COLUMNS] as const;
const OPPORTUNITY_ADS_LINK_ADS_OPTIONS = [
  "ad_id",
  "ad_name",
  "campaign_id",
  "campaign_name",
  "adset_id",
  "adset_name",
] as const;

type UtmMappingPayload = {
  client_id?: string;
  utm_source_field_id?: string | null;
  utm_campaign_field_id?: string | null;
  utm_medium_field_id?: string | null;
  utm_term_field_id?: string | null;
  utm_content_field_id?: string | null;
  facebook_campaign_utm?: string | null;
  facebook_adset_utm?: string | null;
  facebook_creative_utm?: string | null;
  facebook_utm_source_terms?: string[];
  /** Coluna de oportunidades que se relaciona com a tabela de anúncios Meta (ex.: utm_content). */
  opportunity_ads_link_opportunity_column?: string | null;
  /** Coluna da tabela de anúncios Meta que se relaciona com a oportunidade (ex.: ad_name). */
  opportunity_ads_link_ads_column?: string | null;
};

/** GET: retorna o mapeamento UTM (campos GHL → colunas UTM e Facebook → UTM). */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const clientId = searchParams.get("client_id");
  const cred = await getGhlCredentials(request, clientId);
  if ("error" in cred) return NextResponse.json({ error: cred.error }, { status: cred.status });

  const service = createServiceClient();
  const allKeys = [...UTM_KEYS, ...FACEBOOK_UTM_KEYS, FACEBOOK_SOURCE_TERMS_KEY, OPPORTUNITY_ADS_LINK_OPP_COLUMN, OPPORTUNITY_ADS_LINK_ADS_COLUMN];
  const { data: rows } = await service
    .from("location_predefinitions")
    .select("key, value")
    .eq("client_id", cred.client_id)
    .in("key", allKeys)
    .eq("active", true);

  const byKey = new Map<string, string>();
  for (const r of rows ?? []) {
    if (r.key && r.value != null) byKey.set(r.key, r.value);
  }

  const payload: UtmMappingPayload = {
    utm_source_field_id: byKey.get("utm_source_field_id") ?? null,
    utm_campaign_field_id: byKey.get("utm_campaign_field_id") ?? null,
    utm_medium_field_id: byKey.get("utm_medium_field_id") ?? null,
    utm_term_field_id: byKey.get("utm_term_field_id") ?? null,
    utm_content_field_id: byKey.get("utm_content_field_id") ?? null,
    facebook_campaign_utm: byKey.get("facebook_campaign_utm") ?? null,
    facebook_adset_utm: byKey.get("facebook_adset_utm") ?? null,
    facebook_creative_utm: byKey.get("facebook_creative_utm") ?? null,
    facebook_utm_source_terms: (() => {
      const raw = byKey.get(FACEBOOK_SOURCE_TERMS_KEY);
      if (!raw) return [];
      try {
        const parsed = JSON.parse(raw) as unknown;
        return Array.isArray(parsed)
          ? parsed
              .filter((x): x is string => typeof x === "string")
              .map((s) => s.trim())
              .filter(Boolean)
          : [];
      } catch {
        return [];
      }
    })(),
    opportunity_ads_link_opportunity_column: byKey.get(OPPORTUNITY_ADS_LINK_OPP_COLUMN) ?? null,
    opportunity_ads_link_ads_column: byKey.get(OPPORTUNITY_ADS_LINK_ADS_COLUMN) ?? null,
  };

  return NextResponse.json(payload);
}

/**
 * POST: salva o mapeamento UTM.
 * Body: UtmMappingPayload (todos opcionais).
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as Partial<UtmMappingPayload>;
  const clientId = (body.client_id as string) ?? null;
  const cred = await getGhlCredentials(request, clientId);
  if ("error" in cred) return NextResponse.json({ error: cred.error }, { status: cred.status });

  const service = createServiceClient();

  const toSave: { key: string; value: string }[] = [];
  for (const key of UTM_KEYS) {
    const v = body[key];
    if (v !== undefined) toSave.push({ key, value: typeof v === "string" ? v.trim() : "" });
  }
  for (const key of FACEBOOK_UTM_KEYS) {
    const v = body[key];
    if (v !== undefined && UTM_COLUMNS.includes(v as (typeof UTM_COLUMNS)[number])) {
      toSave.push({ key, value: v as string });
    }
  }

  if (body.facebook_utm_source_terms !== undefined) {
    const terms = Array.isArray(body.facebook_utm_source_terms)
      ? body.facebook_utm_source_terms
          .filter((x): x is string => typeof x === "string")
          .map((s) => s.trim())
          .filter(Boolean)
      : [];
    const uniqueTerms = Array.from(new Set(terms));
    toSave.push({ key: FACEBOOK_SOURCE_TERMS_KEY, value: JSON.stringify(uniqueTerms) });
  }

  if (body.opportunity_ads_link_opportunity_column !== undefined) {
    const v = body.opportunity_ads_link_opportunity_column;
    if (v && OPPORTUNITY_ADS_LINK_OPP_OPTIONS.includes(v as (typeof OPPORTUNITY_ADS_LINK_OPP_OPTIONS)[number])) {
      toSave.push({ key: OPPORTUNITY_ADS_LINK_OPP_COLUMN, value: v });
    }
  }
  if (body.opportunity_ads_link_ads_column !== undefined) {
    const v = body.opportunity_ads_link_ads_column;
    if (v && OPPORTUNITY_ADS_LINK_ADS_OPTIONS.includes(v as (typeof OPPORTUNITY_ADS_LINK_ADS_OPTIONS)[number])) {
      toSave.push({ key: OPPORTUNITY_ADS_LINK_ADS_COLUMN, value: v });
    }
  }

  try {
    const allKeys = [...UTM_KEYS, ...FACEBOOK_UTM_KEYS, FACEBOOK_SOURCE_TERMS_KEY, OPPORTUNITY_ADS_LINK_OPP_COLUMN, OPPORTUNITY_ADS_LINK_ADS_COLUMN];
    for (const key of allKeys) {
      await service
        .from("location_predefinitions")
        .update({ active: false, updated_at: new Date().toISOString() })
        .eq("client_id", cred.client_id)
        .eq("key", key);
    }
    for (const { key, value } of toSave) {
      if (value) {
        await service.from("location_predefinitions").insert({
          client_id: cred.client_id,
          key,
          value,
          active: true,
        });
      }
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Erro ao salvar mapeamento UTM";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
