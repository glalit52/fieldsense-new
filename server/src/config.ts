import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const env = process.env;

export const config = {
  port: Number(env.PORT ?? 8787),
  dataDir: path.resolve(here, "../..", env.DATA_DIR || "data"),
  webDist: env.WEB_DIST ? path.resolve(env.WEB_DIST) : path.resolve(here, "../../web/dist"),
  anthropicKey: env.ANTHROPIC_API_KEY || "",
  agrisModel: env.AGRIS_MODEL || "claude-opus-5-5",
  contactEmail: env.CONTACT_EMAIL || "lalit@sensegrass.com",
  gee: {
    keyFile: env.GEE_SERVICE_ACCOUNT_KEY_FILE || "",
    project: env.GEE_PROJECT || "",
  },
  cdse: {
    clientId: env.CDSE_CLIENT_ID || "",
    clientSecret: env.CDSE_CLIENT_SECRET || "",
  },
  openWeatherKey: env.OPENWEATHER_API_KEY || "",
  openMeteoKey: env.OPEN_METEO_API_KEY || "",
  userAgent: `FieldSense/1.0 (${env.CONTACT_EMAIL || "lalit@sensegrass.com"})`,
};

export function integrationStatus() {
  return {
    openMeteo: true,
    nasaPower: true,
    soilGrids: true,
    modisOrnl: true,
    sentinelStac: true,
    sentinelHub: Boolean(config.cdse.clientId && config.cdse.clientSecret),
    earthEngine: Boolean(config.gee.keyFile),
    openWeather: Boolean(config.openWeatherKey),
    claude: Boolean(config.anthropicKey),
  };
}
