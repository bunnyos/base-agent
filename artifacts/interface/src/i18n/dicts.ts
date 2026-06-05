import { FALLBACK_LANG, type Lang } from "./config";
import type { TFn, Vars } from "./context";

type Namespace = Record<string, string>;
type Dict = Record<string, Namespace>;

// Auto-discover every locale file at build time. A locale lives at
// `./locales/<lang>/<namespace>.ts` and default-exports a flat
// `{ key: "value" }` object. Adding a new language is just dropping a folder
// of files here (plus one entry in config.ts for the switcher) — no wiring,
// no imports to maintain. Partially-translated languages are fine: any missing
// namespace or key transparently falls back to FALLBACK_LANG at runtime.
//
// This glob lives apart from the React context (see context.ts) so editing a
// locale only hot-updates this data module, never the context identity.
const modules = import.meta.glob<{ default: Namespace }>("./locales/*/*.ts", {
  eager: true,
});

const DICTS: Record<string, Dict> = {};
for (const [path, mod] of Object.entries(modules)) {
  const m = /\/locales\/([^/]+)\/([^/]+)\.ts$/.exec(path);
  if (!m) continue;
  const [, lang, ns] = m;
  (DICTS[lang] ??= {})[ns] = mod.default ?? {};
}

function lookup(dict: Dict, key: string): string | undefined {
  const dot = key.indexOf(".");
  if (dot === -1) return undefined;
  const ns = key.slice(0, dot);
  const k = key.slice(dot + 1);
  return dict[ns]?.[k];
}

function interpolate(str: string, vars?: Vars): string {
  if (!vars) return str;
  return str.replace(/\{(\w+)\}/g, (m, name) =>
    name in vars ? String(vars[name]) : m,
  );
}

export function makeT(lang: Lang): TFn {
  const primary = DICTS[lang] ?? {};
  const fallback = DICTS[FALLBACK_LANG] ?? {};
  return (key, vars) => {
    const hit = lookup(primary, key) ?? lookup(fallback, key) ?? key;
    return interpolate(hit, vars);
  };
}
