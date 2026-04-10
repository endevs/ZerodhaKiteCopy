# Deploy — ZerodhaKiteGit (Docker)

Flask-SocketIO backend + CRA frontend. **Compose project name:** `zerodhakite` (isolated from other apps on the same host).

## Ports (do not collide with other stacks)

| App | Host | Backend (internal) |
|-----|------|-------------------|
| AstrologyDRP | 5173 / 8001 | 8001 |
| AI_toolsDRP | 5174 | 8002 |
| **This app** | **5175** → Nginx **80** | **8003** on **`127.0.0.1` only** (optional direct API/debug); browsers should use **5175** |

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

## Local Docker

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

Build and push from a machine with Docker logged in (`docker login`):

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

SQLite lives in volume **`zerodhakite_data`** at `/app/data/database.db` inside the backend container.

## Native dev (no Docker)

Use `npm start` (port 3000) and Flask on **8003** with `backend/.env` as before; see `backend/env_template.txt`.
