import { defineConfig } from "drizzle-kit";
import path from "path";

// Local dev: load the repo-root .env so DATABASE_URL is available to `db push`
// without exporting it. No-op in production where the host injects env.
try {
  process.loadEnvFile(path.join(__dirname, "..", "..", ".env"));
} catch {}

const connectionString =
  process.env.NEON_DATABASE_URL ?? process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL must be set for drizzle-kit push");
}

export default defineConfig({
  schema: path.join(__dirname, "./src/schema/index.ts"),
  dialect: "postgresql",
  dbCredentials: {
    url: connectionString,
  },
});
