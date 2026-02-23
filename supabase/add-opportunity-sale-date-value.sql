-- ============================================================
-- Coluna sale_date_value na tabela opportunities (data da venda)
-- Preenchida pelo sync quando há predefinição sale_date_field_id.
-- Usada no relatório e indicadores: só conta como venda se tiver data.
-- Rodar após opportunities-and-calendar-events.sql
-- ============================================================

alter table public.opportunities
  add column if not exists sale_date_value timestamptz;

comment on column public.opportunities.sale_date_value is 'Data da venda (campo customizado configurado em Predefinições). Só preenchido quando sale_date_field_id está definido; usado para filtrar e contar vendas no relatório.';
