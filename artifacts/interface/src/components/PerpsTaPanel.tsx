import { useEffect, useRef, useState } from "react";
import { Loader2, X, Copy, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n";
import { Markdown } from "./report/Markdown";

type StreamEvent =
  | { type: "thinking" }
  | { type: "model"; model: string }
  | { type: "content"; delta: string }
  | { type: "done"; response?: string }
  | { type: "error"; message: string };

// Streamed AI technical-analysis report for one perps pair. Auto-generates on
// open and renders as an inline column card (header + scrollable streaming
// body + footer).
export function PerpsTaPanel({
  pair,
  lang,
  onClose,
}: {
  pair: string;
  lang: string;
  onClose?: () => void;
}) {
  const t = useT();
  const [text, setText] = useState("");
  const [status, setStatus] = useState<"loading" | "done" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [copied, setCopied] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const abort = new AbortController();
    let sawDone = false;
    let sawError = false;
    setText("");
    setErrorMsg("");
    setStatus("loading");

    const processChunk = (chunk: string) => {
      for (const line of chunk.split("\n")) {
        const trimmed = line.trimStart();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (!payload) continue;
        let ev: StreamEvent;
        try {
          ev = JSON.parse(payload) as StreamEvent;
        } catch {
          continue;
        }
        if (ev.type === "content") {
          setText((s) => s + ev.delta);
        } else if (ev.type === "done") {
          if (ev.response) setText(ev.response);
          sawDone = true;
          setStatus("done");
        } else if (ev.type === "error") {
          sawError = true;
          setErrorMsg(ev.message);
          setStatus("error");
        }
      }
    };

    (async () => {
      try {
        const resp = await fetch("/api/perps/ta/stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pair, lang }),
          signal: abort.signal,
        });
        if (resp.status === 429) {
          setErrorMsg(t("perps.taRateLimit"));
          setStatus("error");
          return;
        }
        if (!resp.ok || !resp.body) {
          throw new Error(`HTTP ${resp.status}`);
        }
        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            buf += decoder.decode();
            if (buf.trim()) processChunk(buf);
            break;
          }
          buf += decoder.decode(value, { stream: true });
          let idx: number;
          while ((idx = buf.indexOf("\n\n")) !== -1) {
            processChunk(buf.slice(0, idx));
            buf = buf.slice(idx + 2);
          }
        }
        if (sawDone) {
          setStatus("done");
        } else if (!sawError) {
          setErrorMsg(t("perps.taEndedEarly"));
          setStatus("error");
        }
      } catch (err) {
        if (abort.signal.aborted) return;
        setErrorMsg(err instanceof Error ? err.message : String(err));
        setStatus("error");
      }
    })();

    return () => abort.abort();
  }, [pair, lang, t]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [text]);

  const handleCopy = async () => {
    if (!text.trim()) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="flex max-h-[640px] min-h-[360px] flex-col overflow-hidden rounded border border-border bg-card lg:order-3 lg:col-span-3">
          {/* header */}
          <div className="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-border px-3">
            <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground truncate">
              {`${t("perps.taReport")} · ${pair}`}
            </span>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={handleCopy}
                disabled={status !== "done" || text.trim() === ""}
                className="inline-flex items-center gap-1.5 rounded border border-border px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground hover:bg-foreground/5 disabled:opacity-40 disabled:hover:bg-transparent"
              >
                {copied ? (
                  <Check className="h-3 w-3" />
                ) : (
                  <Copy className="h-3 w-3" />
                )}
                {copied ? t("perps.taCopied") : t("perps.taCopy")}
              </button>
              {onClose && (
                <button
                  type="button"
                  onClick={onClose}
                  aria-label={t("perps.taClose")}
                  className="rounded p-1 text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>

          {/* body */}
          <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto p-3">
            {status === "error" ? (
              <p className="font-mono text-xs text-destructive">
                {errorMsg || t("perps.taError")}
              </p>
            ) : text.trim() === "" ? (
              <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {t("perps.taGenerating")}
              </div>
            ) : (
              <>
                <Markdown source={text} />
                {status === "loading" && (
                  <div className="mt-3 flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    {t("perps.taWriting")}
                  </div>
                )}
              </>
            )}
          </div>

          {/* footer */}
          <div className="border-t border-border px-3 py-2 shrink-0">
            <span className="font-mono text-[10px] text-muted-foreground">
              {t("perps.taDisclaimer")}
            </span>
          </div>
    </div>
  );
}
