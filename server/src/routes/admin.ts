import type { FastifyInstance } from "fastify";
import mongoose from "mongoose";
import { authEnabled } from "../config.ts";
import { requireAdmin } from "../lib/auth.ts";
import { badRequest, notFound, str } from "../lib/validate.ts";
import { Field } from "../models/Field.ts";
import { publicUser, User } from "../models/User.ts";

const DAY = 86_400_000;

/** Usage overview and user management for admins (role "admin" or an ADMIN_EMAILS address). Accounts only. */
export async function adminRoutes(app: FastifyInstance) {
  if (!authEnabled()) return;
  const opts = { preHandler: requireAdmin };

  app.get("/api/admin/stats", opts, async () => {
    const since = (days: number) => new Date(Date.now() - days * DAY);
    const [users, users7d, users30d, active7d, fields, children] = await Promise.all([
      User.countDocuments({}),
      User.countDocuments({ createdAt: { $gte: since(7) } }),
      User.countDocuments({ createdAt: { $gte: since(30) } }),
      User.countDocuments({ lastLogin: { $gte: since(7) } }),
      Field.countDocuments({}),
      Field.aggregate([{ $group: { _id: null, tests: { $sum: { $size: "$tests" } }, activities: { $sum: { $size: { $ifNull: ["$activities", []] } } } } }]),
    ]);
    return { users, users7d, users30d, active7d, fields, tests: children[0]?.tests ?? 0, activities: children[0]?.activities ?? 0 };
  });

  /** Newest first, with each user's field count; `q` matches name, email or organisation. */
  app.get("/api/admin/users", opts, async (req) => {
    const q = req.query as any;
    const limit = Math.min(100, Math.max(1, Number(q.limit) || 50));
    const page = Math.max(0, Number(q.page) || 0);
    const search = str(q.q, 100).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const filter = search ? { $or: ["name", "email", "organization"].map((k) => ({ [k]: { $regex: search, $options: "i" } })) } : {};
    const [total, users] = await Promise.all([
      User.countDocuments(filter),
      User.find(filter).sort({ createdAt: -1 }).skip(page * limit).limit(limit),
    ]);
    const counts = new Map((await Field.aggregate([
      { $match: { userId: { $in: users.map((u) => u._id) } } },
      { $group: { _id: "$userId", n: { $sum: 1 } } },
    ])).map((c: any) => [String(c._id), c.n as number]));
    return { total, page, limit, users: users.map((u) => ({ ...publicUser(u), fields: counts.get(String(u._id)) ?? 0 })) };
  });

  app.patch<{ Params: { id: string } }>("/api/admin/users/:id", opts, async (req) => {
    const role = (req.body as any)?.role;
    if (role !== "user" && role !== "admin") throw badRequest('role must be "user" or "admin"');
    if (!mongoose.isValidObjectId(req.params.id)) throw notFound("No such user");
    if (String(req.user!._id) === req.params.id && role !== "admin") throw badRequest("You can't remove your own admin role");
    const u = await User.findByIdAndUpdate(req.params.id, { role }, { returnDocument: "after" });
    if (!u) throw notFound("No such user");
    return { user: publicUser(u) };
  });
}
