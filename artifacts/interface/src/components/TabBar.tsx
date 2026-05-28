import { useMemo } from "react";
import { Reorder, motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import { useTabs, type Tab } from "./TabsContext";
import { useClickSound } from "@/hooks/useClickSound";
import { cn } from "@/lib/utils";

export function TabBar() {
  const { tabs, activeId, setActive, closeTab, reorderVisible } = useTabs();
  const click = useClickSound();

  const visible = useMemo(() => tabs.filter((t) => !t.hidden), [tabs]);

  const onReorder = (next: Tab[]) => {
    // Only emit if the order actually changed — Framer fires onReorder on
    // every pointer move during a drag and we don't want a click on every tick.
    const before = visible.map((t) => t.id).join("|");
    const after = next.map((t) => t.id).join("|");
    if (before === after) return;
    reorderVisible(next.map((t) => t.id));
    click("drop");
  };

  return (
    <div className="w-full flex flex-nowrap items-end gap-1 px-2 pt-1 border-b border-border bg-muted/40 shrink-0 overflow-x-auto md:h-9 md:pt-0">
      <Reorder.Group
        as="div"
        axis="x"
        values={visible}
        onReorder={onReorder}
        className="flex flex-nowrap items-end gap-1 overflow-x-auto flex-1 min-w-0"
      >
        <AnimatePresence initial={false}>
          {visible.map((t) => {
            const active = t.id === activeId;
            const showClose = t.id !== "home" && t.closable !== false;
            return (
              <Reorder.Item
                key={t.id}
                value={t}
                as="div"
                layout
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 6, scale: 0.9 }}
                whileDrag={{
                  scale: 1.04,
                  rotate: -1.5,
                  zIndex: 50,
                  boxShadow: "0 8px 24px -8px rgba(0,0,0,0.25)",
                }}
                whileHover={{ y: -1 }}
                whileTap={{ scale: 0.96 }}
                transition={{
                  type: "spring",
                  stiffness: 520,
                  damping: 32,
                  mass: 0.6,
                }}
                onPointerDown={() => {
                  if (!active) {
                    setActive(t.id);
                    click("tap");
                  }
                }}
                className={cn(
                  "group relative h-7 flex items-center gap-2 px-3 rounded-t-md border border-b-0 text-xs font-sans shrink-0 max-w-[140px] sm:max-w-[180px] cursor-grab active:cursor-grabbing select-none",
                  active
                    ? "bg-background border-border text-foreground"
                    : "bg-transparent border-transparent text-muted-foreground hover:bg-background/60 hover:text-foreground",
                )}
              >
                <span className="truncate relative z-10">{t.title}</span>
                {showClose && (
                  <motion.span
                    role="button"
                    aria-label={`close ${t.title}`}
                    whileHover={{ scale: 1.2, rotate: 90 }}
                    whileTap={{ scale: 0.85 }}
                    transition={{ type: "spring", stiffness: 500, damping: 22 }}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      click("tap");
                      closeTab(t.id);
                    }}
                    className="p-0.5 rounded hover:bg-foreground/10 text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-3 w-3" />
                  </motion.span>
                )}
              </Reorder.Item>
            );
          })}
        </AnimatePresence>
      </Reorder.Group>
    </div>
  );
}
