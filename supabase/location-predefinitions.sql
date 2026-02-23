-- ============================================================
-- Pré-definições por location (ex.: campo customizado "data da venda")
-- Uma linha ativa por (client_id, key). Ao salvar nova, desativar a anterior.
-- ============================================================

create table if not exists public.location_predefinitions (
  id uuid primary key default uuid_generate_v4(),
  client_id uuid not null references public.clients(id) on delete cascade,
  key text not null,
  value text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_location_predefinitions_client_key_active
  on public.location_predefinitions (client_id, key, active);

alter table public.location_predefinitions enable row level security;

-- ADM: tudo; user: só dos clientes vinculados
drop policy if exists location_predefinitions_adm_all on public.location_predefinitions;
create policy location_predefinitions_adm_all on public.location_predefinitions
  for all using (public.is_adm());

drop policy if exists location_predefinitions_user_linked on public.location_predefinitions;
create policy location_predefinitions_user_linked on public.location_predefinitions
  for all using (
    exists (
      select 1 from public.user_clients
      where user_clients.client_id = location_predefinitions.client_id
        and user_clients.user_id = auth.uid()
    )
  );

drop trigger if exists location_predefinitions_updated_at on public.location_predefinitions;
create trigger location_predefinitions_updated_at
  before update on public.location_predefinitions
  for each row execute function public.set_updated_at();

-- Script de desativação: desativa a linha anterior para a mesma key do cliente.
-- Chamar ANTES de inserir o novo registro quando o usuário alterar o campo "data da venda".
-- Exemplo de uso (por API ou server): UPDATE ... SET active = false WHERE client_id = $1 AND key = 'sale_date_field_id';
comment on table public.location_predefinitions is 'Pré-definições por conta (ex.: sale_date_field_id). Apenas uma linha ativa por (client_id, key). Ao salvar nova, executar desativação da anterior.';
