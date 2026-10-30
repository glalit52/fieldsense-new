import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const env = process.env;
const list = (v?: string) => (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);

export const config = {
  production: env.NODE_ENV === "production",
  port: Number(env.PORT ?? 8787),
  /** "::" accepts IPv4 and IPv6; falls back to 0.0.0.0 where IPv6 is off (see index.ts). */
  host: env.HOST || "::",
  /** Build identity shown in /api/health: Railway's commit SHA when deployed, else the package version. */
  version: env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) || env.APP_VERSION || "1.1.0",
  environment: env.RAILWAY_ENVIRONMENT_NAME || env.NODE_ENV || "development",
  dataDir: path.resolve(here, "../..", env.DATA_DIR || "data"),
  webDist: env.WEB_DIST ? path.resolve(env.WEB_DIST) : path.resolve(here, "../../web/dist"),
  /** Accounts and per-user fields are switched on by MONGO_URI; without it saved fields live in local SQLite (single user). */
  mongoUri: env.MONGO_URI || "",
  jwtSecret: env.JWT_SECRET || "",
  jwtExpiresIn: env.JWT_EXPIRES_IN || "7d",
  authTokenKey: env.AUTH_TOKEN_KEY || env.VITE_AUTH_TOKEN_KEY || env.TOKEN_KEY || "fieldsense_auth_token",
  authCookieName: env.AUTH_COOKIE_NAME || env.SESSION_COOKIE_NAME || "fs_session",
  /** Browser origins allowed to call the API cross-origin. Empty = same-origin only (the API serves the web app). */
  corsOrigins: list(env.CORS_ORIGINS),
  /** Accounts with these emails get the admin role (user list, usage stats). */
  adminEmails: list(env.ADMIN_EMAILS).map((e) => e.toLowerCase()),
  apiKeys: list(env.API_KEYS),
  anthropicKey: env.ANTHROPIC_API_KEY || "",
  agrisModel: env.AGRIS_MODEL || "claude-opus-5-5",
  contactEmail: env.CONTACT_EMAIL || "lalit@sensegrass.com",
  gee: {
    keyFile: env.GEE_SERVICE_ACCOUNT_KEY_FILE || "",
    /** Inline service-account JSON, for hosts like Railway where mounting a key file is awkward. */
    keyJson: env.GEE_SERVICE_ACCOUNT_KEY || "",
    project: env.GEE_PROJECT || "",
  },
  cdse: {
    clientId: env.CDSE_CLIENT_ID || "",
    clientSecret: env.CDSE_CLIENT_SECRET || "",
  },
  openWeatherKey: env.OPENWEATHER_API_KEY || "",
  alerts: {
    /** Daily forecast scan of saved fields for frost, heat, heavy rain, gusts, blight and spray windows. */
    enabled: env.ALERTS_ENABLED !== "false",
    /** Resend (resend.com) key and sender, e.g. "FieldSense <alerts@sensegrass.com>"; without both, alerts stay in the app. */
    resendKey: env.RESEND_API_KEY || "",
    from: env.ALERTS_FROM || "",
  },
  /** Public URL of the app for links in emails. */
  appUrl: env.APP_URL || (env.RAILWAY_PUBLIC_DOMAIN ? `https://${env.RAILWAY_PUBLIC_DOMAIN}` : ""),
  openMeteoKey: env.OPEN_METEO_API_KEY || "",
  userAgent: `FieldSense/1.0 (${env.CONTACT_EMAIL || "lalit@sensegrass.com"})`,
};

export const authEnabled = () => Boolean(config.mongoUri);

/** Refuse to boot with a configuration that would be insecure in production. */
export function assertConfig() {
  if (!authEnabled()) return;
  if (config.jwtSecret.length >= 32) return;
  if (config.production) throw new Error("JWT_SECRET must be set to at least 32 random characters when MONGO_URI is set (try: openssl rand -hex 32)");
  config.jwtSecret = "dev-only-insecure-jwt-secret-change-me-0000";
  console.warn("[FieldSense] JWT_SECRET is not set; using an insecure development secret.");
}

export function integrationStatus() {
  return {
    accounts: authEnabled(),
    openMeteo: true,
    nasaPower: true,
    soilGrids: true,
    modisOrnl: true,
    sentinelStac: true,
    sentinelHub: Boolean(config.cdse.clientId && config.cdse.clientSecret),
    earthEngine: Boolean(config.gee.keyFile || config.gee.keyJson),
    openWeather: Boolean(config.openWeatherKey),
    claude: Boolean(config.anthropicKey),
    alertEmails: Boolean(config.alerts.resendKey && config.alerts.from),
  };
}
