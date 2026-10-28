import type { FastifyReply, FastifyRequest } from "fastify";
import jwt from "jsonwebtoken";
import { config } from "../config.ts";
import { isAdmin, User, type UserDoc } from "../models/User.ts";
import { isMongoConnected } from "./mongoose.ts";
import { HttpError } from "./validate.ts";

export const SESSION_COOKIE = config.authCookieName;
const crossSite = config.production && config.corsOrigins.length > 0;

declare module "fastify" {
  interface FastifyRequest {
    user?: UserDoc;
  }
}

export interface TokenPayload {
  sub: string;
  email?: string;
  role?: string;
  name?: string;
  tokenKey?: string;
  iat?: number;
  exp?: number;
}

/**
 * Encodes and signs a JWT token using dynamic secret and token key from config.
 */
export function signToken(user: UserDoc): string {
  const payload: TokenPayload = {
    sub: String(user._id),
    email: user.email,
    role: user.role,
    name: user.name,
    tokenKey: config.authTokenKey,
  };

  return jwt.sign(payload, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn as jwt.SignOptions["expiresIn"],
    algorithm: "HS256",
  });
}

/**
 * Decodes the token without cryptographic verification (useful for claims inspection).
 */
export function decodeToken(token: string): TokenPayload | null {
  try {
    return jwt.decode(token) as TokenPayload | null;
  } catch {
    return null;
  }
}

/**
 * Decodes and cryptographically verifies the token using the dynamic secret.
 */
export function verifyToken(token: string): TokenPayload | null {
  try {
    return jwt.verify(token, config.jwtSecret, { algorithms: ["HS256"] }) as TokenPayload;
  } catch {
    return null;
  }
}

/** Session cookie for the web app: HttpOnly so scripts can't read it, Secure behind HTTPS edge. */
export function setSession(reply: FastifyReply, token: string) {
  const decoded = decodeToken(token);
  const exp = decoded?.exp ? new Date(decoded.exp * 1000) : new Date(Date.now() + 7 * 86400000);
  reply.setCookie(config.authCookieName, token, {
    path: "/",
    httpOnly: true,
    // A web app on another origin (CORS_ORIGINS) only gets the cookie back with SameSite=None, which requires Secure.
    sameSite: crossSite ? "none" : "lax",
    secure: config.production || crossSite,
    expires: exp,
  });
}

export function clearSession(reply: FastifyReply) {
  reply.clearCookie(config.authCookieName, { path: "/", sameSite: crossSite ? "none" : "lax", secure: config.production || crossSite });
}

/** Extracts token dynamically from headers, dynamic token key header, dynamic cookie, or query */
export function tokenOf(req: FastifyRequest): string | undefined {
  const h = req.headers.authorization;
  if (h?.startsWith("Bearer ")) return h.slice(7).trim();

  // Dynamic header matching the env token key
  const safeHeaderKey = `x-${config.authTokenKey.replace(/[^a-zA-Z0-9_-]/g, "").toLowerCase()}`;
  const dynamicHeader = req.headers[safeHeaderKey] as string | undefined;
  if (dynamicHeader) return dynamicHeader.trim();

  // Standard x-auth-token or x-token-key
  const xAuth = (req.headers["x-auth-token"] || req.headers["x-token-key"]) as string | undefined;
  if (xAuth) return xAuth.trim();

  // Dynamic cookie. Tokens are never read from the query string: URLs end up in logs, history and Referer headers.
  return req.cookies[config.authCookieName] || req.cookies[config.authTokenKey] || undefined;
}


async function userFromToken(token: string): Promise<UserDoc | null> {
  try {
    const decoded = verifyToken(token);
    if (!decoded) return null;
    const user = await User.findById(decoded.sub);
    const iat = decoded.iat ?? 0;
    return user && !(user.passwordChangedAt && iat * 1000 < user.passwordChangedAt.getTime()) ? user : null;
  } catch (e) {
    if (e instanceof jwt.JsonWebTokenError) return null;
    throw e;
  }
}

export async function requireDb() {
  if (!isMongoConnected()) throw new HttpError(503, "Accounts are temporarily unavailable. Please try again shortly.");
}

export async function requireAuth(req: FastifyRequest) {
  await requireDb();
  const token = tokenOf(req);
  const user = token ? await userFromToken(token) : null;
  if (!user) throw new HttpError(401, "Please sign in to continue.");
  req.user = user;
}

export async function requireAdmin(req: FastifyRequest) {
  await requireAuth(req);
  if (!isAdmin(req.user!)) throw new HttpError(403, "Admins only");
}

