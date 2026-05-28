import { Router, type IRouter } from "express";
import {
  listSessions,
  getSession,
  createSession,
  saveSession,
  deleteSession,
  type StoredMessage,
} from "../lib/chat-sessions";

const router: IRouter = Router();

router.get("/chats", async (_req, res): Promise<void> => {
  res.json(await listSessions());
});

router.post("/chats", async (_req, res): Promise<void> => {
  res.json(await createSession());
});

router.get("/chats/:id", async (req, res): Promise<void> => {
  const id = req.params["id"] ?? "";
  try {
    const s = await getSession(id);
    if (!s) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json(s);
  } catch {
    res.status(400).json({ error: "invalid id" });
  }
});

router.put("/chats/:id", async (req, res): Promise<void> => {
  const id = req.params["id"] ?? "";
  const body = req.body as {
    title?: unknown;
    messages?: unknown;
  };
  if (!Array.isArray(body.messages)) {
    res.status(400).json({ error: "messages must be an array" });
    return;
  }
  const messages = body.messages as StoredMessage[];
  const title = typeof body.title === "string" ? body.title : undefined;
  try {
    const saved = await saveSession(id, {
      messages,
      ...(title ? { title } : {}),
    });
    res.json(saved);
  } catch {
    res.status(400).json({ error: "invalid id" });
  }
});

router.delete("/chats/:id", async (req, res): Promise<void> => {
  const id = req.params["id"] ?? "";
  try {
    const ok = await deleteSession(id);
    if (!ok) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json({ id });
  } catch {
    res.status(400).json({ error: "invalid id" });
  }
});

export default router;
