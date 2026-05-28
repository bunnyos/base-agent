import { db, chatsTable, type StoredChatMessage } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { logger } from "./logger";
import { getCurrentUserId } from "./user";

export type StoredMessage = StoredChatMessage;

export interface ChatSession {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: StoredMessage[];
}

export interface ChatSummary {
  id: string;
  title: string;
  updatedAt: string;
}

function safeId(id: string): string {
  const cleaned = id.replace(/[^a-zA-Z0-9_-]/g, "");
  if (!cleaned) throw new Error("invalid chat id");
  return cleaned;
}

function randomId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function titleFromMessages(messages: StoredMessage[]): string {
  const firstUser = messages.find((m) => m.role === "user" && m.text.trim());
  if (!firstUser) return "new chat";
  const t = firstUser.text.trim().replace(/\s+/g, " ");
  return t.length > 50 ? t.slice(0, 47) + "…" : t;
}

function rowToSession(row: typeof chatsTable.$inferSelect): ChatSession {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    messages: row.messages,
  };
}

export async function listSessions(): Promise<ChatSummary[]> {
  const userId = getCurrentUserId();
  const rows = await db
    .select({
      id: chatsTable.id,
      title: chatsTable.title,
      updatedAt: chatsTable.updatedAt,
    })
    .from(chatsTable)
    .where(eq(chatsTable.userId, userId))
    .orderBy(desc(chatsTable.updatedAt));
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    updatedAt: r.updatedAt.toISOString(),
  }));
}

export async function getSession(id: string): Promise<ChatSession | null> {
  const userId = getCurrentUserId();
  let cleaned: string;
  try {
    cleaned = safeId(id);
  } catch {
    return null;
  }
  const [row] = await db
    .select()
    .from(chatsTable)
    .where(and(eq(chatsTable.id, cleaned), eq(chatsTable.userId, userId)))
    .limit(1);
  return row ? rowToSession(row) : null;
}

export async function createSession(): Promise<ChatSession> {
  const userId = getCurrentUserId();
  const id = randomId();
  const now = new Date();
  const [row] = await db
    .insert(chatsTable)
    .values({
      id,
      userId,
      title: "new chat",
      messages: [],
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  if (!row) throw new Error("failed to create chat session");
  return rowToSession(row);
}

export async function saveSession(
  id: string,
  patch: { title?: string; messages: StoredMessage[] },
): Promise<ChatSession> {
  const userId = getCurrentUserId();
  const cleaned = safeId(id);
  const existing = await getSession(cleaned);
  const now = new Date();
  let title =
    patch.title?.trim() ||
    existing?.title ||
    titleFromMessages(patch.messages);
  if (
    (!patch.title || !patch.title.trim()) &&
    (title === "new chat" || !existing)
  ) {
    title = titleFromMessages(patch.messages);
  }

  if (existing) {
    const [row] = await db
      .update(chatsTable)
      .set({ title, messages: patch.messages, updatedAt: now })
      .where(and(eq(chatsTable.id, cleaned), eq(chatsTable.userId, userId)))
      .returning();
    if (!row) throw new Error("failed to update chat session");
    return rowToSession(row);
  }
  const [row] = await db
    .insert(chatsTable)
    .values({
      id: cleaned,
      userId,
      title,
      messages: patch.messages,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  if (!row) throw new Error("failed to create chat session");
  return rowToSession(row);
}

export async function deleteSession(id: string): Promise<boolean> {
  const userId = getCurrentUserId();
  let cleaned: string;
  try {
    cleaned = safeId(id);
  } catch {
    return false;
  }
  const result = await db
    .delete(chatsTable)
    .where(and(eq(chatsTable.id, cleaned), eq(chatsTable.userId, userId)))
    .returning({ id: chatsTable.id });
  if (result.length === 0) {
    logger.debug({ id: cleaned }, "deleteSession: not found");
    return false;
  }
  return true;
}
