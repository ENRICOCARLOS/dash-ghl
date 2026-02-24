# Debug no servidor (Docker + SSH)

Para colocar breakpoints e debugar o app rodando no Docker no servidor (Droplet), use o Node inspector + túnel SSH.

---

## 1. Rodar o container com o inspector ativo

No servidor, o processo Node precisa abrir a porta de debug **9229**. Duas opções:

### Opção A: Variável de ambiente no Portainer

No stack do DASH-GHL no Portainer:

1. **Edit stack** → em **Environment variables**, adicione:
   - Name: `NODE_OPTIONS`  
   - Value: `--inspect=0.0.0.0:9229`
2. Em **Ports** (ou no `deploy.ports` do compose), publique também a porta **9229** (host 9229 → container 9229).
3. **Update** o stack.

Se o seu compose não tiver a porta 9229, adicione no `docker-compose.yml` (temporariamente, para debug):

```yaml
ports:
  - "3000:3000"
  - "9229:9229"
```

E no `deploy.ports` (Swarm):

```yaml
deploy:
  ports:
    - target: 3000
      published: 3000
      protocol: tcp
      mode: host
    - target: 9229
      published: 9229
      protocol: tcp
      mode: host
```

### Opção B: Container manual via SSH (sem Portainer)

No servidor, parando o stack e subindo um container só para debug:

```bash
# Parar o serviço do stack (ou use outro nome de container)
docker stop $(docker ps -q --filter name=dash-ghl)

# Subir com inspector e porta 9229 exposta
docker run -d --name dash-ghl-debug \
  -p 3000:3000 -p 9229:9229 \
  -e NODE_OPTIONS="--inspect=0.0.0.0:9229" \
  -e NEXT_PUBLIC_SUPABASE_URL="..." \
  -e NEXT_PUBLIC_SUPABASE_ANON_KEY="..." \
  -e SUPABASE_SERVICE_ROLE_KEY="..." \
  -e CRON_SECRET="..." \
  ENRICODATA/dash-ghl:latest
```

(Ajuste as env e a imagem conforme o seu projeto.)

---

## 2. Túnel SSH (no seu PC)

No PowerShell ou terminal do seu PC, crie o túnel para a porta 9229:

```bash
ssh -L 9229:127.0.0.1:9229 root@143.198.160.11
```

Troque `root@143.198.160.11` pelo usuário e IP do seu Droplet. Deixe essa sessão SSH aberta enquanto estiver debugando.

---

## 3. Anexar o debugger no Cursor/VS Code

1. Com o túnel SSH ativo, no Cursor: **Run and Debug** (Ctrl+Shift+D).
2. Selecione **"Attach to Node (Docker no servidor)"**.
3. Clique em **Start Debugging** (F5).

O debugger vai se conectar ao Node que está rodando no container. Coloque breakpoints no código (por exemplo em `src/app/api/` ou em server components); quando a requisição passar por ali, o debug para no breakpoint.

---

## 4. Firewall

Se o inspector não conectar, no Droplet libere a porta 9229 (só para debug):

```bash
sudo ufw allow 9229/tcp
sudo ufw reload
```

Ou, se preferir não expor 9229 na internet, use **só o túnel SSH** (passo 2): a porta 9229 fica acessível só em `localhost` no servidor, e o túnel traz isso para o seu PC. Nesse caso não é obrigatório abrir 9229 no firewall.

---

## Resumo

| Onde        | O quê |
|------------|--------|
| Servidor   | Container rodando com `NODE_OPTIONS=--inspect=0.0.0.0:9229` e porta 9229 publicada |
| Seu PC     | `ssh -L 9229:127.0.0.1:9229 user@IP` (deixar aberto) |
| Cursor     | Run and Debug → **Attach to Node (Docker no servidor)** |

Quando terminar de debugar, pode remover `NODE_OPTIONS` e a porta 9229 do stack/container e fazer o update normalmente.
