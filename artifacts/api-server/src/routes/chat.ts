import { Router, type IRouter } from "express";
import { SendChatBody, SendChatResponse } from "@workspace/api-zod";
import { runBunny, streamBunny } from "../lib/bunny-agent";
import { take } from "../lib/rate-limit";
import { getCurrentUserId } from "../lib/user";

const router: IRouter = Router();

router.post("/chat", async (req, res): Promise<void> => {
  const parsed = SendChatBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const rate = take(getCurrentUserId(), "chat");
  if (!rate.allowed) {
    res.setHeader("Retry-After", String(rate.retryAfterSec));
    res
      .status(429)
      .json({ error: "rate limit exceeded", retryAfterSec: rate.retryAfterSec });
    return;
  }

  try {
    const result = await runBunny(parsed.data.message, parsed.data.history);
    res.json(SendChatResponse.parse(result));
  } catch (err) {
    req.log.error({ err }, "Bunny chat failed");
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(502).json({ error: `Bunny failed: ${message}` });
  }
});

router.post("/chat/stream", async (req, res): Promise<void> => {
  const parsed = SendChatBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const rate = take(getCurrentUserId(), "chat");
  if (!rate.allowed) {
    res.setHeader("Retry-After", String(rate.retryAfterSec));
    res
      .status(429)
      .json({ error: "rate limit exceeded", retryAfterSec: rate.retryAfterSec });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();
  res.write(": connected\n\n");
  const flush = (res as unknown as { flush?: () => void }).flush;
  if (typeof flush === "function") flush.call(res);

  const write = (event: unknown): void => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
    if (typeof flush === "function") flush.call(res);
  };

  let closed = false;
  const keepAlive = setInterval(() => {
    if (closed) return;
    res.write(": ping\n\n");
    if (typeof flush === "function") flush.call(res);
  }, 15000);
  res.on("close", () => {
    closed = true;
    clearInterval(keepAlive);
  });

  try {
    for await (const ev of streamBunny(parsed.data.message, parsed.data.history)) {
      if (closed) break;
      write(ev);
    }
  } catch (err) {
    req.log.error({ err }, "Bunny stream failed");
    const message = err instanceof Error ? err.message : "Unknown error";
    write({ type: "error", message });
  } finally {
    clearInterval(keepAlive);
    if (!closed) {
      res.write("event: end\ndata: {}\n\n");
      res.end();
    }
  }
});

export default router;
