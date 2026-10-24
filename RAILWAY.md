# FieldSense — Railway Deployment Guide (End-to-End)

FieldSense is fully pre-configured for seamless, zero-friction deployment on [Railway](https://railway.com).

---

## 1. Quick Deploy Steps

### Option A: Via Railway Web Dashboard
1. Log in to [Railway](https://railway.com).
2. Click **New Project** → **Deploy from GitHub repo**.
3. Select this repository: `glalit52/fieldsense-new` (or your fork/team repo).
4. Railway will automatically detect `railway.json` and build using the optimized multi-stage `Dockerfile`.

### Option B: Via Railway CLI
```bash
npm i -g @railway/cli
railway login
railway init
railway up
```

---

## 2. Persistent Storage (Volume Mount)

FieldSense uses SQLite (`fieldsense.db`) for caching 35 years of weather/soil records and storing user-created fields.

To persist this data across service redeployments and restarts:

1. In your Railway project view, click on the **FieldSense** service.
2. Go to the **Volumes** tab.
3. Click **Add Volume**.
4. Set the **Mount Path** to:
   ```
   /app/data
   ```
5. Click **Add**. Railway will mount persistent SSD storage at `/app/data`.

---

## 3. Environment Variables Configuration

In Railway's **Variables** tab for the service, configure the following:

### Core Configuration
| Variable | Value / Recommendation | Note |
|---|---|---|
| `CONTACT_EMAIL` | `lalit@sensegrass.com` | **Default is pre-configured**. Sent in User-Agent header for Nominatim / ORNL upstream APIs and displayed in support links. |
| `DATA_DIR` | `/app/data` | Default in Dockerfile. Points to the mounted Railway Volume. |
| `PORT` | *(Managed by Railway)* | Automatically injected by Railway. FieldSense binds to `0.0.0.0:${PORT}`. |
| `NODE_ENV` | `production` | Set automatically in Dockerfile. |

### Optional API Enhancements
| Variable | When to Set | Details |
|---|---|---|
| `ANTHROPIC_API_KEY` | Recommended | Unlocks Claude 3.5/Opus streaming AI assistant for **Agris**. Without this, Agris runs on the built-in deterministic rule engine. |
| `AGRIS_MODEL` | Optional | E.g. `claude-3-5-sonnet-20241022` or `claude-opus-5-5`. |
| `OPEN_METEO_API_KEY` | Recommended for Production | Removes public rate limits (~600 calls/min, 10k/day) for ERA5 weather archives and forecasts. |
| `CDSE_CLIENT_ID` & `CDSE_CLIENT_SECRET` | Optional | Unlocks Sentinel-2 NDVI/NDMI field-level statistics via Copernicus Data Space (Sentinel Hub). |
| `GEE_SERVICE_ACCOUNT_KEY_FILE` & `GEE_PROJECT` | Optional | Google Earth Engine service account credentials for CHIRPS bias correction and WorldCover maps. |
| `API_KEYS` | Optional | Comma-separated API keys required on `/api/v1/batch` (open if unset). |
| `LOG_LEVEL` | Optional | Fastify log level (`info`, `warn`, `error`, `debug`). |

---

## 4. Healthcheck & Orchestration

The project includes `railway.json` which declares:

```json
{
  "$schema": "https://railway.com/railway.schema.json",
  "build": {
    "builder": "DOCKERFILE",
    "dockerfilePath": "Dockerfile"
  },
  "deploy": {
    "numReplicas": 1,
    "sleepApplication": false,
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 10,
    "healthcheckPath": "/api/health",
    "healthcheckTimeout": 60
  }
}
```

- **Healthcheck Path:** `/api/health` returns HTTP 200 with uptime, system status, integrations, and contact email.
- **Graceful Shutdown:** The server listens for `SIGTERM` and `SIGINT` signals, safely terminates open HTTP connections, and closes the SQLite database connection before shutdown.
- **Reverse Proxy Support:** Fastify is configured with `trustProxy: true` to properly detect client IPs behind Railway's Edge routers and rate limit appropriately.

---

## 5. Custom Domain & Networking

1. In Railway, navigate to **Settings** → **Networking**.
2. Click **Generate Domain** (gives you a `*.up.railway.app` URL).
3. To attach a custom domain (e.g. `fieldsense.sensegrass.com`):
   - Click **Custom Domain**.
   - Enter your domain name and follow the DNS CNAME instructions.
   - Railway will automatically provision a free Let's Encrypt SSL/TLS certificate.

---

## 6. Verification Checklist

After deploying to Railway:

- [ ] Check `https://<your-app>.up.railway.app/api/health` returns:
  ```json
  {
    "ok": true,
    "status": "healthy",
    "service": "FieldSense",
    "contact": "lalit@sensegrass.com",
    "integrations": { ... }
  }
  ```
- [ ] Open `https://<your-app>.up.railway.app` in your browser.
- [ ] Drop a pin on the map and run "Check this field".
- [ ] Verify that saving a field persists after restarting or redeploying the Railway service (confirms Volume `/app/data` is active).

---

## 7. Support & Enterprise Assistance

For assistance with enterprise setup, custom agro-satellite feeds, or dedicated models:
- **Lalit Gautam**
- **Email:** [lalit@sensegrass.com](mailto:lalit@sensegrass.com)
- **Organization:** SenseGrass Inc.
