import { db, usersTable, userSettingsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { logger } from "./logger";
import { getActiveUserId } from "./request-context";

// Fallback synthetic user used for public/unauthenticated routes (/auth/me,
// /healthz) and boot-time tasks that need *some* userId. Real users are
// created on Base MCP OAuth callback via upsertUserByWallet, and
// getCurrentUserId() reads the active id from AsyncLocalStorage populated by
// the session middleware.
export const LOCAL_USER_ID = "00000000-0000-0000-0000-000000000001";

export async function ensureLocalUser(): Promise<void> {
  await db
    .insert(usersTable)
    .values({ id: LOCAL_USER_ID, isLocal: true })
    .onConflictDoNothing({ target: usersTable.id });

  await db
    .insert(userSettingsTable)
    .values({ userId: LOCAL_USER_ID })
    .onConflictDoNothing({ target: userSettingsTable.userId });

  const [row] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.id, LOCAL_USER_ID))
    .limit(1);
  if (!row) throw new Error("failed to create local user");
  logger.info({ userId: LOCAL_USER_ID }, "local user ready");
}

export function getCurrentUserId(): string {
  const uid = getActiveUserId();
  if (!uid) {
    throw new Error(
      "no active user in request context — call runWithUser(uid, fn) before reading user-scoped state",
    );
  }
  return uid;
}

// Upsert a wallet-authenticated user. Returns the existing or new userId.
// Caller must lowercase the address; we store it lowercased and also create
// the per-user settings row so downstream reads have a default to hydrate.
export async function upsertUserByWallet(walletAddress: string): Promise<string> {
  const lower = walletAddress.toLowerCase();
  // Atomic upsert — two concurrent OAuth callbacks for the same wallet
  // (e.g. popup retried) would otherwise race the select/insert and fail
  // the loser on the unique constraint. ON CONFLICT DO UPDATE forces the
  // returning row to come back for both winners and losers.
  const [row] = await db
    .insert(usersTable)
    .values({ walletAddress: lower, isLocal: false })
    .onConflictDoUpdate({
      target: usersTable.walletAddress,
      set: { walletAddress: lower },
    })
    .returning({ id: usersTable.id });
  if (!row) throw new Error("failed to upsert user");

  await db
    .insert(userSettingsTable)
    .values({ userId: row.id })
    .onConflictDoNothing({ target: userSettingsTable.userId });

  logger.info({ userId: row.id, walletAddress: lower }, "wallet user upserted");
  return row.id;
}

export async function countUsers(): Promise<number> {
  const [row] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(usersTable);
  return row?.c ?? 0;
}
