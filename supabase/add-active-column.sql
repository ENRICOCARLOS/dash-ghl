-- Rodar este script se as tabelas já existiam antes de ter a coluna active.
-- Adiciona active boolean not null default true onde não existir.

ALTER TABLE public.pipelines ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;
ALTER TABLE public.pipeline_stages ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;
ALTER TABLE public.ghl_users ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;
ALTER TABLE public.ghl_calendars ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;

-- Slug do relatório por cliente (padrão 'padrao'; variações só para aquele cliente)
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS report_slug text NOT NULL DEFAULT 'padrao';
