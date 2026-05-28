import { Router, type IRouter } from "express";
import {
  ListModelsResponse,
  GetCurrentModelResponse,
  SetCurrentModelBody,
  SetCurrentModelResponse,
} from "@workspace/api-zod";
import {
  listOpenRouterModels,
  getCurrentModelId,
  setCurrentModelId,
} from "../lib/bunny-agent";

const router: IRouter = Router();

router.get("/models", async (req, res): Promise<void> => {
  try {
    const models = await listOpenRouterModels();
    res.json(ListModelsResponse.parse(models));
  } catch (err) {
    req.log.error({ err }, "List models failed");
    res.status(502).json({ error: "Failed to list models" });
  }
});

router.get("/settings/model", async (_req, res): Promise<void> => {
  res.json(GetCurrentModelResponse.parse({ model: getCurrentModelId() }));
});

router.post("/settings/model", async (req, res): Promise<void> => {
  const parsed = SetCurrentModelBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const model = await setCurrentModelId(parsed.data.model);
  res.json(SetCurrentModelResponse.parse({ model }));
});

export default router;
