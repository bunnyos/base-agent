import { Router, type IRouter } from "express";
import { listActions, setActionStatus } from "../lib/actions";

const router: IRouter = Router();

// Live inbox: pending only. Default response stays small even after the
// history grows. Pass ?include=all to get history too (used by the
// dedicated history view).
router.get("/actions", async (req, res): Promise<void> => {
  const include = String(req.query["include"] ?? "");
  const all = await listActions();
  if (include === "all") {
    res.json({ actions: all });
    return;
  }
  res.json({ actions: all.filter((a) => a.status === "pending") });
});

router.get("/actions/history", async (_req, res): Promise<void> => {
  res.json({ actions: await listActions() });
});

router.post("/actions/:id/dismiss", async (req, res): Promise<void> => {
  const id = req.params["id"] ?? "";
  const updated = await setActionStatus(id, "dismissed");
  if (!updated) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json({ actions: (await listActions()).filter((a) => a.status === "pending") });
});

// Restore a hidden row to pending so it shows up in the live inbox again.
router.post("/actions/:id/unhide", async (req, res): Promise<void> => {
  const id = req.params["id"] ?? "";
  const updated = await setActionStatus(id, "pending");
  if (!updated) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json({ action: updated });
});

router.post("/actions/:id/execute", async (req, res): Promise<void> => {
  const id = req.params["id"] ?? "";
  const updated = await setActionStatus(id, "executed");
  if (!updated) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json({ actions: (await listActions()).filter((a) => a.status === "pending") });
});

export default router;
