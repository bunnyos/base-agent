import { pgTable, uuid, text, timestamp, index, boolean } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const actionsTable = pgTable(
  "actions",
  {
    id: text("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    // Description of the alert/recommendation. Column kept as `body` for
    // backward compatibility; surfaced as `description` in the API.
    body: text("body").notNull(),
    // Which instruction line produced this item.
    source: text("source").notNull(),
    // Legacy severity field. New rows write "info"; kept so historical rows
    // remain readable.
    severity: text("severity").notNull().default("info"),
    // "alert" or "recommendation".
    kind: text("kind").notNull().default("alert"),
    // Whether to surface this in the UI. false → logged silently.
    push: boolean("push").notNull().default(true),
    // For recommendations: the chat prompt that pre-fills when the user
    // clicks "execute". Empty string for alerts.
    suggestedPrompt: text("suggested_prompt").notNull().default(""),
    status: text("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("actions_user_status_idx").on(t.userId, t.status, t.createdAt),
  ],
);

export type ActionRow = typeof actionsTable.$inferSelect;
export type InsertActionRow = typeof actionsTable.$inferInsert;
