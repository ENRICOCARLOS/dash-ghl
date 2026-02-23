# DASH - GHL

Painel **multi-tenant** com **Supabase** (auth + dados) e isolamento por **Location ID** do GoHighLevel. Nunca mistura dados de contas diferentes.

## Stack

- **Next.js 15** (App Router)
- **React 19** + **TypeScript** + **Tailwind CSS 4**
- **Supabase** (Auth, Postgres, RLS)

## Papéis

- **ADM:** acesso total; vê no sidebar **"Gerenciar Clientes"**; pode criar clientes, usuários, vincular/desvincular e redefinir senhas.
- **Usuário:** acessa só as Locations às quais foi vinculado; troca de conta pelo **seletor na topbar**; não vê "Gerenciar Clientes".

## Layout

- **Sidebar:** Dashboard (+ Gerenciar Clientes só para ADM).
- **Topbar:** Seletor de conta (Location) + menu do usuário (Sair).
- Toda a aplicação usa **Sidebar + Topbar**; dados sempre escopados pela **conta ativa**.

## Rotas

| Rota | Descrição | Acesso |
|------|-----------|--------|
| `/` | Login (e-mail + senha, Supabase Auth) | Público |
| `/dashboard` | Dashboard (conta ativa) | Logado |
| `/gerenciar-clientes` | Lista de clientes, + Cadastrar cliente, + Criar usuário | ADM |
| `/gerenciar-clientes/novo` | Cadastrar cliente (nome, usuário, senha, GHL API Key, Location ID) | ADM |
| `/gerenciar-clientes/[id]` | Editar cliente | ADM |
| `/gerenciar-clientes/[id]/usuarios` | Vincular/desvincular usuários, redefinir senha | ADM |
| `/gerenciar-clientes/usuarios/novo` | Criar usuário e opcionalmente vincular a clientes | ADM |

## API (backend)

- `GET/POST /api/auth/session` — sessão (perfil + clientes)
- `GET/POST /api/auth/active-client` — conta ativa (Location)
- `GET /api/ghl-credentials?location_id=` — API Key + Location ID do cliente ativo
- `GET/POST /api/clients`, `PATCH/DELETE /api/clients/[id]`
- `GET/POST /api/users`, `POST /api/users/reset-password`, `POST/DELETE /api/users/link-client`

## Como rodar

1. **Supabase:** crie o projeto, rode `supabase/schema.sql` no SQL Editor e crie o primeiro ADM (veja `supabase/README.md`).
2. **Env:** copie `.env.example` para `.env.local` e preencha as variáveis do Supabase.
3. **App:**

```bash
npm install
npm run dev
```

Acesse **http://localhost:3000** e entre com o e-mail do ADM.

## Isolamento por Location

- O **seletor na topbar** define a conta (Location) ativa.
- Todas as queries, exibições e chamadas que usam dados do GHL devem usar **sempre** o Location ID da conta ativa (via `useActiveClient()` ou `GET /api/ghl-credentials`).
- Nunca misturar dados de diferentes Location IDs.
