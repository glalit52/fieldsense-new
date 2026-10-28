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
}
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
export interface SavedField {
  id: string;
  name: string;
  lat: number;
  lon: number;
  polygon: LonLat[] | null;
  notes: string;
  summary: Record<string, any> | null;
  tests: SoilTest[];
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

async function request<T>(
  path: string,
  init: RequestInit & { json?: unknown } = {},
): Promise<T> {
  const { json, ...rest } = init;
  const token = getToken();
  const safeHeaderKey = `x-${AUTH_TOKEN_KEY.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const authHeaders: Record<string, string> = token
    ? {
        Authorization: `Bearer ${token}`,
        "X-Auth-Token": token,
        ...(safeHeaderKey.length > 2 ? { [safeHeaderKey]: token } : {}),
      }
    : {};

  const res = await fetch(path, {
    credentials: "same-origin",
    ...rest,
    headers: {
      ...authHeaders,
      ...(json !== undefined ? JSON_HEADERS : {}),
      ...rest.headers,
    },
    ...(json !== undefined && { body: JSON.stringify(json) }),
  });
  if (!res.ok) {
    if (res.status === 401 && path.startsWith("/api/auth/me")) {
      setToken(null);
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
  const token = getToken();
  const safeHeaderKey = `x-${AUTH_TOKEN_KEY.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const authHeaders: Record<string, string> = token
    ? {
        Authorization: `Bearer ${token}`,
        "X-Auth-Token": token,
        ...(safeHeaderKey.length > 2 ? { [safeHeaderKey]: token } : {}),
      }
    : {};
  const res = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    headers: { ...JSON_HEADERS, ...authHeaders },
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
) {
  const reader = await stream("/api/agris", {
    reportId,
    question,
    conversationId,
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
