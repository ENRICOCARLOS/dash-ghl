# Tabelas Supabase — DASH GHL

## Tabelas que o app usa (schema em `schema.sql`)

| Tabela | Uso | RLS |
|--------|-----|-----|
| **auth.users** | Supabase Auth (login). Não criamos; trigger `handle_new_user` cria profile ao inserir. | N/A |
| **public.profiles** | Um por usuário (id = auth.users.id). Campos: email, full_name, role ('ADM' ou 'user'). | Usuário vê o próprio; ADM vê todos. |
| **public.clients** | Clientes GHL: name, ghl_api_key, ghl_location_id. | ADM: tudo; user: só clientes em user_clients. |
| **public.user_clients** | Quem acessa qual cliente (user_id, client_id). | ADM: tudo; user: só os próprios. |
| **public.user_active_client** | Cliente “ativo” do usuário (user_id, client_id). | Cada um edita o próprio. |

## Conferência rápida

1. **Trigger**  
   `on_auth_user_created` em `auth.users` chama `handle_new_user()` e insere em `profiles`. Se o usuário foi criado antes do trigger, o profile pode não existir — a API `/api/auth/session` cria o profile na hora nesse caso.

2. **Variáveis**  
   `.env.local`: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.

3. **Login**  
   O app usa o cliente browser (`createBrowserClient`) para `signInWithPassword`; a sessão fica no storage do browser. A API de sessão aceita cookie ou header `Authorization: Bearer <token>`.

## Rodar o schema no Supabase

No **SQL Editor** do projeto: colar e executar todo o conteúdo de `schema.sql`.
