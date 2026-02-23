-- ============================================================
-- DASH - GHL — Multi-tenancy com GoHighLevel
-- Isolamento total por Location ID (nunca misturar dados)
-- ============================================================

-- Extensão para UUID
create extension if not exists "uuid-ossp";

-- Perfis (extende auth.users): papel ADM ou user
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  full_name text,
  role text not null check (role in ('ADM', 'user')) default 'user',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Clientes (cada um = conta GHL com Location ID próprio; opcional: Facebook Ads)
create table if not exists public.clients (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  ghl_api_key text not null,
  ghl_location_id text not null unique,
  report_slug text not null default 'padrao',
  fb_access_token text,
  fb_ad_account_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Vínculo usuário ↔ clientes (um usuário pode acessar várias locations)
create table if not exists public.user_clients (
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  primary key (user_id, client_id)
);

-- Sessão ativa: qual location o usuário está vendo (opcional; pode ser só no front)
create table if not exists public.user_active_client (
  user_id uuid primary key references auth.users(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade
);

-- Trigger updated_at
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists profiles_updated_at on public.profiles;
create trigger profiles_updated_at
  before update on public.profiles for each row execute function public.set_updated_at();

drop trigger if exists clients_updated_at on public.clients;
create trigger clients_updated_at
  before update on public.clients for each row execute function public.set_updated_at();

-- ========== RLS ==========
alter table public.profiles enable row level security;
alter table public.clients enable row level security;
alter table public.user_clients enable row level security;
alter table public.user_active_client enable row level security;

-- Função auxiliar: é ADM?
create or replace function public.is_adm()
returns boolean as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'ADM'
  );
$$ language sql security definer stable;

-- Profiles: usuário vê só o próprio; ADM vê todos
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select using (id = auth.uid());

drop policy if exists profiles_select_adm on public.profiles;
create policy profiles_select_adm on public.profiles
  for select using (public.is_adm());

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update using (id = auth.uid());

drop policy if exists profiles_all_adm on public.profiles;
create policy profiles_all_adm on public.profiles
  for all using (public.is_adm());

-- Clients: ADM vê/edita tudo; user só vê clientes vinculados
drop policy if exists clients_adm_all on public.clients;
create policy clients_adm_all on public.clients
  for all using (public.is_adm());

drop policy if exists clients_user_linked on public.clients;
create policy clients_user_linked on public.clients
  for select using (
    exists (
      select 1 from public.user_clients
      where user_clients.client_id = clients.id and user_clients.user_id = auth.uid()
    )
  );

-- User_clients: ADM gerencia tudo; user vê só os próprios vínculos
drop policy if exists user_clients_adm_all on public.user_clients;
create policy user_clients_adm_all on public.user_clients
  for all using (public.is_adm());

drop policy if exists user_clients_select_own on public.user_clients;
create policy user_clients_select_own on public.user_clients
  for select using (user_id = auth.uid());

-- User_active_client: cada um edita a própria sessão
drop policy if exists user_active_client_own on public.user_active_client;
create policy user_active_client_own on public.user_active_client
  for all using (user_id = auth.uid());

-- ========== Trigger: criar profile ao criar user no Auth ==========
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    coalesce(new.email, new.raw_user_meta_data->>'email', ''),
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', ''),
    coalesce((new.raw_user_meta_data->>'role')::text, 'user')
  );
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
-- Pipelines e estágios (cache/sincronização por conta GHL)
-- ============================================================

create table if not exists public.pipelines (
  id uuid primary key default uuid_generate_v4(),
  client_id uuid not null references public.clients(id) on delete cascade,
  ghl_pipeline_id text not null,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, ghl_pipeline_id)
);

create table if not exists public.pipeline_stages (
  id uuid primary key default uuid_generate_v4(),
  pipeline_id uuid not null references public.pipelines(id) on delete cascade,
  ghl_stage_id text not null,
  name text not null,
  position int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (pipeline_id, ghl_stage_id)
);

drop trigger if exists pipelines_updated_at on public.pipelines;
create trigger pipelines_updated_at
  before update on public.pipelines for each row execute function public.set_updated_at();

drop trigger if exists pipeline_stages_updated_at on public.pipeline_stages;
create trigger pipeline_stages_updated_at
  before update on public.pipeline_stages for each row execute function public.set_updated_at();

-- ============================================================
-- Usuários GHL (nome/email dos usuários da location no GoHighLevel)
-- ============================================================

create table if not exists public.ghl_users (
  id uuid primary key default uuid_generate_v4(),
  client_id uuid not null references public.clients(id) on delete cascade,
  ghl_user_id text not null,
  name text not null,
  email text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, ghl_user_id)
);

drop trigger if exists ghl_users_updated_at on public.ghl_users;
create trigger ghl_users_updated_at
  before update on public.ghl_users for each row execute function public.set_updated_at();

-- ============================================================
-- Calendários GHL (cache/sincronização por conta)
-- ============================================================

create table if not exists public.ghl_calendars (
  id uuid primary key default uuid_generate_v4(),
  client_id uuid not null references public.clients(id) on delete cascade,
  ghl_calendar_id text not null,
  name text not null,
  description text,
  timezone text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, ghl_calendar_id)
);

drop trigger if exists ghl_calendars_updated_at on public.ghl_calendars;
create trigger ghl_calendars_updated_at
  before update on public.ghl_calendars for each row execute function public.set_updated_at();

-- ========== RLS: pipelines, pipeline_stages, ghl_users, ghl_calendars ==========
alter table public.pipelines enable row level security;
alter table public.pipeline_stages enable row level security;
alter table public.ghl_users enable row level security;
alter table public.ghl_calendars enable row level security;

-- Pipelines: ADM tudo; user vê e edita só dos clientes vinculados
drop policy if exists pipelines_adm_all on public.pipelines;
create policy pipelines_adm_all on public.pipelines
  for all using (public.is_adm());

drop policy if exists pipelines_user_linked on public.pipelines;
create policy pipelines_user_linked on public.pipelines
  for all using (
    exists (
      select 1 from public.user_clients
      where user_clients.client_id = pipelines.client_id and user_clients.user_id = auth.uid()
    )
  );

-- Pipeline_stages: herdam visibilidade do pipeline; ADM tudo; user vê e edita quando pipeline é do client vinculado
drop policy if exists pipeline_stages_adm_all on public.pipeline_stages;
create policy pipeline_stages_adm_all on public.pipeline_stages
  for all using (public.is_adm());

drop policy if exists pipeline_stages_user_linked on public.pipeline_stages;
create policy pipeline_stages_user_linked on public.pipeline_stages
  for all using (
    exists (
      select 1 from public.pipelines p
      join public.user_clients uc on uc.client_id = p.client_id and uc.user_id = auth.uid()
      where p.id = pipeline_stages.pipeline_id
    )
  );

-- GHL Users: ADM tudo; user vê e edita só dos clientes vinculados
drop policy if exists ghl_users_adm_all on public.ghl_users;
create policy ghl_users_adm_all on public.ghl_users
  for all using (public.is_adm());

drop policy if exists ghl_users_user_linked on public.ghl_users;
create policy ghl_users_user_linked on public.ghl_users
  for all using (
    exists (
      select 1 from public.user_clients
      where user_clients.client_id = ghl_users.client_id and user_clients.user_id = auth.uid()
    )
  );

-- GHL Calendars: ADM tudo; user vê e edita só dos clientes vinculados
drop policy if exists ghl_calendars_adm_all on public.ghl_calendars;
create policy ghl_calendars_adm_all on public.ghl_calendars
  for all using (public.is_adm());

drop policy if exists ghl_calendars_user_linked on public.ghl_calendars;
create policy ghl_calendars_user_linked on public.ghl_calendars
  for all using (
    exists (
      select 1 from public.user_clients
      where user_clients.client_id = ghl_calendars.client_id and user_clients.user_id = auth.uid()
    )
  );

-- ============================================================
-- Facebook Ads: insights diários (campanha, conjunto, anúncio; impressões, cliques, gasto)
-- Sincronização incremental a partir do último dia (atualiza último dia + novos).
-- ============================================================

create table if not exists public.facebook_ads_daily_insights (
  id uuid primary key default uuid_generate_v4(),
  client_id uuid not null references public.clients(id) on delete cascade,
  date date not null,
  campaign_id text not null,
  campaign_name text not null default '',
  adset_id text not null,
  adset_name text not null default '',
  ad_id text not null,
  ad_name text not null default '',
  impressions bigint not null default 0,
  clicks bigint not null default 0,
  spend numeric(14, 2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, date, ad_id)
);

create index if not exists idx_facebook_ads_daily_insights_client_date
  on public.facebook_ads_daily_insights (client_id, date);

drop trigger if exists facebook_ads_daily_insights_updated_at on public.facebook_ads_daily_insights;
create trigger facebook_ads_daily_insights_updated_at
  before update on public.facebook_ads_daily_insights for each row execute function public.set_updated_at();

alter table public.facebook_ads_daily_insights enable row level security;

drop policy if exists facebook_ads_daily_insights_adm_all on public.facebook_ads_daily_insights;
create policy facebook_ads_daily_insights_adm_all on public.facebook_ads_daily_insights
  for all using (public.is_adm());

drop policy if exists facebook_ads_daily_insights_user_linked on public.facebook_ads_daily_insights;
create policy facebook_ads_daily_insights_user_linked on public.facebook_ads_daily_insights
  for all using (
    exists (
      select 1 from public.user_clients
      where user_clients.client_id = facebook_ads_daily_insights.client_id and user_clients.user_id = auth.uid()
    )
  );
