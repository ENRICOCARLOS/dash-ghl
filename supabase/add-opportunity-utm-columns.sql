-- ============================================================
-- Colunas UTM fixas na tabela opportunities (mapeamento GHL + Facebook)
-- Rodar após opportunities-and-calendar-events.sql
-- ============================================================

alter table public.opportunities
  add column if not exists utm_source text,
  add column if not exists utm_campaign text,
  add column if not exists utm_medium text,
  add column if not exists utm_term text,
  add column if not exists utm_content text;

comment on column public.opportunities.utm_source is 'UTM source (preenchido por campo GHL ou Facebook)';
comment on column public.opportunities.utm_campaign is 'UTM campaign (preenchido por campo GHL ou nome da campanha Facebook)';
comment on column public.opportunities.utm_medium is 'UTM medium (preenchido por campo GHL ou nome do conjunto Facebook)';
comment on column public.opportunities.utm_term is 'UTM term (preenchido por campo GHL)';
comment on column public.opportunities.utm_content is 'UTM content (preenchido por campo GHL ou nome do criativo Facebook)';
