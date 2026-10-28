import { agrisMode } from "./agris.ts";
import { buildApp } from "./app.ts";
import { assertConfig, authEnabled, config } from "./config.ts";
import { closeDb, dataPersistent } from "./lib/cache.ts";
import { closeMongo, connectMongo } from "./lib/mongoose.ts";

assertConfig();
const app = await buildApp();

await app.listen({ port: config.port, host: "0.0.0.0" });
app.log.info(`FieldSense API on :${config.port} — Agris: ${agrisMode()} — accounts: ${authEnabled() ? "on" : "off"} — contact: ${config.contactEmail}`);
if (!dataPersistent) app.log.warn("SQLite is not on the configured DATA_DIR; caches and saved fields will be lost on redeploy (see RAILWAY.md, Volumes).");
if (config.production && !authEnabled()) app.log.warn("Accounts are off (no MONGO_URI): saved fields are shared by everyone who can reach this server.");
// Listen first so the platform health check passes while the database is still connecting.
if (authEnabled()) void connectMongo(app.log);

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info(`${signal} received, shutting down`);
  setTimeout(() => { app.log.error("Shutdown timed out; forcing exit"); process.exit(1); }, 10_000).unref();
  try {
    await app.close();
    await closeMongo();
    closeDb();
    process.exit(0);
  } catch (err) {
    app.log.error({ err }, "Error during shutdown");
    process.exit(1);
  }
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("unhandledRejection", (err) => app.log.error({ err }, "unhandled rejection"));
