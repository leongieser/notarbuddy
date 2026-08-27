import { defineConfig } from "drizzle-kit";

// drizzle-kit runs outside Next, so .env.local is not loaded for it.
try {
  process.loadEnvFile(".env.local");
} catch {}

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set (see .env.example)");

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  strict: true,
  dbCredentials: { url },
});
