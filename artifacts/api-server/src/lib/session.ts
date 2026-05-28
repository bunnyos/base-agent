import { createHmac, timingSafeEqual } from "node:crypto";

// HMAC-signed session cookie. Format: "<payload-b64url>.<sig-b64url>"
// Payload is JSON { uid, addr, exp } where exp is unix-seconds.
// The HMAC key is derived from SESSION_SECRET separately from the at-rest
// encryption key, so leaking session cookies cannot reveal stored data.

const COOKIE_NAME = "bunny_session";
const TTL_SECONDS = 60 * 60 * 24 * 14; // 14 days

function b64url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fromB64url(s: string): Buffer {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

function getSigningKey(): Buffer {
  const s = process.env["SESSION_SECRET"];
  if (!s || s.length < 16) {
    throw new Error("SESSION_SECRET is required (>=16 chars) for session cookies.");
  }
  // Domain-separated from at-rest key
  return Buffer.from(`session/v1/${s}`, "utf8");
}

export interface SessionPayload {
  uid: string;
  addr: string;
  exp: number;
}

export function signSession(uid: string, addr: string): string {
  const payload: SessionPayload = {
    uid,
    addr,
    exp: Math.floor(Date.now() / 1000) + TTL_SECONDS,
  };
  const body = b64url(Buffer.from(JSON.stringify(payload), "utf8"));
  const sig = b64url(
    createHmac("sha256", getSigningKey()).update(body).digest(),
  );
  return `${body}.${sig}`;
}

export function verifySession(cookie: string | undefined): SessionPayload | null {
  if (!cookie) return null;
  const idx = cookie.lastIndexOf(".");
  if (idx <= 0) return null;
  const body = cookie.slice(0, idx);
  const sig = cookie.slice(idx + 1);
  const expected = createHmac("sha256", getSigningKey()).update(body).digest();
  let actual: Buffer;
  try {
    actual = fromB64url(sig);
  } catch {
    return null;
  }
  if (actual.length !== expected.length) return null;
  if (!timingSafeEqual(actual, expected)) return null;
  let payload: SessionPayload;
  try {
    payload = JSON.parse(fromB64url(body).toString("utf8")) as SessionPayload;
  } catch {
    return null;
  }
  if (typeof payload.exp !== "number" || payload.exp < Date.now() / 1000) {
    return null;
  }
  if (typeof payload.uid !== "string" || typeof payload.addr !== "string") {
    return null;
  }
  return payload;
}

// Minimal Cookie header parser — avoids the cookie-parser dep. Returns
// the value of `name` or undefined. Tolerates spaces and quotes.
export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    if (k !== name) continue;
    let v = part.slice(eq + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    try {
      return decodeURIComponent(v);
    } catch {
      return v;
    }
  }
  return undefined;
}

export function buildSetCookie(value: string, maxAgeSec: number): string {
  const secure = process.env["NODE_ENV"] === "production" ? "; Secure" : "";
  return `${COOKIE_NAME}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure}`;
}

export function buildClearCookie(): string {
  const secure = process.env["NODE_ENV"] === "production" ? "; Secure" : "";
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

export const SESSION_COOKIE_NAME = COOKIE_NAME;
export const SESSION_TTL_SECONDS = TTL_SECONDS;

// Short-lived anon session cookie. Issued when an unauthenticated visitor
// starts the Base OAuth flow; cleared once the callback upgrades them to a
// real session keyed on their wallet address. Plain random id, not signed —
// it only buys time to complete the OAuth dance, no privilege attached.
const ANON_COOKIE_NAME = "bunny_anon";
const ANON_TTL_SECONDS = 60 * 15;

export function buildAnonCookie(id: string): string {
  const secure = process.env["NODE_ENV"] === "production" ? "; Secure" : "";
  return `${ANON_COOKIE_NAME}=${encodeURIComponent(id)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${ANON_TTL_SECONDS}${secure}`;
}

export function buildClearAnonCookie(): string {
  const secure = process.env["NODE_ENV"] === "production" ? "; Secure" : "";
  return `${ANON_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

export const ANON_SESSION_COOKIE_NAME = ANON_COOKIE_NAME;
