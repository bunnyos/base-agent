import { createContext, useContext } from "react";
import type { Lang } from "./config";

export type Vars = Record<string, string | number>;
export type TFn = (key: string, vars?: Vars) => string;

export interface LangContextValue {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: TFn;
}

// Created in its own module (no locale glob, no component) so its identity is
// stable across HMR. If this lived next to the `import.meta.glob` of locale
// files, every locale edit would hot-replace this module and mint a NEW context
// object — already-mounted consumers would then read a null context and throw
// "useT must be used within LanguageProvider".
export const LangContext = createContext<LangContextValue | null>(null);

export function useLang(): { lang: Lang; setLang: (l: Lang) => void } {
  const ctx = useContext(LangContext);
  if (!ctx) throw new Error("useLang must be used within LanguageProvider");
  return { lang: ctx.lang, setLang: ctx.setLang };
}

export function useT(): TFn {
  const ctx = useContext(LangContext);
  if (!ctx) throw new Error("useT must be used within LanguageProvider");
  return ctx.t;
}
