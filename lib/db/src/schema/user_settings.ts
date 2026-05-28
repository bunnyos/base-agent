import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const userSettingsTable = pgTable("user_settings", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  openrouterApiKey: text("openrouter_api_key"),
  moralisApiKey: text("moralis_api_key"),
  cmcApiKey: text("cmc_api_key"),
  model: text("model"),
  memoryMd: text("memory_md").notNull().default(""),
  baseMcpSession: jsonb("base_mcp_session"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type UserSettings = typeof userSettingsTable.$inferSelect;
export type InsertUserSettings = typeof userSettingsTable.$inferInsert;
