import { useState, useRef, useEffect, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAppStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { playSound } from "@/lib/sound";
import {
  ArrowUp,
  ChevronRight,
  Loader2,
  Plus,
  History,
  Trash2,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";

type ChatSummary = { id: string; title: string; updatedAt: string };
type StoredSession = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: Array<{
    id: string;
    role: "user" | "bunny";
    text: string;
    timestamp: string;
    tools?: ToolEvent[];
  }>;
};

type ToolEvent = {
  id: string;
  name: string;
  args: unknown;
  result?: string;
  isError?: boolean;
  done: boolean;
};

interface ChatMessage {
  id: string;
  role: "user" | "bunny";
  text: string;
  timestamp: string;
  tools?: ToolEvent[];
  thinking?: boolean;
  streaming?: boolean;
}

type StreamEvent =
  | { type: "model"; model: string }
  | { type: "thinking" }
  | { type: "tool_call"; id: string; name: string; args: unknown }
  | { type: "tool_result"; id: string; name: string; content: string; isError?: boolean }
  | { type: "content"; delta: string }
  | { type: "done"; model: string; response: string }
  | { type: "error"; message: string };

// Match any URL on a Base/Coinbase approval host. Server-side, the agent
// extracts these from tool results and appends them to the final reply if
// missing, so as long as the host is in this set we'll render a button.
const APPROVAL_URL_RE =
  /(https:\/\/(?:account\.base\.app|base\.org|www\.base\.org|wallet\.base\.org|account\.base\.org|keys\.coinbase\.com|wallet\.coinbase\.com)\/[^\s)\]"']+)/g;

function approvalLabel(url: string): string {
  if (url.includes("base.app") || url.includes("base.org"))
    return "approve transaction in base app →";
  return "open base app to approve →";
}

// Open the wallet approval URL as a centered popup window instead of a new
// browser tab. Falls back to a normal window.open if the browser blocks the
// popup (some engines ignore size hints and just open a tab — that's fine).
function openApprovalPopup(url: string): void {
  const width = 480;
  const height = 720;
  const screenLeft = window.screenLeft ?? window.screenX ?? 0;
  const screenTop = window.screenTop ?? window.screenY ?? 0;
  const viewportW =
    window.innerWidth ?? document.documentElement.clientWidth ?? width;
  const viewportH =
    window.innerHeight ?? document.documentElement.clientHeight ?? height;
  const left = Math.max(0, screenLeft + (viewportW - width) / 2);
  const top = Math.max(0, screenTop + (viewportH - height) / 2);
  const features = [
    "popup=yes",
    `width=${width}`,
    `height=${height}`,
    `left=${Math.round(left)}`,
    `top=${Math.round(top)}`,
    "resizable=yes",
    "scrollbars=yes",
    "noopener",
    "noreferrer",
  ].join(",");
  const win = window.open(url, "bunny-approval", features);
  if (!win) {
    // Popup blocked — fall back to a normal tab so the user can still approve.
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

// Wallet approval URLs use a few different path formats depending on the
// host (account.base.app uses /wallet-requests/, wallet.base.org uses
// /requests/, some Coinbase wallet flows use /calls/ or /approve/). We need
// the ID to poll status — without it the auto-poll + "check now" controls
// get suppressed and the user just sees a bare approve button.
function extractRequestId(url: string): string | null {
  const m = url.match(/\/(?:wallet-requests|wallet-request|requests|request|calls|approve)\/([a-zA-Z0-9_-]+)/);
  return m?.[1] ?? null;
}

type ApprovalState = "pending" | "confirmed" | "failed";

function classifyStatus(content: string): ApprovalState {
  const lower = content.toLowerCase();
  // Failure FIRST — "rejected" / "failed" can co-occur with words like
  // "completed" in a status envelope, and we never want to mis-mark a
  // rejection as confirmed.
  if (
    /"status"\s*:\s*"(?:failed|reverted|rejected|cancell?ed|expired|denied)"/i.test(
      content,
    ) ||
    /\b(?:reverted|rejected|cancelled|canceled|expired|denied|user[_ ]rejected)\b/i.test(
      lower,
    )
  ) {
    return "failed";
  }
  // Confirmed — explicit status tags, or evidence the chain accepted the tx
  // (a 0x… 64-hex transaction hash field, or wording the wallet uses once
  // the user has approved and the bundler/relayer has submitted it).
  if (
    /"status"\s*:\s*"(?:confirmed|success|completed|complete|submitted|broadcast|broadcasted|approved|done|executed|mined|included)"/i.test(
      content,
    ) ||
    /"(?:transactionhash|txhash|tx_hash|transaction_hash|hash|userophash|userop_hash)"\s*:\s*"0x[0-9a-f]{16,}"/i.test(
      content,
    ) ||
    /\b(?:transaction\s+(?:confirmed|submitted|broadcast|broadcasted|sent|executed|mined|included)|approved\s+by\s+user|user\s+approved|successfully\s+(?:submitted|broadcast|sent|executed))\b/i.test(
      lower,
    )
  ) {
    return "confirmed";
  }
  return "pending";
}

// Best-effort tx-hash extraction from a get_request_status payload. The
// MCP returns a JSON blob whose exact shape varies, but a successful
// receipt always carries a 0x… hex hash under one of these field names.
function extractTxHash(content: string): string | null {
  const m = content.match(
    /"(?:transactionHash|txHash|tx_hash|transaction_hash|userOpHash|userop_hash|hash)"\s*:\s*"(0x[0-9a-fA-F]{16,})"/,
  );
  return m?.[1] ?? null;
}

type DoneState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "confirmed"; txHash: string | null }
  | { kind: "pending" }
  | { kind: "failed"; reason: string }
  | { kind: "unknown" }; // marked done but the MCP wouldn't tell us

function ApprovalLink({ url }: { url: string }) {
  // We don't auto-poll (the MCP `get_request_status` is inconsistent across
  // wallets) — instead the user clicks "done" themselves, and on that click
  // we fire one status check and surface a congrats / failure / unknown
  // message based on what the MCP returns.
  const requestId = extractRequestId(url);
  const [state, setState] = useState<DoneState>({ kind: "idle" });

  const markDone = async () => {
    if (!requestId) {
      setState({ kind: "unknown" });
      return;
    }
    setState({ kind: "checking" });
    try {
      const r = await fetch("/api/base-mcp/call", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "get_request_status",
          args: { requestId },
        }),
      });
      if (!r.ok) {
        setState({ kind: "unknown" });
        return;
      }
      const j = (await r.json()) as { content?: string; isError?: boolean };
      const raw = j.content ?? "";
      console.log("[approval status] mark done →", raw);
      const cls = classifyStatus(raw);
      if (cls === "confirmed") {
        setState({ kind: "confirmed", txHash: extractTxHash(raw) });
      } else if (cls === "failed") {
        // Try to surface a short reason from the payload.
        const m = raw.match(/"(?:error|message|reason)"\s*:\s*"([^"]{1,160})"/i);
        setState({ kind: "failed", reason: m?.[1] ?? "transaction failed" });
      } else {
        setState({ kind: "pending" });
      }
    } catch {
      setState({ kind: "unknown" });
    }
  };

  const interacted = state.kind !== "idle";

  return (
    <div className="block mt-2 mb-2 space-y-1">
      <button
        type="button"
        onClick={() => openApprovalPopup(url)}
        disabled={interacted}
        className="block w-full px-3 py-2 bg-accent text-accent-foreground rounded-md text-xs font-sans font-medium hover:bg-accent/90 transition-colors text-center disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {approvalLabel(url)}
      </button>
      <div className="flex items-center justify-center gap-2 font-mono text-[10px] uppercase tracking-widest text-center">
        {state.kind === "idle" && (
          <button
            type="button"
            onClick={markDone}
            className="px-2 py-0.5 rounded border border-border text-muted-foreground hover:text-foreground hover:border-foreground/40"
          >
            click here once done →
          </button>
        )}
        {state.kind === "checking" && (
          <>
            <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
            <span className="text-muted-foreground">checking on-chain…</span>
          </>
        )}
        {state.kind === "confirmed" && (
          <div className="flex flex-col items-center gap-0.5">
            <div className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-green" />
              <span className="text-green">congrats — transaction confirmed</span>
            </div>
            {state.txHash && (
              <a
                href={`https://basescan.org/tx/${state.txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted-foreground hover:text-foreground underline-offset-2 hover:underline normal-case tracking-normal"
              >
                view on basescan ↗
              </a>
            )}
          </div>
        )}
        {state.kind === "pending" && (
          <div className="flex flex-col items-center gap-0.5">
            <div className="flex items-center gap-1.5">
              <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
              <span className="text-muted-foreground">
                still pending — check your wallet
              </span>
            </div>
            <button
              type="button"
              onClick={markDone}
              className="px-2 py-0.5 rounded border border-border text-muted-foreground hover:text-foreground hover:border-foreground/40 normal-case tracking-normal"
            >
              check again
            </button>
          </div>
        )}
        {state.kind === "failed" && (
          <div className="flex flex-col items-center gap-0.5">
            <div className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-destructive" />
              <span className="text-destructive">
                {state.reason || "transaction failed"}
              </span>
            </div>
          </div>
        )}
        {state.kind === "unknown" && (
          <div className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-green" />
            <span className="text-green">marked done</span>
          </div>
        )}
      </div>
    </div>
  );
}

function parseMessageText(text: string) {
  const parts = text.split(APPROVAL_URL_RE);
  return parts.map((part, i) => {
    if (APPROVAL_URL_RE.test(part)) {
      // .test() consumed the lastIndex on the global regex; reset for next part
      APPROVAL_URL_RE.lastIndex = 0;
      const clean = part.replace(/[.,;:]+$/, "");
      return <ApprovalLink key={i} url={clean} />;
    }
    APPROVAL_URL_RE.lastIndex = 0;
    return <span key={i}>{part}</span>;
  });
}

function summarizeArgs(args: unknown): string {
  if (!args || typeof args !== "object") return "";
  try {
    const s = JSON.stringify(args);
    return s.length > 80 ? s.slice(0, 77) + "…" : s;
  } catch {
    return "";
  }
}

function ToolCallChip({ tool }: { tool: ToolEvent }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="my-1 rounded border border-border bg-foreground/5 overflow-hidden">
      <button
        onClick={() => tool.done && setOpen((v) => !v)}
        disabled={!tool.done}
        className="w-full flex items-center gap-1.5 px-2 py-1 text-left hover:bg-foreground/5 disabled:cursor-default"
      >
        {tool.done ? (
          <ChevronRight
            className={cn("h-3 w-3 text-muted-foreground transition-transform", open && "rotate-90")}
          />
        ) : (
          <Loader2 className="h-3 w-3 text-muted-foreground animate-spin" />
        )}
        <span
          className={cn(
            "font-mono text-[11px]",
            tool.isError ? "text-destructive" : "text-foreground",
          )}
        >
          {tool.name}
        </span>
        <span className="font-mono text-[10px] text-muted-foreground truncate flex-1">
          {summarizeArgs(tool.args)}
        </span>
        {tool.done && (
          <span className="font-mono text-[10px] text-muted-foreground">
            {tool.isError ? "err" : "ok"}
          </span>
        )}
      </button>
      {open && tool.done && (
        <div className="px-2 pb-2 space-y-1">
          {tool.args !== undefined && (
            <pre className="font-mono text-[10px] text-muted-foreground bg-background/50 rounded p-1.5 overflow-x-auto whitespace-pre-wrap break-all">
              {JSON.stringify(tool.args, null, 2)}
            </pre>
          )}
          {tool.result && (
            <pre className="font-mono text-[10px] text-foreground/80 bg-background/50 rounded p-1.5 overflow-x-auto whitespace-pre-wrap break-all max-h-48 overflow-y-auto">
              {tool.result}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

// Persistent status line under every bunny message so the user always sees
// whether the agent is still working or has stopped — instead of having to
// infer it from the disabled input box or a transient cursor blink.
function BunnyStatusLine({ message }: { message: ChatMessage }) {
  const activeTool = (message.tools ?? []).find((t) => !t.done);
  if (message.streaming) {
    let label: string;
    if (activeTool) label = `running ${activeTool.name}…`;
    else if (message.thinking || !message.text) label = "thinking…";
    else label = "responding…";
    return (
      <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground flex items-center gap-1.5 pt-1">
        <Loader2 className="h-3 w-3 animate-spin" />
        <span>{label}</span>
      </div>
    );
  }
  const text = message.text ?? "";
  const errored =
    text.startsWith("error:") ||
    text.includes("(stream ended unexpectedly)") ||
    text.includes("(bunnyOS is quiet");
  if (errored) {
    return (
      <div className="font-mono text-[10px] uppercase tracking-widest text-destructive flex items-center gap-1.5 pt-1">
        <span className="h-1.5 w-1.5 rounded-full bg-destructive" />
        <span>stopped</span>
      </div>
    );
  }
  if (!text && (message.tools ?? []).length === 0) {
    // Empty bunny message with no tools and not streaming — odd, but mark it
    // so the user knows it's not still spinning.
    return (
      <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground flex items-center gap-1.5 pt-1">
        <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground" />
        <span>stopped</span>
      </div>
    );
  }
  return (
    <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground flex items-center gap-1.5 pt-1">
      <span className="h-1.5 w-1.5 rounded-full bg-green" />
      <span>done</span>
    </div>
  );
}

export function ChatPanel() {
  const queryClient = useQueryClient();
  const chatInput = useAppStore((state) => state.chatInput);
  const setChatInput = useAppStore((state) => state.setChatInput);
  const addFeedEntry = useAppStore((state) => state.addFeedEntry);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [lastStatus, setLastStatus] = useState<"done" | "error" | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  sessionIdRef.current = sessionId;
  const lastUserTextRef = useRef<string>("");

  const { data: chatList } = useQuery({
    queryKey: ["/api/chats"],
    queryFn: async () => {
      const r = await fetch("/api/chats");
      if (!r.ok) return [] as ChatSummary[];
      const j = (await r.json()) as unknown;
      return Array.isArray(j) ? (j as ChatSummary[]) : ([] as ChatSummary[]);
    },
    refetchInterval: 30_000,
  });

  const saveCurrentSession = useCallback(
    async (msgs: ChatMessage[], explicitId?: string) => {
      const id = explicitId ?? sessionIdRef.current;
      if (!id || msgs.length === 0) return;
      const payload = {
        messages: msgs.map((m) => ({
          id: m.id,
          role: m.role,
          text: m.text,
          timestamp: m.timestamp,
          ...(m.tools ? { tools: m.tools } : {}),
        })),
      };
      try {
        const r = await fetch(`/api/chats/${encodeURIComponent(id)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!r.ok) throw new Error(`save ${id} failed: HTTP ${r.status}`);
        queryClient.invalidateQueries({ queryKey: ["/api/chats"] });
      } catch (err) {
        console.warn("[chat] persist failed", err);
      }
    },
    [queryClient],
  );

  const ensureSessionId = useCallback(async (): Promise<string> => {
    if (sessionIdRef.current) return sessionIdRef.current;
    const r = await fetch("/api/chats", { method: "POST" });
    const created = (await r.json()) as StoredSession;
    sessionIdRef.current = created.id;
    setSessionId(created.id);
    queryClient.invalidateQueries({ queryKey: ["/api/chats"] });
    return created.id;
  }, [queryClient]);

  const startNewChat = () => {
    if (isStreaming) abortRef.current?.abort();
    sessionIdRef.current = null;
    setSessionId(null);
    setMessages([]);
  };

  const loadChat = async (id: string) => {
    if (isStreaming) abortRef.current?.abort();
    try {
      const r = await fetch(`/api/chats/${encodeURIComponent(id)}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const s = (await r.json()) as StoredSession;
      sessionIdRef.current = s.id;
      setSessionId(s.id);
      setMessages(
        s.messages.map((m) => ({
          id: m.id,
          role: m.role,
          text: m.text,
          timestamp: m.timestamp,
          ...(m.tools ? { tools: m.tools as ToolEvent[] } : {}),
        })),
      );
    } catch {
      /* ignore */
    }
  };

  const deleteChat = async (id: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await fetch(`/api/chats/${encodeURIComponent(id)}`, { method: "DELETE" });
      queryClient.invalidateQueries({ queryKey: ["/api/chats"] });
      if (sessionIdRef.current === id) startNewChat();
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isStreaming]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const updateBunny = (id: string, updater: (m: ChatMessage) => ChatMessage) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? updater(m) : m)));
  };

  const handleSubmit = async (overrideText?: string) => {
    if (isStreaming) return;
    const sourceText = overrideText ?? chatInput;
    if (!sourceText.trim()) return;

    playSound("confirm");
    const userText = sourceText.trim();
    lastUserTextRef.current = userText;
    const ts = new Date().toTimeString().split(" ")[0] ?? "";
    const userMessage: ChatMessage = {
      id: Math.random().toString(36).substring(7),
      role: "user",
      text: userText,
      timestamp: ts,
    };
    const bunnyId = Math.random().toString(36).substring(7);
    const bunnyMessage: ChatMessage = {
      id: bunnyId,
      role: "bunny",
      text: "",
      timestamp: new Date().toTimeString().split(" ")[0] ?? "",
      tools: [],
      thinking: true,
      streaming: true,
    };

    const priorMessages = messages.slice();
    setMessages((prev) => [...prev, userMessage, bunnyMessage]);
    setChatInput("");
    setIsStreaming(true);
    setLastStatus(null);

    let activeSessionId = "";
    try {
      activeSessionId = await ensureSessionId();
    } catch {
      activeSessionId = sessionIdRef.current ?? "";
    }

    // Local mirror of the bunny message — survives abort / session switch and
    // is the source of truth for the single final save.
    let localBunny: ChatMessage = { ...bunnyMessage };
    const mutateBunny = (updater: (m: ChatMessage) => ChatMessage) => {
      localBunny = updater(localBunny);
      updateBunny(bunnyId, updater);
    };

    const abort = new AbortController();
    abortRef.current = abort;
    let sawDone = false;
    let sawError = false;
    let finalResponse = "";

    const processChunk = (chunk: string) => {
      const dataLine = chunk.split("\n").find((l) => l.startsWith("data:"));
      if (!dataLine) return;
      const data = dataLine.slice(5).trim();
      if (!data) return;
      let ev: StreamEvent;
      try {
        ev = JSON.parse(data) as StreamEvent;
      } catch {
        return;
      }
      if (ev.type === "thinking") {
        mutateBunny((m) => ({ ...m, thinking: true }));
      } else if (ev.type === "tool_call") {
        mutateBunny((m) => ({
          ...m,
          thinking: false,
          tools: [
            ...(m.tools ?? []),
            { id: ev.id, name: ev.name, args: ev.args, done: false },
          ],
        }));
      } else if (ev.type === "tool_result") {
        mutateBunny((m) => ({
          ...m,
          tools: (m.tools ?? []).map((t) =>
            t.id === ev.id
              ? { ...t, result: ev.content, isError: ev.isError, done: true }
              : t,
          ),
        }));
      } else if (ev.type === "content") {
        mutateBunny((m) => ({
          ...m,
          thinking: false,
          text: m.text + ev.delta,
        }));
      } else if (ev.type === "done") {
        sawDone = true;
        finalResponse = ev.response;
        mutateBunny((m) => ({
          ...m,
          text: ev.response || m.text,
          thinking: false,
          streaming: false,
        }));
      } else if (ev.type === "error") {
        sawError = true;
        mutateBunny((m) => ({
          ...m,
          text: `error: ${ev.message}`,
          thinking: false,
          streaming: false,
        }));
      }
    };

    try {
      const history = messages
        .filter((m) => m.text && m.text.trim() && !m.text.startsWith("error:"))
        .slice(-20)
        .map((m) => ({
          role: m.role === "user" ? ("user" as const) : ("assistant" as const),
          content: m.text,
        }));
      const resp = await fetch("/api/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userText, history }),
        signal: abort.signal,
      });
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
          const chunk = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          processChunk(chunk);
        }
      }

      if (sawError) {
        setLastStatus("error");
        addFeedEntry({ message: "Failed to respond", status: "error" });
      } else if (sawDone) {
        setLastStatus("done");
        let status: "success" | "pending" | "error" = "success";
        const hasApproval = APPROVAL_URL_RE.test(finalResponse);
        APPROVAL_URL_RE.lastIndex = 0;
        if (hasApproval) status = "pending";
        else if (/error|failed/i.test(finalResponse)) status = "error";
        addFeedEntry({ message: "Responded to user", status });
      } else {
        setLastStatus("error");
        mutateBunny((m) => ({
          ...m,
          text: m.text || "(stream ended unexpectedly)",
          thinking: false,
          streaming: false,
        }));
        addFeedEntry({ message: "Stream interrupted", status: "error" });
      }

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setLastStatus("error");
      mutateBunny((m) => ({
        ...m,
        text: m.text || `error: ${msg}`,
        thinking: false,
        streaming: false,
      }));
      if (!sawError) addFeedEntry({ message: "Failed to respond", status: "error" });
    } finally {
      // Single, terminal save using a snapshot we own — immune to user
      // switching/clearing chats mid-stream, and only fires once per turn so
      // no out-of-order overwrites are possible. We save on errors too so the
      // failed turn (tool chips + partial text) stays in chat history.
      if (activeSessionId) {
        const finalMessages: ChatMessage[] = [
          ...priorMessages,
          userMessage,
          { ...localBunny, streaming: false, thinking: false },
        ];
        void saveCurrentSession(finalMessages, activeSessionId);
      }
      setIsStreaming(false);
      abortRef.current = null;
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="h-full flex flex-col bg-background">
      <div className="px-4 py-3 border-b border-border/50 shrink-0 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="font-sans text-xs font-medium text-muted-foreground uppercase tracking-widest">
            chat
          </h2>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={startNewChat}
            className="h-7 px-2 font-mono text-[11px] text-muted-foreground hover:text-foreground"
          >
            <Plus className="h-3 w-3 mr-1" />
            new chat
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 font-mono text-[11px] text-muted-foreground hover:text-foreground"
              >
                <History className="h-3 w-3 mr-1" />
                history
                {chatList && chatList.length > 0 && (
                  <span className="ml-1 text-muted-foreground/60">
                    ({chatList.length})
                  </span>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72 max-h-96 overflow-y-auto">
              <DropdownMenuLabel className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                saved chats
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {(!chatList || chatList.length === 0) && (
                <div className="px-2 py-3 font-mono text-[11px] text-muted-foreground text-center">
                  no saved chats yet
                </div>
              )}
              {chatList?.map((c) => (
                <DropdownMenuItem
                  key={c.id}
                  onSelect={() => void loadChat(c.id)}
                  className={cn(
                    "font-mono text-[11px] flex items-start gap-2 group cursor-pointer",
                    c.id === sessionId && "bg-accent/30",
                  )}
                >
                  <div className="flex-1 min-w-0">
                    <div className="truncate text-foreground">{c.title}</div>
                    <div className="text-[10px] text-muted-foreground">
                      {new Date(c.updatedAt).toLocaleString()}
                    </div>
                  </div>
                  <button
                    onClick={(e) => void deleteChat(c.id, e)}
                    className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive p-1 -m-1"
                    aria-label="delete chat"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-6">
        {messages.length === 0 && (
          <div className="h-full flex items-center justify-center px-6">
            <p className="font-mono text-xs text-muted-foreground text-center max-w-sm leading-relaxed">
              bunnyOS can interface directly with protocols and services you enable.
            </p>
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className="flex flex-col">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-mono text-xs text-muted-foreground">
                {m.timestamp}
              </span>
            </div>
            {m.role === "user" ? (
              <div className="font-mono text-sm leading-relaxed whitespace-pre-wrap text-foreground">
                {`> ${m.text}`}
              </div>
            ) : (
              <div className="space-y-1">
                {(m.tools ?? []).map((t) => (
                  <ToolCallChip key={t.id} tool={t} />
                ))}
                {m.text && (
                  <div className="font-mono text-sm leading-relaxed whitespace-pre-wrap text-green">
                    {parseMessageText(m.text)}
                    {m.streaming && (
                      <span className="animate-pulse text-green">▋</span>
                    )}
                  </div>
                )}
                <BunnyStatusLine message={m} />
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="p-4 border-t border-border shrink-0 bg-background">
        <div className="flex items-end gap-2 border border-border rounded-lg p-2 focus-within:border-accent transition-colors">
          <textarea
            id="chat-input"
            ref={inputRef}
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isStreaming}
            placeholder="type your instructions here"
            className="flex-1 min-w-0 h-9 max-h-[140px] bg-transparent px-1 py-2 font-mono text-sm leading-5 resize-none focus:outline-none disabled:opacity-50"
            rows={1}
          />
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={!chatInput.trim() || isStreaming}
            aria-label="send"
            className={cn(
              "shrink-0 h-9 w-9 rounded-md p-0 grid place-items-center",
              "bg-accent text-accent-foreground shadow-sm",
              "transition-all duration-150",
              "hover:scale-105 hover:shadow active:scale-95",
              "disabled:bg-foreground/10 disabled:text-muted-foreground/60",
              "disabled:hover:scale-100 disabled:shadow-none disabled:cursor-not-allowed",
            )}
          >
            {isStreaming ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ArrowUp className="h-4 w-4" strokeWidth={2.5} />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
