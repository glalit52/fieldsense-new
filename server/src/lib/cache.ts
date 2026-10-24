import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { config } from "../config.ts";

fs.mkdirSync(config.dataDir, { recursive: true });
export const db = new DatabaseSync(path.join(config.dataDir, "fieldsense.db"));
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS cache (key TEXT PRIMARY KEY, value TEXT NOT NULL, expires INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS fields (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, lat REAL NOT NULL, lon REAL NOT NULL,
    polygon TEXT, notes TEXT, created INTEGER NOT NULL, updated INTEGER NOT NULL, summary TEXT
  );
  CREATE TABLE IF NOT EXISTS soil_tests (
    id INTEGER PRIMARY KEY AUTOINCREMENT, field_id TEXT NOT NULL, date TEXT NOT NULL,
    ph REAL, organic_carbon REAL, clay REAL, p REAL, k REAL, notes TEXT
  );
`);

const getStmt = db.prepare("SELECT value, expires FROM cache WHERE key = ?");
const setStmt = db.prepare("INSERT OR REPLACE INTO cache (key, value, expires) VALUES (?, ?, ?)");
const inflight = new Map<string, Promise<unknown>>();

export const DAY = 86_400_000;

/** Read-through cache with request coalescing. Failed fetches are never cached. */
export async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const row = getStmt.get(key) as { value: string; expires: number } | undefined;
  if (row && row.expires > Date.now()) return JSON.parse(row.value) as T;
  const pending = inflight.get(key);
  if (pending) return pending as Promise<T>;
  const p = fn()
    .then((v) => {
      setStmt.run(key, JSON.stringify(v), Date.now() + ttlMs);
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

/** Close SQLite database connection cleanly during graceful shutdown. */
export function closeDb() {
  try {
    db.close();
  } catch {
    // Ignore if already closed
  }
}

