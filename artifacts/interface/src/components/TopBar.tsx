import { useEffect } from "react";
import {
  useHealthCheck,
  getGetBaseMcpStatusQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { cn } from "@/lib/utils";
import logo from "@assets/logo.png";
import { useAuth } from "@/hooks/useAuth";

export function TopBar() {
  const queryClient = useQueryClient();
  const auth = useAuth();
  const { data: healthData, isError: isHealthError } = useHealthCheck({
    query: { queryKey: ["/api/healthz"], refetchInterval: 5000 },
  });

  useEffect(() => {
    const onMessage = (ev: MessageEvent) => {
      if (ev.data?.type === "base-mcp-auth") {
        // Anon → real user upgrade also lands here: refresh both auth and
        // mcp status so the UI flips from "connect" to "signed in".
        void auth.refresh();
        queryClient.invalidateQueries({ queryKey: getGetBaseMcpStatusQueryKey() });
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [queryClient, auth]);

  const isConnected = healthData?.status === "ok" && !isHealthError;

  return (
    <div className="h-14 sm:h-16 w-full flex items-center justify-between px-3 sm:px-4 border-b border-border bg-background shrink-0">
      <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity" aria-label="BunnyOS home">
        <img src={logo} alt="logo" className="h-9 sm:h-12 w-auto" />
      </Link>

      <div className="flex items-center gap-2">
        {auth.authenticated && auth.walletAddress && (
          <button
            onClick={() => void auth.logout()}
            className="px-2 py-1 sm:px-3 sm:py-2 bg-foreground/10 text-foreground hover:bg-foreground/20 rounded font-sans text-xs font-medium transition-colors inline-flex items-center justify-center gap-1.5"
          >
            sign out
          </button>
        )}
        <div
          className={cn(
            "w-2 h-2 rounded-full ml-2",
            isConnected ? "bg-green" : "bg-red"
          )}
          title={isConnected ? "Connected" : "Disconnected"}
        />
      </div>
    </div>
  );
}
