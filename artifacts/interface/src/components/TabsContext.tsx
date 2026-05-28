import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

export type Tab = {
  id: string;
  title: string;
  kind:
    | "home"
    | "protocol"
    | "settings"
    | "actions"
    | "chat"
    | "wallet"
    | "actions-builder"
    | "actions-history";
  payload?: { protocolId: string };
  // false → no close button in TabBar and closeTab is a no-op.
  // Defaults to true for backward compatibility; `home` is always non-closable
  // regardless (legacy hard-coded behavior in closeTab).
  closable?: boolean;
  // true → not rendered in TabBar. Used to keep the `home` tab in state on
  // mobile (so legacy callers still work) without showing it alongside the
  // explicit wallet/actions/chat tabs.
  hidden?: boolean;
};

type TabsContextValue = {
  tabs: Tab[];
  activeId: string;
  openTab: (tab: Tab) => void;
  closeTab: (id: string) => void;
  // Force-remove a tab regardless of its `closable` flag. Used for
  // viewport-driven cleanup (e.g. tearing down the mobile-only wallet /
  // actions / chat tabs when we widen back to desktop) where the tabs
  // were intentionally non-closable for the user but still need to go.
  removeTab: (id: string) => void;
  setActive: (id: string) => void;
  setHidden: (id: string, hidden: boolean) => void;
  // Reorder by dragging: move `fromId` so it lands immediately before
  // `toId`. No-op if either id is missing or they're already adjacent
  // in the requested direction.
  moveTab: (fromId: string, toId: string) => void;
  // Rewrite the order of visible tabs from a Framer Motion Reorder list.
  // Hidden tabs keep their positions; visible slots are refilled from the
  // new id order. Used by the draggable TabBar.
  reorderVisible: (orderedVisibleIds: string[]) => void;
};

const HOME_TAB: Tab = { id: "home", title: "main", kind: "home" };
const SETTINGS_TAB: Tab = {
  id: "settings",
  title: "configure",
  kind: "settings",
  closable: false,
};
const ACTIONS_BUILDER_TAB: Tab = {
  id: "actions-builder",
  title: "actions builder",
  kind: "actions-builder",
  closable: false,
};
const ACTIONS_HISTORY_TAB: Tab = {
  id: "actions-history",
  title: "actions history",
  kind: "actions-history",
  closable: false,
};
// Base MCP is the wallet — always-on and seeded on every terminal mount so
// the user lands with their wallet tab already available. Closable so the
// user can dismiss it if the bar gets crowded; re-opens on next sign-in.
const BASE_MCP_TAB: Tab = {
  id: "protocol:base",
  title: "base mcp",
  kind: "protocol",
  payload: { protocolId: "base" },
  closable: true,
};

const TabsContext = createContext<TabsContextValue | null>(null);

export function TabsProvider({ children }: { children: ReactNode }) {
  const [tabs, setTabs] = useState<Tab[]>([
    HOME_TAB,
    ACTIONS_BUILDER_TAB,
    ACTIONS_HISTORY_TAB,
    SETTINGS_TAB,
    BASE_MCP_TAB,
  ]);
  const [activeId, setActiveId] = useState<string>("home");

  const openTab = useCallback((tab: Tab) => {
    setTabs((prev) => (prev.some((t) => t.id === tab.id) ? prev : [...prev, tab]));
    setActiveId(tab.id);
  }, []);

  const closeTab = useCallback((id: string) => {
    if (id === "home") return;
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.id === id);
      if (idx < 0) return prev;
      if (prev[idx]?.closable === false) return prev;
      const next = prev.filter((t) => t.id !== id);
      setActiveId((curr) => {
        if (curr !== id) return curr;
        const neighbor = prev[idx + 1] ?? prev[idx - 1] ?? HOME_TAB;
        return neighbor.id;
      });
      return next;
    });
  }, []);

  const removeTab = useCallback((id: string) => {
    if (id === "home") return;
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.id === id);
      if (idx < 0) return prev;
      const next = prev.filter((t) => t.id !== id);
      setActiveId((curr) => {
        if (curr !== id) return curr;
        const neighbor = next[idx] ?? next[idx - 1] ?? HOME_TAB;
        return neighbor.id;
      });
      return next;
    });
  }, []);

  const setActive = useCallback((id: string) => setActiveId(id), []);

  const moveTab = useCallback((fromId: string, toId: string) => {
    if (fromId === toId) return;
    setTabs((prev) => {
      const from = prev.findIndex((t) => t.id === fromId);
      const to = prev.findIndex((t) => t.id === toId);
      if (from < 0 || to < 0) return prev;
      const next = prev.slice();
      const [moved] = next.splice(from, 1);
      if (!moved) return prev;
      // After removing `from`, the original `to` index shifts left by one
      // if it was after `from`. Insert before the (now-adjusted) target.
      const insertAt = from < to ? to - 1 : to;
      next.splice(insertAt, 0, moved);
      return next;
    });
  }, []);

  const reorderVisible = useCallback((orderedVisibleIds: string[]) => {
    setTabs((prev) => {
      const byId = new Map(prev.map((t) => [t.id, t]));
      let cursor = 0;
      // Walk the original list. Hidden tabs stay put; each visible slot is
      // refilled in turn from the new id order. Unknown ids are skipped, and
      // any leftover visible slots fall back to the original tab so we never
      // drop one on the floor.
      return prev.map((t) => {
        if (t.hidden) return t;
        while (
          cursor < orderedVisibleIds.length &&
          !byId.has(orderedVisibleIds[cursor]!)
        ) {
          cursor++;
        }
        const nextId = orderedVisibleIds[cursor++];
        return nextId ? byId.get(nextId) ?? t : t;
      });
    });
  }, []);

  const setHidden = useCallback((id: string, hidden: boolean) => {
    setTabs((prev) =>
      prev.map((t) => (t.id === id && !!t.hidden !== hidden ? { ...t, hidden } : t)),
    );
  }, []);

  const value = useMemo(
    () => ({
      tabs,
      activeId,
      openTab,
      closeTab,
      removeTab,
      setActive,
      setHidden,
      moveTab,
      reorderVisible,
    }),
    [
      tabs,
      activeId,
      openTab,
      closeTab,
      removeTab,
      setActive,
      setHidden,
      moveTab,
      reorderVisible,
    ],
  );

  return <TabsContext.Provider value={value}>{children}</TabsContext.Provider>;
}

export function useTabs(): TabsContextValue {
  const ctx = useContext(TabsContext);
  if (!ctx) throw new Error("useTabs must be used inside <TabsProvider>");
  return ctx;
}
