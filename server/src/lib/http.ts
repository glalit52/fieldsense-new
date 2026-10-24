import { config } from "../config.ts";

export class UpstreamError extends Error {
  status: number;
  source: string;
  constructor(source: string, status: number, message: string) {
    super(`${source}: ${message}`);
    this.source = source;
    this.status = status;
  }
}

interface FetchOpts extends RequestInit {
  timeoutMs?: number;
  retries?: number;
  source?: string;
}

/** fetch + JSON with timeout and exponential backoff on 429/5xx/network errors. */
export async function getJson<T = any>(url: string, opts: FetchOpts = {}): Promise<T> {
  const { timeoutMs = 30_000, retries = 2, source = new URL(url).host, ...init } = opts;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        ...init,
        headers: { "User-Agent": config.userAgent, Accept: "application/json", ...(init.headers ?? {}) },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.ok) return (await res.json()) as T;
      // Keep error text short and readable (strip HTML error pages).
      const body = (await res.text()).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 160);
      lastErr = new UpstreamError(source, res.status, `HTTP ${res.status} ${body}`);
      if (res.status !== 429 && res.status < 500) throw lastErr;
    } catch (e) {
      lastErr = e;
      if (e instanceof UpstreamError && e.status !== 429 && e.status < 500) throw e;
    }
    if (attempt < retries) {
      // Minutely quotas (e.g. Open-Meteo) need a full minute; otherwise exponential backoff.
      const minute = lastErr instanceof UpstreamError && lastErr.status === 429 && /minute/i.test(lastErr.message);
      await new Promise((r) => setTimeout(r, minute ? 61_000 : 800 * 2 ** attempt));
    }
  }
  throw lastErr instanceof Error ? lastErr : new UpstreamError(source, 0, String(lastErr));
}

/** Run async tasks with a concurrency cap. */
export async function pool<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}
