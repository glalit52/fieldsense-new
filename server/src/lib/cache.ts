import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { config } from "../config.ts";

/**
 * Ensures the data directory exists and has full write permissions.
 * Falls back to secondary safe locations if primary volume path is restricted.
 */
function resolveWritableDataDir(preferredDir: string): string {
  const candidates = [
    preferredDir,
    path.resolve(process.cwd(), "data"),
    path.join(os.tmpdir(), "fieldsense-data"),
  ];

  for (const candidate of candidates) {
    try {
      if (!fs.existsSync(candidate)) {
        fs.mkdirSync(candidate, { recursive: true, mode: 0o777 });
      }
      // Probe write test to guarantee SQLite can create and write files
      const probeFile = path.join(candidate, `.probe-${process.pid}-${Date.now()}`);
      fs.writeFileSync(probeFile, "ok");
      fs.unlinkSync(probeFile);
      return candidate;
    } catch (err: any) {
      console.warn(`[FieldSense] Could not initialize directory "${candidate}": ${err.message}`);
    }
  }

  throw new Error(`Failed to initialize any writable data directory for fieldsense.db. Tried: ${candidates.join(", ")}`);
}

export const dataDirectory = resolveWritableDataDir(config.dataDir);
/** False when the preferred directory (the Railway volume) was not writable and data will not survive a redeploy. */
export const dataPersistent = dataDirectory === config.dataDir;
if (!dataPersistent) console.warn(`[FieldSense] DATA_DIR "${config.dataDir}" is not writable; using "${dataDirectory}", which will NOT persist across deploys.`);
export const dbFilePath = path.join(dataDirectory, "fieldsense.db");

// Initialize SQLite database
export const db = new DatabaseSync(dbFilePath);

// Configure Pragmas safely
try {
  db.exec("PRAGMA journal_mode = WAL;");
} catch {
  try {
    db.exec("PRAGMA journal_mode = DELETE;");
  } catch {}
}
try {
  db.exec("PRAGMA synchronous = NORMAL;");
} catch {}

// Create required schemas and performance indexes
db.exec(`
  CREATE TABLE IF NOT EXISTS cache (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    expires INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_cache_expires ON cache(expires);

  CREATE TABLE IF NOT EXISTS fields (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    lat REAL NOT NULL,
    lon REAL NOT NULL,
    polygon TEXT,
    notes TEXT,
    created INTEGER NOT NULL,
    updated INTEGER NOT NULL,
    summary TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_fields_updated ON fields(updated DESC);

  CREATE TABLE IF NOT EXISTS soil_tests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    field_id TEXT NOT NULL,
    date TEXT NOT NULL,
    ph REAL,
    organic_carbon REAL,
    clay REAL,
    p REAL,
    k REAL,
    notes TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_soil_tests_field_id ON soil_tests(field_id);
`);

/** Clean up expired cache items to prevent database bloat over time. */
export function pruneExpiredCache(): number {
  try {
    const res = db.prepare("DELETE FROM cache WHERE expires < ?").run(Date.now());
    return Number(res.changes ?? 0);
  } catch {
    return 0;
  }
}

// Prune stale cache entries on boot and hourly after that
pruneExpiredCache();
setInterval(pruneExpiredCache, 3_600_000).unref();

const getStmt = db.prepare("SELECT value, expires FROM cache WHERE key = ?");
const setStmt = db.prepare("INSERT OR REPLACE INTO cache (key, value, expires) VALUES (?, ?, ?)");
const inflight = new Map<string, Promise<unknown>>();

export const DAY = 86_400_000;

export function getCache<T>(key: string): T | undefined {
  const row = getStmt.get(key) as { value: string; expires: number } | undefined;
  return row && row.expires > Date.now() ? (JSON.parse(row.value) as T) : undefined;
}

export function putCache(key: string, value: unknown, ttlMs: number) {
  setStmt.run(key, JSON.stringify(value), Date.now() + ttlMs);
}

/** Read-through cache with request coalescing. Failed fetches are never cached. */
export async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = getCache<T>(key);
  if (hit !== undefined) return hit;
  const pending = inflight.get(key);
  if (pending) return pending as Promise<T>;
  const p = fn()
    .then((v) => {
      putCache(key, v, ttlMs);
      return v;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

/** Round coordinates so nearby pins share cached upstream data (~110 m). */
export function cell(lat: number, lon: number, digits = 3) {
  return `${lat.toFixed(digits)},${lon.toFixed(digits)}`;
}

/** Retrieve database diagnostics for observability and health checks. */
export function getDbStats() {
  try {
    const stats = fs.statSync(dbFilePath);
    const fieldsCount = (db.prepare("SELECT COUNT(*) as c FROM fields").get() as any)?.c ?? 0;
    const testsCount = (db.prepare("SELECT COUNT(*) as c FROM soil_tests").get() as any)?.c ?? 0;
    const cacheCount = (db.prepare("SELECT COUNT(*) as c FROM cache").get() as any)?.c ?? 0;
    const journalMode = (db.prepare("PRAGMA journal_mode").get() as any)?.journal_mode ?? "unknown";
    return {
      status: "connected",
      dataDir: dataDirectory,
      persistent: dataPersistent,
      sizeBytes: stats.size,
      fieldsCount,
      testsCount,
      cacheEntries: cacheCount,
      journalMode,
    };
  } catch (err: any) {
    return {
      status: "error",
      dataDir: dataDirectory,
      dbPath: dbFilePath,
      error: err.message,
    };
  }
}

/** Close SQLite database connection cleanly during graceful shutdown. */
export function closeDb() {
  try {
    db.close();
  } catch {
    // Ignore if already closed
  }
}
