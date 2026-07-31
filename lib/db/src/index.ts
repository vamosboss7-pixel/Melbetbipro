import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

const connectionString =
  process.env["NEON_DATABASE_URL"] ??
  process.env["DATABASE_PRIVATE_URL"] ??
  process.env["DATABASE_PUBLIC_URL"] ??
  process.env["DATABASE_URL"];

if (!connectionString) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

const needsSsl =
  connectionString.includes("neon.tech") ||
  connectionString.includes("railway.app") ||
  connectionString.includes("supabase");

export const pool = new Pool({
  connectionString,
  ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
});
export const db = drizzle(pool, { schema });

export * from "./schema";
