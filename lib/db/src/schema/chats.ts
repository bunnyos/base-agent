import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";

// Messages are stored as a JSON array on the chat row. This matches the
// existing on-disk shape and lets the agent loop persist atomically.
export interface StoredChatMessage {
  id: string;
  role: "user" | "bunny";
  text: string;
  timestamp: string;
  tools?: unknown[];
}

export const chatsTable = pgTable(
  "chats",
  {
    id: text("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    title: text("title").notNull().default("new chat"),
    messages: jsonb("messages").$type<StoredChatMessage[]>().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("chats_user_updated_idx").on(t.userId, t.updatedAt)],
);

export type Chat = typeof chatsTable.$inferSelect;
export type InsertChat = typeof chatsTable.$inferInsert;
