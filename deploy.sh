#!/usr/bin/env bash
# Despliega main a producción (LXC 102 "swiss-mng") en un solo paso: build, rsync,
# reinicio del servicio y verificación real (compara el hash del bundle que se acaba
# de compilar contra el que producción efectivamente sirve, no solo un curl a /api).
#
# Uso: ejecutar desde el checkout principal (~/Documents/Claude/chess-manager), en main:
#   ./deploy.sh
#
# Requiere: estar en la rama main, sin cambios sin commitear, y la clave dedicada
# ~/.ssh/id_ed25519_homelab_swiss-mng_new (ver README.md y CLAUDE.md del homelab).
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LXC_HOST="root@172.16.0.23"
LXC_KEY="$HOME/.ssh/id_ed25519_homelab_swiss-mng_new"
REMOTE_PATH="/opt/chess-manager"
PROD_URL="https://chess.zephyr-system.com"

cd "$REPO_DIR"

echo "==> Verificando rama y estado del checkout"
current_branch="$(git rev-parse --abbrev-ref HEAD)"
if [ "$current_branch" != "main" ]; then
  echo "Este script solo despliega desde 'main' (estás en '$current_branch'). Cambiá de rama y volvé a correrlo." >&2
  exit 1
fi
if [ -n "$(git status --porcelain)" ]; then
  echo "Hay cambios sin commitear en $REPO_DIR. Resolvé eso antes de desplegar (git status)." >&2
  exit 1
fi

echo "==> git pull --ff-only"
git pull --ff-only

echo "==> npm ci"
npm ci

echo "==> npm run build"
npm run build

echo "==> Sincronizando a swiss-mng (172.16.0.23)"
rsync -az --delete --exclude data --exclude .git --exclude node_modules \
  -e "ssh -i $LXC_KEY -o IdentitiesOnly=yes" \
  "$REPO_DIR/" "$LXC_HOST:$REMOTE_PATH/"

echo "==> Reiniciando chess-manager.service"
ssh -i "$LXC_KEY" -o IdentitiesOnly=yes "$LXC_HOST" \
  "systemctl restart chess-manager && systemctl is-active chess-manager"

echo "==> Verificando que producción sirve exactamente lo que se acaba de compilar"
sleep 2
local_hash="$(grep -o 'index-[A-Za-z0-9_-]*\.js' dist/index.html || true)"
remote_html="$(curl -fsS "$PROD_URL/" || true)"
remote_hash="$(printf '%s' "$remote_html" | grep -o 'index-[A-Za-z0-9_-]*\.js' || true)"

echo "Bundle local:  ${local_hash:-<no encontrado>}"
echo "Bundle remoto: ${remote_hash:-<no encontrado>}"

if [ -n "$local_hash" ] && [ "$local_hash" = "$remote_hash" ]; then
  echo "✅ Producción sirve el build recién generado."
else
  echo "⚠️  El hash remoto NO coincide con el local -- no asumas que el deploy funcionó." >&2
  echo "    Revisá el journalctl del servicio y probá de nuevo antes de dar esto por hecho." >&2
  exit 1
fi
