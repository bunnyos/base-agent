import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { DEFAULT_LANG, STORAGE_KEY, isLang, type Lang } from "./config";
import { LangContext, type LangContextValue } from "./context";
import { makeT } from "./dicts";

function readStored(): Lang {
  if (typeof window === "undefined") return DEFAULT_LANG;
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    if (isLang(v)) return v;
  } catch {
    /* ignore */
  }
  return DEFAULT_LANG;
}

// This file exports ONLY a component, so React Fast Refresh can hot-update it
// while preserving state. The hooks/context live in ./context and the locale
// data in ./dicts, keeping this boundary refresh-clean.
export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(readStored);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      /* ignore */
    }
    if (typeof document !== "undefined") {
      document.documentElement.lang = lang;
    }
  }, [lang]);

  const setLang = useCallback((l: Lang) => setLangState(l), []);
  const t = useMemo(() => makeT(lang), [lang]);

  const value = useMemo<LangContextValue>(
    () => ({ lang, setLang, t }),
    [lang, setLang, t],
  );

  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}
