export type LonLat = [number, number];
export type Report = any; // shape defined by server/src/engine/report.ts

export interface CheckInput {
  lat: number;
  lon: number;
  polygon?: LonLat[];
  lab?: { ph?: number; organicCarbon?: number; clay?: number };
  cropId?: string;
  limeTargetPh?: number;
  limeDepthCm?: number;
}

export interface User {
  id: string;
  name: string;
  email: string;
  organization: string;
  role: string;
  createdAt: string;
  alertEmails?: boolean;
}

/** Stands in for a signed-in user when the server runs without accounts (no MONGO_URI): fields are shared locally. */
export const LOCAL_USER: User = { id: "local", name: "Local workspace", email: "", organization: "", role: "user", createdAt: "" };
export interface SoilTest {
  id: string;
  date: string;
  ph: number | null;
  organicCarbon: number | null;
  clay: number | null;
  p: number | null;
  k: number | null;
  notes: string;
}
export type ActivityType = "sowing" | "fertiliser" | "spraying" | "irrigation" | "tillage" | "scouting" | "harvest" | "other";
export interface Activity {
  id: string;
  date: string;
  type: ActivityType;
  crop: string;
  product: string;
  quantity: number | null;
  unit: string;
  cost: number | null;
  yieldTPerHa: number | null;
  notes: string;
}
/** One archived check of a saved field, as the history list shows it. */
export interface CheckMeta {
  id: string;
  checkedAt: string;
  headline: string;
  soilPh: number | null;
  organicCarbonPct: number | null;
  labUsed: boolean;
  rainPerYear: number;
  lime: { call: string; rateTPerHa: number };
  topCrops: { id: string; name: string; score: number; median: number }[];
  risks: { id: string; label: string; level: "low" | "moderate" | "high" }[];
  landChangePct: number | null;
  selectedCrop: string | null;
}
export interface SeasonReview {
  harvestDate: string; year: number; crop: string; cropId: string | null; actual: number;
  modelled: number | null; typical: number | null; good: number | null; irrigated: number | null; gapPct: number | null;
  verdict: "above" | "on par" | "below" | "no model";
  weather: { year: number; rain: number; rainNormal: number; rainPct: number; hotDays: number; hotDaysNormal: number; longestDrySpell: number; drySpellNormal: number } | null;
  inputs: { sowingDate: string | null; fertiliserEntries: number; irrigationMm: number; spend: number };
  reasons: string[];
}
export interface NutrientPlan {
  crop: { id: string; name: string; product: string };
  targetYield: number;
  basis: { nSupplyKgHa: number; nRecovery: number; legume: boolean; organicCarbonPct: number | null; ph: number | null; p: number | null; k: number | null; pClass: string | null; kClass: string | null; uptakePerTonne: { n: number; p2o5: number; k2o: number } };
  nutrients: { n: number; p2o5: number; k2o: number };
  products: { name: string; grade: string; kgPerHa: number }[];
  applications: { date: string; daysAfterSowing: number; stage: string; n: number; p2o5: number; k2o: number; products: { name: string; grade: string; kgPerHa: number }[] }[];
  notes: string[];
}
export type AlertKind = "frost_hard" | "frost_light" | "heat" | "heavy_rain" | "gusts" | "blight" | "disease" | "spray";
export interface FieldAlert {
  id: string; fieldId: string; fieldName: string; kind: AlertKind; level: "danger" | "warn" | "info";
  day: string; value: number | null; detail: { from?: string; to?: string } | null; created: number; read: boolean;
}
export interface AlertsState { alerts: FieldAlert[]; unread: number; email: { available: boolean; enabled: boolean } }

export interface AdminUser extends User {
  lastLogin: string | null;
  fields: number;
}
export interface SavedField {
  id: string;
  name: string;
  lat: number;
  lon: number;
  polygon: LonLat[] | null;
  notes: string;
  summary: Record<string, any> | null;
  tests: SoilTest[];
  activities: Activity[];
  created: number;
  updated: number;
}

/** An API error with its HTTP status, so callers can tell "please sign in" (401) from a failure. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Dynamic Auth Token Key resolved from environment variables:
 * Priority: VITE_TOKEN_KEY -> VITE_AUTH_TOKEN_KEY -> TOKEN_KEY -> default
 */
export const AUTH_TOKEN_KEY: string =
  (import.meta as any).env?.VITE_TOKEN_KEY ||
  (import.meta as any).env?.VITE_AUTH_TOKEN_KEY ||
  (import.meta as any).env?.TOKEN_KEY ||
  "fieldsense_auth_token";

export interface DecodedTokenPayload {
  sub: string;
  email?: string;
  name?: string;
  role?: string;
  tokenKey?: string;
  iat?: number;
  exp?: number;
}

/**
 * Decodes base64url-encoded JWT payload client-side end-to-end.
 */
export function decodeJwt(token: string): DecodedTokenPayload | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const base64Url = parts[1];
    const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split("")
        .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
        .join("")
    );
    return JSON.parse(jsonPayload);
  } catch {
    return null;
  }
}

/**
 * Checks whether a decoded JWT token has expired.
 */
export function isJwtExpired(token: string): boolean {
  const decoded = decodeJwt(token);
  if (!decoded || !decoded.exp) return false;
  return decoded.exp * 1000 < Date.now();
}

export function getToken(): string | null {
  try {
    const token = localStorage.getItem(AUTH_TOKEN_KEY);
    if (!token) return null;
    if (isJwtExpired(token)) {
      localStorage.removeItem(AUTH_TOKEN_KEY);
      return null;
    }
    return token;
  } catch {
    return null;
  }
}

export function setToken(token: string | null) {
  try {
    if (token) localStorage.setItem(AUTH_TOKEN_KEY, token);
    else localStorage.removeItem(AUTH_TOKEN_KEY);
  } catch {}
}

const JSON_HEADERS = { "content-type": "application/json" };

let unauthorized: (() => void) | null = null;
/** Called when a signed-in request comes back 401 (session expired or revoked elsewhere). */
export function onUnauthorized(fn: (() => void) | null) {
  unauthorized = fn;
}

function authHeaders(): Record<string, string> {
  const token = getToken();
  if (!token) return {};
  const safeHeaderKey = `x-${AUTH_TOKEN_KEY.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return {
    Authorization: `Bearer ${token}`,
    "X-Auth-Token": token,
    ...(safeHeaderKey.length > 2 ? { [safeHeaderKey]: token } : {}),
  };
}

async function request<T>(
  path: string,
  init: RequestInit & { json?: unknown } = {},
): Promise<T> {
  const { json, ...rest } = init;
  const res = await fetch(path, {
    credentials: "same-origin",
    ...rest,
    headers: {
      ...authHeaders(),
      ...(json !== undefined ? JSON_HEADERS : {}),
      ...rest.headers,
    },
    ...(json !== undefined && { body: JSON.stringify(json) }),
  });
  if (!res.ok) {
    if (res.status === 401) {
      if (path.startsWith("/api/auth/me")) setToken(null);
      // Wrong credentials on sign-in are a form error, not an expired session.
      else if (!/^\/api\/auth\/(login|signup|password)/.test(path) && !(path === "/api/auth/me" && rest.method === "DELETE")) {
        setToken(null);
        unauthorized?.();
      }
    }
    throw new ApiError(
      res.status,
      (await res.json().catch(() => null))?.error ??
        `Request failed (HTTP ${res.status})`,
    );
  }
  return res.json();
}

/** Starts a streamed POST and returns its text reader, or throws the server's error. */
async function stream(path: string, body: unknown) {
  const res = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    headers: { ...JSON_HEADERS, ...authHeaders() },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body)
    throw new ApiError(
      res.status,
      (await res.json().catch(() => null))?.error ?? `HTTP ${res.status}`,
    );
  return res.body.pipeThrough(new TextDecoderStream()).getReader();
}



export async function runReport(
  input: CheckInput,
  onProgress: (s: string) => void,
): Promise<{ report: Report; reportId: string }> {
  const reader = await stream("/api/report", input);
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (!line.trim()) continue;
      const msg = JSON.parse(line);
      if (msg.type === "progress") onProgress(msg.stage);
      else if (msg.type === "report")
        return { report: msg.report, reportId: msg.reportId };
      else if (msg.type === "error") throw new Error(msg.error);
    }
  }
  throw new Error(
    "The connection closed before the report finished. Please try again.",
  );
}

export async function* askAgris(
  reportId: string,
  question: string,
  conversationId?: string,
  language?: string,
) {
  const reader = await stream("/api/agris", {
    reportId,
    question,
    conversationId,
    language,
  });
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buf += value;
    let i: number;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, i);
      buf = buf.slice(i + 2);
      if (chunk.startsWith("data: ")) yield JSON.parse(chunk.slice(6));
    }
  }
}

/** Fetches a PDF (with the session's auth) and saves it under the server's filename. */
async function downloadPdf(path: string, init: RequestInit & { json?: unknown } = {}) {
  const { json, ...rest } = init;
  const res = await fetch(path, {
    credentials: "same-origin",
    ...rest,
    headers: { ...authHeaders(), ...(json !== undefined ? JSON_HEADERS : {}) },
    ...(json !== undefined && { body: JSON.stringify(json) }),
  });
  if (!res.ok) throw new ApiError(res.status, (await res.json().catch(() => null))?.error ?? `HTTP ${res.status}`);
  const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? "fieldsense-report.pdf";
  const a = document.createElement("a");
  a.href = URL.createObjectURL(await res.blob());
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

export const api = {
  health: () => request<any>("/api/health"),
  geocode: (q: string) =>
    request<any[]>(`/api/geocode?q=${encodeURIComponent(q)}`),
  land: (body: { lat: number; lon: number; polygon?: LonLat[] }) =>
    request<any>("/api/land", { method: "POST", json: body }),
  satellite: (body: {
    lat: number;
    lon: number;
    polygon?: LonLat[];
    days?: number;
  }) => request<any>("/api/satellite", { method: "POST", json: body }),

  fields: () => request<SavedField[]>("/api/fields"),
  saveField: (f: {
    name: string;
    lat: number;
    lon: number;
    polygon?: LonLat[] | null;
    notes?: string;
    summary?: Record<string, any>;
  }) => request<SavedField>("/api/fields", { method: "POST", json: f }),
  updateField: (
    id: string,
    f: { name?: string; notes?: string; summary?: Record<string, any> },
  ) => request<SavedField>(`/api/fields/${id}`, { method: "PUT", json: f }),
  deleteField: (id: string) =>
    request<{ ok: true }>(`/api/fields/${id}`, { method: "DELETE" }),
  addTest: (id: string, t: Record<string, string>) =>
    request<SavedField>(`/api/fields/${id}/tests`, { method: "POST", json: t }),
  deleteTest: (id: string, testId: string) =>
    request<SavedField>(`/api/fields/${id}/tests/${testId}`, {
      method: "DELETE",
    }),
  importFields: (fields: { name: string; lat?: number; lon?: number; polygon?: LonLat[]; notes?: string }[]) =>
    request<{ created: number; fields: SavedField[] }>("/api/fields/import", {
      method: "POST",
      json: { fields },
    }),
  addActivity: (id: string, a: Record<string, string>) =>
    request<SavedField>(`/api/fields/${id}/activities`, {
      method: "POST",
      json: a,
    }),
  deleteActivity: (id: string, activityId: string) =>
    request<SavedField>(`/api/fields/${id}/activities/${activityId}`, {
      method: "DELETE",
    }),

  archiveCheck: (fieldId: string, reportId: string) =>
    request<{ check: CheckMeta; field: SavedField }>(`/api/fields/${fieldId}/checks`, { method: "POST", json: { reportId } }),
  checks: (fieldId: string) => request<CheckMeta[]>(`/api/fields/${fieldId}/checks`),
  openCheck: (fieldId: string, checkId: string) =>
    request<{ check: CheckMeta; report: Report; reportId: string }>(`/api/fields/${fieldId}/checks/${checkId}`),
  deleteCheck: (fieldId: string, checkId: string) =>
    request<{ ok: true }>(`/api/fields/${fieldId}/checks/${checkId}`, { method: "DELETE" }),
  review: (fieldId: string) =>
    request<{ checkedAt: string | null; seasons: SeasonReview[]; message?: string }>(`/api/fields/${fieldId}/review`),
  fieldPdf: (fieldId: string, checkId?: string) =>
    downloadPdf(`/api/fields/${fieldId}/report.pdf${checkId ? `?check=${encodeURIComponent(checkId)}` : ""}`),
  reportPdf: (reportId: string, fieldName?: string) =>
    downloadPdf("/api/report.pdf", { method: "POST", json: { reportId, fieldName } }),
  nutrients: (b: { reportId: string; cropId?: string; targetYield?: number; p?: number | null; k?: number | null; sowingDate?: string }) =>
    request<NutrientPlan>("/api/nutrients", { method: "POST", json: b }),

  alerts: () => request<AlertsState>("/api/alerts"),
  refreshAlerts: () => request<AlertsState & { scanned: number; raised: number }>("/api/alerts/refresh", { method: "POST" }),
  readAlerts: (ids?: string[]) => request<{ ok: true }>("/api/alerts/read", { method: "POST", json: ids ? { ids } : {} }),
  alertSettings: (email: boolean) =>
    request<{ email: AlertsState["email"] }>("/api/alerts/settings", { method: "PUT", json: { email } }),

  adminStats: () => request<Record<string, number>>("/api/admin/stats"),
  adminUsers: (q = "", page = 0) =>
    request<{ total: number; page: number; limit: number; users: AdminUser[] }>(
      `/api/admin/users?${new URLSearchParams({ q, page: String(page) })}`,
    ),
  setRole: (id: string, role: "user" | "admin") =>
    request<{ user: User }>(`/api/admin/users/${id}`, {
      method: "PATCH",
      json: { role },
    }).then((r) => r.user),

  me: () => request<{ user: User }>("/api/auth/me").then((r) => r.user),
  login: (email: string, password: string) =>
    request<{ user: User; token?: string }>("/api/auth/login", {
      method: "POST",
      json: { email, password },
    }).then((r) => {
      if (r.token) setToken(r.token);
      return r.user;
    }),
  signup: (b: {
    name: string;
    email: string;
    password: string;
    organization?: string;
  }) =>
    request<{ user: User; token?: string }>("/api/auth/signup", {
      method: "POST",
      json: b,
    }).then((r) => {
      if (r.token) setToken(r.token);
      return r.user;
    }),
  logout: () =>
    request<{ ok: true }>("/api/auth/logout", { method: "POST" }).finally(
      () => {
        setToken(null);
      },
    ),
  updateProfile: (b: { name?: string; organization?: string }) =>
    request<{ user: User }>("/api/auth/me", { method: "PATCH", json: b }).then(
      (r) => r.user,
    ),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ ok: true }>("/api/auth/password", {
      method: "POST",
      json: { currentPassword, newPassword },
    }),
  deleteAccount: (password: string) =>
    request<{ ok: true }>("/api/auth/me", {
      method: "DELETE",
      json: { password },
    }).finally(() => {
      setToken(null);
    }),
};
