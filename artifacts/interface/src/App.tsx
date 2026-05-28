import { useEffect, useRef, useState } from "react";
import { Route, Switch as RouterSwitch, Redirect } from "wouter";
import { useGetApiKeyStatus } from "@workspace/api-client-react";
import { TopBar } from "./components/TopBar";
import { WalletPortfolioPanel } from "./components/WalletPortfolioPanel";
import { ActionsPanel } from "./components/ActionsPanel";
import { ChatPanel } from "./components/ChatPanel";
import { TabBar } from "./components/TabBar";
import { Footer } from "./components/Footer";
import { TabsProvider, useTabs } from "./components/TabsContext";
import { ProtocolTabView } from "./components/ProtocolTabView";
import { ConfigureView } from "./components/ConfigureView";
import { ActionsBuilderView } from "./components/ActionsBuilderView";
import { ActionsHistoryView } from "./components/ActionsHistoryView";
import Landing from "./pages/Landing";
import { useAuth } from "./hooks/useAuth";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";

const queryClient = new QueryClient();

// Tailwind `md` breakpoint = 768px. Kept in sync with the responsive classes
// in HomeView so tab seeding and layout agree on what counts as "mobile".
const MOBILE_MQ = "(max-width: 767px)";

function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState<boolean>(() =>
    typeof window !== "undefined" ? window.matchMedia(MOBILE_MQ).matches : false,
  );
  useEffect(() => {
    const mq = window.matchMedia(MOBILE_MQ);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  return isMobile;
}

// On mobile, the three home-screen panels are split into three sibling tabs
// (wallet, actions, chat) — each its own full-page view, none closable. The
// legacy `home` tab is hidden in this mode. On desktop, all three live inside
// the original HomeView 3-column layout and the mobile tabs are removed.
const MOBILE_TAB_IDS = ["wallet", "actions", "chat"] as const;

function useMobilePaneTabs(isMobile: boolean): void {
  const { tabs, openTab, removeTab, setActive, activeId, reorderVisible } = useTabs();
  useEffect(() => {
    if (isMobile) {
      const hadAny = MOBILE_TAB_IDS.some((id) => tabs.some((t) => t.id === id));
      for (const id of MOBILE_TAB_IDS) {
        if (!tabs.some((t) => t.id === id)) {
          openTab({ id, title: id, kind: id, closable: false });
        }
      }
      // Pin wallet / actions / chat to the very front of the tab bar so the
      // mobile primary panes are always the first 3 tabs, even after the
      // permanent actions / configure / base-mcp tabs that were seeded
      // earlier in TabsProvider. Anything the user opened
      // (e.g. a protocol tab) keeps its relative order behind the trio.
      const visibleIds = tabs
        .filter((t) => !t.hidden)
        .map((t) => t.id);
      const others = visibleIds.filter(
        (id) => !MOBILE_TAB_IDS.includes(id as (typeof MOBILE_TAB_IDS)[number]),
      );
      // Include newly-seeded mobile ids that aren't in `tabs` yet (this
      // effect saw the pre-seed snapshot); reorderVisible safely ignores
      // ids it doesn't know about.
      reorderVisible([...MOBILE_TAB_IDS, ...others]);
      // On first entry into mobile, default to the wallet tab — openTab
      // would otherwise leave us on whichever pane got seeded last.
      if (!hadAny) setActive("wallet");
    } else {
      // Bypass `closable: false` — these tabs are intentionally non-closable
      // for the user but must be torn down when we widen back to desktop or
      // they'll stick around in the TabBar with no panes to back them.
      for (const id of MOBILE_TAB_IDS) {
        if (tabs.some((t) => t.id === id)) removeTab(id);
      }
      // If we were on a mobile-only tab when the viewport widened, snap
      // back to home so TabContent has something valid to render.
      if (MOBILE_TAB_IDS.includes(activeId as (typeof MOBILE_TAB_IDS)[number])) {
        setActive("home");
      }
    }
    // Only re-run when the breakpoint changes. Depending on `tabs` would
    // loop because openTab/closeTab mutate it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMobile]);
}

// Hide the legacy `home` tab from the TabBar while in mobile mode so the
// user only sees the three explicit pages. Toggled via the `hidden` flag.
function useHomeTabVisibility(isMobile: boolean): void {
  const { tabs, setHidden } = useTabs();
  useEffect(() => {
    const home = tabs.find((t) => t.id === "home");
    if (!home) return;
    if (!!home.hidden !== isMobile) setHidden("home", isMobile);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMobile]);
}

function HomeView() {
  return (
    <div className="flex-1 flex w-full min-h-0">
      <div className="w-[20%] shrink-0 h-full">
        <WalletPortfolioPanel />
      </div>
      <div className="w-[35%] shrink-0 h-full">
        <ActionsPanel />
      </div>
      <div className="w-[45%] shrink-0 h-full">
        <ChatPanel />
      </div>
    </div>
  );
}

// First-run nudge: a freshly-signed-in user with no OpenRouter key gets
// dropped straight onto the configure tab so they can add one. Runs at
// most once per mount; switching away never bounces them back.
function useFirstRunConfigureNudge(): void {
  const { setActive } = useTabs();
  const { data: keyStatus, isLoading } = useGetApiKeyStatus();
  const nudgedRef = useRef(false);
  useEffect(() => {
    if (nudgedRef.current) return;
    if (isLoading || !keyStatus) return;
    nudgedRef.current = true;
    if (!keyStatus.configured) setActive("settings");
  }, [isLoading, keyStatus, setActive]);
}

function TabContent() {
  const isMobile = useIsMobile();
  useMobilePaneTabs(isMobile);
  useHomeTabVisibility(isMobile);
  useFirstRunConfigureNudge();
  const { tabs, activeId } = useTabs();
  const active = tabs.find((t) => t.id === activeId) ?? tabs[0];
  if (!active) return <HomeView />;
  if (active.kind === "settings") return <ConfigureView />;
  if (active.kind === "actions-builder") return <ActionsBuilderView />;
  if (active.kind === "actions-history") return <ActionsHistoryView />;
  if (active.kind === "protocol" && active.payload) {
    return <ProtocolTabView protocolId={active.payload.protocolId} />;
  }
  if (active.kind === "wallet") {
    return (
      <div className="flex-1 w-full min-h-0">
        <WalletPortfolioPanel />
      </div>
    );
  }
  if (active.kind === "actions") {
    return (
      <div className="flex-1 w-full min-h-0">
        <ActionsPanel />
      </div>
    );
  }
  if (active.kind === "chat") {
    return (
      <div className="flex-1 w-full min-h-0">
        <ChatPanel />
      </div>
    );
  }
  return <HomeView />;
}

function TerminalApp() {
  const auth = useAuth();
  if (auth.loading) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-background text-muted-foreground font-mono text-sm">
        loading…
      </div>
    );
  }
  if (!auth.authenticated) {
    return <Redirect to="/" />;
  }
  return (
    <TabsProvider>
      <div className="h-full w-full flex flex-col bg-background text-foreground overflow-hidden">
        <TopBar />
        <TabBar />
        <div className="flex-1 min-h-0 flex w-full">
          <TabContent />
        </div>
        <Footer />
      </div>
    </TabsProvider>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <RouterSwitch>
          <Route path="/" component={Landing} />
          <Route path="/terminal" component={TerminalApp} />
          <Route path="/terminal/:rest*" component={TerminalApp} />
          <Route>
            <Redirect to="/" />
          </Route>
        </RouterSwitch>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
