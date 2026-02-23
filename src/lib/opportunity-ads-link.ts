import type { SupabaseClient } from "@supabase/supabase-js";

const KEY_OPP_COLUMN = "opportunity_ads_link_opportunity_column";
const KEY_ADS_COLUMN = "opportunity_ads_link_ads_column";

/** Colunas de oportunidade que podem ser usadas para ligar à tabela de anúncios. */
export const OPPORTUNITY_LINK_COLUMNS = [
  "utm_source",
  "utm_campaign",
  "utm_medium",
  "utm_term",
  "utm_content",
] as const;

/** Colunas da tabela facebook_ads_daily_insights que podem ser usadas para ligar à oportunidade. */
export const ADS_LINK_COLUMNS = [
  "ad_id",
  "ad_name",
  "campaign_id",
  "campaign_name",
  "adset_id",
  "adset_name",
] as const;

export type OpportunityAdsLinkConfig = {
  /** Coluna em opportunities (ex.: utm_content). */
  opportunityColumn: (typeof OPPORTUNITY_LINK_COLUMNS)[number] | null;
  /** Coluna em facebook_ads_daily_insights (ex.: ad_name). */
  adsColumn: (typeof ADS_LINK_COLUMNS)[number] | null;
};

/**
 * Lê em location_predefinitions as colunas configuradas para a relação
 * oportunidade ↔ anúncios Meta. Com isso as APIs podem fazer o join e puxar investimento.
 */
export async function getOpportunityAdsLinkConfig(
  service: SupabaseClient,
  clientId: string
): Promise<OpportunityAdsLinkConfig> {
  const { data: rows } = await service
    .from("location_predefinitions")
    .select("key, value")
    .eq("client_id", clientId)
    .in("key", [KEY_OPP_COLUMN, KEY_ADS_COLUMN])
    .eq("active", true);

  const byKey = new Map<string, string>();
  for (const r of rows ?? []) {
    if (r.key && r.value != null) byKey.set(r.key, r.value);
  }

  const opp = byKey.get(KEY_OPP_COLUMN)?.trim() ?? null;
  const ads = byKey.get(KEY_ADS_COLUMN)?.trim() ?? null;

  return {
    opportunityColumn:
      opp && OPPORTUNITY_LINK_COLUMNS.includes(opp as (typeof OPPORTUNITY_LINK_COLUMNS)[number])
        ? (opp as (typeof OPPORTUNITY_LINK_COLUMNS)[number])
        : null,
    adsColumn:
      ads && ADS_LINK_COLUMNS.includes(ads as (typeof ADS_LINK_COLUMNS)[number])
        ? (ads as (typeof ADS_LINK_COLUMNS)[number])
        : null,
  };
}
