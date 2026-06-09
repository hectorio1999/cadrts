# Deploying `agent-server` to an LXC

This is the Hermes-style topology: one **agent-server** running headless in
an LXC on Proxmox, exposed via a Cloudflare tunnel; every desktop client
on every machine (laptop, Mac, work box) connects to that one server with
**Local ↔ Remote** toggled in Settings.

The model is **bring-your-own-credentials**: each client uploads its own
`~/.claude/.credentials.json` per turn. The server never persists them — it
writes them into a per-turn temp HOME directory that's deleted as soon as
the child exits. N concurrent turns = N isolated HOMEs.

## 1. Create the LXC on Proxmox

In the Proxmox UI, **Create CT** with:

| Field          | Value                          |
|----------------|--------------------------------|
| Hostname       | `rts-agentdesktop`             |
| Template       | Debian 12 standard (or Ubuntu 22.04+) |
| Disk           | 8 GB                           |
| CPU            | 2 cores                        |
| RAM            | 2048 MB                        |
| Network        | DHCP on your normal bridge     |
| Unprivileged   | Yes                            |
| Features       | `nesting=1` (so npm install works) |

Boot it, note the IP it picked up.

## 2. Get the source onto the LXC

Pick one:

**a. scp the tree from your laptop** (no git remote needed):
```powershell
# From your laptop
scp -r "$env:USERPROFILE\Desktop\claude-agent-desktop" root@<lxc-ip>:/opt/cad
```

**b. Clone via git** (when you push this to a repo):
```bash
# On the LXC
git clone https://github.com/your-org/claude-agent-desktop /opt/cad
```

## 3. Run the bootstrap

SSH in as root:

```bash
ssh root@<lxc-ip>
bash /opt/cad/scripts/lxc-bootstrap.sh
```

That script:

1. Installs Node 20, the `@anthropic-ai/claude-code` CLI, Rust toolchain
2. Creates a service user `cad` with linger enabled (survives reboot)
3. Builds `agent-server` in release mode (~5 min the first time)
4. Generates a random 48-char `CAD_SERVER_TOKEN` and writes
   `/etc/cad/server.env` (mode 640)
5. Installs a hardened systemd user unit (`NoNewPrivileges`, read-only home,
   private /tmp, only the agent's state dir is writable)
6. Enables + starts it
7. Prints the bearer token and the URL to put into the Tauri client

Example final output:

```
============================================================
  agent-server is live
============================================================
  LXC IP        : 10.0.0.170
  bind          : 0.0.0.0:9120
  health        : {"ok":true,"version":"0.1.0"}
  systemd       : systemctl --user -M cad@ status cad-server
  journal       : journalctl --user-unit=cad-server -M cad@ -f

In the Tauri desktop app, Settings → Remote:
  Server URL    : http://10.0.0.170:9120
  Bearer token  : f3K8q2P-7…48-chars-of-randomness
```

## 4. Configure Cloudflare tunnel

This is the same pattern Hermes uses — the `httpHostHeader: localhost`
rewrite is what keeps the loopback-only Bearer gate active and stops the
dashboard's host-header check from forcing the OAuth path.

In the Cloudflare Zero Trust UI → Tunnels → existing tunnel → Public Hostnames
→ Add:

| Field           | Value                                                 |
|-----------------|-------------------------------------------------------|
| Subdomain       | `agent`                                               |
| Domain          | `rosariotechsolutions.com`                            |
| Service         | HTTP                                                  |
| URL             | `10.0.0.170:9120`                                     |
| TLS / origin    | **Additional application settings → HTTP Settings →** |
|                 | **HTTP Host Header: `localhost`**                     |

Verify from your laptop:
```powershell
curl -s https://agent.rosariotechsolutions.com/api/health
# → {"ok":true,"version":"0.1.0"}
```

**Do NOT put Cloudflare Access in front of this hostname** — the desktop
client can't satisfy the CF Access cookie, exactly the same trap as Hermes.

## 5. Point clients at it

On every machine you want to use the agent from:

1. Open Claude Agent Desktop
2. Sidebar → **⚙ settings (transport)** (or `Cmd+K` → "Settings — transport")
3. Pick **Remote agent-server**
4. Server URL: `https://agent.rosariotechsolutions.com`
5. Bearer token: paste the value the bootstrap printed
6. Click **test connection** — you should see "connection ok"
7. **Save**

That's it. Every turn you send from now on goes through the server. Your
local `claude login` credentials are read per-turn, uploaded to the server,
isolated in a temp HOME, used to authenticate the child claude.exe, and
deleted when the turn ends.

## Operating the server

| Want to                              | Run                                                                      |
|--------------------------------------|---------------------------------------------------------------------------|
| See status                           | `ssh root@lxc 'systemctl --user -M cad@ status cad-server'`              |
| Tail logs                            | `journalctl --user-unit=cad-server -M cad@ -f`                            |
| Restart after editing the env file   | `systemctl --user -M cad@ restart cad-server`                             |
| Update the binary (`git pull` + build)| `cd /opt/cad && git pull && sudo -u cad cargo build --release -p agent-server && systemctl --user -M cad@ restart cad-server` |
| Rotate the bearer token              | edit `/etc/cad/server.env`, restart the service, update each client      |

## Threat model summary

| Surface                | Mitigation                                                            |
|------------------------|------------------------------------------------------------------------|
| Server access          | Bearer token (48 random chars). Constant-time-ish compare              |
| OAuth tokens at rest   | Never written. Per-turn upload, written to 0600 file in per-turn `/tmp/cad-<uuid>/`, deleted on turn exit. systemd `PrivateTmp=yes` namespaces this |
| Pay-per-token billing  | `CliTransport` scrubs `ANTHROPIC_API_KEY`/`CLAUDE_API_KEY` from child env. All turns ride OAuth |
| Tool blast radius      | `cwd` defaults to the server user's home; that user has read-only access to `/` and rw only to `~/.cad` + `/tmp`. systemd `ProtectHome=read-only` enforces this |
| Network egress         | Whatever the LXC can reach. Use Proxmox firewall to restrict if needed  |
| Cloudflare tunnel      | `httpHostHeader: localhost` keeps the local Bearer gate active          |
