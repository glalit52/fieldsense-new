import mongoose from "mongoose";
import type { FastifyBaseLogger } from "fastify";
import { config } from "../config.ts";

// Fail fast while disconnected instead of queueing queries; routes answer 503 (see requireDb).
mongoose.set("bufferCommands", false);
mongoose.set("strictQuery", true);

let stopped = false;
let indexed = false;

/**
 * Connects in the background and keeps retrying with backoff. Mongoose reconnects by itself after a
 * successful first connection, but not when the first attempt fails (e.g. Atlas IP allow-list, cold start).
 */
export async function connectMongo(log: FastifyBaseLogger) {
  const conn = mongoose.connection;
  conn.on("disconnected", () => !stopped && log.warn("MongoDB disconnected"));
  conn.on("reconnected", () => log.info("MongoDB reconnected"));
  conn.on("error", (e) => log.error({ err: e }, "MongoDB error"));
  for (let attempt = 1; !stopped; attempt++) {
    try {
      await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 10_000, maxPoolSize: 10 });
      // Unique email must exist before the first signup, or two racing signups could both succeed on a fresh database.
      await Promise.all(Object.values(mongoose.models).map((m) => m.createIndexes()));
      indexed = true;
      log.info("MongoDB connected");
      return;
    } catch (e: any) {
      const wait = Math.min(60, 2 ** attempt);
      log.error(`MongoDB connection failed (attempt ${attempt}): ${e.message}; retrying in ${wait}s`);
      await new Promise((r) => setTimeout(r, wait * 1000).unref());
    }
  }
}

export async function closeMongo() {
  stopped = true;
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
}

export const isMongoConnected = () => indexed && mongoose.connection.readyState === 1;
