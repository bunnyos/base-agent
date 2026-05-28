import { useAppStore } from "@/lib/store";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

export function FeedPanel() {
  const feed = useAppStore((state) => state.feed);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [feed]);

  return (
    <div className="h-full flex flex-col border-r border-border">
      <div className="p-4 border-b border-border/50 shrink-0">
        <h2 className="font-sans text-xs font-medium text-muted-foreground uppercase tracking-widest">
          feed
        </h2>
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-2">
        {feed.map((entry) => (
          <div key={entry.id} className="font-mono text-xs text-text-dim flex items-start gap-2">
            <span className="shrink-0">[{entry.time}]</span>
            <span
              className={cn(
                "shrink-0",
                entry.status === "success" && "text-green",
                entry.status === "pending" && "text-yellow",
                entry.status === "error" && "text-red",
                entry.status === "info" && "text-muted-foreground"
              )}
            >
              ●
            </span>
            <span className="text-foreground break-words">{entry.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
