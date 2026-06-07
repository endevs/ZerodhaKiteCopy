# Deploy — ZerodhaKiteGit (Docker)

Flask-SocketIO backend + CRA frontend. **Compose project name:** `zerodhakite` (isolated from other apps on the same host).

## Ports (do not collide with other stacks)

| App | Host | Backend (internal) |
|-----|------|-------------------|
| AstrologyDRP | 5173 / 8001 | 8001 |
| AI_toolsDRP | 5174 | 8002 |
| **This app** | **5175** → Nginx **80** | **8003** on **`0.0.0.0`** (direct API); restrict with **security group**; browsers usually use **5175** |

**SPA entry (same bundle on drpinfotech.com):** **`/`** — multi-product welcome page with links to **`/trading`**, static failover summaries for **`/astrology/`** and **`/ai/`** (no live-app dependency during S3 failover), **`/openbook`**, etc. **`/login`**, **`/dashboard`**, etc. are unchanged. If CloudFront fails over to the **handcrafted static site** under repo folder **`s3/`** (instead of uploading the CRA build), sync that folder so `/`, **`/astrology/`**, **`/ai/`**, `/openbook/`, `/astrodrp/`, `/trading/`, and **`/legal/...`** match the hub (see **S3 static failover checklist** below).

### S3 static failover checklist (`s3/` handcrafted HTML)

When the primary EC2/origin is unhealthy and CloudFront serves the **failover bucket** (or prefix), users need **real S3 keys** for each URL—React Router does not run on S3. This repo maintains matching pages under **`s3/`**:

| Path (example) | S3 object key |
|----------------|---------------|
| `/` | `index.html` |
| `/trading/` | `trading/index.html` |
| `/astrology/` | `astrology/index.html` |
| `/ai/` | `ai/index.html` |
| `/openbook/` | `openbook/index.html` |
| `/astrodrp/` | `astrodrp/index.html` |
| `/legal/openbook-privacy-policy/` | `legal/openbook-privacy-policy/index.html` |
| `/legal/astrodrp-privacy-policy/` | `legal/astrodrp-privacy-policy/index.html` |

**Before upload / `aws s3 sync`:**

1. **Logo:** ensure **`s3/assets/drp-infotech-logo.png`** exists (copied from `frontend/public/` or your brand asset).
2. **Screenshots:** keep **`s3/android/openbook/screenshots/*.jpg`** and **`s3/android/astrodpr/screenshots/*.jpg`** in sync with `frontend/public/android/.../screenshots/` after UI changes.
3. **AstroDRP APK (optional):** copy the release **`astroDRP.apk`** to **`s3/android/astrodpr/astroDRP.apk`** on the machine that uploads to S3—this path is referenced by **`s3/astrodrp/index.html`**; APKs are **gitignored** under **`s3/`** to avoid large blobs in Git.
4. Upload the **whole** **`s3/`** tree (including **`css/`**, **`js/`**, top-level **`*.html`** policy pages CloudFront might still serve) to your failover bucket/prefix.

**CloudFront:** confirm behaviors or origins map **`/astrology*`**, **`/ai*`**, **`/openbook*`**, **`/astrodrp*`**, **`/legal/*`**, **`/trading*`** (and default `/`) to the failover origin when active, with **403/404** or **502** fallbacks pointing at this static site as documented in your distribution. Prefer **directory-style** URLs ending in `/` so `index.html` resolves predictably.

If you prefer failover = **full CRA `frontend/build`** instead, upload that build and keep **`index.html`** + hashed assets current after each frontend release—that path is separate from the handcrafted **`s3/`** tree.

**Android APKs (large files, gitignored):**
- **OpenBook:** copy **`app-release.apk`** into **`frontend/public/android/openbook/app-release.apk`** before `npm run build` / `docker-hub-push.ps1`.
- **AstroDRP:** copy **`astroDRP.apk`** into **`frontend/public/android/astrodpr/astroDRP.apk`** before `npm run build` / `docker-hub-push.ps1`.

The repo keeps screenshots in git (`frontend/public/android/openbook/screenshots/` and `frontend/public/android/astrodpr/screenshots/`), but APK files are excluded to avoid very large blobs—use your release pipeline or manual copy on the build machine.

## Clone (do not use GitHub `/tree/...` URLs)

```bash
git clone <YOUR_ZERODHA_REPO_GIT_URL>.git
cd <repo>
```

## Environment files (local vs production)

| File | Used by | In git? |
|------|---------|--------|
| **`backend/.env`** | `docker-compose.yml` (your PC / local Docker) | No — create from `env_template.txt` |
| **`backend/.env.production`** | `docker-compose.prod.yml` and `docker-compose.hub.yml` on the **server** | No — create on server only |
| **`backend/env_template.txt`** | Template for **local** `.env` | Yes |
| **`backend/.env.production.example`** | Template for **production** `.env.production` (`https://drpinfotech.com`) | Yes |

**Local:**

```bash
cp backend/env_template.txt backend/.env
# Edit backend/.env — never commit .env
```

**Production server (first deploy):**

```bash
cp backend/.env.production.example backend/.env.production
# Edit backend/.env.production — set SECRET_KEY, GOOGLE_*, Razorpay, SMTP, etc. Never commit.
```

**Interactive env (Windows):** `.\scripts\setup-env.ps1` — generates `backend/.env` (local) or `backend/.env.production` (production); never commit those files.

**Docker Hub → EC2:**

1. Publish **multi-arch** images (`linux/amd64` + **`linux/arm64`**): run **`.\scripts\docker-hub-push.ps1`** (after `docker login`) from a machine where buildx can build both platforms, **or** use [GitHub Actions multi-arch](#github-actions-multi-arch-push-to-docker-hub) after configuring **`DOCKERHUB_USERNAME`** / **`DOCKERHUB_TOKEN`**. On Windows, QEMU **arm64** builds may fail; use **`$env:DOCKER_PLATFORMS = "linux/amd64"`** only when your EC2 is **x86_64**. **Graviton (ARM64) production:** until Hub has **`linux/arm64`** for your tag, [`docker-compose.hub.yml`](docker-compose.hub.yml) keeps **`platform: linux/amd64`** and you **must** have **amd64 binfmt** after every reboot ([systemd unit](#graviton-aarch64-keep-amd64-emulation-after-reboot-optional-fallback) or deploy/refresh scripts). After multi-arch exists on Hub, **remove** the two **`platform:`** lines in compose and **`pull` + `up -d`** so Docker uses **native arm64** (no QEMU for Zerodhakite).
2. Use the **same** `$env:IMAGE_TAG` when pushing and when deploying (`latest` or a version string); it must match what the server resolves in `docker-compose.hub.yml`.
3. On your PC, ensure `backend/.env.production` is filled (from setup script or copied from `.env.production.example`).
4. **`DEPLOY_SSH` must reach the host from your PC:** use **public DNS / Elastic IP**, not VPC-private `172.31.x.x` (unless Session Manager tunnel / bastion). Optional: copy **[`scripts/deploy.local.ps1.example`](scripts/deploy.local.ps1.example)** to **`scripts/deploy.local.ps1`** (gitignored), set **`DEPLOY_SSH`**, **`DEPLOY_PATH`**, **`DEPLOY_SSH_KEY`** there; **`remote-deploy-via-ssh.ps1`** auto-loads it.
5. `$env:DEPLOY_SSH = "ubuntu@<ec2-host>"` (if not already in **`deploy.local.ps1`**); optional `$env:DEPLOY_PATH` (defaults to **`/home/ubuntu/apps/zerodhakite`**), **`$env:DEPLOY_SSH_KEY`**, **`DOCKERHUB_NAMESPACE`**, **`IMAGE_TAG`**.
6. Optionally `$env:DEPLOY_SYNC_ENV = "1"` then **`.\scripts\remote-deploy-via-ssh.ps1`** — SCPs **`backend/.env.production`** when set, **`git pull`**, **`docker compose … pull`** and **`up -d --force-recreate`** (refreshes running containers against pulled **`IMAGE_TAG`**).
7. **On-server alternative (already SSH'd on EC2):** from the clone root run **`chmod +x scripts/ec2-hub-refresh.sh`** once; then **`ZERODHAKITE_ROOT=/path/to/clone ./scripts/ec2-hub-refresh.sh`** (defaults **`$HOME/apps/zerodhakite`**). Only **`docker-compose.hub.yml`** stacks are recreated; astrology / ai_tools containers are unaffected.
8. **S3 static failover:** needs [AWS CLI](https://aws.amazon.com/cli/) configured; then `aws s3 sync ./s3/ s3://<your-failover-bucket>/` from the repo root (no CloudFront edit required; optional invalidations if HTML is cached).

### Graviton (aarch64): keep amd64 emulation after reboot (optional fallback)

[`docker-compose.hub.yml`](docker-compose.hub.yml) expects **multi-arch** Hub images so containers run **native ARM** and do not need QEMU. If you still run **amd64-only** images on Graviton, the kernel must register **`binfmt_misc`** for amd64 (via `tonistiigi/binfmt`). That registration is **lost on reboot** unless you re-run binfmt at boot.

**Recommended:** push **linux/arm64** (see [GitHub Actions multi-arch](#github-actions-multi-arch-push-to-docker-hub) or [`scripts/docker-hub-push.ps1`](scripts/docker-hub-push.ps1)), then you do not rely on binfmt for ZerodhaKite.

**If you need binfmt on every boot** (same command as deploy scripts):

1. **systemd (persistent on the EC2 instance)** — from the repo clone on the server:

   ```bash
   sudo chmod +x scripts/install-amd64-binfmt-systemd.sh
   sudo ./scripts/install-amd64-binfmt-systemd.sh
   ```

   This installs [`scripts/systemd/docker-amd64-binfmt.service`](scripts/systemd/docker-amd64-binfmt.service), enables **`docker-amd64-binfmt.service`**, and starts it once (after **`docker.service`**). Reboot to verify: `systemctl status docker-amd64-binfmt.service`.

2. **cloud-init** — merge into instance user-data (run after Docker is installed; **once per boot** is enough):

   ```yaml
   #cloud-config
   runcmd:
     - docker run --rm --privileged tonistiigi/binfmt --install amd64
   ```

   Prefer the **systemd unit** if Docker is managed by systemd and you want a clear dependency on **`docker.service`**.

**Other containers on the same EC2:** **`docker compose -f docker-compose.hub.yml …`** only recreates services defined in that file (Compose project **`zerodhakite`**). It does **not** stop or replace containers from other compose projects (e.g. astrology, ai_tools) on the host.

**Binfmt / systemd unit:** Registration is **kernel-wide** but it does **not** restart or reconfigure existing containers. It only tells the kernel how to **run amd64 executables** when something tries to execute them. Containers that use **native linux/arm64** images are **unchanged** (their binaries are aarch64, so binfmt is not used). Stacks that already run **amd64-only** images on Graviton were already depending on the same mechanism; enabling it at boot avoids surprise failures after reboot without touching other apps’ data or networks.

### GitHub Actions: multi-arch push to Docker Hub

Workflow: [`.github/workflows/docker-hub-push.yml`](../.github/workflows/docker-hub-push.yml). It builds **`linux/amd64`** and **`linux/arm64`** and pushes **`zerodhakite-backend`** / **`zerodhakite-frontend`** on **push to `main`** (when `backend/`, `frontend/`, or the workflow file changes) or **manual `workflow_dispatch`** (optional tag input).

**Repository secrets** (Settings → Secrets and variables → Actions):

| Name | Purpose |
|------|---------|
| **`DOCKERHUB_USERNAME`** | Docker Hub login (often same as image namespace) |
| **`DOCKERHUB_TOKEN`** | [Access token](https://docs.docker.com/docker-hub/access-tokens/) with read/write |

**Optional repository variable:** **`DOCKERHUB_NAMESPACE`** — if your Hub namespace differs from **`DOCKERHUB_USERNAME`**.

If **`DOCKERHUB_TOKEN`** is unset, the workflow job is skipped (e.g. forks) so the workflow file does not break CI.

After the first successful multi-arch push for your tag (e.g. **`latest`**), **remove** the two **`platform: linux/amd64`** lines from [`docker-compose.hub.yml`](docker-compose.hub.yml), commit, then on Graviton run **`git pull`** and **`docker compose -f docker-compose.hub.yml pull && docker compose -f docker-compose.hub.yml up -d`** so Docker pulls **arm64** automatically.

Use a **separate Google OAuth Web client** for production (only `https://drpinfotech.com` origins + redirect) if you also use localhost in another client.

### Docker + Google Sign-In (local)

The UI is **http://localhost:5175**; the backend is also on the host at **http://localhost:8003**. Use an explicit OAuth callback on **8003** so it matches Google Cloud Console regardless of proxy `Host` headers:

**Google Cloud Console** (OAuth client):

- **Authorized JavaScript origins:** `http://localhost:8003`, `http://localhost:5175`
- **Authorized redirect URIs:** `http://localhost:8003/api/auth/google/callback`

**`backend/.env`:**

```env
TRUST_PROXY=1
CORS_ORIGINS=http://localhost:5175,http://localhost:8003
FRONTEND_URL=http://localhost:5175
BACKEND_URL=http://localhost:8003
GOOGLE_REDIRECT_URI=http://localhost:8003/api/auth/google/callback
```

Production URLs are in **`backend/.env.production.example`** (`https://drpinfotech.com`). Register those exact URIs on your **production** OAuth client.

**`redirect_uri_mismatch` (Google error 400):** The app sends the URI logged as `Google OAuth redirect_uri:` in backend logs. It must match **Authorized redirect URIs** in Google Cloud Console **character-for-character** (https not http, `drpinfotech.com` vs `www`, no extra slash). On the **server**, set **`BACKEND_URL=https://drpinfotech.com`** and **`GOOGLE_REDIRECT_URI=https://drpinfotech.com/api/auth/google/callback`** in **`backend/.env.production`**, restart the backend. **Local** still uses **`backend/.env`** + request host unless **`GOOGLE_REDIRECT_URI`** is set (see `env_template.txt`).

### Zerodha Kite Connect (redirect URL & ports)

Same stack as the table above: **browser UI on host `5175`**, Flask on **`8003`** mapped to **`0.0.0.0:8003`** on the host (allow **TCP 8003** in the security group if you need direct access from outside).

- **Kite developer console → Redirect URL** must match **`{BACKEND_URL}/callback`** (see `backend/app.py`). Examples:
  - **Production:** `https://drpinfotech.com/callback` (no port when using HTTPS on **443**).
  - **Local Docker:** `http://localhost:5175/callback` (Nginx on **5175** proxies `/callback` to the backend) **or** `http://localhost:8003/callback` (direct to the mapped backend port).
- **CloudFront:** If the default behavior sends `/*` to the **frontend** origin on **`5175`**, **`/callback`** is handled by **Nginx** → backend (see `frontend/nginx.conf`). You do **not** need port **8000**; align origins with **5175** / **443** (TLS), not legacy **3000** / **8000**.

### CloudFront — avoid “HTML instead of JSON” on `/api/*`

If the browser console shows `Unexpected token '<'` / `not valid JSON` for `/api/...`, the **CDN returned HTML** (usually `index.html` or an error page), not Flask JSON.

| Symptom | Typical cause | Fix |
|--------|----------------|-----|
| JSON parse error on login | Default behavior points to **S3** (static CRA build only) | Point **`/*`** (or at least **`/api/*`**, **`/socket.io/*`**, **`/callback`**) to **EC2 Nginx on port 5175**, or add path behaviors to **5175** |
| JSON parse error | **`/api/*`** origin uses port **8000** | Use **8003** (Flask in Docker) or **5175** (Nginx proxies `/api/`) |
| JSON parse error | API origin wrong host / timeout | Custom error page is HTML — fix origin health and **security group** (allow **5175** / **8003** from CloudFront or `0.0.0.0/0` as you prefer) |

**Simplest setup:** one **custom origin** = EC2 public DNS (or ALB), **HTTP port 5175**, default behavior **`/*`** with **Managed-CachingDisabled** (or tuned) for `/api/*` if split. Nginx in the frontend container already proxies **`/api/`**, **`/socket.io/`**, **`/callback`** to the backend.

## Local Docker

**Windows quick refresh:** double-click [`docker-refresh.bat`](../docker-refresh.bat) in the repo root to rebuild backend + frontend images, recreate containers, run health checks, and show a success/issues summary before closing.

### Options chain (live + historical)

The **Options** tab loads today’s nearest expiry by default and polls `/api/options/chain-board` every 3s when live. Zerodha does **not** provide historical data for **expired options**; chains for past dates/expiries come only from data captured in SQLite (`option_quote_latest`, `option_quote_ticks`, `option_chain_snapshots`). Run `python backend/migrate_option_chain_quotes.py` once on existing DBs. Tick retention defaults to **60 trading days** (`OPTION_TICK_RETENTION_DAYS`). Live capture uses **ATM ±15 strikes** for spike detection (`OPTION_LTP_SPIKE_PCT_30S`, `OPTION_IV_SPIKE_PCT_60S`).

The backend image installs **CPU-only PyTorch** (`requirements-docker.txt` + PyTorch CPU index) so the first build stays ~minutes instead of multi‑GB CUDA wheels. For GPU training on the host, use a venv + full `requirements.txt` outside Docker.

```bash
# Optional: interactive backend/.env (first time)
# bash setup.sh local

docker compose build
docker compose up -d
```

The compose volume starts with an **empty** SQLite file unless you bind-mount an existing `database.db` (see below).

Open **http://localhost:5175**

**Windows:** `.\setup.ps1 -Env local` creates **`backend\.env`** if missing (prompts), then starts Compose.

## Production (EC2)

`docker-compose.prod.yml` loads **`backend/.env.production`** only (not `.env`).

### Interactive setup (recommended, same idea as toolsDRP)

On the server, in the repo root:

```bash
git pull
bash setup.sh prod
```

The first run **prompts** for Google OAuth, Razorpay, SMTP, public URL (default `https://drpinfotech.com`), writes **`backend/.env.production`**, then **`docker compose -f docker-compose.prod.yml up --build -d`**. If `.env.production` already exists, it is left unchanged.

### Manual

```bash
cp backend/.env.production.example backend/.env.production
# edit secrets, then:
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml up -d
```

Optional host Nginx (TLS on 443, upstream is plain HTTP to the container): `proxy_pass http://127.0.0.1:5175;`

### Docker Hub (optional)

For **Graviton** and [`docker-compose.hub.yml`](docker-compose.hub.yml), use **multi-arch** images ([`scripts/docker-hub-push.ps1`](scripts/docker-hub-push.ps1) or [GitHub Actions](#github-actions-multi-arch-push-to-docker-hub)). The commands below push **single-arch** (host CPU only) and are mainly for quick tests on matching hardware:

```bash
export DOCKERHUB_NAMESPACE=yourdockerhubuser
export IMAGE_TAG=1.0.0

docker build -t ${DOCKERHUB_NAMESPACE}/zerodhakite-backend:${IMAGE_TAG} ./backend
docker build -t ${DOCKERHUB_NAMESPACE}/zerodhakite-frontend:${IMAGE_TAG} ./frontend
docker push ${DOCKERHUB_NAMESPACE}/zerodhakite-backend:${IMAGE_TAG}
docker push ${DOCKERHUB_NAMESPACE}/zerodhakite-frontend:${IMAGE_TAG}
```

On the server (with `.env.production` in place):

```bash
export DOCKERHUB_NAMESPACE=yourdockerhubuser
export IMAGE_TAG=1.0.0
docker compose -f docker-compose.hub.yml pull
docker compose -f docker-compose.hub.yml up -d
```

## Smoke test

- Load UI on **5175**
- Sign in / hit a `/api/...` route
- DevTools → Network: Socket.IO connects (polling or websocket)

## Logs

```bash
docker compose -f docker-compose.prod.yml logs -f backend
docker compose -f docker-compose.prod.yml logs -f frontend
```

## Data

SQLite file on the host: **`data/database.db`** (bind-mounted to `/app/data/database.db` in the backend container).

- **Back up before upgrades:** `.\scripts\backup-database.ps1` → `data/backups/database-YYYYMMDD-HHMMSS.db`
- **Restore:** `.\scripts\restore-database.ps1 -BackupPath data\backups\...`
- **Never** run `docker compose down -v` unless you intend to delete unused named volumes (bind-mounted `data/` is kept, but avoid `-v` as a habit).
- Native dev: set `DATABASE_PATH=../data/database.db` in `backend/.env` (see [`data/README.md`](../data/README.md)).

## Native dev (no Docker)

Use `npm start` (port 3000) and Flask on **8003** with `backend/.env` as before; see `backend/env_template.txt`.
