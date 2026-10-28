# Deploying FieldSense on Railway

FieldSense ships as one Docker container: the Fastify API also serves the built React app. `railway.json` tells Railway to build the `Dockerfile` and health-check `/api/health`.

## 1. Create the service

**Dashboard:** New Project → Deploy from GitHub repo → pick this repository. Railway detects `railway.json` and builds the Dockerfile.

**CLI:**

```bash
npm i -g @railway/cli
railway login
railway init        # or: railway link, for an existing project
railway up
```

Then **Settings → Networking → Generate Domain** for a `*.up.railway.app` URL, or add a custom domain (Railway issues the TLS certificate).

## 2. Add a volume (required)

SQLite at `/app/data` holds the upstream data cache (35 years of weather per area, soil, satellite) and Agris report IDs; without accounts it also holds saved fields. Without a volume all of that resets on every deploy.

Service → **Volumes → Add Volume**, mount path **`/app/data`**.

Railway mounts volumes owned by root. The container's entrypoint (`docker-entrypoint.sh`) takes ownership of the volume and then runs the server as the unprivileged `node` user, so no `RAILWAY_RUN_UID` setting is needed. `GET /api/health` reports `database.persistent: true` when the database is on the volume; if it says `false`, the volume is missing or not writable and the logs say so at boot.

Keep **one replica**: SQLite on a volume can't be shared between instances.

## 3. Variables

Set these under the service's **Variables** tab. `PORT` is injected by Railway; `NODE_ENV`, `DATA_DIR` and `WEB_DIST` are set in the Dockerfile.

### Accounts (recommended for any public URL)

Without `MONGO_URI`, saved fields are shared by everyone who can open the site. With it, people sign up and each sees only their own fields.

| Variable | Value |
|---|---|
| `MONGO_URI` | MongoDB connection string, e.g. MongoDB Atlas `mongodb+srv://USER:PASSWORD@cluster.example.mongodb.net/fieldsense`. Railway's MongoDB plugin works too: reference its `MONGO_URL` as `${{MongoDB.MONGO_URL}}`. |
| `JWT_SECRET` | **Required with `MONGO_URI`.** At least 32 random characters: `openssl rand -hex 32`. The server refuses to start in production without it. Changing it signs everyone out. |
| `JWT_EXPIRES_IN` | Session length, default `7d`. |

**MongoDB Atlas network access:** Railway does not have fixed outbound IPs on most plans, so in Atlas → Network Access allow `0.0.0.0/0` (access is still protected by the database user's password), or use Railway's static outbound IPs if your plan has them. If the database is unreachable, the app keeps serving field checks; sign-in returns 503 and the server retries the connection with backoff. `GET /api/health` shows `accounts.connected`.

### Data sources and assistant (optional)

| Variable | When to set |
|---|---|
| `OPEN_METEO_API_KEY` | Recommended in production. The free tier (~600 calls/min, 10k/day) runs out quickly because each new area pulls a 35-year archive. |
| `ANTHROPIC_API_KEY` | Runs Agris on Claude. Without it, Agris answers with built-in rules. |
| `AGRIS_MODEL` | Claude model for Agris, default `claude-opus-5-5`. |
| `CDSE_CLIENT_ID`, `CDSE_CLIENT_SECRET` | Copernicus Data Space (Sentinel Hub) field statistics and NDVI images. |
| `GEE_SERVICE_ACCOUNT_KEY`, `GEE_PROJECT` | Google Earth Engine. Paste the whole service-account JSON into `GEE_SERVICE_ACCOUNT_KEY` (Railway has no convenient way to mount a key file). |
| `CONTACT_EMAIL` | Shown in the app and sent in the User-Agent to Nominatim and ORNL, which require a contact. Default `lalit@sensegrass.com`. |
| `API_KEYS` | Comma-separated keys for `POST /api/v1/batch` (`x-api-key` header). Leave empty only if the batch API should be open. |
| `CORS_ORIGINS` | Other websites allowed to call the API from a browser. Not needed for the bundled web app. |
| `LOG_LEVEL` | `info` (default), `warn`, `debug`. |

## 4. What the deployment does

- **Build:** multi-stage Dockerfile. The web app is built in one stage, the server's production dependencies are installed in another, and the final image holds only `server/src`, production `node_modules` and `web/dist`.
- **Health check:** `/api/health` returns 200 as long as the process serves requests. A MongoDB or upstream-API outage shows in the response body rather than failing the deploy.
- **Shutdown:** on `SIGTERM` the server stops accepting connections, closes MongoDB and SQLite, and exits; `drainingSeconds: 15` gives it time. It force-exits after 10 s if something hangs.
- **Behind Railway's proxy:** `trustProxy` is on, so rate limits key on the real client IP. Session cookies are `HttpOnly`, `SameSite=Lax` and `Secure`. HSTS is sent in production.
- **Caching:** fingerprinted assets are served `immutable` for a year and `index.html` is `no-cache`, so a deploy is picked up on the next page load. JSON responses and the streamed report are gzipped.
- **Limits:** 120 requests/min per IP overall; 10/min on sign-in, sign-up and password endpoints; 30/min on Agris; 10/min on the batch API.

## 5. Check the deployment

- [ ] `https://<app>.up.railway.app/api/health` → `"status": "healthy"`, `database.persistent: true`, and with accounts `accounts.connected: true`.
- [ ] Open the site, drop a pin, press **Check this field**.
- [ ] With accounts: create an account, save the field, redeploy, sign in again: the field is still there.
- [ ] Without accounts: save a field, redeploy: it is still there (confirms the volume).

## Running the same image locally

```bash
docker build -t fieldsense .
docker run -p 8787:8787 --env-file .env -v fieldsense-data:/app/data fieldsense
```

## Support

Lalit Gautam · [lalit@sensegrass.com](mailto:lalit@sensegrass.com) · SenseGrass Inc.
