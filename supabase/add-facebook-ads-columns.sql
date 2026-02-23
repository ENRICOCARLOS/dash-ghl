-- Adiciona colunas para integração com Facebook Ads (Marketing API)
-- Execute após o schema principal. Campos opcionais por cliente.

alter table public.clients
  add column if not exists fb_access_token text,
  add column if not exists fb_ad_account_id text;

comment on column public.clients.fb_access_token is 'Token de acesso da Meta/Facebook (Marketing API)';
comment on column public.clients.fb_ad_account_id is 'ID da conta de anúncios (ex: act_123456789)';
