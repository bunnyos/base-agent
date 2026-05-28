import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";

// One row per user-authored "action" (the configured rule, not the feed row).
// The runner is a scoped agent loop: it reads `instructions`, may call any
// tool whose name is in `toolAllowlist` (null = all enabled tools), and emits
// zero or more alert / recommendation rows into the actions feed via the
// `emit_alert` / `emit_recommendation` pseudo-tools.
//
// Table name is intentionally still `workflows` to avoid colliding with the
// existing `actions` table (which holds the resulting feed rows). The UI
// calls these "actions" / "actions builder".
export const workflowsTable = pgTable(
  "workflows",
  {
    id: text("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    name: text("name").notNull().default(""),
    enabled: boolean("enabled").notNull().default(true),
    // Min cadence enforced by the scheduler. The scheduler ticks once per
    // minute, so values below 60_000 are effectively rounded up.
    intervalMs: integer("interval_ms").notNull().default(600_000),
    // Freeform user prompt: what to watch for, when to alert, when to recommend.
    instructions: text("instructions").notNull().default(""),
    // Tool name allowlist. null = all enabled tools. Empty array = read-only
    // (only emit_* tools allowed, no data fetches — basically useless, but
    // valid).
    toolAllowlist: jsonb("tool_allowlist").$type<string[] | null>(),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    // "ok" | "error" — informational, surfaced in the UI.
    lastRunStatus: text("last_run_status"),
    lastRunError: text("last_run_error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("workflows_user_enabled_idx").on(t.userId, t.enabled)],
);

export type WorkflowRow = typeof workflowsTable.$inferSelect;
export type InsertWorkflowRow = typeof workflowsTable.$inferInsert;
