-- Tabela para armazenar insights diários do Facebook Ads (campanha, conjunto, anúncio; impressões, cliques, gasto por dia).
-- Sincronização incremental: sempre a partir do último dia armazenado (atualizando o último dia + novos).

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

-- RLS
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
