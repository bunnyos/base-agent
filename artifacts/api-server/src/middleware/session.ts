import { randomBytes } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import {
  verifySession,
  readCookie,
  SESSION_COOKIE_NAME,
  ANON_SESSION_COOKIE_NAME,
  buildAnonCookie,
} from "../lib/session";
import { runWithRequestContext } from "../lib/request-context";
import { hydrateUserSettings } from "../lib/settings";
import { LOCAL_USER_ID, ensureLocalUser } from "../lib/user";

// Resolves the active user from the session cookie, hydrates their settings
// cache, then runs the rest of the request inside AsyncLocalStorage so
// lib/user.ts:getCurrentUserId() sees the right id.
//
// Auth model: multi-user, with Base MCP OAuth as the sign-in. A visitor with
// no session is allowed through to:
//   - public routes (/auth/*, /healthz) — handled as the local fallback user
//   - the Base MCP OAuth bootstrap (auth-url + callback) — handled as an
//     opaque `anon:<id>` until the callback derives their wallet, upserts a
//     real user, and mints a real session cookie.
// Everything else returns 401.

const PUBLIC_PREFIXES = ["/auth/", "/healthz"];

// Base-MCP endpoints that participate in the anon-OAuth bootstrap. Only the
// two endpoints that actually drive the OAuth dance are allowed anonymously;
// /status is intentionally NOT in this set so passive visitors loading the
// page don't accumulate anon entries in the OAuth provider maps.
//   POST /base-mcp/auth-url      → mint bunny_anon, start OAuth (JSON; legacy)
//   GET  /base-mcp/connect-start → mint bunny_anon, 302 to Base OAuth URL
//                                  (used by the popup; survives third-party
//                                  cookie blocking when the app is in an
//                                  iframe because it's a top-level navigation)
//   GET  /base-mcp/callback      → finish OAuth, derive wallet, mint real session
const ANON_STARTS_FLOW = new Set([
  "/base-mcp/auth-url",
  "/base-mcp/connect-start",
]);
const ANON_FINISHES_FLOW = new Set(["/base-mcp/callback"]);

function isPublicPath(p: string): boolean {
  // p is mounted under /api, so without the prefix
  return PUBLIC_PREFIXES.some((pref) => p.startsWith(pref));
}

// Derive the public origin from the request itself, honoring X-Forwarded-*
// because app.ts sets `trust proxy`. This is what makes OAuth's redirect_uri
// work across preview, deployed, custom domains, localhost, Docker, etc.
// with zero env config.
function originFromReq(req: Request): string {
  const host = req.get("x-forwarded-host") ?? req.get("host") ?? "localhost";
  const proto = req.protocol || "http";
  return `${proto}://${host}`;
}

export function sessionMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  void (async () => {
    try {
      const cookieHeader = req.headers.cookie;
      const sessionCookie = readCookie(cookieHeader, SESSION_COOKIE_NAME);
      const payload = verifySession(sessionCookie);
      const origin = originFromReq(req);

      if (payload) {
        await hydrateUserSettings(payload.uid);
        runWithRequestContext({ userId: payload.uid, origin }, () => next());
        return;
      }

      // No valid session.
      if (isPublicPath(req.path)) {
        // public route — run with local user so settings/etc don't blow up
        await ensureLocalUser();
        await hydrateUserSettings(LOCAL_USER_ID);
        runWithRequestContext({ userId: LOCAL_USER_ID, origin }, () => next());
        return;
      }
      if (ANON_STARTS_FLOW.has(req.path)) {
        // Starting the OAuth dance. Reuse existing bunny_anon cookie if
        // present, else mint a fresh one. The id is opaque — only used as
        // the key into the in-memory anon OAuth state map.
        let anonId = readCookie(cookieHeader, ANON_SESSION_COOKIE_NAME);
        if (!anonId) {
          anonId = randomBytes(16).toString("hex");
          res.append("Set-Cookie", buildAnonCookie(anonId));
        }
        runWithRequestContext({ userId: `anon:${anonId}`, origin }, () => next());
        return;
      }
      if (ANON_FINISHES_FLOW.has(req.path)) {
        // Finishing the dance. We REQUIRE the anon cookie set by /auth-url
        // — without it the callback can't find any anon state to upgrade,
        // and we shouldn't mint a fresh one (no provider, no codeVerifier).
        const anonId = readCookie(cookieHeader, ANON_SESSION_COOKIE_NAME);
        if (!anonId) {
          res.status(400).send("Missing anon session — start the connect flow first");
          return;
        }
        runWithRequestContext({ userId: `anon:${anonId}`, origin }, () => next());
        return;
      }
      res.status(401).json({ error: "not authenticated" });
    } catch (err) {
      req.log.error({ err }, "session middleware failed");
      res.status(500).json({ error: "session resolution failed" });
    }
  })();
}
