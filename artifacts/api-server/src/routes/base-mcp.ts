import { Router, type IRouter } from "express";
import {
  getStatus,
  startAuthFlow,
  finishAuthFlow,
  disconnect,
  listTools,
  callTool,
  migrateAnonOAuthToUser,
  purgeAnonOAuthState,
} from "../lib/base-mcp";
import { getActiveUserId, runWithUser } from "../lib/request-context";
import { upsertUserByWallet } from "../lib/user";
import { hydrateUserSettings, setBaseMcpSession } from "../lib/settings";
import { seedDefaultActionsIfEmpty } from "../lib/seed-defaults";
import {
  buildSetCookie,
  buildClearAnonCookie,
  signSession,
  SESSION_TTL_SECONDS,
} from "../lib/session";

const ANON_PREFIX = "anon:";

// Both helpers exist so the OAuth callback HTML can safely interpolate
// attacker-controlled values (the `error` query param and thrown error
// messages). Without escaping, a payload like `</script><script>...` would
// break out of the inline <script> block and run same-origin — and the page
// runs inside an authenticated session, so a successful XSS could call
// /api/base-mcp/call with `send`/`swap`. Belt-and-braces:
//   - escapeHtml for any value going into HTML body text
//   - escapeJsonForScript for JSON literals embedded inside <script>
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeJsonForScript(s: string): string {
  // JSON.stringify does NOT escape `</` or U+2028/U+2029, all of which can
  // terminate or corrupt an inline script. Patch them up.
  return JSON.stringify(s)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function currentAnonId(): string | null {
  const uid = getActiveUserId();
  if (!uid || !uid.startsWith(ANON_PREFIX)) return null;
  return uid.slice(ANON_PREFIX.length);
}

// Pull the connected wallet address out of the get_wallets MCP tool result.
// The shape varies a bit by server version; we accept either
// {baseAccount:{address}} or {address} or [{address}].
function extractWalletAddress(parsed: unknown): string | null {
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;
  const ba = obj["baseAccount"];
  if (ba && typeof ba === "object") {
    const addr = (ba as Record<string, unknown>)["address"];
    if (typeof addr === "string" && addr.startsWith("0x")) return addr;
  }
  if (typeof obj["address"] === "string" && (obj["address"] as string).startsWith("0x")) {
    return obj["address"] as string;
  }
  if (Array.isArray(obj["wallets"])) {
    for (const w of obj["wallets"] as unknown[]) {
      if (w && typeof w === "object") {
        const a = (w as Record<string, unknown>)["address"];
        if (typeof a === "string" && a.startsWith("0x")) return a;
      }
    }
  }
  return null;
}

const router: IRouter = Router();

router.get("/base-mcp/status", async (_req, res): Promise<void> => {
  try {
    const status = await getStatus();
    res.json(status);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: message });
  }
});

router.post("/base-mcp/auth-url", async (_req, res): Promise<void> => {
  try {
    const result = await startAuthFlow();
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: message });
  }
});

// Top-level entry point for the OAuth dance. The popup navigates HERE
// directly (rather than calling the JSON /auth-url endpoint via fetch and
// then opening Base's URL), so that the bunny_anon cookie is set during a
// top-level browser navigation. Cookie set on a same-origin fetch issued
// from inside a cross-site preview iframe gets dropped by third-party cookie
// blocking — but cookies set on a top-level popup navigation persist.
router.get("/base-mcp/connect-start", async (_req, res): Promise<void> => {
  try {
    const result = await startAuthFlow();
    res.redirect(302, result.authUrl);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res
      .status(500)
      .send(
        `<html><body><script>window.opener?.postMessage({type:"base-mcp-auth",ok:false,error:${escapeJsonForScript(message)}},"*");window.close();</script>Error: ${escapeHtml(message)}</body></html>`,
      );
  }
});

router.get("/base-mcp/callback", async (req, res): Promise<void> => {
  const code = typeof req.query["code"] === "string" ? req.query["code"] : "";
  const state = typeof req.query["state"] === "string" ? req.query["state"] : "";
  const error = typeof req.query["error"] === "string" ? req.query["error"] : "";
  if (error) {
    res
      .status(400)
      .send(
        `<html><body><script>window.opener?.postMessage({type:"base-mcp-auth",ok:false,error:${escapeJsonForScript(error)}},"*");window.close();</script>Authorization failed: ${escapeHtml(error)}</body></html>`,
      );
    return;
  }
  if (!code) {
    res.status(400).send("Missing authorization code");
    return;
  }
  if (!state) {
    res.status(400).send("Missing OAuth state");
    return;
  }
  const anonIdOnEntry = currentAnonId();
  try {
    await finishAuthFlow(code, state);

    // If this OAuth flow was bootstrapped anonymously (the visitor wasn't
    // signed in when they clicked "connect base account"), derive their
    // wallet address from the freshly authorized MCP, upsert a real user,
    // migrate the OAuth state, and hand them a real session cookie.
    if (anonIdOnEntry) {
      let address: string | null = null;
      try {
        const wallets = await callTool("get_wallets", {});
        let parsed: unknown = null;
        try {
          parsed = JSON.parse(wallets.content);
        } catch {
          parsed = null;
        }
        address = extractWalletAddress(parsed);
      } catch (err) {
        req.log.warn({ err }, "get_wallets failed during anon → user upgrade");
      }
      if (!address) {
        throw new Error(
          "Could not determine your wallet address from Base. Try again or open the popup directly.",
        );
      }
      const lower = address.toLowerCase();
      const userId = await upsertUserByWallet(lower);
      await migrateAnonOAuthToUser(anonIdOnEntry, userId, async (s) => {
        await runWithUser(userId, async () => {
          await hydrateUserSettings(userId);
          await setBaseMcpSession(s);
          try {
            await seedDefaultActionsIfEmpty(userId);
          } catch (err) {
            req.log.warn({ err, userId }, "seed default actions failed");
          }
        });
      });
      const sessionCookie = signSession(userId, lower);
      res.setHeader("Set-Cookie", [
        buildSetCookie(sessionCookie, SESSION_TTL_SECONDS),
        buildClearAnonCookie(),
      ]);
    }

    res.send(
      `<html><body><script>window.opener?.postMessage({type:"base-mcp-auth",ok:true},"*");window.close();</script>Connected. You can close this window.</body></html>`,
    );
  } catch (err) {
    // Half-finished anon flows leave OAuth tokens + an MCP client in memory;
    // purge them so the next "connect" attempt starts clean. Also clear the
    // bunny_anon cookie so a fresh anon id is minted next time.
    if (anonIdOnEntry) {
      purgeAnonOAuthState(anonIdOnEntry);
      res.setHeader("Set-Cookie", buildClearAnonCookie());
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    req.log.error({ err }, "Base MCP callback failed");
    res
      .status(500)
      .send(
        `<html><body><script>window.opener?.postMessage({type:"base-mcp-auth",ok:false,error:${escapeJsonForScript(message)}},"*");window.close();</script>Error: ${escapeHtml(message)}</body></html>`,
      );
  }
});

router.post("/base-mcp/disconnect", async (_req, res): Promise<void> => {
  try {
    await disconnect();
    res.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: message });
  }
});

const ALLOWED_TOOLS = new Set([
  "get_portfolio",
  "get_wallets",
  "get_transaction_history",
  "search_tokens",
  "send",
  "swap",
  "get_request_status",
]);

router.post("/base-mcp/call", async (req, res): Promise<void> => {
  const body = req.body as { name?: unknown; args?: unknown };
  const name = typeof body.name === "string" ? body.name : "";
  const args =
    body.args && typeof body.args === "object" && !Array.isArray(body.args)
      ? (body.args as Record<string, unknown>)
      : {};
  if (!name) {
    res.status(400).json({ error: "Missing tool name" });
    return;
  }
  if (!ALLOWED_TOOLS.has(name)) {
    res.status(403).json({ error: `Tool ${name} is not exposed via this endpoint` });
    return;
  }
  try {
    const result = await callTool(name, args);
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(result.content);
    } catch {
      parsed = null;
    }
    // Approval polling is opaque without seeing the raw response — log the
    // first ~400 chars so we can tune classifyStatus against real shapes.
    if (name === "get_request_status") {
      req.log.info(
        {
          tool: name,
          args,
          isError: result.isError,
          contentPreview: result.content.slice(0, 400),
        },
        "get_request_status result",
      );
    }
    res.json({ content: result.content, isError: result.isError, parsed });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    req.log.error({ err, tool: name }, "MCP tool call failed");
    res.status(500).json({ error: message });
  }
});

router.get("/base-mcp/tools", async (_req, res): Promise<void> => {
  try {
    const tools = await listTools();
    res.json(tools);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: message });
  }
});

export default router;
