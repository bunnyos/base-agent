import { Router, type IRouter } from "express";
import {
  buildClearCookie,
  buildClearAnonCookie,
  readCookie,
  verifySession,
  SESSION_COOKIE_NAME,
} from "../lib/session";
import {
  disconnect as disconnectBaseMcp,
  getStatus as getBaseMcpStatus,
} from "../lib/base-mcp";
import { runWithUser } from "../lib/request-context";
import { hydrateUserSettings } from "../lib/settings";

// Auth endpoints. Sign-in itself is owned by the Base MCP OAuth flow
// (/api/base-mcp/auth-url + /callback) — there is no separate SIWE step.
// These routes just expose the current session and logout.
const router: IRouter = Router();

router.get("/auth/me", (req, res) => {
  void (async () => {
    const cookie = readCookie(req.headers.cookie, SESSION_COOKIE_NAME);
    const payload = verifySession(cookie);
    if (!payload) {
      res.json({ authenticated: false });
      return;
    }

    // Sign-in is anchored to the Base MCP session. If the user has a valid
    // signed session cookie but their Base MCP is no longer connected
    // (server restart wiped the in-memory client, OAuth tokens expired and
    // refresh failed, user revoked from Base, etc.), the UI was painting
    // them as "logged in" while every wallet call quietly failed. Treat
    // that drift as a logout: clear cookies and report unauthenticated so
    // the connect-wallet button comes back.
    let connected = false;
    try {
      await hydrateUserSettings(payload.uid);
      const status = await runWithUser(payload.uid, () => getBaseMcpStatus());
      connected = status.connected;
    } catch (err) {
      req.log.warn(
        { err, userId: payload.uid },
        "auth/me: base-mcp status check failed; treating as disconnected",
      );
    }

    if (!connected) {
      res.setHeader("Set-Cookie", [buildClearCookie(), buildClearAnonCookie()]);
      res.json({ authenticated: false, reason: "base-mcp-disconnected" });
      return;
    }

    res.json({
      authenticated: true,
      userId: payload.uid,
      walletAddress: payload.addr,
    });
  })();
});

// Hard sign-out: clear cookies AND tear down the user's Base MCP session
// (OAuth tokens persisted in DB + in-memory client + tools cache). Without
// this the user signs back in instantly from cached tokens on the next
// "connect base wallet" click and feels like nothing happened.
router.post("/auth/logout", (req, res) => {
  void (async () => {
    try {
      const cookie = readCookie(req.headers.cookie, SESSION_COOKIE_NAME);
      const payload = verifySession(cookie);
      if (payload) {
        try {
          await hydrateUserSettings(payload.uid);
          await runWithUser(payload.uid, () => disconnectBaseMcp());
        } catch (err) {
          req.log.warn({ err }, "logout: failed to tear down base-mcp; clearing cookies anyway");
        }
      }
    } catch (err) {
      req.log.error({ err }, "logout: unexpected error before cookie clear");
    } finally {
      // Always clear cookies, even if anything above blew up. HttpOnly
      // cookies can only be cleared by the server, so a failure here would
      // leave the browser stuck "signed in" until the cookie expires.
      res.setHeader("Set-Cookie", [buildClearCookie(), buildClearAnonCookie()]);
      if (!res.headersSent) res.json({ ok: true });
    }
  })();
});

export default router;
