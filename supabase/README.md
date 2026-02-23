# Supabase — DASH - GHL

Tudo do banco e auth é **só** o schema do DASH - GHL:

- **Auth/core:** `profiles`, `clients`, `user_clients`, `user_active_client` + Supabase Auth
- **Pipelines:** `pipelines`, `pipeline_stages` (dados dos pipelines e estágios GHL por conta)
- **Usuários GHL:** `ghl_users` (nome/email dos usuários da location no GoHighLevel)
- **Calendários:** `ghl_calendars` (informações dos calendários GHL por conta)

## 1. Rodar o schema

No **SQL Editor** do projeto Supabase, execute o conteúdo de **`schema.sql`** desta pasta.

Se as tabelas `pipelines`, `pipeline_stages`, `ghl_calendars`, `ghl_users` já existiam antes: execute também **`add-active-column.sql`** para adicionar a coluna `active` e a coluna **`report_slug`** em `clients` (slug da visualização de relatório por cliente; padrão `padrao`).

Para o Dashboard de indicadores (campo “data da venda” nas pré-definições): execute **`location-predefinitions.sql`** para criar a tabela `location_predefinitions` (uma linha ativa por `client_id` + `key`; ao salvar nova, desativar a anterior).

Para oportunidades e eventos de calendário no banco (com colunas dinâmicas para campos customizados): execute **`opportunities-and-calendar-events.sql`**. Cria as tabelas `opportunities` e `calendar_events` com os campos padrão da API GHL e as funções que adicionam colunas `cf_<fieldId>` quando o usuário escolhe quais campos customizados importar nas Predefinições.

## 2. Criar o primeiro ADM

1. Crie um usuário em **Authentication** do Supabase (e-mail + senha).
2. No SQL Editor, execute (troque o e-mail):

```sql
UPDATE public.profiles
SET role = 'ADM'
WHERE email = 'seu-email-adm@exemplo.com';
```

## 3. Variáveis de ambiente

No `.env.local` do Next.js (na raiz do DASH - GHL):

- `NEXT_PUBLIC_SUPABASE_URL` — URL do projeto
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Chave anônima
- `SUPABASE_SERVICE_ROLE_KEY` — Chave de service role (criar usuários, etc.)

## 4. RLS

As políticas no `schema.sql` garantem: usuários só veem clientes vinculados; ADM tem acesso total; isolamento por Location ID no uso no app.
