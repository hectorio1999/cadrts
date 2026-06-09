#!/usr/bin/env bash
# Pull the latest from GitHub on the LXC, rebuild the server, update the
# baked build commit, restart the service. Idempotent — safe to re-run.
#
# Run as `cad` (the service user) or as root from any account that can
# `sudo -u cad` and edit /etc/cad/server.env. From a laptop, this is the
# one-liner remote deploy:
#
#   ssh root@<lxc-ip> bash /opt/cad/scripts/deploy-lxc.sh
#
# Or, more usefully, set up an alias on the laptop:
#
#   alias caddeploy='ssh root@10.0.0.84 bash /opt/cad/scripts/deploy-lxc.sh'
#
# What happens:
#   1. Pull origin/main into /opt/cad
#   2. (Re)build the web bundle if Vite is present, copy to /opt/cad/dist
#   3. Cargo release build of agent-server
#   4. Write the new commit SHA into /etc/cad/server.env as CAD_BUILD_COMMIT
#   5. Restart cad-server
#   6. Report the new /api/version

set -euo pipefail
DIR=/opt/cad
USER_NAME=cad

step() { printf "\n\033[1;34m▶ %s\033[0m\n" "$*"; }
ok()   { printf "  \033[32m✓\033[0m %s\n" "$*"; }
warn() { printf "  \033[33m!\033[0m %s\n" "$*"; }

cd "$DIR"
BEFORE=$(sudo -u "$USER_NAME" git rev-parse HEAD)

step "Pulling origin/main"
sudo -u "$USER_NAME" git fetch origin --depth=50
sudo -u "$USER_NAME" git reset --hard origin/main
AFTER=$(sudo -u "$USER_NAME" git rev-parse HEAD)
if [ "$BEFORE" = "$AFTER" ]; then
  ok "already at $AFTER (no new commits)"
else
  ok "pulled $BEFORE..$AFTER"
  sudo -u "$USER_NAME" git --no-pager log --oneline "$BEFORE..$AFTER" || true
fi

# Web bundle. We rebuild it on the LXC if Node/npm are available (they are
# from the bootstrap). The compiled dist/ lives next to the source tree.
if command -v npm >/dev/null && [ -f "$DIR/package.json" ]; then
  step "Rebuilding the React web bundle"
  if [ ! -d "$DIR/node_modules" ]; then
    sudo -u "$USER_NAME" npm install
  fi
  sudo -u "$USER_NAME" npm run build:web
  ok "dist/ rebuilt"
fi

step "Cargo build (release) -p agent-server"
sudo -u "$USER_NAME" bash -c \
  "cd '$DIR' && PATH=\"\$HOME/.cargo/bin:\$PATH\" cargo build --release -p agent-server" \
  | tail -3
ok "binary built"

step "Updating /etc/cad/server.env CAD_BUILD_COMMIT=$AFTER"
sed -i "s|^CAD_BUILD_COMMIT=.*|CAD_BUILD_COMMIT=$AFTER|" /etc/cad/server.env
grep BUILD_COMMIT /etc/cad/server.env

step "Restarting cad-server"
sudo -u "$USER_NAME" XDG_RUNTIME_DIR="/run/user/$(id -u "$USER_NAME")" \
  systemctl --user restart cad-server
sleep 2
STATUS=$(sudo -u "$USER_NAME" XDG_RUNTIME_DIR="/run/user/$(id -u "$USER_NAME")" \
  systemctl --user is-active cad-server)
ok "service: $STATUS"

step "Verifying /api/version"
curl -fsS http://127.0.0.1:9120/api/version | sed 's/,/,\n  /g'
echo
ok "deploy complete · HEAD=$AFTER"
