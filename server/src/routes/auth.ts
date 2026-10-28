import type { FastifyInstance } from "fastify";
import bcrypt from "bcryptjs";
import { authEnabled } from "../config.ts";
import { clearSession, requireAuth, requireDb, setSession, signToken } from "../lib/auth.ts";
import { badRequest, HttpError, str } from "../lib/validate.ts";
import { Field } from "../models/Field.ts";
import { PASSWORD_MIN, publicUser, User } from "../models/User.ts";

/** Brute-force guard on credential endpoints, on top of the global limit. */
const strict = { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } };
/** Compared against when the email is unknown, so response time doesn't reveal which emails have accounts. */
const DUMMY_HASH = bcrypt.hashSync("fieldsense-timing-guard", 12);

function password(v: unknown): string {
  if (typeof v !== "string" || v.length < PASSWORD_MIN || v.length > 200) throw badRequest(`Password must be ${PASSWORD_MIN}–200 characters`);
  return v;
}

export async function authRoutes(app: FastifyInstance) {
  if (!authEnabled()) {
    app.all("/api/auth/*", async () => { throw new HttpError(404, "Accounts are not enabled on this server"); });
    return;
  }

  app.post("/api/auth/signup", { ...strict, preHandler: requireDb }, async (req, reply) => {
    const b: any = req.body ?? {};
    const name = str(b.name, 100);
    const email = str(b.email, 254).toLowerCase();
    if (name.length < 2) throw badRequest("Please enter your name");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw badRequest("Please enter a valid email address");
    try {
      const user = await User.create({ name, email, password: password(b.password), organization: str(b.organization, 150), lastLogin: new Date() });
      const token = signToken(user);
      setSession(reply, token);
      return reply.code(201).send({ user: publicUser(user), token });
    } catch (e: any) {
      if (e?.code === 11000) throw new HttpError(409, "An account with this email already exists. Please sign in.");
      throw e;
    }
  });

  app.post("/api/auth/login", { ...strict, preHandler: requireDb }, async (req, reply) => {
    const b: any = req.body ?? {};
    const user = await User.findOne({ email: str(b.email, 254).toLowerCase() }).select("+password");
    const ok = user ? await user.comparePassword(String(b.password ?? "")) : await bcrypt.compare(String(b.password ?? ""), DUMMY_HASH);
    if (!user || !ok) throw new HttpError(401, "Wrong email or password");
    user.lastLogin = new Date();
    await user.save();
    const token = signToken(user);
    setSession(reply, token);
    return { user: publicUser(user), token };
  });


  app.post("/api/auth/logout", async (_req, reply) => {
    clearSession(reply);
    return { ok: true };
  });

  app.get("/api/auth/me", { preHandler: requireAuth }, async (req) => ({ user: publicUser(req.user!) }));

  app.patch("/api/auth/me", { preHandler: requireAuth }, async (req) => {
    const b: any = req.body ?? {};
    const u = req.user!;
    if (b.name != null) {
      if (str(b.name, 100).length < 2) throw badRequest("Please enter your name");
      u.name = str(b.name, 100);
    }
    if (b.organization != null) u.organization = str(b.organization, 150);
    await u.save();
    return { user: publicUser(u) };
  });

  app.post("/api/auth/password", { ...strict, preHandler: requireAuth }, async (req, reply) => {
    const b: any = req.body ?? {};
    const u = await User.findById(req.user!._id).select("+password");
    if (!u || !(await u.comparePassword(String(b.currentPassword ?? "")))) throw new HttpError(401, "Current password is wrong");
    u.password = password(b.newPassword);
    await u.save();
    setSession(reply, signToken(u));
    return { ok: true };
  });

  /** Deletes the account and everything saved under it. */
  app.delete("/api/auth/me", { ...strict, preHandler: requireAuth }, async (req, reply) => {
    const u = await User.findById(req.user!._id).select("+password");
    if (!u || !(await u.comparePassword(String((req.body as any)?.password ?? "")))) throw new HttpError(401, "Password is wrong");
    await Field.deleteMany({ userId: u._id });
    await u.deleteOne();
    clearSession(reply);
    return { ok: true };
  });
}
