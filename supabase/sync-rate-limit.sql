-- Registro do último sync GHL por cliente (para rate limit: 1 sync a cada 5 min).
-- Uso: verificar last_ghl_sync_at antes de rodar sync; atualizar após sync.
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS last_ghl_sync_at timestamptz;
