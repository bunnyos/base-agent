// Static identifiers for outbound third-party headers (currently OpenRouter's
// HTTP-Referer / X-Title used for app analytics + ranking). These are NOT
// the public origin of this deployment — OpenRouter just wants a stable
// identifier for the app making the call. Keeping it static makes the code
// domain-agnostic: a fork running on any host reports the same identifier
// unless the operator overrides it.
export const OPENROUTER_HTTP_REFERER =
  process.env["OPENROUTER_HTTP_REFERER"] ?? "https://bunnyos.ai";
export const OPENROUTER_APP_TITLE =
  process.env["OPENROUTER_APP_TITLE"] ?? "bunnyOS";
