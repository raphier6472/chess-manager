#!/usr/bin/env bash
# Despliega main a producción (LXC 102 "swiss-mng") en un solo paso: build, sync,
# reinicio del servicio y verificación real de que el servidor corre el commit que se
# acaba de compilar (no solo un curl a /api).
#
# Uso: ejecutar desde el checkout principal (~/Documents/chess-manager), en main, desde
# una terminal real de localpc — no a través del "!" de Remote Control, que corta el SSH:
#   ./deploy.sh
#
# Requiere: estar en la rama main, sin cambios en archivos versionados, y la clave
# dedicada ~/.ssh/id_ed25519_homelab_swiss-mng_new (ver README.md y CLAUDE.md del homelab).
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LXC_HOST="root@172.16.0.23"
LXC_KEY="$HOME/.ssh/id_ed25519_homelab_swiss-mng_new"
REMOTE_PATH="/opt/chess-manager"
PROD_URL="https://chess.zephyr-system.com"
# BatchMode: si SSH quisiera preguntar algo (passphrase, host key nuevo) falla en vez de
# quedarse colgado esperando una terminal que puede no existir.
SSH_OPTS=(-i "$LXC_KEY" -o IdentitiesOnly=yes -o BatchMode=yes -o ConnectTimeout=10)

cd "$REPO_DIR"

echo "==> Verificando rama y estado del checkout"
current_branch="$(git rev-parse --abbrev-ref HEAD)"
if [ "$current_branch" != "main" ]; then
  echo "Este script solo despliega desde 'main' (estás en '$current_branch'). Cambiá de rama y volvé a correrlo." >&2
  exit 1
fi
# Solo frenan los cambios en archivos VERSIONADOS: son los que harían que el build no
# corresponda al commit. Lo no versionado no viaja a producción (más abajo se despliega
# `git archive HEAD` + dist/), así que no hace falta frenar por eso.
# Antes se usaba `git status --porcelain` a secas, que también cuenta lo no versionado, y
# cualquier archivo suelto en el checkout (una carpeta .claude/, un skills-lock.json, una
# nota) cortaba el deploy acá, antes del pull, con un mensaje fácil de pasar por alto:
# varios "ya corrí el deploy" no habían desplegado nada.
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "Hay cambios sin commitear en archivos versionados de $REPO_DIR. Resolvé eso antes de desplegar (git status)." >&2
  exit 1
fi

echo "==> git pull --ff-only"
git pull --ff-only
commit="$(git rev-parse --short HEAD)"
echo "    desplegando $commit"

echo "==> npm ci"
npm ci

echo "==> npm run build"
npm run build

# Se arma una copia limpia con exactamente lo que está commiteado más el build, y es ESO
# lo que se sincroniza. Así nunca viaja nada que no esté en git (los worktrees de .claude/,
# archivos sueltos, un .env local), y el --delete del rsync deja el servidor idéntico a
# esa copia. Antes se sincronizaba el directorio de trabajo entero.
echo "==> Preparando copia limpia para desplegar"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
git archive HEAD | tar -x -C "$STAGE"
cp -a dist "$STAGE/dist"
printf '%s\n' "$commit" > "$STAGE/VERSION"

# Si cambiaron las dependencias hay que reinstalarlas en el servidor ANTES de reiniciar,
# o el servicio arrancaría sin un módulo nuevo. node_modules no se sincroniza (ver el
# --exclude de abajo) y hasta ahora nada lo reinstalaba: cualquier PR que agregara una
# dependencia habría dejado el servicio caído al reiniciar.
echo "==> Comparando dependencias con el servidor"
local_lock="$(sha256sum package-lock.json | cut -d' ' -f1)"
remote_lock="$(ssh "${SSH_OPTS[@]}" "$LXC_HOST" "sha256sum $REMOTE_PATH/package-lock.json 2>/dev/null | cut -d' ' -f1" || true)"
needs_install=0
if [ "$local_lock" != "$remote_lock" ]; then
  needs_install=1
  echo "    el lockfile cambió: se reinstalarán las dependencias en el servidor"
else
  echo "    sin cambios"
fi

# data/ guarda la base de datos y node_modules se instala allá: los dos quedan fuera del
# sync Y protegidos del --delete. .git y .env se protegen por si existen en el servidor.
echo "==> Sincronizando a swiss-mng (172.16.0.23)"
rsync -az --delete \
  --exclude data --exclude node_modules --exclude .git --exclude .env \
  -e "ssh ${SSH_OPTS[*]}" \
  "$STAGE/" "$LXC_HOST:$REMOTE_PATH/"

if [ "$needs_install" = 1 ]; then
  echo "==> npm ci en el servidor"
  ssh "${SSH_OPTS[@]}" "$LXC_HOST" "cd $REMOTE_PATH && npm ci"
fi

echo "==> Reiniciando chess-manager.service"
ssh "${SSH_OPTS[@]}" "$LXC_HOST" \
  "systemctl restart chess-manager && systemctl is-active chess-manager"

# Dos comprobaciones. La primera es la que vale para cambios de backend: que el servidor
# tenga el VERSION del commit recién desplegado. La segunda, que el frontend servido sea
# el recién compilado — que no dice nada si el cambio fue solo de servidor, porque el
# bundle no cambia.
echo "==> Verificando que producción corre $commit"
remote_version="$(ssh "${SSH_OPTS[@]}" "$LXC_HOST" "cat $REMOTE_PATH/VERSION 2>/dev/null" || true)"
if [ "$remote_version" != "$commit" ]; then
  echo "⚠️  El servidor tiene VERSION='${remote_version:-<sin archivo>}' y se esperaba '$commit': el rsync no dejó lo que se compiló." >&2
  exit 1
fi
echo "    VERSION en el servidor: $remote_version"

# El servicio puede tardar unos segundos en atender después del reinicio: se reintenta
# hasta 20 s en vez de fallar a la primera, que daba falsas alarmas con el deploy bien hecho.
local_hash="$(grep -o 'index-[A-Za-z0-9_-]*\.js' dist/index.html || true)"
remote_hash=""
for _ in $(seq 1 10); do
  remote_hash="$(curl -fsS --max-time 5 "$PROD_URL/" 2>/dev/null | grep -o 'index-[A-Za-z0-9_-]*\.js' || true)"
  [ -n "$remote_hash" ] && break
  sleep 2
done

echo "Bundle local:  ${local_hash:-<no encontrado>}"
echo "Bundle remoto: ${remote_hash:-<no encontrado>}"

if [ -n "$local_hash" ] && [ "$local_hash" = "$remote_hash" ]; then
  echo "✅ Producción corre $commit y sirve el build recién generado."
else
  echo "⚠️  El hash remoto NO coincide con el local -- no asumas que el deploy funcionó." >&2
  echo "    Revisá el journalctl del servicio y probá de nuevo antes de dar esto por hecho." >&2
  exit 1
fi
