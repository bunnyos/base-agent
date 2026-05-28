import { pgTable, uuid, text, boolean, primaryKey } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const userProtocolsTable = pgTable(
  "user_protocols",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    protocolId: text("protocol_id").notNull(),
    enabled: boolean("enabled").notNull().default(true),
  },
  (t) => [primaryKey({ columns: [t.userId, t.protocolId] })],
);

export type UserProtocol = typeof userProtocolsTable.$inferSelect;
