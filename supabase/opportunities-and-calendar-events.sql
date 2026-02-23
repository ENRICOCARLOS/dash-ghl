-- ============================================================
-- Oportunidades e eventos de calendário (campos de sistema GHL)
-- Campos customizados: colunas dinâmicas cf_<fieldId> criadas via predefinições
-- ============================================================

-- ---------- Oportunidades (campos padrão da API GHL) ----------
-- Ref: id, pipelineId, pipelineStageId/stageId, name, status, monetaryValue,
--      contactId, assignedTo, source, dateAdded, createdAt, customFields
create table if not exists public.opportunities (
  id uuid primary key default uuid_generate_v4(),
  client_id uuid not null references public.clients(id) on delete cascade,
  ghl_opportunity_id text not null,
  pipeline_id text,
  stage_id text,
  name text,
  status text,
  monetary_value numeric(14, 2),
  contact_id text,
  assigned_to text,
  source text,
  date_added timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, ghl_opportunity_id)
);

create index if not exists idx_opportunities_client_id on public.opportunities (client_id);
create index if not exists idx_opportunities_pipeline_stage on public.opportunities (client_id, pipeline_id, stage_id);
create index if not exists idx_opportunities_created_at on public.opportunities (client_id, created_at);

drop trigger if exists opportunities_updated_at on public.opportunities;
create trigger opportunities_updated_at
  before update on public.opportunities for each row execute function public.set_updated_at();

-- ---------- Eventos de calendário (campos padrão da API GHL) ----------
-- Ref: id, calendarId, startTime, endTime, createdAt, status, title,
--      contactId, assignedUserId, notes, source, dateAdded, dateUpdated
create table if not exists public.calendar_events (
  id uuid primary key default uuid_generate_v4(),
  client_id uuid not null references public.clients(id) on delete cascade,
  ghl_event_id text not null,
  ghl_calendar_id text,
  start_time timestamptz,
  end_time timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  status text,
  title text,
  contact_id text,
  assigned_user_id text,
  notes text,
  source text,
  date_added timestamptz,
  date_updated timestamptz,
  unique (client_id, ghl_event_id)
);

create index if not exists idx_calendar_events_client_id on public.calendar_events (client_id);
create index if not exists idx_calendar_events_calendar on public.calendar_events (client_id, ghl_calendar_id);
create index if not exists idx_calendar_events_start_time on public.calendar_events (client_id, start_time);

drop trigger if exists calendar_events_updated_at on public.calendar_events;
create trigger calendar_events_updated_at
  before update on public.calendar_events for each row execute function public.set_updated_at();

-- ---------- RLS ----------
alter table public.opportunities enable row level security;
alter table public.calendar_events enable row level security;

drop policy if exists opportunities_adm_all on public.opportunities;
create policy opportunities_adm_all on public.opportunities
  for all using (public.is_adm());

drop policy if exists opportunities_user_linked on public.opportunities;
create policy opportunities_user_linked on public.opportunities
  for all using (
    exists (
      select 1 from public.user_clients
      where user_clients.client_id = opportunities.client_id and user_clients.user_id = auth.uid()
    )
  );

drop policy if exists calendar_events_adm_all on public.calendar_events;
create policy calendar_events_adm_all on public.calendar_events
  for all using (public.is_adm());

drop policy if exists calendar_events_user_linked on public.calendar_events;
create policy calendar_events_user_linked on public.calendar_events
  for all using (
    exists (
      select 1 from public.user_clients
      where user_clients.client_id = calendar_events.client_id and user_clients.user_id = auth.uid()
    )
  );

-- ---------- Funções para adicionar colunas de campos customizados ----------
-- Nome da coluna: cf_<fieldId> (sanitizado: só [a-zA-Z0-9_])
-- Chamadas via RPC pelo backend ao salvar predefinições de campos a importar.

create or replace function public.sanitize_custom_field_column_name(raw_id text)
returns text
language plpgsql
immutable
as $$
declare
  out text;
  c text;
  i int;
begin
  if raw_id is null or length(trim(raw_id)) = 0 then
    return null;
  end if;
  out := 'cf_';
  for i in 1..length(raw_id) loop
    c := substr(raw_id, i, 1);
    if c ~ '^[a-zA-Z0-9_]$' then
      out := out || c;
    else
      out := out || '_';
    end if;
  end loop;
  return out;
end;
$$;

create or replace function public.add_opportunity_custom_field_column(field_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  col_name text;
  full_sql text;
begin
  col_name := public.sanitize_custom_field_column_name(field_id);
  if col_name is null then
    return;
  end if;
  full_sql := format(
    'ALTER TABLE public.opportunities ADD COLUMN IF NOT EXISTS %I text',
    col_name
  );
  execute full_sql;
end;
$$;

comment on table public.opportunities is 'Oportunidades GHL por cliente. Colunas cf_* são campos customizados escolhidos nas predefinições.';
comment on table public.calendar_events is 'Eventos/agendamentos GHL por cliente (sincronizados a partir dos calendários em ghl_calendars).';
