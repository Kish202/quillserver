import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import * as schema from "./schema";

const sql = neon(process.env.DATABASE_URL!);
export const db = drizzle(sql, { schema });

/** Retry a DB call — Neon's free tier scales to zero when idle (cold start). */
export async function withDbRetry<T>(fn: () => Promise<T>, retries = 2): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (retries > 0) {
      await new Promise((r) => setTimeout(r, 700));
      return withDbRetry(fn, retries - 1);
    }
    throw e;
  }
}
