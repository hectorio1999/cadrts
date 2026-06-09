# Building Claude Agent Desktop for macOS (.dmg / .app)

Two paths. Pick whichever has less friction for you.

---

## Path A — local build on the Mac (fastest first time)

Prereqs:

```bash
# Rust toolchain
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
# Node + the Claude Code CLI for the auth model
brew install node
npm install -g @anthropic-ai/claude-code
# Sign in once so the Tauri 'Local' transport has credentials to fall back on
claude login
```

Build:

```bash
git clone <your-repo> claude-agent-desktop  # or scp the folder
cd claude-agent-desktop

# 1. Install JS deps
npm install

# 2. Build the React shell + the Tauri app together
npm run build
```

Output lands at `src-tauri/target/release/bundle/`:

```
bundle/
├── dmg/
│   └── Claude Agent Desktop_0.1.0_aarch64.dmg     ← drag this to a friend
├── macos/
│   └── Claude Agent Desktop.app/                  ← ditto, .app bundle
```

Cross-arch builds (build arm64 from Intel, or vice-versa):

```bash
rustup target add aarch64-apple-darwin
npm run tauri build -- --target aarch64-apple-darwin
# or x86_64-apple-darwin for Intel Macs
```

On the first run macOS will block the unsigned `.dmg` with the "this app
is from an unidentified developer" warning. Right-click → Open → Open
once and macOS remembers your trust forever after. To skip that
permanently, sign + notarise (see Path B's CI flow which does it
automatically when the secrets are configured).

---

## Path B — GitHub Actions, multi-platform (set-and-forget)

Push the repo to GitHub. The workflow at
`.github/workflows/desktop-release.yml` builds **`macos-arm64`,
`macos-x64`, `windows-x64`, and `linux-x64`** in parallel on the
matching runners.

To produce signed `.dmg` files for macOS — and skip the "unidentified
developer" warning entirely — add these repo secrets at
**Settings → Secrets and variables → Actions**:

| Secret name                  | What it is                                                       |
|------------------------------|------------------------------------------------------------------|
| `APPLE_CERTIFICATE`          | base64-encoded `.p12` of your Developer ID Application certificate (`base64 -i cert.p12 \| pbcopy`) |
| `APPLE_CERTIFICATE_PASSWORD` | The `.p12`'s export password                                     |
| `APPLE_SIGNING_IDENTITY`     | `Developer ID Application: Hector Rosario (TEAMID)`              |
| `APPLE_ID`                   | Your Apple ID email                                              |
| `APPLE_PASSWORD`             | An **app-specific password** generated at appleid.apple.com — not your real password |
| `APPLE_TEAM_ID`              | 10-character team ID from developer.apple.com → Membership       |

If you skip the secrets entirely, the workflow still runs and produces
**unsigned** `.dmg` files; they work fine for personal use, just need the
right-click → Open dance once.

Trigger paths:

- **Tagged release** — `git tag v0.1.0 && git push --tags` → creates a
  draft GitHub Release with all four bundle artefacts attached.
- **Manual** — `Actions → desktop-release → Run workflow` → artefacts
  appear under the run page for 14 days, no release made.

---

## Path C — quick + dirty Apple Silicon DMG without CI

If you don't have a Mac handy and just need *something*, the
`tauri-action` CLI can produce a `.dmg` on macOS using a free Apple ID
without notarisation, but the resulting `.dmg` still triggers Gatekeeper
warnings. Either of paths A or B is genuinely easier.

---

## What the user sees

After install, the same React app runs. The Settings → Remote toggle lets
the Mac client point at `https://agent.rosariotechsolutions.com` with the
bearer token. From the Mac's perspective, everything routes through the
LXC server just like the Windows and browser clients.

The **UpdateBadge** lives in the bottom-right corner. On Mac/Tauri the
"Update now" button currently tells you to restart the desktop app — a
proper `tauri-plugin-updater` integration (downloads a signed update
bundle from a static URL) is a follow-up. The badge logic itself is the
hard part and is already wired; auto-installing the new build is just a
plugin away.
