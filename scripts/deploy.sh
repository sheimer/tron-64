#!/bin/bash
set -e

# Sudoers Configuration on Target Server (/etc/sudoers.d/bitcycles-service or /etc/sudoers.d/hidden):
# <user> ALL=(ALL) NOPASSWD: /usr/bin/systemctl stop bitcycles.service
# <user> ALL=(ALL) NOPASSWD: /usr/bin/systemctl start bitcycles.service
# <user> ALL=(ALL) NOPASSWD: /usr/bin/systemctl status bitcycles.service
# <user> ALL=(ALL) NOPASSWD: /usr/bin/systemctl enable bitcycles.service
# <user> ALL=(ALL) NOPASSWD: /usr/bin/systemctl is-active bitcycles.service
# <user> ALL=(ALL) NOPASSWD: /usr/bin/systemctl daemon-reload
# <user> ALL=(ALL) NOPASSWD: /usr/bin/systemctl stop tron.service
# <user> ALL=(ALL) NOPASSWD: /usr/bin/cp <path>/build/bitcycles.service.resolved /etc/systemd/system/bitcycles.service
# <user> ALL=(ALL) NOPASSWD: /bin/cp <path>/build/bitcycles.service.resolved /etc/systemd/system/bitcycles.service

INFO='\033[0;36m'
ERR='\033[0;31m'
NC='\033[0m' # No Color

# 1. Load .env if present
if [ -f ".env" ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

# 2. Resolve deployment parameters (CLI arguments override .env)
target="${1:-$DEPLOY_TARGET}"
path="${2:-${DEPLOY_PATH:-/srv/tron}}"
port="${3:-${DEPLOY_PORT:-3042}}"
service_user="${DEPLOY_SERVICE_USER:-tron}"
use_fnm="${DEPLOY_USE_FNM:-${USE_FNM:-false}}"

if [ -z "$target" ]; then
  echo -e "${ERR}Error: No deployment target specified.${NC}"
  echo -e "Usage:"
  echo -e "  ./scripts/deploy.sh <target> [path] [port]"
  echo -e "Or create a .env file from .env.example:"
  echo -e "  cp .env.example .env && edit .env"
  exit 1
fi

echo -e "${INFO}*** Deploying Bitcycles to ${target}:${path} (PORT=${port}, USE_FNM=${use_fnm})${NC}"

echo -e "${INFO}*** rsync payload to ${target}:${path}/deploy${NC}"
rsync --delete-after --filter=":e- .gitignore" --filter "- .git/" -v -a . "$target:$path/deploy"

ssh "$target" bash <<EOF
set -e
cd "$path"

# Ensure persistent data directory exists
mkdir -p "$path/data"
mkdir -p run/node_modules

echo -e "${INFO}*** copy deploy to build${NC}"
cp -a deploy build
if [ -d run/node_modules ]; then
  echo -e "${INFO}*** reusing cached node_modules for fast build${NC}"
  cp -a run/node_modules build/
fi

if [ -f "$path/.env" ]; then
  echo -e "${INFO}*** copy persistent $path/.env to build/.env${NC}"
  cp "$path/.env" build/.env
fi

cd build

if [ "$use_fnm" = "true" ] || [ "$use_fnm" = "1" ]; then
  echo -e "${INFO}*** npm install (via fnm)${NC}"
  ~/.local/share/fnm/fnm exec npm install --omit=dev --prefer-offline --no-audit
  service_template="bitcycles-fnm.service"
else
  echo -e "${INFO}*** npm install (system node)${NC}"
  npm install --omit=dev --prefer-offline --no-audit
  service_template="bitcycles.service"
fi
cd ..

# Process and update systemd service if template exists
REMOTE_USER=\$(whoami)
REMOTE_HOME=\$HOME

if [ -f "build/\$service_template" ]; then
  echo -e "${INFO}*** resolving \$service_template placeholders${NC}"
  sed -e "s|__PATH__|$path|g" \
      -e "s|__SERVICE_USER__|$service_user|g" \
      -e "s|__USER__|\$REMOTE_USER|g" \
      -e "s|__HOME__|\$REMOTE_HOME|g" \
      -e "s|__PORT__|$port|g" \
      "build/\$service_template" > build/bitcycles.service.resolved

  if [ ! -f "/etc/systemd/system/bitcycles.service" ] || ! cmp -s build/bitcycles.service.resolved /etc/systemd/system/bitcycles.service; then
    echo -e "${INFO}*** updating /etc/systemd/system/bitcycles.service${NC}"
    sudo cp "$path/build/bitcycles.service.resolved" /etc/systemd/system/bitcycles.service
    sudo systemctl daemon-reload
    sudo systemctl enable bitcycles.service
  fi
fi

echo -e "${INFO}*** restart service${NC}"
# Stop legacy tron.service if it exists
sudo systemctl stop tron.service 2>/dev/null || true
sudo systemctl stop bitcycles.service || true

rm -rf run
mv build run

sudo systemctl start bitcycles.service

if sudo systemctl is-active --quiet bitcycles.service; then
  echo -e "${INFO}*** bitcycles.service is active and running!${NC}"
fi

echo -e "${INFO}*** deploy completed successfully${NC}"
EOF
