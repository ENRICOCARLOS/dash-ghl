-- ============================================================
-- Coluna date_updated na tabela opportunities (data de última atualização no GHL)
-- Rodar após opportunities-and-calendar-events.sql
-- ============================================================
-- date_added = data de criação no GHL (dateAdded/dateCreated/createdAt)
-- date_updated = data de última atualização no GHL (dateUpdated) — usada no sync horário (alteradas na última hora)

alter table public.opportunities
  add column if not exists date_updated timestamptz;

comment on column public.opportunities.date_added is 'Data de criação da oportunidade no GHL (dateAdded/dateCreated/createdAt)';
comment on column public.opportunities.date_updated is 'Data da última atualização da oportunidade no GHL (dateUpdated); usada no filtro da atualização automática (1h).';
