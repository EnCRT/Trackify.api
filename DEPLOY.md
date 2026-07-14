# Trackify.API — Deployment Guide (Render Free Tier)

## Architecture

```
┌──────────────────────────────────────────────────────┐
│                    Render (Free Tier)                 │
│                                                       │
│  ┌──────────────────┐                                │
│  │   Strapi 5       │                                │
│  │   (Docker)       │                                │
│  │   :1337          │                                │
│  │   512 MB / 0.1   │                                │
│  │   vCPU            │                                │
│  └────────┬─────────┘                                │
│           │                                           │
└───────────┼───────────────────────────────────────────┘
            │  DATABASE_URL (SSL)
            ▼
┌──────────────────────────┐
│  Supabase (Free Tier)     │
│                           │
│  PostgreSQL 15            │
│  + PostGIS (enabled)      │
│  500 MB / 2 projects      │
│                           │
└──────────────────────────┘

         ┌──────────────┐
         │  cron-job.org │  ← HTTP ping every 10 min
         │  (keep-alive) │     prevents Render cold start
         └──────────────┘
```

## Quick Start (One-Time Setup)

### 1. Prerequisites

- **GitHub account** with the Trackify.API repo pushed
- **Supabase project** with PostgreSQL + PostGIS (already provisioned)
- **Render account** (sign up at https://render.com with GitHub)

### 2. Push Code to GitHub

```bash
cd D:\ESP32\Trackify.API

# If not already a git repo:
git init
git remote add origin git@github.com:YOUR_USERNAME/trackify-api.git
git branch -M main

# Commit all deployment configs
git add -A
git commit -m "Add Render Free Tier deployment config (render.yaml, updated CI)"
git push -u origin main
```

### 3. Deploy on Render

**Option A: Blueprint (recommended — infra-as-code)**

1. Go to https://dashboard.render.com
2. Click **New** → **Blueprint**
3. Connect your GitHub repo `trackify-api`
4. Render reads `render.yaml` and auto-creates the Web Service
5. Click **Apply** — Render starts building the Docker image

**Option B: Manual Web Service**

1. Go to https://dashboard.render.com
2. Click **New** → **Web Service**
3. Connect your GitHub repo `trackify-api`
4. Configure:
   - **Name:** `trackify-api`
   - **Runtime:** Docker
   - **Region:** Frankfurt (or closest to users)
   - **Branch:** `main`
   - **Plan:** Free
5. Click **Create Web Service**

### 4. Set Environment Variables

In Render dashboard → your service → **Environment**, add:

| Variable | Value / How to get |
|----------|-------------------|
| `DATABASE_CLIENT` | `postgres` |
| `DATABASE_URL` | From Supabase: **Settings → Database → Connection string → URI** (use Session Pooler, port 6543) |
| `DATABASE_SSL` | `true` |
| `DATABASE_SSL_REJECT_UNAUTHORIZED` | `false` (Supabase requires this) |
| `DATABASE_POOL_MAX` | `1` (if using Supabase PgBouncer on port 6543) |
| `HOST` | `0.0.0.0` |
| `PORT` | `1337` |
| `NODE_ENV` | `production` |

**Generate secrets** (run in terminal):
```bash
echo "APP_KEYS=$(openssl rand -base64 32),$(openssl rand -base64 32),$(openssl rand -base64 32),$(openssl rand -base64 32)"
echo "API_TOKEN_SALT=$(openssl rand -base64 16)"
echo "ADMIN_JWT_SECRET=$(openssl rand -base64 32)"
echo "JWT_SECRET=$(openssl rand -base64 32)"
echo "TRANSFER_TOKEN_SALT=$(openssl rand -base64 16)"
echo "ENCRYPTION_KEY=$(openssl rand -base64 16)"
```

Add each generated value as an env var in Render. **Do NOT set DATABASE_HOST, DATABASE_PORT, etc.** — `DATABASE_URL` takes precedence.

### 5. Supabase Database Setup

#### Supabase Connection String

Get your DATABASE_URL from Supabase dashboard → **Settings → Database**:

- **Session Pooler (port 6543):** `postgresql://postgres.[PROJECT_REF]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:6543/postgres`
  - Best for Strapi/serverless — uses PgBouncer
  - Set `DATABASE_POOL_MAX=1` (PgBouncer handles pooling)
  - Append `?pgbouncer=true` to the URL

- **Direct Connection (port 5432):** `postgresql://postgres.[PROJECT_REF]:[PASSWORD]@db.[PROJECT_REF].supabase.co:5432/postgres`
  - Works without PgBouncer limitations
  - Set `DATABASE_POOL_MAX=10`

#### Enable PostGIS (if not already enabled)

```sql
-- Run in Supabase SQL Editor
CREATE EXTENSION IF NOT EXISTS postgis;
```

### 6. First Startup

On first deploy, Render builds the Docker image and starts the container.
Strapi auto-runs pending migrations from `database/migrations/`.

Check logs in Render dashboard → **Logs** tab.

### 7. Create Admin User

After the service is running, create the Super Admin account:

**Option A: Via Render Shell**
1. Render dashboard → your service → **Shell**
2. Run:
```bash
node -e "
  const strapi = require('@strapi/strapi').default;
  strapi().admin.services.user.create({
    email: 'admin@trackify.app',
    password: 'CHANGE_ME_NOW',
    firstname: 'Admin',
    isActive: true
  }).then(() => console.log('Admin created'));
"
```

**Option B: Via first-time browser visit**
1. Visit `https://trackify-api.onrender.com/admin`
2. Fill in the registration form (first visitor becomes Super Admin)

### 8. Keep-Alive (Prevent Cold Start)

Render Free Tier spins down after **15 minutes of inactivity**. Cold start takes ~1 minute.

**Fix: cron-job.org free ping**

1. Go to https://cron-job.org → Sign up (free)
2. Create a new cron job:
   - **URL:** `https://trackify-api.onrender.com/_health`
   - **Interval:** Every 10 minutes
   - **Save**

This sends an HTTP GET every 10 min, keeping the service alive.
Also works: UptimeRobot, Freshping, or a simple GitHub Actions scheduled workflow.

## CI/CD: Render Native + GitHub Actions

### Render Auto-Deploy (Default)

- Every push to `main` → Render auto-detects and redeploys
- No manual trigger needed, no CI tokens
- Zero-config — just push and wait ~3-5 min

### GitHub Actions (Build Validation)

The workflow at `.github/workflows/deploy.yml`:
- **On PR:** Builds and validates the Docker image (no deploy)
- **On push to main:** Build checks run; Render auto-deploys independently

### Manual Deploy Hook

For programmatic deploys:
```bash
curl -X POST "https://api.render.com/deploy/srv-XXXXX?key=YOUR_DEPLOY_KEY"
```

Find your Deploy Hook URL in Render → service → **Settings** → **Deploy Hook**.

## Cost Breakdown (Free Tier)

| Item | Monthly |
|------|---------|
| Strapi Web Service (512 MB, 0.1 vCPU) | **$0** (750 hrs — covers 1 instance) |
| Supabase PostgreSQL (500 MB, 2 projects) | **$0** |
| cron-job.org keep-alive pings | **$0** |
| Render auto-SSL (Let's Encrypt) | **$0** |
| **TOTAL** | **$0/mo** |

## Environment Variables Reference

| Variable | Required | Default | Notes |
|----------|----------|---------|-------|
| `HOST` | No | `0.0.0.0` | Server listen address |
| `PORT` | No | `1337` | Server port |
| `NODE_ENV` | Yes | `development` | Set to `production` |
| `DATABASE_CLIENT` | Yes | `sqlite` | Must be `postgres` |
| `DATABASE_URL` | Yes | — | Supabase connection string |
| `DATABASE_SSL` | Yes | `false` | Must be `true` for Supabase |
| `DATABASE_SSL_REJECT_UNAUTHORIZED` | No | `true` | Set `false` for Supabase |
| `DATABASE_POOL_MAX` | No | `10` | Set `1` if using PgBouncer |
| `APP_KEYS` | Yes | — | 4× comma-separated base64 strings |
| `API_TOKEN_SALT` | Yes | — | Random base64 string |
| `ADMIN_JWT_SECRET` | Yes | — | Random base64 string |
| `JWT_SECRET` | Yes | — | Random base64 string |
| `TRANSFER_TOKEN_SALT` | Yes | — | Random base64 string |
| `ENCRYPTION_KEY` | Yes | — | Random base64 string |
| `GOOGLE_CLIENT_ID` | No | — | For Google OAuth (mobile auth) |

## Troubleshooting

### Strapi won't start

Check Render logs:
1. Render dashboard → your service → **Logs**
2. Common issues:
   - `APP_KEYS` not set or malformed
   - `DATABASE_URL` unreachable (check Supabase firewall)
   - Port already in use

### Database connection refused

- Verify `DATABASE_URL` is correct (copy from Supabase, not manually typed)
- Check that Supabase project is active (not paused)
- Ensure SSL settings: `DATABASE_SSL=true`, `DATABASE_SSL_REJECT_UNAUTHORIZED=false`
- Try port 5432 (direct) instead of 6543 (pooler) if PgBouncer issues

### Migrations not running

Strapi auto-runs migrations on startup (from `database/migrations/`).
To run manually via Render Shell:
```bash
npx strapi migration:up
```

### Cold start taking too long

- First cold start: ~2-3 min (Docker image pull + build)
- Subsequent cold starts: ~30-60 sec (image cached)
- Keep-alive ping via cron-job.org reduces cold starts to near-zero

### "Your connection is not private" (SSL error)

Render auto-provisions Let's Encrypt SSL. This takes ~1-2 minutes after first deploy.
If it persists: check Render → Settings → SSL Certificate → "Renew".

### Supabase PgBouncer errors

If you see `prepared statement "..." already exists`:
- Switch to **Direct Connection** (port 5432) instead of Session Pooler (port 6543)
- Or set `DATABASE_POOL_MAX=1` and append `?pgbouncer=true` to DATABASE_URL

## Migration from Railway

If you're coming from Railway:
1. The `railway.json` is kept but unused by Render
2. Export env vars from Railway → set in Render
3. Database is on Supabase (unchanged) — just update `DATABASE_URL` on Render
4. Remove `RAILWAY_TOKEN` from GitHub secrets
