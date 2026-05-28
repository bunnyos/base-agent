import { Router, type IRouter } from "express";
import {
  listWorkflows,
  createWorkflow,
  updateWorkflow,
  deleteWorkflow,
  runWorkflowNow,
  ALLOWED_INTERVALS_MS,
  type WorkflowDraft,
} from "../lib/workflows";
import { listMoralisTools } from "../lib/moralis";
import { listCmcTools } from "../lib/cmc";
import { listBankrTools } from "../lib/bankr";
import { listDefiLlamaTools } from "../lib/defillama";
import { listTools as listBaseMcpTools } from "../lib/base-mcp";
import { listAnonMcpStatuses, getAnonMcpTools } from "../lib/mcp-anon";
import { isProtocolEnabled } from "../lib/settings";
import { take } from "../lib/rate-limit";
import { getCurrentUserId } from "../lib/user";

const router: IRouter = Router();

interface ToolCatalogEntry {
  protocol: string;
  name: string;
  description: string;
}

async function buildToolCatalog(): Promise<ToolCatalogEntry[]> {
  const out: ToolCatalogEntry[] = [];
  if (isProtocolEnabled("base")) {
    try {
      const tools = await listBaseMcpTools();
      for (const t of tools) {
        out.push({ protocol: "base", name: t.name, description: t.description ?? "" });
      }
    } catch {
      // Base mcp may be disconnected — skip silently.
    }
  }
  if (isProtocolEnabled("moralis")) {
    for (const t of listMoralisTools()) {
      out.push({ protocol: "moralis", name: t.name, description: t.description });
    }
  }
  if (isProtocolEnabled("cmc")) {
    for (const t of listCmcTools()) {
      out.push({ protocol: "cmc", name: t.name, description: t.description });
    }
  }
  if (isProtocolEnabled("bankr")) {
    for (const t of listBankrTools()) {
      out.push({ protocol: "bankr", name: t.name, description: t.description });
    }
  }
  if (isProtocolEnabled("defillama")) {
    for (const t of listDefiLlamaTools()) {
      out.push({ protocol: "defillama", name: t.name, description: t.description });
    }
  }
  for (const s of listAnonMcpStatuses()) {
    if (!isProtocolEnabled(s.id)) continue;
    const tools = getAnonMcpTools(s.id) ?? [];
    for (const t of tools) {
      out.push({ protocol: s.id, name: t.name, description: t.description ?? "" });
    }
  }
  return out;
}

router.get("/workflows", async (_req, res): Promise<void> => {
  const [workflows, tools] = await Promise.all([
    listWorkflows(),
    buildToolCatalog(),
  ]);
  res.json({
    workflows,
    tools,
    allowedIntervalsMs: ALLOWED_INTERVALS_MS,
  });
});

interface BodyDraft {
  name?: unknown;
  enabled?: unknown;
  intervalMs?: unknown;
  instructions?: unknown;
  toolAllowlist?: unknown;
}

function parseAllowlist(v: unknown): string[] | null | { error: string } {
  if (v === undefined || v === null) return null;
  if (!Array.isArray(v)) return { error: "toolAllowlist must be an array of strings or null" };
  const out: string[] = [];
  for (const x of v) {
    if (typeof x !== "string" || !x) return { error: "toolAllowlist entries must be non-empty strings" };
    out.push(x);
  }
  return out;
}

function parseDraft(body: BodyDraft): { ok: true; draft: WorkflowDraft } | { ok: false; error: string } {
  const name = typeof body.name === "string" ? body.name : "";
  const enabled = body.enabled === false ? false : true;
  const intervalMs = typeof body.intervalMs === "number" ? body.intervalMs : 600_000;
  const instructions = typeof body.instructions === "string" ? body.instructions : "";
  const allow = parseAllowlist(body.toolAllowlist);
  if (allow && !Array.isArray(allow) && "error" in allow) return { ok: false, error: allow.error };
  return {
    ok: true,
    draft: {
      name,
      enabled,
      intervalMs,
      instructions,
      toolAllowlist: (allow as string[] | null) ?? null,
    },
  };
}

router.post("/workflows", async (req, res): Promise<void> => {
  const parsed = parseDraft(req.body as BodyDraft);
  if (!parsed.ok) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  const wf = await createWorkflow(parsed.draft);
  res.json({ workflow: wf });
});

router.put("/workflows/:id", async (req, res): Promise<void> => {
  const id = req.params["id"];
  if (!id) {
    res.status(400).json({ error: "missing id" });
    return;
  }
  const body = req.body as BodyDraft;
  const patch: Partial<WorkflowDraft> = {};
  if (typeof body.name === "string") patch.name = body.name;
  if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
  if (typeof body.intervalMs === "number") patch.intervalMs = body.intervalMs;
  if (typeof body.instructions === "string") patch.instructions = body.instructions;
  if (body.toolAllowlist !== undefined) {
    const allow = parseAllowlist(body.toolAllowlist);
    if (allow && !Array.isArray(allow) && "error" in allow) {
      res.status(400).json({ error: allow.error });
      return;
    }
    patch.toolAllowlist = (allow as string[] | null) ?? null;
  }
  const wf = await updateWorkflow(id, patch);
  if (!wf) {
    res.status(404).json({ error: "not found" });
    return;
  }
  res.json({ workflow: wf });
});

router.delete("/workflows/:id", async (req, res): Promise<void> => {
  const id = req.params["id"];
  if (!id) {
    res.status(400).json({ error: "missing id" });
    return;
  }
  const ok = await deleteWorkflow(id);
  if (!ok) {
    res.status(404).json({ error: "not found" });
    return;
  }
  res.json({ ok: true });
});

router.post("/workflows/:id/run", async (req, res): Promise<void> => {
  const id = req.params["id"];
  if (!id) {
    res.status(400).json({ error: "missing id" });
    return;
  }
  const rate = take(getCurrentUserId(), "scan");
  if (!rate.allowed) {
    res.setHeader("Retry-After", String(rate.retryAfterSec));
    res
      .status(429)
      .json({ error: "rate limit exceeded", retryAfterSec: rate.retryAfterSec });
    return;
  }
  const result = await runWorkflowNow(id);
  if (!result) {
    res.status(404).json({ error: "not found" });
    return;
  }
  res.json({ result });
});

export default router;
