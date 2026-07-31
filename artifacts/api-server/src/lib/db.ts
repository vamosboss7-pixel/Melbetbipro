import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "@workspace/db/schema";

const connectionString =
  process.env["NEON_DATABASE_URL"] ??
  process.env["DATABASE_URL"] ??
  process.env["DATABASE_PRIVATE_URL"] ??
  process.env["DATABASE_PUBLIC_URL"];

if (!connectionString) {
  throw new Error("No database connection string found. Set DATABASE_URL.");
}

const needsSsl =
  connectionString.includes("neon.tech") ||
  connectionString.includes("railway.app") ||
  connectionString.includes("supabase");

const pool = new Pool({
  connectionString,
  ssl: needsSsl ? { rejectUnauthorized: false } : false,
});

export const db = drizzle(pool, { schema });
