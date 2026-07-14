# Trackify.API — Deployment Guide (Railway $0/mo Hobby)

## Architecture

```
┌──────────────────────────────────────────────┐
│                  Railway                      │
│                                               │
│  ┌──────────────┐    ┌────────────────────┐  │
│  │   Strapi 5   │◄──►│  PostgreSQL 16     │  │
│  │  (Docker)    │    │  + PostGIS         │  │
│  │  :1337       │    │  (Railway Plugin)  │  │
│  └──────┬───────┘    └────────────────────┘  │
│         │                                      │
└─────────┼──────────────────────────────────────┘
          │
    ┌─────▼──────┐
    │ Cloudflare │  ← domain (optional)
    │ Registrar  │
    └────────────┘
```

## Quick Start (One-Time Setup)

### 1. Create Railway Account

1. Go to https://railway.com
2. Click **"Start a New Project"**
3. Sign in with **GitHub** (authorize Railway OAuth app)
4. You get **$5 free trial credit** (no credit card required)

### 2. Push Code to GitHub

```bash
# Initialize (already done)
cd D:\ESP32\Trackify.API
git init

# Create repo on GitHub (via web: github.com/new)
# Name: trackify-api  (or Trackify.API)

# Push
git remote add origin git@github.com:YOUR_USERNAME/trackify-api.git
git branch -M main
git add -A
git commit -m "Initial: Strapi 5 + PostgreSQL + Railway deploy config"
git push -u origin main
```

### 3. Deploy on Railway

1. In Railway dashboard → **New Project** → **Deploy from GitHub repo**
2. Select `trackify-api` repo
3. Railway auto-detects `Dockerfile` + `railway.json`

### 4. Add PostgreSQL Service

1. In your Railway project → **New** → **Database** → **PostgreSQL**
2. Railway auto-provisions Postgres 16
3. Enables PostGIS manually in SQL tab:
   ```sql
   CREATE EXTENSION IF NOT EXISTS postgis;
   ```
4. Railway auto-injects `DATABASE_URL` env var into your Strapi service
   (The Strapi `config/database.ts` already reads `DATABASE_URL` — no extra config needed!)

### 5. Set Environment Variables

In Railway dashboard → your Strapi service → **Variables**, add:

| Variable | How to generate |
|----------|----------------|
| `APP_KEYS` | `openssl rand -base64 32`, repeat 4 times, comma-separated |
| `API_TOKEN_SALT` | `openssl rand -base64 16` |
| `ADMIN_JWT_SECRET` | `openssl rand -base64 32` |
| `JWT_SECRET` | `openssl rand -base64 32` |
| `TRANSFER_TOKEN_SALT` | `openssl rand -base64 16` |
| `ENCRYPTION_KEY` | `openssl rand -base64 16` |

Quick generation (run in terminal):
```bash
echo "APP_KEYS=$(openssl rand -base64 32),$(openssl rand -base64 32),$(openssl rand -base64 32),$(openssl rand -base64 32)"
echo "API_TOKEN_SALT=$(openssl rand -base64 16)"
echo "ADMIN_JWT_SECRET=$(openssl rand -base64 32)"
echo "JWT_SECRET=$(openssl rand -base64 32)"
echo "TRANSFER_TOKEN_SALT=$(openssl rand -base64 16)"
echo "ENCRYPTION_KEY=$(openssl rand -base64 16)"
```

**IMPORTANT:** Do NOT set `DATABASE_CLIENT`, `DATABASE_HOST`, etc. manually.
Railway auto-provides `DATABASE_URL` — Strapi uses it automatically.

### 6. Run Migrations

Railway runs the Dockerfile's `CMD ["node", "dist/server.js"]` which starts Strapi.
On first startup, Strapi auto-runs pending migrations from `database/migrations/`.

To run manually (via Railway CLI):
```bash
railway run npx strapi migration:up
```

### 7. Create Admin User

First time setup — create the Super Admin account:
```bash
# Via Railway CLI
railway run node -e "
  const strapi = require('@strapi/strapi').default;
  strapi().admin.services.user.create({
    email: 'admin@trackify.app',
    password: 'CHANGE_ME_NOW',
    firstname: 'Admin',
    isActive: true
  }).then(() => console.log('Admin created'));
"
```

Then visit `https://your-app.railway.app/admin` and log in.

## Optional: Custom Domain (Cloudflare $9/yr)

### Register Domain

1. Go to https://cloudflare.com → Register domain
2. Pick a domain (e.g., `trackify.app`, `trackify-api.com`)
3. Cost: ~$9/year (varies by TLD)

### Connect to Railway

1. In Railway → your Strapi service → **Settings** → **Domains**
2. Add your custom domain: `api.trackify.app`
3. Railway gives you a `CNAME` target
4. In Cloudflare DNS → add CNAME record:
   - Name: `api`
   - Target: `<railway-cname-target>.railway.app`
   - Proxy status: DNS only (grey cloud)

### SSL Certificate

Railway auto-provisions **Let's Encrypt SSL** for custom domains.
No manual setup needed — wait ~5 minutes after DNS propagates.

## CI/CD: GitHub Actions

The workflow at `.github/workflows/deploy.yml`:

- **On PR:** Builds and validates the Docker image (no deploy)
- **On push to main:** Builds → deploys to Railway via `railway up`

### Set RAILWAY_TOKEN Secret

1. Go to Railway → **Settings** → **Tokens** → **Create Token**
2. Copy the token
3. Go to GitHub repo → **Settings** → **Secrets** → **New Repository Secret**
4. Name: `RAILWAY_TOKEN`, Value: paste the token

## Cost Breakdown (Hobby Plan)

| Item | Monthly |
|------|---------|
| Strapi container (512 MB RAM, 0.5 vCPU) | $0 (trial credit) / ~$5 after |
| PostgreSQL 16 (Railway Plugin, 1 GB) | $0 (trial credit) / ~$2 after |
| Egress (bandwidth) | $0 (included in trial) |
| Domain (Cloudflare, annual) | ~$0.75/mo ($9/yr) |
| **TOTAL after trial** | **~$7-8/mo** |

Railway trial: $5 credit, no credit card required. Lasts until credit exhausted.

## Troubleshooting

### Strapi won't start

```bash
# Check logs
railway logs

# Common issue: APP_KEYS not set
# Ensure all 6 secret vars are set in Railway Variables
```

### Migrations not running

```bash
# Run manually
railway run npx strapi migration:up
```

### Database connection refused

Railway auto-injects `DATABASE_URL`. Ensure you did NOT override
`DATABASE_HOST` / `DATABASE_PORT` / etc. in Railway Variables —
the `DATABASE_URL` takes precedence.

### Domain not working

- DNS propagation can take up to 48 hours (usually 5 min)
- Verify CNAME record is "DNS only" (grey cloud), not proxied
- Check: `dig api.yourdomain.com CNAME`
