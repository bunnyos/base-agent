// ── Adding a new language ───────────────────────────────────────────────────
// 1. Add its code to `LANGS` and a display label to `LANG_LABELS` below.
// 2. Create `locales/<code>/` and drop in namespace files (copy an existing
//    language's folder as a template). You can translate incrementally — any
//    missing namespace/key falls back to FALLBACK_LANG automatically.
// That's it. Locale files are auto-discovered (see i18n/index.tsx), so there
// are no imports or registries to update.
// ────────────────────────────────────────────────────────────────────────────

export const LANGS = ["zh", "en", "ko"] as const;
export type Lang = (typeof LANGS)[number];

// Languages offered in the UI switcher.
export const SELECTABLE_LANGS: readonly Lang[] = ["zh", "en", "ko"];

// Shown to first-time visitors with no saved preference.
export const DEFAULT_LANG: Lang = "zh";
// Used to fill any missing translation in the active language.
export const FALLBACK_LANG: Lang = "en";
export const STORAGE_KEY = "bunny.lang";

export const LANG_LABELS: Record<Lang, string> = {
  zh: "中文",
  en: "EN",
  ko: "한국어",
};

export function isLang(v: unknown): v is Lang {
  return typeof v === "string" && (LANGS as readonly string[]).includes(v);
}
