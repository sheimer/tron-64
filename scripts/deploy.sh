#!/bin/bash
set -e

# Sudoers Configuration on Target Server (/etc/sudoers.d/bitcycles-service or /etc/sudoers.d/<user>):
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
SUCCESS='\033[0;32m'
ERR='\033[0;31m'
NC='\033[0m' # No Color

# 1. Load .env if present
if [ -f ".env" ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

deploy_host() {
  local target="$1"
  local path="${2:-${DEPLOY_PATH:-/srv/tron}}"
  local port="${3:-${DEPLOY_PORT:-3000}}"
  local service_user="${4:-${DEPLOY_SERVICE_USER:-tron}}"
  local use_fnm="${5:-${DEPLOY_USE_FNM:-${USE_FNM:-false}}}"
  local profile="${6:-default}"

  if [ -z "$target" ]; then
    echo -e "${ERR}Error: Target is empty for profile '${profile}'.${NC}"
    return 1
  fi

  echo
  echo -e "${INFO}======================================================${NC}"
  echo -e "${INFO}   Deploying Bitcycles [Profile: ${profile}]${NC}"
  echo -e "${INFO}   Target:       ${target}:${path}${NC}"
  echo -e "${INFO}   Port:         ${port}${NC}"
  echo -e "${INFO}   Service User: ${service_user}${NC}"
  echo -e "${INFO}   Runtime:      $([ "$use_fnm" = "true" ] || [ "$use_fnm" = "1" ] && echo "FNM" || echo "System Node")${NC}"
  echo -e "${INFO}======================================================${NC}"

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
sudo systemctl stop bitcycles.service || true

rm -rf run
mv build run

sudo systemctl start bitcycles.service

if systemctl is-active --quiet bitcycles.service; then
  echo -e "${SUCCESS}*** bitcycles.service is active and running on ${target}!${NC}"
fi

echo -e "${SUCCESS}*** deploy to ${target} completed successfully${NC}"
EOF
}

# 2. Resolve target profiles or CLI arguments
arg_target="$1"

get_profile_targets() {
  local list="${DEPLOY_TARGETS:-}"
  echo "$list" | tr ',' ' '
}

deploy_profile() {
  local prof="$1"
  local upper
  upper=$(echo "$prof" | tr '[:lower:]' '[:upper:]' | tr '-' '_')

  local t_var="DEPLOY_${upper}_TARGET"
  local p_var="DEPLOY_${upper}_PATH"
  local port_var="DEPLOY_${upper}_PORT"
  local u_var="DEPLOY_${upper}_SERVICE_USER"
  local fnm_var="DEPLOY_${upper}_USE_FNM"

  local target="${!t_var:-$DEPLOY_TARGET}"
  local path="${!p_var:-${DEPLOY_PATH:-/srv/tron}}"
  local port="${!port_var:-${DEPLOY_PORT:-3000}}"
  local service_user="${!u_var:-${DEPLOY_SERVICE_USER:-tron}}"
  local use_fnm="${!fnm_var:-${DEPLOY_USE_FNM:-${USE_FNM:-false}}}"

  deploy_host "$target" "$path" "$port" "$service_user" "$use_fnm" "$prof"
}

# Case A: Deploy to all configured profiles (or single default)
if [ -z "$arg_target" ] || [ "$arg_target" = "all" ]; then
  profile_list=$(get_profile_targets)
  if [ -n "$profile_list" ]; then
    echo -e "${INFO}Deploying to all configured profiles: ${profile_list}${NC}"
    for prof in $profile_list; do
      deploy_profile "$prof"
    done
    echo -e "\n${SUCCESS}All multi-target deployments completed successfully!${NC}"
  elif [ -n "$DEPLOY_TARGET" ]; then
    deploy_host "$DEPLOY_TARGET" "${DEPLOY_PATH:-/srv/tron}" "${DEPLOY_PORT:-3000}" "${DEPLOY_SERVICE_USER:-tron}" "${DEPLOY_USE_FNM:-${USE_FNM:-false}}" "default"
  else
    echo -e "${ERR}Error: No deployment target specified.${NC}"
    echo -e "Usage:"
    echo -e "  ./scripts/deploy.sh [profile | all | <user@host>] [path] [port]"
    echo -e "Or create/edit .env from .env.example with DEPLOY_TARGET or DEPLOY_TARGETS"
    exit 1
  fi

# Case B: Profile name specified (e.g. ./scripts/deploy.sh primary)
elif [ -n "$(eval echo "\${DEPLOY_$(echo "$arg_target" | tr '[:lower:]' '[:upper:]' | tr '-' '_')_TARGET:-}")" ]; then
  deploy_profile "$arg_target"

# Case C: Ad-hoc host specified (e.g. ./scripts/deploy.sh user@host /srv/tron 3042)
else
  deploy_host "$arg_target" "${2:-${DEPLOY_PATH:-/srv/tron}}" "${3:-${DEPLOY_PORT:-3000}}" "${DEPLOY_SERVICE_USER:-tron}" "${DEPLOY_USE_FNM:-${USE_FNM:-false}}" "adhoc"
fi
