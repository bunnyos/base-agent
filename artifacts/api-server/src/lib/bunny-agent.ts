import { getContext } from "./memory";
import { logger } from "./logger";
import { listTools, callTool, getStatus as getMcpStatus } from "./base-mcp";
import { OPENROUTER_HTTP_REFERER, OPENROUTER_APP_TITLE } from "./app-meta";
import {
  listAllAnonMcpTools,
  listAnonMcpStatuses,
  findAnonMcpForTool,
  callAnonMcpTool,
} from "./mcp-anon";
import {
  listMoralisTools,
  findMoralisTool,
  callMoralisTool,
  moralisStatus,
} from "./moralis";
import {
  listCoinGeckoTools,
  findCoinGeckoTool,
  callCoinGeckoTool,
} from "./coingecko";
import {
  listBankrTools,
  findBankrTool,
  callBankrTool,
} from "./bankr";
import {
  listDefiLlamaTools,
  findDefiLlamaTool,
  callDefiLlamaTool,
} from "./defillama";
import {
  getApiKey,
  getStoredModel,
  setStoredModel,
  isProtocolEnabled,
} from "./settings";
import { API_PROTOCOLS } from "../routes/protocols";

export const FALLBACK_MODELS = ["openai/gpt-5.4"];

const DEFAULT_MODEL = process.env["LLM_MODEL"] ?? FALLBACK_MODELS[0]!;

export function getCurrentModelId(): string {
  return getStoredModel() ?? DEFAULT_MODEL;
}

export async function setCurrentModelId(modelId: string): Promise<string> {
  await setStoredModel(modelId);
  return modelId;
}

const SYSTEM_INSTRUCTIONS = `
  # Identity
  You are Bunny, an open-source DeFi companion on Base (Coinbase's L2). You are an expert DeFi operator — fluent in lending, borrowing, swapping, LPing, yield farming, liquid staking, restaking, and risk management. You know the difference between supply APY and net APY, between TVL and liquidity, between an isolated market and a vault, between impermanent loss and divergence loss, between a soft peg and a hard peg. You help the user manage their portfolio, swap tokens, monitor yields, and explore DeFi on Base. You have read-only awareness of the user's freeform memory below — whatever notes, preferences, goals, or constraints they've written for you.

  # Mission — make the user money, don't let them lose it
  Your job is to help the user grow their portfolio safely. Two principles, in this order:
  1. **Protect first.** Before any action, sanity-check it. If something looks risky or wrong, say so plainly in one line before proceeding — don't bury the warning. Things to flag, briefly:
     - Amount looks like a fat-finger (e.g. user typed "100" when their balance is 100.5, or an extra zero vs prior actions).
     - Token has very low liquidity / very high price impact on the quote (>1% for stables, >3% for majors).
     - Vault/market with tiny TVL (< ~$100k), very new (< a few weeks), or dominated by a single depositor.
     - Borrowing close to the liquidation threshold, or supplying as collateral something volatile against a stable debt.
     - Depegged stablecoin, wrapped asset trading off-peg, or an unusually high APY (often = risk premium, not free money).
     - Approving "unlimited" allowance when a bounded amount would do (prefer bounded when the tool supports it).
     - Action on the wrong chain, wrong token symbol collision (e.g. multiple "USDC"s), or unverified contract.
     If a check fails hard (insufficient balance, would liquidate immediately, depegged asset), STOP and tell the user — don't proceed and don't ask them to confirm a clearly bad action.
  2. **Then optimize.** Among safe options, prefer higher net APY, lower fees, deeper liquidity, and reputable protocols. Mention the tradeoff in one short line when it matters ("morpho vault X is +0.4% APY vs Y but TVL is 10× smaller — pick Y unless you want the yield"). Don't shill — be neutral and factual.

  You are not a financial advisor and you don't give regulatory or tax advice. You are an experienced operator giving honest, mechanical guidance. Never promise returns. Never claim something is "safe" without qualification — say "lower risk relative to X" instead.

  # Voice
  Precise, calm, crypto-native. Lowercase. Short, terminal-style replies. No filler, no apologies, no "as an AI". No emoji unless the user uses them. Keep replies under ~6 sentences unless the user asks for depth.

  # Flow — keep it smooth
  Optimize for a frictionless experience. Don't pepper the user with clarifying questions. If their intent is clear enough to act on, ACT — pick sensible defaults (top vault by APY, USDC for stables, the exact amount they named, full balance only if they say "all") and proceed. Only ask a question when the action is irreversible AND genuinely ambiguous (e.g. multiple options match equally, or a required value is missing entirely). Even then, ask ONE short question, not a list. Never confirm before calling a prepare or batched-calls tool — the wallet UI is the confirmation step. Prefer doing over narrating; the user wants an approval URL, not a plan.

  # Tool usage — golden rules
  1. Trust the live tool list, not your memory. Tool names, arg shapes, and which servers are connected come from the tool list provided this session. If a tool you "remember" isn't listed, it doesn't exist.
  2. Read before write. Before any onchain action, call the relevant read tools (balance, quote, allowance, info) to confirm feasibility. Don't fire a prepare/send blindly.
  3. Never invent addresses, vault IDs, market IDs, pool IDs, or token decimals. Discover them via tools. If you can't discover something, say so and stop — don't guess.
  4. Amount discipline. Onchain tools want base-unit integers as strings (1 USDC = "1000000" at 6 decimals; 1 WETH = "1000000000000000000" at 18). Never pass floats. If you don't know a token's decimals, look them up first.
  5. Default chain is base. Pass chain: "base" to any tool that accepts it unless the user explicitly names another chain.
  6. One tool per logical step. Don't loop the same tool with the same args. If a call fails, fix the inputs or stop — don't retry identically.

  # Onchain write flow (prepare → execute) — THE most important contract
  Bunny never broadcasts transactions itself. Every write action is two strict steps in the SAME assistant turn.

  **Step 1 — PREPARE.** Call any tool whose name contains "prepare" (or "build", or otherwise returns unsigned transactions). The result has a top-level "transactions" array. Each entry looks like { to, value?, data? }. There may also be a "requirements" array describing approvals — that is INFORMATIONAL ONLY; the approval txs are ALREADY inside "transactions". Do not skip them.

  **Step 2 — EXECUTE.** Immediately call the batched-calls tool (its name usually contains "send_calls" or otherwise mentions "batched calls" / EIP-5792 — scan the live tool list). You MUST forward EVERY entry from the prepare result's "transactions" array into the "calls" argument, in the same order. Forwarding the transactions is the single most failed step. Models routinely call the batched-calls tool with calls: [] or with only the last tx. DO NOT DO THAT.

  ## Exact shape (copy this pattern literally)

    {
      "chain": "base",
      "calls": [
        { "to": "0x...", "value": "0x0", "data": "0x..." },
        { "to": "0x...", "value": "0x0", "data": "0x..." }
      ]
    }

  ## Mapping rules (strict)
  - "to" — required. Copy directly from the prepare tx.
  - "value" — required, hex string. If the prepare tx omits it, or has 0 / "0", send "0x0".
  - "data" — required, hex string. If the prepare tx omits it, send "0x".
  - Order — preserve it exactly. Approval txs come BEFORE the action tx. Reordering or dropping the approval will revert with "useroperation reverted".
  - Length — calls.length MUST equal transactions.length from the prepare result. If it doesn't, you made a mistake. Fix and retry.
  - Never calls: []. Empty calls is always a bug. If you have nothing to send, you have nothing to do — go back to a prepare tool first.
  - One batched call per user intent. Don't split approval + action into two separate batched calls.

  ## Mandatory self-check before emitting the batched-calls tool call
  Before you emit the tool call, mentally verify ALL of these:
  - I have a prepare-tool result in THIS turn with a transactions array.
  - My calls array has the SAME length as transactions.
  - Every "to" and "data" matches the prepare output exactly. Every missing "value" became "0x0". Every missing "data" became "0x".
  - Order is preserved.
  If any check fails, do NOT emit the call yet — fix it first.

  ## Worked example
  User: "deposit 1 USDC into the top vault".
  1. Call a query tool to discover the vault → pick vault address.
  2. Call prepare_deposit({ chain: "base", vault: "0xVAULT", amount: "1000000" }) → returns { transactions: [approveTx, depositTx], requirements: [...] }.
  3. Call the batched-calls tool with { chain: "base", calls: [ { to: approveTx.to, value: approveTx.value ?? "0x0", data: approveTx.data }, { to: depositTx.to, value: depositTx.value ?? "0x0", data: depositTx.data } ] } → returns an approval URL.
  4. Surface the URL verbatim on its own line. Stop.

  # Approval link & status
  A successful batched-calls result contains an approval URL of the form https://wallet.base.org/requests/<id>. You MUST place that URL verbatim on its own line in your final reply so the UI can detect it. Tell the user to approve in their wallet. NEVER claim a transaction is executed, confirmed, or successful — only the wallet can do that. The UI auto-polls request status; don't poll it yourself unless the user explicitly asks "is it done?".

  # Error recovery
  - "calls array was empty" / "At least one call is required" → you forgot to forward the prepared transactions. Re-call the batched-calls tool NOW with every entry from the last prepare result's "transactions" array. Do not stop, do not re-prepare.
  - "useroperation reverted" / "failed to estimate gas" → simulation failed. Most likely (a) you dropped the approval tx — re-run prepare and include EVERY tx; (b) insufficient balance — check via a balance tool and tell the user; (c) stale or wrong address/params — re-discover. Do NOT blindly retry identical calls.
  - "Protocol X is disabled by the user" → tell the user to enable it in the Protocols panel. Do not retry.
  - Required server not connected → tell the user the single thing to connect (e.g. click "Connect Base" in the top bar). Do not retry.
  - Empty or garbled tool result → say so and stop. Don't fabricate.
  - Rate limited (429) → tell the user and stop. Don't loop.

  # Stop conditions
  - Write action: stop once you've produced an approval URL. Don't call more tools, don't ask for confirmation — the wallet UI is where the user confirms.
  - Read question: stop once you have the answer. Don't chain unnecessary tools.
  - Failed precondition (no balance, no connection, disabled protocol): stop and tell the user the one thing to fix.

  If you finish a write flow without an approval URL in your reply, you have failed the request.
  `.trim();

export interface BunnyRunResult {
  response: string;
  model: string;
}

export type BunnyStreamEvent =
  | { type: "model"; model: string }
  | { type: "thinking" }
  | { type: "tool_call"; id: string; name: string; args: unknown }
  | { type: "tool_result"; id: string; name: string; content: string; isError?: boolean }
  | { type: "content"; delta: string }
  | { type: "done"; model: string; response: string }
  | { type: "error"; message: string };

export type Msg =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface OpenRouterTool {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

interface OpenRouterChoice {
  message?: {
    content?: string | null;
    tool_calls?: ToolCall[];
  };
  finish_reason?: string;
}

export async function callOpenRouter(
  apiKey: string,
  model: string,
  messages: Msg[],
  tools: OpenRouterTool[] | undefined,
  referer: string,
): Promise<
  | { ok: true; message: NonNullable<OpenRouterChoice["message"]>; finishReason: string }
  | { ok: false; status: number; text: string }
> {
  const body: Record<string, unknown> = {
    model,
    messages,
    temperature: 0.6,
  };
  if (tools && tools.length > 0) {
    body["tools"] = tools;
    body["tool_choice"] = "auto";
  }
  const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": referer,
      "X-Title": OPENROUTER_APP_TITLE,
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    return { ok: false, status: resp.status, text };
  }
  const json = (await resp.json()) as { choices?: OpenRouterChoice[] };
  const choice = json.choices?.[0];
  const message = choice?.message ?? { content: "" };
  return { ok: true, message, finishReason: choice?.finish_reason ?? "stop" };
}

export async function getMcpToolsForOpenRouter(): Promise<OpenRouterTool[]> {
  const out: OpenRouterTool[] = [];
  try {
    const status = await getMcpStatus();
    if (status.connected && isProtocolEnabled("base")) {
      const tools = await listTools();
      for (const t of tools) {
        out.push({
          type: "function" as const,
          function: {
            name: t.name,
            description: t.description || t.name,
            parameters:
              typeof t.inputSchema === "object" && t.inputSchema
                ? t.inputSchema
                : { type: "object", properties: {} },
          },
        });
      }
    }
  } catch (err) {
    logger.warn({ err }, "Failed to load Base MCP tools");
  }
  try {
    for (const t of listAllAnonMcpTools()) {
      if (!isProtocolEnabled(t.serverId)) continue;
      out.push({
        type: "function" as const,
        function: {
          name: t.name,
          description: t.description || t.name,
          parameters:
            typeof t.inputSchema === "object" && t.inputSchema
              ? t.inputSchema
              : { type: "object", properties: {} },
        },
      });
    }
  } catch (err) {
    logger.warn({ err }, "Failed to load anon MCP tools");
  }
  try {
    const m = moralisStatus();
    if (m.connected && isProtocolEnabled("moralis")) {
      for (const t of listMoralisTools()) {
        out.push({
          type: "function" as const,
          function: {
            name: t.name,
            description: t.description || t.name,
            parameters:
              typeof t.inputSchema === "object" && t.inputSchema
                ? t.inputSchema
                : { type: "object", properties: {} },
          },
        });
      }
    }
  } catch (err) {
    logger.warn({ err }, "Failed to load Moralis tools");
  }
  try {
    if (isProtocolEnabled("coingecko")) {
      for (const t of listCoinGeckoTools()) {
        out.push({
          type: "function" as const,
          function: {
            name: t.name,
            description: t.description || t.name,
            parameters:
              typeof t.inputSchema === "object" && t.inputSchema
                ? t.inputSchema
                : { type: "object", properties: {} },
          },
        });
      }
    }
    if (isProtocolEnabled("defillama")) {
      for (const t of listDefiLlamaTools()) {
        out.push({
          type: "function" as const,
          function: {
            name: t.name,
            description: t.description || t.name,
            parameters:
              typeof t.inputSchema === "object" && t.inputSchema
                ? t.inputSchema
                : { type: "object", properties: {} },
          },
        });
      }
    }
    if (isProtocolEnabled("bankr")) {
      for (const t of listBankrTools()) {
        out.push({
          type: "function" as const,
          function: {
            name: t.name,
            description: t.description || t.name,
            parameters:
              typeof t.inputSchema === "object" && t.inputSchema
                ? t.inputSchema
                : { type: "object", properties: {} },
          },
        });
      }
    }
  } catch (err) {
    logger.warn({ err }, "Failed to load CoinGecko tools");
  }
  return out;
}

interface AgentTurnCtx {
  // Transactions from the most recent successful `*prepare*` tool result,
  // already normalized to `{to, value, data}`. Used to auto-recover
  // `send_calls` when the model forgets to forward them.
  lastPrepareTransactions: Array<{ to: string; value: string; data: string }> | null;
}

export function newAgentTurnCtx(): AgentTurnCtx {
  return { lastPrepareTransactions: null };
}

// Normalize a `value` field to a 0x-prefixed hex string. The wallet RPC
// strictly requires hex (it errors with "cannot unmarshal hex string without
// 0x prefix into Go struct field Call.calls.value"). Some prepare tools
// return decimal strings ("0", "1000000"), bare "0x", or omit it entirely.
function normalizeHexValue(v: unknown): string {
  if (typeof v !== "string" || v === "" || v === "0x") return "0x0";
  if (v.startsWith("0x") || v.startsWith("0X")) {
    return v === "0x0" ? "0x0" : v;
  }
  // Decimal string — coerce to hex via BigInt. Falls back to "0x0" on garbage.
  try {
    const n = BigInt(v);
    return `0x${n.toString(16)}`;
  } catch {
    return "0x0";
  }
}

// Normalize a `data` field. Empty / missing → "0x"; non-0x-prefixed hex →
// prefixed; anything else passed through (caller's responsibility).
function normalizeHexData(d: unknown): string {
  if (typeof d !== "string" || d === "") return "0x";
  if (d.startsWith("0x") || d.startsWith("0X")) return d;
  // Looks like raw hex chars — prefix it.
  if (/^[0-9a-fA-F]+$/.test(d)) return `0x${d}`;
  return "0x";
}

// Normalize an array of calls (whether produced by the model or pulled from
// a cached prepare result) to the {to, value, data} shape with proper
// 0x-prefixed hex on value/data. Drops any entry without a `to`.
function normalizeCalls(
  raw: unknown,
): Array<{ to: string; value: string; data: string }> {
  if (!Array.isArray(raw)) return [];
  const out: Array<{ to: string; value: string; data: string }> = [];
  for (const c of raw) {
    if (!c || typeof c !== "object") continue;
    const o = c as Record<string, unknown>;
    if (typeof o["to"] !== "string" || !o["to"]) continue;
    out.push({
      to: o["to"],
      value: normalizeHexValue(o["value"]),
      data: normalizeHexData(o["data"]),
    });
  }
  return out;
}

// Parse a prepare_* tool result, pulling out the `transactions` array and
// normalizing each entry to the `{to, value, data}` shape that send_calls
// expects. Returns null when the content isn't JSON or has no usable txs.
function extractPreparedTransactions(
  content: string,
): Array<{ to: string; value: string; data: string }> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const txs = (parsed as { transactions?: unknown }).transactions;
  const out = normalizeCalls(txs);
  return out.length > 0 ? out : null;
}

export async function dispatchToolCall(
  name: string,
  args: Record<string, unknown>,
  ctx?: AgentTurnCtx,
): Promise<{ content: string; isError: boolean }> {
  // Common model failure: send_calls is invoked with an empty `calls` array
  // after a successful prepare_* call. If we still have the prepared
  // transactions cached from this turn, splice them in server-side so the
  // user's deposit / swap actually goes through. Otherwise fall back to a
  // sharp directive error so the next round has a chance to recover.
  if (name === "send_calls") {
    const rawCalls = (args as { calls?: unknown }).calls;
    let normalized = normalizeCalls(rawCalls);
    if (normalized.length === 0) {
      const cached = ctx?.lastPrepareTransactions;
      if (cached && cached.length > 0) {
        normalized = cached;
        logger.info(
          { injected: cached.length },
          "send_calls had empty/invalid calls array; auto-populated from cached prepare transactions",
        );
      } else {
        return {
          isError: true,
          content:
            "send_calls FAILED: calls array was empty. You MUST pass EVERY transaction from the prior prepare_* tool's `transactions` array as `calls`, in order, mapped to `{to, value, data}` (value defaults to \"0x0\", data to \"0x\"). Do not drop the approval. Re-call send_calls now with the populated calls array; do not stop here.",
        };
      }
    }
    // Always rewrite calls to the normalized form so downstream wallet RPC
    // sees properly 0x-prefixed hex for value/data. Without this, prepare
    // tools that return decimal "0" or bare "" cause the wallet to error
    // with "cannot unmarshal hex string without 0x prefix".
    (args as Record<string, unknown>)["calls"] = normalized;
  }
  const anonServerId = findAnonMcpForTool(name);
  let result: { content: string; isError: boolean };
  if (anonServerId) {
    if (!isProtocolEnabled(anonServerId)) {
      throw new Error(`Protocol ${anonServerId} is disabled by the user`);
    }
    result = await callAnonMcpTool(anonServerId, name, args);
  } else if (findMoralisTool(name)) {
    if (!isProtocolEnabled("moralis")) {
      throw new Error("Moralis is disabled by the user");
    }
    result = await callMoralisTool(name, args);
  } else if (findCoinGeckoTool(name)) {
    if (!isProtocolEnabled("coingecko")) {
      throw new Error("CoinGecko is disabled by the user");
    }
    result = await callCoinGeckoTool(name, args);
  } else if (findBankrTool(name)) {
    if (!isProtocolEnabled("bankr")) {
      throw new Error("Bankr is disabled by the user");
    }
    result = await callBankrTool(name, args);
  } else if (findDefiLlamaTool(name)) {
    if (!isProtocolEnabled("defillama")) {
      throw new Error("DeFi Llama is disabled by the user");
    }
    result = await callDefiLlamaTool(name, args);
  } else {
    if (!isProtocolEnabled("base")) {
      throw new Error("Base MCP is disabled by the user");
    }
    result = await callTool(name, args);
  }
  // Cache prepare_* transactions so a subsequent empty send_calls can be
  // auto-recovered in the same turn. Matches any tool whose name contains
  // "prepare" (e.g. morpho_prepare_deposit, aave_prepare_withdraw, etc.).
  if (ctx && !result.isError && /prepare/i.test(name)) {
    const txs = extractPreparedTransactions(result.content);
    if (txs) ctx.lastPrepareTransactions = txs;
  }
  return result;
}

function buildMcpStatusNote(toolCount: number): string {
  const parts: string[] = [];
  const baseEnabled = isProtocolEnabled("base");
  parts.push(
    !baseEnabled
      ? `Base MCP DISABLED by user.`
      : toolCount > 0
        ? `Base MCP CONNECTED.`
        : `Base MCP NOT connected.`,
  );
  const anon = listAnonMcpStatuses();
  for (const a of anon) {
    const enabled = isProtocolEnabled(a.id);
    if (!enabled) {
      parts.push(`${a.label} MCP DISABLED by user.`);
    } else if (a.connected) {
      parts.push(`${a.label} MCP CONNECTED (${a.toolCount} tools, ${a.kind}).`);
    } else {
      parts.push(`${a.label} MCP NOT connected.`);
    }
  }
  const enabledApis = API_PROTOCOLS.filter((p) => isProtocolEnabled(p.id));
  if (enabledApis.length > 0) {
    parts.push(
      `HTTP-API protocols available via web_request: ${enabledApis.map((p) => p.id).join(", ")}.`,
    );
  }
  const disabledApis = API_PROTOCOLS.filter((p) => !isProtocolEnabled(p.id));
  if (disabledApis.length > 0) {
    parts.push(
      `Disabled by user (do not use): ${disabledApis.map((p) => p.id).join(", ")}.`,
    );
  }
  return parts.join(" ");
}

const MAX_TOOL_ROUNDS = 50;

// Wallet approval landing pages returned by the batched-calls / send_calls
// tool. We only treat URLs as "approval links" when (a) the tool that
// produced them is the actual wallet-send tool and (b) the URL path matches
// a known wallet-request route. Without (b), generic base.org / wallet.*
// URLs that happen to appear in other tool results (vault pages, docs
// links, prepare output) get misidentified and overwrite the real one.
const APPROVAL_URL_RE =
  /https:\/\/(?:account\.base\.app|wallet\.base\.org|account\.base\.org|keys\.coinbase\.com|wallet\.coinbase\.com)\/(?:wallet-requests|wallet-request|requests|request|calls|approve)\/[^\s"')\]}>,]+/g;

// Tools whose result is allowed to surface an approval URL. Matched
// case-insensitively as a substring so variants like `send_calls`,
// `wallet_send_calls`, etc. all qualify.
function isWalletSendTool(name: string): boolean {
  return /send_calls/i.test(name);
}

function extractApprovalUrls(text: string): string[] {
  if (!text) return [];
  const matches = text.match(APPROVAL_URL_RE) ?? [];
  // Trim common trailing punctuation that the regex can't easily exclude
  return matches.map((u) => u.replace(/[.,;:]+$/, ""));
}

export interface ChatHistoryTurn {
  role: "user" | "assistant";
  content: string;
}

export async function runBunny(
  message: string,
  history?: ChatHistoryTurn[],
): Promise<BunnyRunResult> {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error("OpenRouter API key is not configured. Set it in the Configure dialog.");
  }

  const memoryContext = getContext();
  const mcpTools = await getMcpToolsForOpenRouter();
  const mcpNote = `\n\n${buildMcpStatusNote(mcpTools.length)}${mcpTools.length ? ` Available tools: ${mcpTools.map((t) => t.function.name).join(", ")}.` : ""}`;
  const systemPrompt = `${SYSTEM_INSTRUCTIONS}\n\n${memoryContext}${mcpNote}`;

  const referer = OPENROUTER_HTTP_REFERER;

  const messages: Msg[] = [
    { role: "system", content: systemPrompt },
    ...(history ?? []).map((h) => ({ role: h.role, content: h.content }) as Msg),
    { role: "user", content: message },
  ];

  const tried = new Set<string>();
  const candidates = [getCurrentModelId(), ...FALLBACK_MODELS];

  let lastErr: { status: number; text: string } | null = null;

  for (const model of candidates) {
    if (tried.has(model)) continue;
    tried.add(model);

    let attemptOk = true;
    let finalContent = "";
    const ctx = newAgentTurnCtx();

    try {
      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        const result = await callOpenRouter(apiKey, model, messages, mcpTools, referer);
        if (!result.ok) {
          lastErr = { status: result.status, text: result.text };
          logger.warn(
            { model, status: result.status, text: result.text.slice(0, 200) },
            "OpenRouter model failed, trying next",
          );
          attemptOk = false;
          break;
        }
        const msg = result.message;
        const toolCalls = msg.tool_calls ?? [];
        if (toolCalls.length === 0) {
          finalContent = (msg.content ?? "").trim();
          break;
        }
        // Append assistant message with tool_calls
        messages.push({
          role: "assistant",
          content: msg.content ?? null,
          tool_calls: toolCalls,
        });
        // Execute each tool call
        for (const tc of toolCalls) {
          let argsObj: Record<string, unknown> = {};
          try {
            argsObj = JSON.parse(tc.function.arguments || "{}");
          } catch {
            argsObj = {};
          }
          try {
            const toolResult = await dispatchToolCall(tc.function.name, argsObj, ctx);
            messages.push({
              role: "tool",
              tool_call_id: tc.id,
              content: toolResult.content.slice(0, 8000),
            });
          } catch (err) {
            const m = err instanceof Error ? err.message : String(err);
            messages.push({
              role: "tool",
              tool_call_id: tc.id,
              content: `Error calling ${tc.function.name}: ${m}`,
            });
          }
        }
      }
    } catch (err) {
      attemptOk = false;
      const m = err instanceof Error ? err.message : String(err);
      lastErr = { status: 0, text: m };
    }

    if (attemptOk) {
      const response = finalContent || "(bunnyOS is quiet — try a different model)";
      return { response, model };
    }
  }

  const msg = lastErr
    ? `OpenRouter error ${lastErr.status}: ${lastErr.text.slice(0, 300)}`
    : "No models available";
  logger.error({ lastErr }, "All OpenRouter models failed");
  throw new Error(msg);
}

interface StreamDelta {
  content?: string | null;
  tool_calls?: Array<{
    index: number;
    id?: string;
    type?: string;
    function?: { name?: string; arguments?: string };
  }>;
}

interface StreamChoice {
  index?: number;
  delta?: StreamDelta;
  finish_reason?: string | null;
}

async function* streamOpenRouterRound(
  apiKey: string,
  model: string,
  messages: Msg[],
  tools: OpenRouterTool[] | undefined,
  referer: string,
): AsyncGenerator<
  | { kind: "content"; delta: string }
  | { kind: "tool_calls"; calls: ToolCall[] }
  | { kind: "done"; finishReason: string; assistantContent: string; toolCalls: ToolCall[] }
  | { kind: "error"; status: number; text: string }
> {
  const body: Record<string, unknown> = {
    model,
    messages,
    temperature: 0.6,
    stream: true,
  };
  if (tools && tools.length > 0) {
    body["tools"] = tools;
    body["tool_choice"] = "auto";
  }
  const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": referer,
      "X-Title": OPENROUTER_APP_TITLE,
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok || !resp.body) {
    const text = await resp.text().catch(() => "");
    yield { kind: "error", status: resp.status, text };
    return;
  }
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let assistantContent = "";
  const tcMap = new Map<number, { id: string; name: string; args: string }>();
  let finishReason = "stop";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") continue;
      let parsed: { choices?: StreamChoice[] };
      try {
        parsed = JSON.parse(data) as { choices?: StreamChoice[] };
      } catch {
        continue;
      }
      const choice = parsed.choices?.[0];
      if (!choice) continue;
      const delta = choice.delta;
      if (delta?.content) {
        assistantContent += delta.content;
        yield { kind: "content", delta: delta.content };
      }
      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index;
          const cur = tcMap.get(idx) ?? { id: "", name: "", args: "" };
          if (tc.id) cur.id = tc.id;
          if (tc.function?.name) cur.name = tc.function.name;
          if (tc.function?.arguments) cur.args += tc.function.arguments;
          tcMap.set(idx, cur);
        }
      }
      if (choice.finish_reason) finishReason = choice.finish_reason;
    }
  }
  const toolCalls: ToolCall[] = Array.from(tcMap.entries())
    .sort(([a], [b]) => a - b)
    .map(([, v]) => ({
      id: v.id || `call_${Math.random().toString(36).slice(2)}`,
      type: "function" as const,
      function: { name: v.name, arguments: v.args || "{}" },
    }));
  if (toolCalls.length > 0) {
    yield { kind: "tool_calls", calls: toolCalls };
  }
  yield { kind: "done", finishReason, assistantContent, toolCalls };
}

export async function* streamBunny(
  message: string,
  history?: ChatHistoryTurn[],
): AsyncGenerator<BunnyStreamEvent> {
  yield { type: "thinking" };
  const apiKey = getApiKey();
  if (!apiKey) {
    yield {
      type: "error",
      message:
        "OpenRouter API key is not configured. Set it in the Configure dialog.",
    };
    return;
  }

  const memoryContext = getContext();
  const mcpTools = await getMcpToolsForOpenRouter();
  const mcpNote = `\n\n${buildMcpStatusNote(mcpTools.length)}${mcpTools.length ? ` Available tools: ${mcpTools.map((t) => t.function.name).join(", ")}.` : ""}`;
  const systemPrompt = `${SYSTEM_INSTRUCTIONS}\n\n${memoryContext}${mcpNote}`;

  const referer = OPENROUTER_HTTP_REFERER;

  const messages: Msg[] = [
    { role: "system", content: systemPrompt },
    ...(history ?? []).map((h) => ({ role: h.role, content: h.content }) as Msg),
    { role: "user", content: message },
  ];

  const tried = new Set<string>();
  const candidates = [getCurrentModelId(), ...FALLBACK_MODELS];
  let lastErr: { status: number; text: string } | null = null;

  for (const model of candidates) {
    if (tried.has(model)) continue;
    tried.add(model);
    yield { type: "model", model };
    yield { type: "thinking" };

    let attemptOk = true;
    let fullResponse = "";
    const ctx = newAgentTurnCtx();
    // Any wallet-approval URL we see in tool results during this attempt.
    // The model is supposed to surface it in its final reply, but some
    // models narrate "submitting…" without quoting the URL — in which case
    // the user sees no button. We capture it here and append it ourselves
    // at the end if missing.
    const approvalUrls = new Set<string>();

    try {
      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        let finishReason = "stop";
        let assistantContent = "";
        let toolCalls: ToolCall[] = [];

        const gen = streamOpenRouterRound(apiKey, model, messages, mcpTools, referer);
        for await (const ev of gen) {
          if (ev.kind === "error") {
            lastErr = { status: ev.status, text: ev.text };
            logger.warn(
              { model, status: ev.status, text: ev.text.slice(0, 200) },
              "OpenRouter model failed, trying next",
            );
            attemptOk = false;
            break;
          }
          if (ev.kind === "content") {
            yield { type: "content", delta: ev.delta };
          } else if (ev.kind === "tool_calls") {
            for (const tc of ev.calls) {
              let argsObj: unknown = {};
              try {
                argsObj = JSON.parse(tc.function.arguments || "{}");
              } catch {
                argsObj = tc.function.arguments;
              }
              yield {
                type: "tool_call",
                id: tc.id,
                name: tc.function.name,
                args: argsObj,
              };
            }
          } else if (ev.kind === "done") {
            finishReason = ev.finishReason;
            assistantContent = ev.assistantContent;
            toolCalls = ev.toolCalls;
          }
        }
        if (!attemptOk) break;

        fullResponse += assistantContent;

        if (toolCalls.length === 0 || finishReason !== "tool_calls") {
          break;
        }

        messages.push({
          role: "assistant",
          content: assistantContent || null,
          tool_calls: toolCalls,
        });

        for (const tc of toolCalls) {
          let argsObj: Record<string, unknown> = {};
          try {
            const p = JSON.parse(tc.function.arguments || "{}");
            if (p && typeof p === "object" && !Array.isArray(p)) {
              argsObj = p as Record<string, unknown>;
            }
          } catch {
            argsObj = {};
          }
          try {
            const toolResult = await dispatchToolCall(tc.function.name, argsObj, ctx);
            const content = toolResult.content.slice(0, 8000);
            if (isWalletSendTool(tc.function.name) && !toolResult.isError) {
              for (const u of extractApprovalUrls(content)) approvalUrls.add(u);
            }
            logger.info(
              {
                tool: tc.function.name,
                isError: toolResult.isError,
                contentPreview: content.slice(0, 400),
                approvalUrlsFound: isWalletSendTool(tc.function.name)
                  ? extractApprovalUrls(content)
                  : [],
              },
              "bunny tool result",
            );
            messages.push({ role: "tool", tool_call_id: tc.id, content });
            yield {
              type: "tool_result",
              id: tc.id,
              name: tc.function.name,
              content,
              isError: toolResult.isError,
            };
          } catch (err) {
            const m = err instanceof Error ? err.message : String(err);
            const content = `Error calling ${tc.function.name}: ${m}`;
            messages.push({ role: "tool", tool_call_id: tc.id, content });
            yield {
              type: "tool_result",
              id: tc.id,
              name: tc.function.name,
              content,
              isError: true,
            };
          }
        }
        yield { type: "thinking" };
      }
    } catch (err) {
      attemptOk = false;
      const m = err instanceof Error ? err.message : String(err);
      lastErr = { status: 0, text: m };
    }

    if (attemptOk) {
      let response = fullResponse.trim() || "(bunnyOS is quiet — try a different model)";
      // Force any approval URLs we saw in tool results into the final reply
      // if the model forgot to include them. Without this, the frontend has
      // nothing to render as the "Approve in Base Account" button and the
      // user sees a dead-end "submitting now…" message.
      const missing: string[] = [];
      for (const u of approvalUrls) {
        if (!response.includes(u)) missing.push(u);
      }
      if (missing.length > 0) {
        const suffix = missing.map((u) => `Approve here: ${u}`).join("\n");
        response = `${response}\n\n${suffix}`.trim();
        logger.info(
          { model, missingCount: missing.length },
          "bunny: appended missing approval URLs to final reply",
        );
      }
      yield { type: "done", model, response };
      return;
    }
  }

  const msg = lastErr
    ? `OpenRouter error ${lastErr.status}: ${lastErr.text.slice(0, 300)}`
    : "No models available";
  logger.error({ lastErr }, "All OpenRouter models failed (stream)");
  yield { type: "error", message: msg };
}

export interface ListedModel {
  id: string;
  name: string;
  price_input: number;
  free: boolean;
}

export async function listOpenRouterModels(): Promise<ListedModel[]> {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error("OpenRouter API key is not configured");
  }
  const resp = await fetch("https://openrouter.ai/api/v1/models", {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!resp.ok) {
    throw new Error(`OpenRouter models error ${resp.status}`);
  }
  const { data } = (await resp.json()) as {
    data: Array<{
      id: string;
      name?: string;
      pricing?: { prompt?: string };
    }>;
  };
  const models: ListedModel[] = data.map((m) => {
    const price = parseFloat(m.pricing?.prompt ?? "0");
    return {
      id: m.id,
      name: m.name ?? m.id,
      price_input: Number.isFinite(price) ? price : 0,
      free: !Number.isFinite(price) || price === 0,
    };
  });
  models.sort((a, b) => {
    if (a.free && !b.free) return -1;
    if (!a.free && b.free) return 1;
    if (a.price_input !== b.price_input) return a.price_input - b.price_input;
    return a.name.localeCompare(b.name);
  });
  return models;
}
