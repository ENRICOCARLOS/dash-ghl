-- ============================================================
-- Relação UTM / Oportunidades ↔ Anúncios Meta (facebook_ads_daily_insights)
-- O vínculo é feito por valor: uma coluna da oportunidade (ex.: utm_content)
-- equivale a uma coluna da tabela de anúncios (ex.: ad_name).
-- A escolha das colunas é configurável em location_predefinitions:
--   opportunity_ads_link_opportunity_column = utm_source | utm_campaign | utm_medium | utm_term | utm_content
--   opportunity_ads_link_ads_column          = ad_id | ad_name | campaign_id | campaign_name | adset_id | adset_name
-- Esta view usa o par padrão: opportunities.utm_content = facebook_ads_daily_insights.ad_name
-- para permitir puxar investimento (spend) por oportunidade ou por UTM.
-- ============================================================

-- View: junta oportunidades com os insights de anúncios onde o valor da coluna
-- de oportunidade (padrão utm_content) coincide com a coluna de anúncio (padrão ad_name).
-- Um mesmo anúncio (várias linhas por data) pode estar ligado a várias oportunidades.
create or replace view public.opportunity_ads_insights_v as
select
  o.id as opportunity_id,
  o.client_id,
  o.ghl_opportunity_id,
  o.utm_source,
  o.utm_campaign,
  o.utm_medium,
  o.utm_content,
  f.id as insight_id,
  f.date as insight_date,
  f.campaign_id,
  f.campaign_name,
  f.adset_id,
  f.adset_name,
  f.ad_id,
  f.ad_name,
  f.impressions,
  f.clicks,
  f.spend
from public.opportunities o
join public.facebook_ads_daily_insights f
  on f.client_id = o.client_id
  and nullif(trim(o.utm_content), '') is not null
  and nullif(trim(o.utm_content), '') = nullif(trim(f.ad_name), '');

comment on view public.opportunity_ads_insights_v is 'Junção oportunidade ↔ anúncio Meta pelo par padrão utm_content = ad_name. Use para investimento por oportunidade/UTM. Colunas de ligação configuráveis em location_predefinitions (opportunity_ads_link_*).';
