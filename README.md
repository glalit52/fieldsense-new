# FieldSense

**Know your field before you plant.** Drop a pin or outline a field anywhere on Earth and FieldSense reads 35 years of daily weather, soil maps, terrain and 25 years of satellite greenness. It then scores 67 crops season by season with a daily soil-water balance and returns:

- soil pH with a lime call and rate, with 80% ranges, refined by your lab test if you enter one
- the crops that fit, ranked rainfed and irrigated, with best sowing window, variety length, and yields in dry, typical and good years
- frost, heat, drought, waterlogging, erosion and soil-chemistry risks
- a 16-day operations plan: spray windows (Delta T), disease and late-blight risk, frost/heat/wind alerts, soil workability, water balance
- an ECMWF seasonal outlook and a 2045 outlook (CMIP6) that re-scores the top crops under future climate
- land health since 2000 (MODIS) and current field condition from Sentinel-2 (NDVI, NDMI, NDRE)
- **Agris**, an assistant that answers questions about the field in any language (Claude, with a rule-based fallback)
- optional accounts with private saved fields, lab tests, shareable links, CSV/JSON/print export, and a batch API for organisations
- a **field journal** per field (sowing, fertiliser, spraying, irrigation, tillage, scouting, harvest) with quantities, costs and harvested yield, plus season totals
- a **portfolio** view across saved fields: total area, average pH, fields needing lime or a lab test, re-checks due, this year's spend; search, sort and side-by-side **compare**
- **import and export** of fields as GeoJSON (points and outlines, for GIS and farm software) or CSV
- an **Admin** page for operators: users, roles and usage stats

It is inspired by agrishieldai.com and extends it: field outlines, cultivar choice, irrigated scenario, forecast operations, seasonal and 2045 outlooks, Sentinel-2 monitoring, multi-source rainfall cross-checks, US field-scale soil survey, and an organisation batch API.

---

## Quick start

Requires **Node.js 22.6 or newer** (Node 22 LTS or Node 24; the server runs TypeScript with built-in type stripping).

```bash
git clone https://github.com/glalit52/fieldsense-new.git
cd fieldsense-new
npm install
cp .env.example .env        # add any optional keys (see below)
npm run dev                 # API on :8787, web app with hot reload on :5173
```

Open http://localhost:5173. For a production-style single process (API serves the built web app):

```bash
npm start                   # builds web/ then serves everything on http://localhost:8787
```

Other scripts:

| Command | What it does |
|---|---|
| `npm test` | Engine unit tests, HTTP route tests, and account tests against a throwaway MongoDB (downloads `mongod` 7.0 on first run) |
| `npm run typecheck` | TypeScript checks for server and web |
| `npm run bench` | Calibration benchmark: do six known farming regions rank their real crops in the top 10? |
| `node server/test/smoke-api.ts` | End-to-end API smoke test against a running server |
| `node server/test/smoke-sat.ts` | Sentinel-2 endpoint smoke test |
| `node server/test/diag.ts <lat> <lon> <cropId> <MM-DD>` | Prints season-by-season water/temperature diagnostics for one crop |

Everything works with **no keys at all**. Keys only add sources or raise limits.

## Configuration (`.env`)

| Variable | Purpose |
|---|---|
| `PORT`, `DATA_DIR` | Server port (8787) and where the SQLite database lives (`./data`) |
| `MONGO_URI`, `JWT_SECRET`, `JWT_EXPIRES_IN` | Turns on accounts: sign-up/sign-in and private per-user saved fields in MongoDB. `JWT_SECRET` (32+ random chars) is required in production when `MONGO_URI` is set. Without `MONGO_URI`, saved fields live in SQLite and are shared by everyone using the server. |
| `CORS_ORIGINS` | Comma-separated browser origins allowed to call the API cross-site (default: same-origin only) |
| `ANTHROPIC_API_KEY`, `AGRIS_MODEL` | Runs Agris on Claude (default `claude-opus-5-5`). Without a key Agris uses built-in rules. |
| `GEE_SERVICE_ACCOUNT_KEY_FILE` or `GEE_SERVICE_ACCOUNT_KEY` (inline JSON), `GEE_PROJECT` | Google Earth Engine service account: field-mean MODIS and Sentinel-2, CHIRPS rainfall bias correction, ESA WorldCover, JRC surface water, MERIT Hydro terrain wetness, SoilGrids fallback, NDVI map tiles |
| `CDSE_CLIENT_ID`, `CDSE_CLIENT_SECRET` | Copernicus Data Space (Sentinel Hub) OAuth client: Statistical API field time series and NDVI images |
| `OPEN_METEO_API_KEY` | Commercial Open-Meteo key. The free tier allows about 600 calls/min and 10k/day, and the 35-year archive request is heavy, so use a key in production. |
| `OPENWEATHER_API_KEY` | Reserved for an extra forecast provider (not wired yet) |
| `CONTACT_EMAIL` | Contact email in the User-Agent and support (Default: `lalit@sensegrass.com`); required by the Nominatim and ORNL usage policies |
| `API_KEYS` | Comma-separated keys required on `/api/v1/batch` (open if unset) |
| `ADMIN_EMAILS` | Comma-separated emails that get the admin role (Admin page) |
| `HOST` | Bind address (default `::`, IPv4 + IPv6) |
| `LOG_LEVEL` | Fastify log level |

**Never commit `.env`.** It's in `.gitignore`. In deployment, set these as environment variables on the host.

---

## Architecture

```
fieldsense/
├── server/                     Node + Fastify API (TypeScript, run directly by Node)
│   └── src/
│       ├── index.ts            process bootstrap: config check, listen, MongoDB connect, graceful shutdown
│       ├── app.ts              buildApp(): plugins, security headers, error mapping, static hosting of web/dist
│       ├── config.ts           env + integration status
│       ├── agris.ts            Agris assistant (Claude streaming + rule-based fallback)
│       ├── routes/             analysis (report, land, satellite, agris), fields (+ journal, import), auth, batch, admin
│       ├── stores/fields.ts    FieldStore interface: SQLite (single-user) and MongoDB (per-user) implementations
│       ├── models/             Mongoose User and Field
│       ├── lib/                cache.ts (SQLite KV cache + fields DB), validate.ts, auth.ts (JWT sessions), mongoose.ts, http.ts, geo.ts
│       ├── providers/          one file per external data source
│       └── engine/             the agronomy models (pure functions, unit-tested)
└── web/                        React 19 + Vite + Leaflet + Recharts
    └── src/
        ├── App.tsx             layout, state, report flow, session, deep links
        ├── lib/api.ts          NDJSON report stream, SSE chat, REST helpers
        ├── lib/fieldio.ts      GeoJSON/CSV import and export
        └── components/         MapPanel, Overview, SoilTab, CropsTab, OpsTab, ClimateTab, LandTab, SatelliteTab, FutureTab, Agris, Fields, FieldJournal, Account, Admin, AuthPage, AuthDialog
```

**Report flow** (`server/src/engine/report.ts`): all upstream sources are fetched in parallel. Each is wrapped so that one failing source degrades its section instead of failing the report. The report streams progress lines (NDJSON), then the full JSON. Upstream responses are cached in SQLite (weather 30 days, soil 1 year, reports 6 hours), keyed by rounded coordinates so nearby fields share data.

### Data sources and fallback chains

| Need | Primary | Fallbacks |
|---|---|---|
| Daily weather 1991→now | ERA5 / ERA5-Land via Open-Meteo archive | none; required |
| Rainfall cross-check | NASA POWER (1981→), CHIRPS via Earth Engine | CHIRPS, when present, bias-corrects ERA5 rain |
| Forecast | Open-Meteo best-match NWP, 16 days, hourly | none |
| Seasonal | ECMWF SEAS5 51-member ensemble | none |
| Climate change | CMIP6 HighResMIP (4 models) via Open-Meteo | none |
| Soil | US: USDA SSURGO (Soil Data Access); elsewhere: ISRIC SoilGrids 2.0 REST | SoilGrids on Earth Engine, then a climate-based estimate flagged low confidence |
| Terrain | Copernicus DEM via Open-Meteo (5×5 grid: slope, aspect, TPI) | MERIT Hydro TWI / HAND via Earth Engine |
| Land health 2000→ | MODIS MOD13Q1 via Earth Engine (field mean) | NASA ORNL DAAC web service (pixel; slow first time, loads in the background) |
| Sentinel-2 | Earth Engine S2 SR harmonised | Sentinel Hub Statistical API, then **keyless** reads of Sentinel-2 L2A COGs on AWS (Element 84 Earth Search) |
| Geocoding | OpenStreetMap Nominatim | none |

Known upstream quirks handled in code: NASA POWER returns precipitation ×24 on multi-decade requests (fetched in 10-year chunks, with a per-chunk guard); ISRIC SoilGrids has outages (15-minute circuit breaker); Open-Meteo per-minute limits (61 s back-off on 429).

### The models (`server/src/engine/`)

| File | Model |
|---|---|
| `soil.ts` | Depth-weighted topsoil (0–30 cm) / subsoil (30–100 cm) with 80% ranges; USDA texture triangle; Saxton & Rawls (2006) field capacity / wilting point → plant-available water; drainage class; carbon stock; lab-test override |
| `lime.ts` | Probability topsoil pH < 5.5 from the pH distribution; lime rate = pH deficit × pH buffering capacity (from clay and organic carbon) × soil mass at incorporation depth ÷ field efficiency and neutralising value |
| `climate.ts` | Annual stats (rain, ET₀, frost, heat, dry spells, GDD, frost dates), monthly climatology with 20–80% bands, Theil–Sen trends and Mann–Kendall significance, dry/wet years, aridity class |
| `crops.ts` | 67 crops: temperature cardinal points, frost and heat limits, thermal time, rooting depth, FAO-56 Kc, FAO-33 Ky, world-class attainable yield, transpiration productivity, pH limits, waterlogging tolerance, texture preference, chill requirement, wet-season disease sensitivity |
| `simulate.ts` | Daily crop simulation: FAO-56 dual crop coefficient (basal transpiration plus soil evaporation from a surface layer), root-zone bucket with continuous fallow storage between seasons, runoff, thermal-time phenology, frost/heat at flowering, chill, waterlogging, wet-season disease. Water limitation is the stricter of FAO-33 Ky and absolute transpiration productivity. Evaluates 37 sowing dates × 3 cultivar lengths × 30 seasons per crop. Also produces the irrigated scenario and irrigation need. |
| `risk.ts` | Frost, heat, drought, waterlogging (drainage, TPI, JRC water occurrence), erosion, acidity/sodicity |
| `landhealth.ts` | NDVI smoothing, annual stats, Theil–Sen trend with Mann–Kendall p, seasonality, green-up/peak month, cropping intensity, recent anomaly |
| `operations.ts` | Spray windows (wind 3–15 km/h, Delta T 2–8 via Stull wet bulb, no rain within 4 h), leaf-wetness disease risk, late-blight Smith periods, frost/heat/gust alerts, trafficability, 7-day water balance |
| `report.ts` | Orchestration, CMIP6 delta-change future scenario, headline |

**Score** = average share of a world-class yield for that crop reached here, over 30 simulated seasons. Yields are attainable yields under good management for past seasons' weather, not forecasts. Lime rates are planning estimates, not prescriptions.

### Calibration status (`npm run bench`)

Share of each region's dominant crops that land in the top 10 (latest run 17/25):

| Region | Result | Note |
|---|---|---|
| Wimmera, Australia | 6/6 | |
| Iowa, USA | 2/2 | maize 10.9 t/ha, soybean 3.8 t/ha; SSURGO soil |
| Mato Grosso, Brazil | 3/3 | |
| Beauce, France | 3/5 | grain maize marginal; sugar beet low on the fallback soil |
| Punjab, India | 3/4 | wheat and rice are irrigated systems; use the Irrigated ranking |
| Rift Valley, Kenya | 0/5 | caused by the low-confidence fallback soil pH while SoilGrids was down |

---

## API

| Method & path | Body / query | Returns |
|---|---|---|
| `GET /api/health` | | always 200 while serving; `version`, integration status, Agris mode, SQLite stats (`persistent`), `accounts {enabled, connected}` |
| `GET /api/ready` | | 200 when SQLite and (with accounts) MongoDB are up, else 503 |
| `GET /api/crops` | | crop parameter library |
| `GET /api/geocode?q=` | | place search |
| `POST /api/report` | `{lat, lon}` or `{polygon: [[lon,lat],…]}`, optional `lab {ph, organicCarbon, clay}`, `cropId`, `limeTargetPh`, `limeDepthCm` | NDJSON: `progress` lines, then `{type:"report", reportId, report}` |
| `POST /api/land` | `{lat, lon}` or `{polygon}` | land-health analysis (used when the report says `landPending`) |
| `POST /api/satellite` | `{lat, lon}` or `{polygon}`, `days` | Sentinel-2 index series, recent scenes, optional tile URL |
| `POST /api/satellite/ndvi.png` | `{polygon}` | NDVI image (Sentinel Hub key required) |
| `POST /api/agris` | `{reportId, question, conversationId?}` | SSE stream: `meta`, `text`, `done`. Report IDs are kept 24 h and survive restarts. |
| `GET/POST /api/fields`, `GET/PUT/DELETE /api/fields/:id` | `{name, lat, lon, polygon?, notes?, summary?}` | saved fields (signed-in user's own when accounts are on) |
| `POST /api/fields/:id/tests`, `DELETE /api/fields/:id/tests/:testId` | `{date, ph?, organicCarbon?, clay?, p?, k?, notes?}` | lab tests, newest first |
| `POST /api/fields/:id/activities`, `DELETE /api/fields/:id/activities/:activityId` | `{date, type, crop?, product?, quantity?, unit?, cost?, yieldTPerHa?, notes?}`; `type` is one of sowing, fertiliser, spraying, irrigation, tillage, scouting, harvest, other | field journal, newest first |
| `POST /api/fields/import` | `{fields: [{name, lat, lon} or {name, polygon}]}` (max 200, all validated before any is saved) | `{created, fields}` |
| `GET /api/admin/stats`, `GET /api/admin/users?q=&page=`, `PATCH /api/admin/users/:id` | `{role: "user"\|"admin"}` | admins only (accounts on) |
| `POST /api/auth/signup`, `/login`, `/logout` | `{name, email, password, organization?}` / `{email, password}` | sets an HttpOnly `fs_session` cookie; API clients may send `Authorization: Bearer <token>` |
| `GET/PATCH/DELETE /api/auth/me`, `POST /api/auth/password` | | profile, edit, delete account (+ all fields, needs `{password}`), change password (signs out other sessions) |
| `POST /api/v1/batch` | `{fields: [{id, lat, lon, polygon?}]}` (max 100), header `x-api-key` if `API_KEYS` set | summaries per field |

---

## Deploying on Railway (Recommended)

FieldSense is configured for 1-click end-to-end deployment on [Railway](https://railway.com) via `railway.json` and Dockerfile. One service runs the full stack: the Docker build compiles the web app and the API serves it on the same domain, so there is nothing to connect.

1. **Deploy to Railway**: Connect this GitHub repository to a new Railway project.
2. **Persistent Volume**: add a **Volume** mounted at `/app/data` to keep the SQLite cache (and, without accounts, saved fields) across redeploys. The container takes ownership of the volume at boot, so no extra settings are needed.
3. **Environment Variables**:
   - `PORT`: Automatically set by Railway.
   - `CONTACT_EMAIL`: Defaults to `lalit@sensegrass.com` (can be overridden).
   - `OPEN_METEO_API_KEY`: Recommended for production workloads.
   - `ANTHROPIC_API_KEY`: Optional; unlocks Claude-powered agronomic assistant.
   - `MONGO_URI` + `JWT_SECRET`: Optional; turn on accounts with private saved fields. Strongly recommended for any public deployment.
4. **Health Check**: Configured to `/api/health` with automatic restart policy on failure.

See [`RAILWAY.md`](RAILWAY.md) for the comprehensive end-to-end Railway deployment guide.

### Docker Local Run

```bash
docker build -t fieldsense .
docker run -p 8787:8787 --env-file .env -v fieldsense-data:/app/data fieldsense
```

---

## Contact & Enterprise Support

FieldSense is developed in collaboration with SenseGrass. For enterprise data integrations, dedicated agronomy models, custom weather stations, or API access:

- **Contact Person:** Lalit Gautam
- **Email:** [lalit@sensegrass.com](mailto:lalit@sensegrass.com)
- **Organization:** SenseGrass Inc.

---

## Licence

All rights reserved. For licensing terms and commercial use, contact `lalit@sensegrass.com`.
