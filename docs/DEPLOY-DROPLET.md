# Deploy DASH-GHL no seu Droplet (Portainer + proxy)

Domínio do app: **relatorios.nowctor.com.br**

No mesmo servidor você já tem:
- **n8n** → n8n.nowctor.com.br  
- **Evolution** → (seu domínio/porta)  
- **DASH-GHL (relatórios)** → relatorios.nowctor.com.br → porta **3000**

---

## Por que não conflita

Cada serviço usa um **domínio diferente** e um **container/porta diferente**. O proxy encaminha pelo nome:

| Domínio | Proxy encaminha para | Serviço |
|---------|----------------------|---------|
| n8n.nowctor.com.br | porta do n8n (ex.: 5678) | n8n |
| relatorios.nowctor.com.br | porta **3000** | DASH-GHL |
| (Evolution) | porta do Evolution | Evolution API |

Nenhum conflito: são só mais um host e mais um container no mesmo proxy.

---

## 1. Imagem Docker

Escolha um caminho:

### Opção A: Build no PC e push para Docker Hub

No PowerShell (pasta do projeto):

```powershell
docker login
docker build -t ENRICOCARLOS/dash-ghl:latest .
docker push ENRICOCARLOS/dash-ghl:latest
```

No Portainer: use a imagem `SEU_USUARIO/dash-ghl:latest` (ele faz o pull).

### Opção B: Build no servidor a partir do GitHub

No Portainer: **Stacks** → **Add stack** → **Web editor** e use o exemplo da seção 2 abaixo (com `build` no compose).  
Ou via SSH: `git clone` do repo e `docker build -t dash-ghl .` na pasta do projeto.

---

## 2. Subir o app no Portainer

O projeto tem **docker-compose.yml** na raiz. Duas formas:

---

### Opção A: Build direto do GitHub no Portainer (recomendado)

O Portainer clona o repo e faz o build no servidor. Não precisa de Docker no PC.

1. No Portainer: **Stacks** → **Add stack**.
2. **Name**: `dash-ghl`.
3. **Build method**: escolha **Repository**.
4. **Repository URL**: `https://github.com/ENRICOCARLOS/dash-ghl`
5. **Repository reference**: use o nome da branch padrão do repo (ex.: `main` ou `master` — confira no GitHub em Settings → Default branch).
6. **Compose path**: `docker-compose.yml`
7. Role até **Environment variables** e adicione (use **Add variable**):
   - `NEXT_PUBLIC_SUPABASE_URL` = sua URL do Supabase  
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` = sua anon key  
   - `SUPABASE_SERVICE_ROLE_KEY` = sua service role key  
   - `CRON_SECRET` = uma senha forte (opcional; use se for chamar o cron)
8. **Deploy the stack**.

O primeiro deploy pode demorar alguns minutos (clone + build). Depois teste: `http://IP-DO-SERVIDOR:3000` ou `https://relatorios.nowctor.com.br` (após configurar o proxy).

---

### Opção B: Container usando imagem do Docker Hub

Se você já fez build no PC e deu push para o Docker Hub:

1. **Containers** → **Add container**.
2. **Name**: `dash-ghl`.
3. **Image**: `ENRICOCARLOS/dash-ghl:latest` (ou seu usuário Docker Hub).
4. **Port mapping**: host `3000` → container `3000` (public).
5. **Env**: adicione as mesmas variáveis (Supabase + CRON_SECRET).
6. **Restart policy**: `Unless stopped`.
7. **Deploy**.

---

## 3. Configurar o proxy → relatorios.nowctor.com.br

No **mesmo proxy** que já usa para n8n e Evolution, adicione **mais um host**:

- **Domínio**: `relatorios.nowctor.com.br`
- **Backend / upstream**: `http://127.0.0.1:3000` (ou `http://dash-ghl:3000` se o proxy usar rede Docker e o nome do container)

### Nginx (arquivo)

```nginx
server {
    listen 80;
    server_name relatorios.nowctor.com.br;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

### Traefik (recomendado neste servidor)

O **docker-compose.yml** do projeto já inclui as labels do Traefik. O Traefik descobre o serviço sozinho.

**Rede do Traefik:** o stack do DASH-GHL precisa estar na **mesma rede** que o Traefik (no seu servidor: `network_swarm_public`). O `docker-compose.yml` já está configurado para usar essa rede. Se no seu ambiente o nome for outro, altere em `networks.swarm_public.name` e na label `traefik.docker.network`.

Depois de subir o stack no Portainer, o Traefik passa a rotear **relatorios.nowctor.com.br** para o DASH-GHL. SSL (Let’s Encrypt) usa o `certresolver=letsencrypt`; se no seu Traefik o resolver tiver outro nome, altere essa label no `docker-compose.yml`.

### Nginx Proxy Manager

- Novo **Proxy Host**:
  - **Domain**: `relatorios.nowctor.com.br`
  - **Forward to**: `127.0.0.1:3000` (ou `dash-ghl:3000` na rede do Docker)
- Ative **SSL** (Let’s Encrypt) como no n8n.

### DNS

- Registro **A**: `relatorios.nowctor.com.br` → IP do Droplet (ex.: `143.198.160.11`).

---

## 4. Supabase

No Supabase → **Authentication** → **URL Configuration**:

- **Site URL**: `https://relatorios.nowctor.com.br`
- **Redirect URLs**: adicione `https://relatorios.nowctor.com.br` e `https://relatorios.nowctor.com.br/**`

---

## 5. Atualizar o app depois

- **Opção A (Docker Hub)**: no PC, `docker build` + `docker push`. No Portainer, **Recreate** o container (pull da nova imagem).
- **Opção B (build no servidor)**: no Portainer ou SSH, novo build a partir do repo e recriar o container.

---

## Resumo

| O quê              | Onde / como |
|--------------------|-------------|
| Container DASH-GHL | Portainer, porta **3000**, env Supabase + CRON |
| Domínio            | **relatorios.nowctor.com.br** (novo host no proxy) |
| SSL                | Igual ao n8n (Let’s Encrypt no proxy) |
| Conflito com n8n/Evolution | Não — cada domínio aponta para uma porta/container diferente. |
