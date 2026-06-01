import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

// NEON_DATABASE_URL wins when both are set so a hosted dev environment (where the
// platform auto-injects an unrelated DATABASE_URL pointing at its built-in
// Postgres) doesn't get shadowed. In Docker / standalone deploys only
// DATABASE_URL needs to be set.
const connectionString =
  process.env.NEON_DATABASE_URL ?? process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "DATABASE_URL must be set to a Postgres connection string.",
  );
}

export const pool = new Pool({ connectionString });
export const db = drizzle(pool, { schema });

export * from "./schema";
