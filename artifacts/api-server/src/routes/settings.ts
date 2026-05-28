import { Router, type IRouter } from "express";
import { SetApiKeyBody, GetApiKeyStatusResponse } from "@workspace/api-zod";
import {
  getApiKey,
  setApiKey,
  clearApiKey,
  isUserKey,
  getMoralisApiKey,
  setMoralisApiKey,
  clearMoralisApiKey,
  isUserMoralisKey,
  getCmcApiKey,
  setCmcApiKey,
  clearCmcApiKey,
  isUserCmcKey,
  maskKey,
} from "../lib/settings";

const router: IRouter = Router();

function statusPayload() {
  const key = getApiKey();
  return GetApiKeyStatusResponse.parse({
    configured: Boolean(key),
    userProvided: isUserKey(),
    masked: key ? maskKey(key) : "",
  });
}

router.get("/settings/api-key", async (_req, res): Promise<void> => {
  res.json(statusPayload());
});

router.post("/settings/api-key", async (req, res): Promise<void> => {
  const parsed = SetApiKeyBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  await setApiKey(parsed.data.apiKey);
  res.json(statusPayload());
});

router.delete("/settings/api-key", async (_req, res): Promise<void> => {
  await clearApiKey();
  res.json(statusPayload());
});

function moralisStatusPayload() {
  const key = getMoralisApiKey();
  return GetApiKeyStatusResponse.parse({
    configured: Boolean(key),
    userProvided: isUserMoralisKey(),
    masked: key ? maskKey(key) : "",
  });
}

router.get("/settings/moralis-key", async (_req, res): Promise<void> => {
  res.json(moralisStatusPayload());
});

router.post("/settings/moralis-key", async (req, res): Promise<void> => {
  const parsed = SetApiKeyBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  await setMoralisApiKey(parsed.data.apiKey);
  res.json(moralisStatusPayload());
});

router.delete("/settings/moralis-key", async (_req, res): Promise<void> => {
  await clearMoralisApiKey();
  res.json(moralisStatusPayload());
});

function cmcStatusPayload() {
  const key = getCmcApiKey();
  return GetApiKeyStatusResponse.parse({
    configured: Boolean(key),
    userProvided: isUserCmcKey(),
    masked: key ? maskKey(key) : "",
  });
}

router.get("/settings/cmc-key", async (_req, res): Promise<void> => {
  res.json(cmcStatusPayload());
});

router.post("/settings/cmc-key", async (req, res): Promise<void> => {
  const parsed = SetApiKeyBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  await setCmcApiKey(parsed.data.apiKey);
  res.json(cmcStatusPayload());
});

router.delete("/settings/cmc-key", async (_req, res): Promise<void> => {
  await clearCmcApiKey();
  res.json(cmcStatusPayload());
});

export default router;
