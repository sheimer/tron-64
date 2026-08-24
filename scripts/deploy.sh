#!/bin/bash
set -e

# Sudoers Configuration on Target Server (/etc/sudoers.d/tron-service):
# <user> ALL=(ALL) NOPASSWD: /usr/bin/systemctl stop tron.service
# <user> ALL=(ALL) NOPASSWD: /usr/bin/systemctl start tron.service
# <user> ALL=(ALL) NOPASSWD: /usr/bin/systemctl status tron.service
# <user> ALL=(ALL) NOPASSWD: /usr/bin/systemctl daemon-reload
# <user> ALL=(ALL) NOPASSWD: /usr/bin/cp <path>/build/tron.service.resolved /etc/systemd/system/tron.service
# <user> ALL=(ALL) NOPASSWD: /bin/cp <path>/build/tron.service.resolved /etc/systemd/system/tron.service

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
path="${2:-$DEPLOY_PATH}"
port="${3:-${DEPLOY_PORT:-3042}}"

if [ -z "$target" ]; then
  echo -e "${ERR}Error: No deployment target specified.${NC}"
  echo -e "Usage:"
  echo -e "  ./scripts/deploy.sh <target> [path] [port]"
  echo -e "Or create a .env file from .env.example:"
  echo -e "  cp .env.example .env && edit .env"
  exit 1
fi

if [ -z "$path" ]; then
  path="/srv/tron"
fi

echo -e "${INFO}*** Deploying Tron to ${target}:${path} (PORT=${port})${NC}"

echo -e "${INFO}*** rsync${NC}"
rsync --delete-after --filter=":e- .gitignore" --filter "- .git/" -v -a . "$target:$path/deploy"

ssh "$target" bash <<EOF
set -e
cd "$path"

# Ensure persistent data directory exists
mkdir -p "$path/data"
mkdir -p run/node_modules

echo -e "${INFO}*** copy deploy to build${NC}"
cp -a deploy build
echo -e "${INFO}*** copy node_modules to build${NC}"
cp -a run/node_modules build/

if [ -f "$path/.env" ]; then
  echo -e "${INFO}*** copy persistent $path/.env to build/.env${NC}"
  cp "$path/.env" build/.env
fi

cd build

echo -e "${INFO}*** npm install${NC}"
~/.local/share/fnm/fnm exec npm install
cd ..

# Process and update systemd service if changed
REMOTE_USER=\$(whoami)
REMOTE_HOME=\$HOME

if [ -f "build/tron.service" ]; then
  echo -e "${INFO}*** resolving tron.service placeholders${NC}"
  sed -e "s|__PATH__|$path|g" \
      -e "s|__USER__|\$REMOTE_USER|g" \
      -e "s|__HOME__|\$REMOTE_HOME|g" \
      -e "s|__PORT__|$port|g" \
      build/tron.service > build/tron.service.resolved

  if [ ! -f "/etc/systemd/system/tron.service" ] || ! cmp -s build/tron.service.resolved /etc/systemd/system/tron.service; then
    echo -e "${INFO}*** updating /etc/systemd/system/tron.service${NC}"
    sudo cp "$path/build/tron.service.resolved" /etc/systemd/system/tron.service
    sudo systemctl daemon-reload
  fi
fi

echo -e "${INFO}*** restart service${NC}"
sudo systemctl stop tron.service
rm -rf run
mv build run
sudo systemctl start tron.service

echo -e "${INFO}*** deploy completed successfully${NC}"
EOF
