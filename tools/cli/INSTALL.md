# Installing MAMMOTH

MAMMOTH deploys 9 autonomous AI departments that work to hit your revenue goal.
This guide covers installation for non-technical users.

---

## One-liner install

### Mac / Linux

```bash
curl -fsSL https://mammoth.run/install.sh | bash
```

What it does:
- Installs Node.js (if missing)
- Installs OrbStack on Mac or Docker Engine on Linux (for local mode)
- Installs the `mammoth` CLI globally via npm
- Runs `mammoth init` to guide you through setup

### Windows (PowerShell)

```powershell
irm https://mammoth.run/install.ps1 | iex
```

What it does:
- Installs Node.js 20 LTS via winget
- Enables WSL2 and installs Docker Desktop
- Installs `mammoth` CLI
- Runs `mammoth init`

---

## Manual install (if you already have Node.js 20+)

```bash
npm install -g mammoth
mammoth init
```

---

## Setup modes

During `mammoth init` you pick one mode. You can change it later with `mammoth init --cloud` or `mammoth init --local`.

### Cloud mode (recommended — no Docker)

Uses free cloud services. Takes 3 minutes. No Docker needed.

You will need accounts at:
- **Neon** — free Postgres database → neon.tech/signup
- **Upstash** — free Redis → console.upstash.com
- **Qdrant Cloud** — optional vector memory → cloud.qdrant.io

MAMMOTH guides you through each step interactively.

### Local mode (Docker required)

Everything runs on your machine. Requires Docker Desktop or OrbStack.

MAMMOTH starts Postgres, Redis, Qdrant, and MinIO containers automatically.

---

## After setup

```bash
mammoth status          # show infrastructure state
mammoth approve list    # review pending AI actions
mammoth trigger sales   # manually fire the sales agent
mammoth doctor          # run health checks
mammoth logs            # tail service logs
```

Dashboard: http://localhost:3000

---

## Commands

| Command | What it does |
|---|---|
| `mammoth init` | First-time setup |
| `mammoth init --cloud` | Re-run setup in cloud mode |
| `mammoth init --local` | Re-run setup in local mode |
| `mammoth start` | Start local Docker services |
| `mammoth stop` | Stop local Docker services |
| `mammoth restart` | Restart local Docker services |
| `mammoth status` | Show infrastructure + auth + companies |
| `mammoth logs [service]` | Tail service logs |
| `mammoth approve list` | List pending approvals |
| `mammoth approve resolve` | Approve / reject / modify an action |
| `mammoth trigger [dept]` | Trigger an agent run |
| `mammoth upgrade` | Pull latest images, run migrations |
| `mammoth doctor` | Health checks |
| `mammoth auth login` | Sign in |
| `mammoth auth logout` | Sign out |
| `mammoth auth status` | Show auth state |
| `mammoth config show` | Print current config |

---

## Uninstall

```bash
npm uninstall -g mammoth
rm -rf ~/.mammoth
```

This removes the CLI and all credentials. Does not affect Neon/Upstash accounts.
