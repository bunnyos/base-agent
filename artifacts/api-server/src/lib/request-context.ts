import { AsyncLocalStorage } from "node:async_hooks";

// Per-request (and per-scanner-iteration) execution context. The session
// middleware resolves a userId from the cookie and runs the request inside
// `als.run({ userId }, next)`. The scanner iterates users and wraps each
// scan in the same way. Every other lib reads the active userId via
// `getCurrentUserId()` (defined in lib/user.ts).

export interface RequestContext {
  userId: string;
  // Public origin the caller reached us on, e.g. "https://bunny.example.com".
  // Populated by the session middleware from req.protocol + req.host (which
  // honor X-Forwarded-* because app sets `trust proxy`). Lets OAuth derive a
  // domain-agnostic redirect_uri without any env config.
  origin?: string;
}

export const requestAls = new AsyncLocalStorage<RequestContext>();

export function runWithUser<T>(userId: string, fn: () => T | Promise<T>): T | Promise<T> {
  return requestAls.run({ userId }, fn);
}

export function runWithRequestContext<T>(
  ctx: RequestContext,
  fn: () => T | Promise<T>,
): T | Promise<T> {
  return requestAls.run(ctx, fn);
}

export function getActiveUserId(): string | undefined {
  return requestAls.getStore()?.userId;
}

export function getActiveRequestOrigin(): string | undefined {
  return requestAls.getStore()?.origin;
}
