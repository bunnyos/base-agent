import { db, workflowsTable, type WorkflowRow } from "@workspace/db";
import { eq, and, notInArray } from "drizzle-orm";
import { logger } from "./logger";
import { hydrateUserSettings, getApiKey } from "./settings";
import { getCurrentUserId } from "./user";
import { runWithUser } from "./request-context";
import { OPENROUTER_HTTP_REFERER, OPENROUTER_APP_TITLE } from "./app-meta";
import {
  dispatchToolCall,
  newAgentTurnCtx,
  callOpenRouter,
  getMcpToolsForOpenRouter,
  getCurrentModelId,
  FALLBACK_MODELS,
  type OpenRouterTool,
  type Msg,
} from "./bunny-agent";
import {
  insertAction,
  listRecentActionsBySource,
  type TokenRef,
} from "./actions";
import { NATIVE_ACTIONS } from "./native-actions";

// ---------- Public types ----------

export type AlertSeverity = "info" | "warn" | "critical";

export interface RunEmit {
  kind: "alert" | "recommendation";
  title: string;
  severity?: AlertSeverity;
  deduped: boolean;
}

export interface RunResult {
  ranAt: string;
  status: "ok" | "error";
  emitted: RunEmit[];
  note?: string;
  error?: string;
}

export type WorkflowSource = "native" | "custom";

export interface PublicWorkflow {
  id: string;
  name: string;
  // "native" = shipped in code starter pack; "custom" = user-authored.
  source: WorkflowSource;
  enabled: boolean;
  intervalMs: number;
  instructions: string;
  // null = all enabled tools allowed.
  toolAllowlist: string[] | null;
  lastRunAt: string | null;
  lastRunStatus: string | null;
  lastRunError: string | null;
  createdAt: string;
}

export interface WorkflowDraft {
  name: string;
  enabled: boolean;
  intervalMs: number;
  instructions: string;
  toolAllowlist: string[] | null;
}

export const ALLOWED_INTERVALS_MS = [
  60_000,
  5 * 60_000,
  10 * 60_000,
  30 * 60_000,
  60 * 60_000,
  6 * 60 * 60_000,
  24 * 60 * 60_000,
] as const;

// ---------- Runner ----------

// Two structured outputs the LLM is forced to use. These are intercepted in
// the dispatch loop; they never hit dispatchToolCall.
const EMIT_TOOLS: OpenRouterTool[] = [
  {
    type: "function",
    function: {
      name: "emit_alert",
      description:
        "Post a heads-up alert to the user's inbox. Use for things the user should know about but cannot directly act on (price moves, position health changes, status reports). No execute button is shown.",
      parameters: {
        type: "object",
        properties: {
          title: {
            type: "string",
            description: "Short headline, under 100 chars.",
          },
          summary: {
            type: "string",
            description: "1-3 sentence body explaining what happened and why it matters.",
          },
          severity: {
            type: "string",
            enum: ["info", "warn", "critical"],
            description:
              "info = FYI / routine; warn = notable change worth attention; critical = urgent risk (liquidation, exploit, account compromise). Use critical sparingly.",
          },
          tokens: {
            type: "array",
            description:
              "Every token this alert references. Include the contract address (CA) for each so the user can verify it. Omit or leave empty if no specific token is involved.",
            items: {
              type: "object",
              properties: {
                symbol: {
                  type: "string",
                  description: "Token ticker, e.g. 'USDC' or 'WETH'.",
                },
                address: {
                  type: "string",
                  description:
                    "On-chain contract address (CA), e.g. '0x...'. Use the exact address from the tool data, never invent one.",
                },
                chain: {
                  type: "string",
                  description: "Network slug, e.g. 'base'. Optional.",
                },
              },
              required: ["symbol", "address"],
            },
          },
        },
        required: ["title", "summary"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "emit_recommendation",
      description:
        "Post a suggested action to the user's inbox with an Execute button. Use when there is a concrete on-chain move worth taking (deposit, withdraw, swap, rebalance, claim). When the user clicks Execute, the executeInstructions sentence is sent to the chat agent which will craft the wallet approval. Never write to chain yourself.",
      parameters: {
        type: "object",
        properties: {
          title: {
            type: "string",
            description: "Short headline, under 100 chars.",
          },
          why: {
            type: "string",
            description: "1-3 sentences explaining why this is recommended right now, citing the data you observed.",
          },
          executeInstructions: {
            type: "string",
            description:
              "A single short imperative sentence the chat agent can act on, e.g. 'deposit 100 USDC into the morpho gauntlet usdc vault on base' or 'swap 0.1 ETH for USDC on base'. Be specific about amounts, assets, and venues.",
          },
          tokens: {
            type: "array",
            description:
              "Every token this recommendation references. Include the contract address (CA) for each so the user can verify it. Omit or leave empty if no specific token is involved.",
            items: {
              type: "object",
              properties: {
                symbol: {
                  type: "string",
                  description: "Token ticker, e.g. 'USDC' or 'WETH'.",
                },
                address: {
                  type: "string",
                  description:
                    "On-chain contract address (CA), e.g. '0x...'. Use the exact address from the tool data, never invent one.",
                },
                chain: {
                  type: "string",
                  description: "Network slug, e.g. 'base'. Optional.",
                },
              },
              required: ["symbol", "address"],
            },
          },
        },
        required: ["title", "why", "executeInstructions"],
      },
    },
  },
];

const SYSTEM_PROMPT = `
You are a scoped autonomous agent that runs on a schedule for one user.

Your job: follow the user's instructions for this action, call read-only tools to gather the data you need, then post zero or more findings by calling emit_alert and/or emit_recommendation. You may call each multiple times if multiple findings are warranted. Be conservative — only emit when the user's trigger conditions are actually met.

Hard rules:
- Never call write tools yourself (send_calls, any *prepare* tool). The user owns execution via the Execute button on a recommendation.
- emit_recommendation.executeInstructions must be a single short imperative sentence the chat agent can act on with specific amounts, assets, and venues.
- emit_alert severity "critical" is reserved for genuine risk (liquidation, exploit, account compromise). Default to "info".
- Whenever a finding is about specific token(s), populate the \`tokens\` array with each token's symbol and contract address (CA) using the exact address from the tool data. Never fabricate an address; omit a token rather than guess.
- If a tool errors or returns nothing useful, do NOT invent data. Either emit a low-severity alert noting the failure, or stop silently if it's transient.
- You are budget-limited: do the minimum tool calls needed, then emit and stop.
- After emitting, end your turn with a brief one-line note (not shown to the user — only logged) describing what you did. Do not chat.
`.trim();

const MAX_TOOL_ROUNDS = 8;

// Hard backend denylist for the actions runner. Even if a user puts a write
// tool in toolAllowlist (or leaves allowlist = null = all), these names are
// blocked. The user owns execution — recommendations route through chat where
// send_calls is approved interactively. Match by tool name; covers Base MCP
// `send_calls` and any `prepare_*` / `*_prepare` style mutating helpers.
function isWriteTool(name: string): boolean {
  if (name === "send_calls") return true;
  if (/(^|_)prepare($|_)/i.test(name)) return true;
  return false;
}

function buildReferer(): string {
  return OPENROUTER_HTTP_REFERER;
}

// Coerce the model's `tokens` argument into a clean TokenRef[]. Drops entries
// missing a symbol or address, trims/caps lengths, and limits the count so a
// hallucinated blob can't bloat a row.
function sanitizeTokens(raw: unknown): TokenRef[] {
  if (!Array.isArray(raw)) return [];
  // Only accept primitive strings — never String()-coerce objects/arrays, or a
  // malformed model payload turns into "[object Object]" junk chips.
  const str = (v: unknown, max: number): string =>
    typeof v === "string" ? v.trim().slice(0, max) : "";
  const out: TokenRef[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const symbol = str(o["symbol"], 32);
    const address = str(o["address"], 128);
    if (!symbol || !address) continue;
    const chain = str(o["chain"], 32);
    const dedupeKey = `${chain.toLowerCase()}:${address.toLowerCase()}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    const ref: TokenRef = { symbol, address };
    if (chain) ref.chain = chain;
    out.push(ref);
    if (out.length >= 10) break;
  }
  return out;
}

// How many of an action's own recent findings to feed back into its runner.
const RECENT_FINDINGS_LIMIT = 10;

// Build a context block of the action's own recent emissions so the model can
// avoid re-posting the same/similar findings. Returns "" when there is no
// history yet (first runs, or after a clear).
async function buildRecentFindingsBlock(source: string): Promise<string> {
  let recent: Awaited<ReturnType<typeof listRecentActionsBySource>>;
  try {
    recent = await listRecentActionsBySource(source, RECENT_FINDINGS_LIMIT);
  } catch {
    // History is an optimization, never block a run on it.
    return "";
  }
  if (recent.length === 0) return "";
  const lines = recent.map((a) => {
    const title = a.title.replace(/\s+/g, " ").trim().slice(0, 140);
    const body = a.description.replace(/\s+/g, " ").trim().slice(0, 180);
    return `- [${a.kind}] ${title}${body ? ` — ${body}` : ""}`;
  });
  return `
Your ${lines.length} most recent finding(s) for this action (newest first). Do NOT emit an alert or recommendation that repeats, restates, or is substantially similar to any of these — only emit genuinely new findings or material changes since these were posted:
${lines.join("\n")}
`;
}

async function executeWorkflow(row: WorkflowRow): Promise<RunResult> {
  const ranAt = new Date().toISOString();
  const apiKey = getApiKey();
  if (!apiKey) {
    return {
      ranAt,
      status: "error",
      emitted: [],
      error: "OpenRouter API key not configured",
    };
  }

  const instructions = (row.instructions ?? "").trim();
  if (!instructions) {
    return {
      ranAt,
      status: "error",
      emitted: [],
      error: "no instructions configured",
    };
  }

  // Build the tool list = catalog filtered by allowlist + emit_* tools.
  // null allowlist = all enabled tools allowed (still subject to write-tool
  // denylist). Empty array = read-only — only emit_* tools available.
  // Backend-enforced: see isWriteTool() + the allowedNames guard below; the
  // system prompt is a hint, not a security boundary.
  const allTools = await getMcpToolsForOpenRouter();
  const allow = Array.isArray(row.toolAllowlist)
    ? new Set(row.toolAllowlist as string[])
    : null;
  const tools: OpenRouterTool[] = [
    ...EMIT_TOOLS,
    ...allTools.filter(
      (t) =>
        !isWriteTool(t.function.name) &&
        (allow === null || allow.has(t.function.name)),
    ),
  ];
  // Set of names the runner will actually dispatch. Anything else the model
  // hallucinates a call for gets a tool-error response and the loop continues.
  const allowedNames = new Set(tools.map((t) => t.function.name));

  const source = `action:${row.id}`;
  const emitted: RunEmit[] = [];

  // Feed the agent its own recent output so it doesn't re-post the same or
  // near-identical findings on every run. Title-only pending dedupe (in
  // insertAction) can't catch reworded repeats — this gives the model the
  // context to suppress them itself.
  const recentBlock = await buildRecentFindingsBlock(source);

  const messages: Msg[] = [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: `Action name: ${row.name || "(unnamed)"}\n\nInstructions from the user:\n${instructions}\n${recentBlock}\nRun now. Gather what you need, emit any warranted alerts or recommendations, then stop.`,
    },
  ];

  const referer = buildReferer();
  const ctx = newAgentTurnCtx();
  const tried = new Set<string>();
  const candidates = [getCurrentModelId(), ...FALLBACK_MODELS];
  let lastNote = "";

  for (const model of candidates) {
    if (tried.has(model)) continue;
    tried.add(model);

    let modelOk = true;
    let lastErr: { status: number; text: string } | null = null;

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const result = await callOpenRouter(apiKey, model, messages, tools, referer);
      if (!result.ok) {
        lastErr = { status: result.status, text: result.text };
        modelOk = false;
        logger.warn(
          { actionId: row.id, model, status: result.status },
          "action runner: openrouter call failed, trying next model",
        );
        break;
      }
      const msg = result.message;
      const toolCalls = msg.tool_calls ?? [];
      if (toolCalls.length === 0) {
        lastNote = (msg.content ?? "").trim().slice(0, 500);
        return { ranAt, status: "ok", emitted, note: lastNote };
      }
      messages.push({
        role: "assistant",
        content: msg.content ?? null,
        tool_calls: toolCalls,
      });

      for (const tc of toolCalls) {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(tc.function.arguments || "{}");
        } catch {
          args = {};
        }
        const name = tc.function.name;
        try {
          if (name === "emit_alert") {
            const title =
              String(args["title"] ?? "").slice(0, 200) || row.name || "alert";
            const summary = String(args["summary"] ?? "").slice(0, 1000);
            const sev: AlertSeverity =
              args["severity"] === "critical"
                ? "critical"
                : args["severity"] === "warn"
                  ? "warn"
                  : "info";
            const inserted = await insertAction({
              kind: "alert",
              title: `[${sev}] ${title}`.slice(0, 200),
              description: summary || title,
              source,
              tokens: sanitizeTokens(args["tokens"]),
            });
            emitted.push({
              kind: "alert",
              title,
              severity: sev,
              deduped: !inserted,
            });
            messages.push({
              role: "tool",
              tool_call_id: tc.id,
              content: inserted
                ? "alert posted to inbox"
                : "duplicate skipped (same title already pending)",
            });
          } else if (name === "emit_recommendation") {
            const title =
              String(args["title"] ?? "").slice(0, 200) ||
              row.name ||
              "recommendation";
            const why = String(args["why"] ?? "").slice(0, 1000);
            const exec = String(args["executeInstructions"] ?? "").slice(
              0,
              500,
            );
            const inserted = await insertAction({
              kind: "recommendation",
              title,
              description: why || title,
              source,
              executeInstructions: exec,
              tokens: sanitizeTokens(args["tokens"]),
            });
            emitted.push({
              kind: "recommendation",
              title,
              deduped: !inserted,
            });
            messages.push({
              role: "tool",
              tool_call_id: tc.id,
              content: inserted
                ? "recommendation posted to inbox with execute button"
                : "duplicate skipped (same title already pending)",
            });
          } else if (isWriteTool(name) || !allowedNames.has(name)) {
            // Hard refuse. Surfaces a tool message back to the model so it
            // can adjust and (ideally) emit a recommendation instead.
            const reason = isWriteTool(name)
              ? "blocked: write/execution tools are not allowed in actions. Emit a recommendation instead (the user runs it via the Execute button)."
              : `blocked: ${name} is not in this action's tool allowlist.`;
            messages.push({
              role: "tool",
              tool_call_id: tc.id,
              content: reason,
            });
            logger.warn(
              { actionId: row.id, tool: name },
              "action runner blocked disallowed tool call",
            );
          } else {
            const r = await dispatchToolCall(name, args, ctx);
            messages.push({
              role: "tool",
              tool_call_id: tc.id,
              content: r.content.slice(0, 8000),
            });
          }
        } catch (err) {
          const m = err instanceof Error ? err.message : String(err);
          messages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: `Error calling ${name}: ${m}`,
          });
        }
      }
    }

    if (modelOk) {
      // Ran out of rounds with no final assistant message.
      return {
        ranAt,
        status: "ok",
        emitted,
        note: "max tool rounds reached without a stop",
      };
    }
    // else fall through to the next candidate model
    if (!modelOk && tried.size === candidates.filter((c, i) => candidates.indexOf(c) === i).length) {
      return {
        ranAt,
        status: "error",
        emitted,
        error: lastErr
          ? `openrouter ${lastErr.status}: ${lastErr.text.slice(0, 300)}`
          : "openrouter call failed",
      };
    }
  }

  return {
    ranAt,
    status: "error",
    emitted,
    error: "all candidate models failed",
  };
}

// ---------- CRUD helpers ----------

function newId(): string {
  return Math.random().toString(36).slice(2, 12);
}

function rowToPublic(r: WorkflowRow): PublicWorkflow {
  const allowlist = Array.isArray(r.toolAllowlist)
    ? (r.toolAllowlist as unknown[]).filter(
        (x): x is string => typeof x === "string",
      )
    : null;
  return {
    id: r.id,
    name: r.name,
    source: r.source === "native" ? "native" : "custom",
    enabled: r.enabled,
    intervalMs: r.intervalMs,
    instructions: r.instructions ?? "",
    toolAllowlist: allowlist,
    lastRunAt: r.lastRunAt ? r.lastRunAt.toISOString() : null,
    lastRunStatus: r.lastRunStatus,
    lastRunError: r.lastRunError,
    createdAt: r.createdAt.toISOString(),
  };
}

// ---------- Native (starter pack) seeding ----------

// Per-user row id for a native action. Deterministic so re-seeding upserts the
// same row instead of duplicating.
function nativeId(userId: string, key: string): string {
  return `nv:${key}:${userId}`;
}

// One attempt per user per process. Seeding is idempotent, but this keeps the
// hot path (every authenticated request / every GET /workflows) from firing 20
// upserts each time.
const seededUsers = new Set<string>();

// Upsert the native starter pack into a user's workflows. Inserts run enabled
// (native ships on by default); re-seeds refresh the code-owned definition
// fields but deliberately leave `enabled` alone so a user's toggle sticks.
export async function seedNativeWorkflows(userId: string): Promise<void> {
  if (seededUsers.has(userId)) return;
  try {
    for (const def of NATIVE_ACTIONS) {
      await db
        .insert(workflowsTable)
        .values({
          id: nativeId(userId, def.key),
          userId,
          name: def.name,
          source: "native",
          enabled: true,
          intervalMs: normalizeInterval(def.intervalMs),
          instructions: def.instructions,
          toolAllowlist: def.toolAllowlist,
        })
        .onConflictDoUpdate({
          target: workflowsTable.id,
          set: {
            name: def.name,
            source: "native",
            intervalMs: normalizeInterval(def.intervalMs),
            instructions: def.instructions,
            toolAllowlist: def.toolAllowlist,
          },
        });
    }
    // Prune orphaned native rows: native actions removed from NATIVE_ACTIONS in
    // a release should stop running. Custom (user-created) rows are never touched.
    const liveIds = NATIVE_ACTIONS.map((d) => nativeId(userId, d.key));
    await db
      .delete(workflowsTable)
      .where(
        and(
          eq(workflowsTable.userId, userId),
          eq(workflowsTable.source, "native"),
          notInArray(workflowsTable.id, liveIds),
        ),
      );
    seededUsers.add(userId);
  } catch (err) {
    // Never let seeding break a request or the scheduler. It'll retry next time
    // (we only mark the user seeded on success).
    logger.warn({ err, userId }, "native action seeding failed");
  }
}

export async function listWorkflows(): Promise<PublicWorkflow[]> {
  const userId = getCurrentUserId();
  await seedNativeWorkflows(userId);
  const rows = await db
    .select()
    .from(workflowsTable)
    .where(eq(workflowsTable.userId, userId));
  return rows
    .map(rowToPublic)
    .sort((a, b) => {
      if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
      return b.createdAt.localeCompare(a.createdAt);
    });
}

function normalizeInterval(ms: unknown): number {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return 600_000;
  for (const allowed of ALLOWED_INTERVALS_MS) {
    if (ms <= allowed) return allowed;
  }
  return ALLOWED_INTERVALS_MS[ALLOWED_INTERVALS_MS.length - 1]!;
}

export async function createWorkflow(
  draft: WorkflowDraft,
): Promise<PublicWorkflow> {
  const userId = getCurrentUserId();
  const [row] = await db
    .insert(workflowsTable)
    .values({
      id: newId(),
      userId,
      name: draft.name.trim() || "untitled action",
      enabled: draft.enabled,
      intervalMs: normalizeInterval(draft.intervalMs),
      instructions: draft.instructions,
      toolAllowlist: draft.toolAllowlist,
    })
    .returning();
  if (!row) throw new Error("insert returned no row");
  return rowToPublic(row);
}

export async function updateWorkflow(
  id: string,
  patch: Partial<WorkflowDraft>,
): Promise<PublicWorkflow | null> {
  const userId = getCurrentUserId();
  // Look up the row first so we can enforce the native guard: native rows are
  // code-owned, so the only field a user may change in place is `enabled`.
  // Definition edits to a native action fork into a custom copy on the client.
  const [existing] = await db
    .select()
    .from(workflowsTable)
    .where(and(eq(workflowsTable.id, id), eq(workflowsTable.userId, userId)));
  if (!existing) return null;
  const isNative = existing.source === "native";

  const values: Partial<typeof workflowsTable.$inferInsert> = {};
  if (patch.enabled !== undefined) values.enabled = patch.enabled;
  if (!isNative) {
    if (patch.name !== undefined)
      values.name = patch.name.trim() || "untitled action";
    if (patch.intervalMs !== undefined)
      values.intervalMs = normalizeInterval(patch.intervalMs);
    if (patch.instructions !== undefined)
      values.instructions = patch.instructions;
    if (patch.toolAllowlist !== undefined)
      values.toolAllowlist = patch.toolAllowlist;
  }
  if (Object.keys(values).length === 0) {
    const [row] = await db
      .select()
      .from(workflowsTable)
      .where(and(eq(workflowsTable.id, id), eq(workflowsTable.userId, userId)));
    return row ? rowToPublic(row) : null;
  }
  const [row] = await db
    .update(workflowsTable)
    .set(values)
    .where(and(eq(workflowsTable.id, id), eq(workflowsTable.userId, userId)))
    .returning();
  return row ? rowToPublic(row) : null;
}

export type DeleteResult = "deleted" | "not_found" | "native";

export async function deleteWorkflow(id: string): Promise<DeleteResult> {
  const userId = getCurrentUserId();
  const [existing] = await db
    .select({ source: workflowsTable.source })
    .from(workflowsTable)
    .where(and(eq(workflowsTable.id, id), eq(workflowsTable.userId, userId)));
  if (!existing) return "not_found";
  // Native actions are not deletable — they can only be disabled. Deleting one
  // would just get re-seeded on the next request anyway.
  if (existing.source === "native") return "native";
  const rows = await db
    .delete(workflowsTable)
    .where(and(eq(workflowsTable.id, id), eq(workflowsTable.userId, userId)))
    .returning({ id: workflowsTable.id });
  return rows.length > 0 ? "deleted" : "not_found";
}

export async function runWorkflowNow(id: string): Promise<RunResult | null> {
  const userId = getCurrentUserId();
  const [row] = await db
    .select()
    .from(workflowsTable)
    .where(and(eq(workflowsTable.id, id), eq(workflowsTable.userId, userId)));
  if (!row) return null;
  return runGuarded(row, async () => {
    const result = await executeWorkflow(row);
    await db
      .update(workflowsTable)
      .set({
        lastRunAt: new Date(result.ranAt),
        lastRunStatus: result.status,
        lastRunError: result.error ?? null,
      })
      .where(and(eq(workflowsTable.id, id), eq(workflowsTable.userId, userId)));
    return result;
  });
}

// In-flight guard: prevents a manual run-now landing on top of a scheduled
// tick from double-emitting. Single-process only; multi-instance needs a
// DB lease.
const inFlight = new Map<string, Promise<RunResult>>();

async function runGuarded(
  row: WorkflowRow,
  fn: () => Promise<RunResult>,
): Promise<RunResult> {
  const existing = inFlight.get(row.id);
  if (existing) return existing;
  const p = (async () => {
    try {
      return await fn();
    } finally {
      inFlight.delete(row.id);
    }
  })();
  inFlight.set(row.id, p);
  return p;
}

// ---------- Scheduler ----------

const SCHEDULER_TICK_MS = 60_000;
let schedulerTimer: NodeJS.Timeout | null = null;

async function runSchedulerCycle(): Promise<void> {
  const rows = await db
    .select()
    .from(workflowsTable)
    .where(eq(workflowsTable.enabled, true));
  const now = Date.now();
  for (const row of rows) {
    if (inFlight.has(row.id)) continue;
    const last = row.lastRunAt ? row.lastRunAt.getTime() : 0;
    // -2s grace so a 60s interval doesn't drift past the tick window.
    if (last > 0 && now - last < row.intervalMs - 2_000) continue;
    void runGuarded(row, async () => {
      try {
        await hydrateUserSettings(row.userId);
        let result: RunResult = {
          ranAt: new Date().toISOString(),
          status: "error",
          emitted: [],
          error: "scheduler: failed before execution",
        };
        await runWithUser(row.userId, async () => {
          result = await executeWorkflow(row);
        });
        await db
          .update(workflowsTable)
          .set({
            lastRunAt: new Date(result.ranAt),
            lastRunStatus: result.status,
            lastRunError: result.error ?? null,
          })
          .where(eq(workflowsTable.id, row.id));
        if (result.status === "error") {
          logger.warn(
            { actionId: row.id, error: result.error },
            "scheduled action run errored",
          );
        }
        return result;
      } catch (err) {
        logger.warn(
          { err, actionId: row.id },
          "scheduled action run threw",
        );
        return {
          ranAt: new Date().toISOString(),
          status: "error",
          emitted: [],
          error: err instanceof Error ? err.message : String(err),
        };
      }
    });
  }
}

export function startWorkflowScheduler(): void {
  if (schedulerTimer) return;
  schedulerTimer = setInterval(() => {
    runSchedulerCycle().catch((err) =>
      logger.warn({ err }, "action scheduler cycle failed"),
    );
  }, SCHEDULER_TICK_MS);
  setTimeout(() => {
    runSchedulerCycle().catch((err) =>
      logger.warn({ err }, "action scheduler initial cycle failed"),
    );
  }, 5_000);
  logger.info({ tickMs: SCHEDULER_TICK_MS }, "action scheduler started");
}
