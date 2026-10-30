import mongoose, { Schema, type HydratedDocument, type Model } from "mongoose";
import bcrypt from "bcryptjs";
import { config } from "../config.ts";

export interface UserAttrs {
  name: string;
  email: string;
  password: string;
  organization: string;
  role: "user" | "admin";
  lastLogin?: Date;
  /** Tokens issued before this are rejected, so a password change signs out other sessions. */
  passwordChangedAt?: Date;
  /** Opted in to emailed weather and spray alerts for saved fields. */
  alertEmails: boolean;
  createdAt: Date;
  updatedAt: Date;
}
interface UserMethods {
  comparePassword(candidate: string): Promise<boolean>;
}
export type UserDoc = HydratedDocument<UserAttrs, UserMethods>;

export const PASSWORD_MIN = 8;
const BCRYPT_COST = 12;

const userSchema = new Schema<UserAttrs, Model<UserAttrs, {}, UserMethods>, UserMethods>(
  {
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 100 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 254, match: /^[^\s@]+@[^\s@]+\.[^\s@]+$/ },
    password: { type: String, required: true, minlength: PASSWORD_MIN, select: false },
    organization: { type: String, trim: true, maxlength: 150, default: "" },
    role: { type: String, enum: ["user", "admin"], default: "user" },
    lastLogin: { type: Date },
    passwordChangedAt: { type: Date },
    alertEmails: { type: Boolean, default: false },
  },
  { timestamps: true },
);

userSchema.pre("save", async function () {
  if (!this.isModified("password")) return;
  this.password = await bcrypt.hash(this.password, BCRYPT_COST);
  // JWT iat has 1 s resolution; back-date so the token issued right after this change stays valid.
  if (!this.isNew) this.passwordChangedAt = new Date(Date.now() - 1000);
});

/** Requires the document to have been loaded with `.select("+password")`. */
userSchema.methods.comparePassword = function (candidate: string) {
  return bcrypt.compare(candidate, this.password);
};

export const User = (mongoose.models.User as Model<UserAttrs, {}, UserMethods>) ?? mongoose.model("User", userSchema);

/** Admin by stored role or by ADMIN_EMAILS, so the first admin needs no database edit. */
export const isAdmin = (u: Pick<UserAttrs, "role" | "email">) => u.role === "admin" || config.adminEmails.includes(u.email);

/** The user as the API returns it: never the password hash. */
export const publicUser = (u: UserDoc) => ({
  id: String(u._id), name: u.name, email: u.email, organization: u.organization ?? "", role: isAdmin(u) ? "admin" : u.role,
  createdAt: u.createdAt, lastLogin: u.lastLogin ?? null, alertEmails: Boolean(u.alertEmails),
});
