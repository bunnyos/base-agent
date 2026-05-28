import { Router, type IRouter } from "express";
import { GetMemoryResponse, UpdateMemoryBody } from "@workspace/api-zod";
import { readMemory, writeMemory } from "../lib/memory";

const router: IRouter = Router();

router.get("/memory", async (_req, res): Promise<void> => {
  const content = readMemory();
  res.json(GetMemoryResponse.parse({ content }));
});

router.put("/memory", async (req, res): Promise<void> => {
  const body = UpdateMemoryBody.parse(req.body);
  await writeMemory(body.content);
  res.json(GetMemoryResponse.parse({ content: body.content }));
});

export default router;
