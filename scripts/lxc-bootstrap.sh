#!/usr/bin/env bash
# Bootstrap an agent-server LXC.
#
# Run AS root on a freshly-created Debian 12 (or Ubuntu 22.04+) LXC.
# Idempotent: re-running it just upgrades + redeploys.
#
# What it does:
#   1. Installs system deps (curl, git, build-essential, libsqlite3-dev, ca-certs)
#   2. Installs Node.js 20 + @anthropic-ai/claude-code globally
#   3. Creates a 'cad' service user (no shell login) with linger enabled
#   4. Installs Rust via rustup under that user
#   5. Clones / pulls the project into /opt/cad
#   6. Builds the agent-server release binary
#   7. Generates a CAD_SERVER_TOKEN if one isn't already on disk
#   8. Writes a systemd user unit and enables it
#   9. Prints the token + the URL the desktop client should point at
#
# Usage:
#   curl -fsSL https://your.host/lxc-bootstrap.sh | sudo bash
# OR  (after copying the repo over manually):
#   sudo bash scripts/lxc-bootstrap.sh
#
# Env overrides:
#   REPO_URL=...   (default: empty; if set, git clone instead of expecting /opt/cad)
#   REPO_REF=main  (branch / tag to check out)
#   BIND_ADDR=0.0.0.0:9120
#   USER_NAME=cad

set -euo pipefail

USER_NAME="${USER_NAME:-cad}"
INSTALL_DIR="${INSTALL_DIR:-/opt/cad}"
BIND_ADDR="${BIND_ADDR:-0.0.0.0:9120}"
ENV_FILE="/etc/cad/server.env"
SERVICE_NAME="cad-server"

step() { printf "\n\033[1;34m▶ %s\033[0m\n" "$*"; }
ok()   { printf "  \033[32m✓\033[0m %s\n" "$*"; }
warn() { printf "  \033[33m!\033[0m %s\n" "$*"; }

if [[ $EUID -ne 0 ]]; then
  echo "Run as root."; exit 1
fi

# ---------- 1. system deps ----------
step "Installing system dependencies"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y --no-install-recommends \
    ca-certificates curl git build-essential pkg-config \
    libsqlite3-dev libssl-dev sudo gnupg locales >/dev/null
locale-gen en_US.UTF-8 >/dev/null 2>&1 || true
ok "apt deps installed"

# ---------- 2. node + claude CLI ----------
if ! command -v node >/dev/null; then
  step "Installing Node.js 20"
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null
  apt-get install -y nodejs >/dev/null
  ok "node $(node -v)"
fi

if ! command -v claude >/dev/null; then
  step "Installing @anthropic-ai/claude-code globally"
  npm install -g @anthropic-ai/claude-code >/dev/null
  ok "claude $(claude --version)"
else
  ok "claude already installed: $(claude --version)"
fi

# ---------- 3. service user + linger ----------
if ! id -u "$USER_NAME" >/dev/null 2>&1; then
  step "Creating service user '$USER_NAME'"
  useradd -m -s /usr/sbin/nologin "$USER_NAME"
  ok "user created"
fi
loginctl enable-linger "$USER_NAME" >/dev/null
ok "linger enabled for $USER_NAME"

# ---------- 4. rust ----------
HOME_DIR="$(getent passwd "$USER_NAME" | cut -d: -f6)"
if [[ ! -x "$HOME_DIR/.cargo/bin/cargo" ]]; then
  step "Installing Rust under $USER_NAME"
  sudo -u "$USER_NAME" -H bash -c \
    "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable --profile minimal" >/dev/null
fi
ok "cargo $(sudo -u "$USER_NAME" -H "$HOME_DIR/.cargo/bin/cargo" --version | awk '{print $2}')"

# ---------- 5. clone / refresh source ----------
if [[ ! -d "$INSTALL_DIR" ]]; then
  if [[ -z "${REPO_URL:-}" ]]; then
    echo
    echo "Source tree not at $INSTALL_DIR and REPO_URL is unset."
    echo "Either:  scp -r claude-agent-desktop/ root@<lxc>:$INSTALL_DIR"
    echo "    or:  REPO_URL=https://… bash scripts/lxc-bootstrap.sh"
    exit 1
  fi
  step "Cloning $REPO_URL into $INSTALL_DIR"
  git clone --depth 1 --branch "${REPO_REF:-main}" "$REPO_URL" "$INSTALL_DIR"
fi
chown -R "$USER_NAME:$USER_NAME" "$INSTALL_DIR"
ok "source at $INSTALL_DIR"

# ---------- 6. build ----------
step "Building agent-server (release) — first time can take ~5 min"
sudo -u "$USER_NAME" -H bash -c \
  "cd '$INSTALL_DIR' && \"$HOME_DIR/.cargo/bin/cargo\" build --release -p agent-server" \
  2>&1 | tail -5
BIN="$INSTALL_DIR/target/release/agent-server"
[[ -x "$BIN" ]] || { echo "build failed: $BIN missing"; exit 1; }
ok "binary built: $BIN"

# ---------- 7. env file ----------
mkdir -p "$(dirname "$ENV_FILE")"
chmod 750 "$(dirname "$ENV_FILE")"
chgrp "$USER_NAME" "$(dirname "$ENV_FILE")"
if [[ ! -f "$ENV_FILE" ]]; then
  step "Generating CAD_SERVER_TOKEN"
  TOKEN="$(head -c 48 /dev/urandom | base64 | tr -dc A-Za-z0-9 | head -c 48)"
  cat >"$ENV_FILE" <<EOF
# Bearer-token gate for agent-server. Clients pass this as
# 'Authorization: Bearer <token>'. Rotate by editing this file
# and: systemctl --user -M $USER_NAME@ restart $SERVICE_NAME
CAD_SERVER_TOKEN=$TOKEN
CAD_SERVER_BIND=$BIND_ADDR
CAD_HOME=$HOME_DIR/.cad
RUST_LOG=info,agent_server=info
EOF
  chmod 640 "$ENV_FILE"
  chgrp "$USER_NAME" "$ENV_FILE"
  ok "token written to $ENV_FILE (mode 640)"
else
  TOKEN="$(grep -E '^CAD_SERVER_TOKEN=' "$ENV_FILE" | cut -d= -f2-)"
  ok "reusing existing token in $ENV_FILE"
fi

# ---------- 8. systemd user unit ----------
UNIT_DIR="$HOME_DIR/.config/systemd/user"
UNIT_PATH="$UNIT_DIR/$SERVICE_NAME.service"
sudo -u "$USER_NAME" -H mkdir -p "$UNIT_DIR"
sudo -u "$USER_NAME" -H tee "$UNIT_PATH" >/dev/null <<EOF
[Unit]
Description=Claude Agent Desktop — headless agent-server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
EnvironmentFile=$ENV_FILE
ExecStart=$BIN
Restart=always
RestartSec=3
# Hardening: server only ever reads its own state dir + spawns claude
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=$HOME_DIR/.cad /tmp
PrivateTmp=yes

[Install]
WantedBy=default.target
EOF
chown "$USER_NAME:$USER_NAME" "$UNIT_PATH"
ok "wrote $UNIT_PATH"

sudo -u "$USER_NAME" -H \
  XDG_RUNTIME_DIR="/run/user/$(id -u "$USER_NAME")" \
  systemctl --user daemon-reload
sudo -u "$USER_NAME" -H \
  XDG_RUNTIME_DIR="/run/user/$(id -u "$USER_NAME")" \
  systemctl --user enable --now "$SERVICE_NAME" >/dev/null
ok "service enabled & started"

# ---------- 9. report ----------
IP="$(ip -4 -o addr show scope global 2>/dev/null | awk '{print $4}' | cut -d/ -f1 | head -1)"
sleep 1
HEALTH="$(curl -fsS "http://127.0.0.1:${BIND_ADDR##*:}/api/health" || true)"

cat <<EOF

============================================================
  agent-server is live
============================================================
  LXC IP        : $IP
  bind          : $BIND_ADDR
  state dir     : $HOME_DIR/.cad
  health        : $HEALTH
  systemd       : systemctl --user -M ${USER_NAME}@ status ${SERVICE_NAME}
  journal       : journalctl --user-unit=${SERVICE_NAME} -M ${USER_NAME}@ -f

In the Tauri desktop app, Settings → Remote:
  Server URL    : http://${IP}:${BIND_ADDR##*:}
                  (or your Cloudflare tunnel hostname)
  Bearer token  : ${TOKEN}

Next steps:
  - Configure your Cloudflare tunnel:
      ingress:
        - hostname: agent.rosariotechsolutions.com
          service:  http://${IP}:${BIND_ADDR##*:}
          originRequest: { httpHostHeader: localhost }
  - Open the Tauri app on each client machine, Settings → Remote,
    paste the URL + token above, click Test connection.

EOF
