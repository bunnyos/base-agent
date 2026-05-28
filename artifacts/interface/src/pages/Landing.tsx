import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import logo from "@assets/logo.png";
import { useAuth } from "@/hooks/useAuth";
import WaveBackground from "@/components/WaveBackground";
import { Footer } from "@/components/Footer";
import { playSound } from "@/lib/sound";

export default function Landing() {
  const [, setLocation] = useLocation();
  const auth = useAuth();
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    const prev = document.title;
    document.title = "The first open-source @base agent.";
    return () => {
      document.title = prev;
    };
  }, []);

  // Note: we intentionally do NOT auto-redirect authenticated visitors away
  // from the landing page. A signed-in user can still browse "/" and click
  // the CTA (which becomes "open terminal") to jump back in.

  // When the OAuth popup posts a success message back, do a hard navigation
  // to /terminal so every query (including /api/base-mcp/status) refetches
  // with the freshly-minted session cookie. A client-side setLocation would
  // keep the cached "not connected" status until the 10s refetch interval.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data as { type?: string; ok?: boolean } | undefined;
      if (data?.type !== "base-mcp-auth" || data.ok !== true) return;
      window.location.assign("/terminal");
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const handleConnect = () => {
    playSound("confirm");
    if (auth.authenticated) {
      setLocation("/terminal");
      return;
    }
    setConnecting(true);
    // Open the top-level start endpoint directly in the popup so the
    // bunny_anon cookie is set during a top-level navigation (works even
    // when the app is inside a cross-site preview iframe). The endpoint
    // 302-redirects to Base's OAuth URL.
    const popup = window.open(
      "/api/base-mcp/connect-start",
      "base-mcp-auth",
      "width=520,height=720",
    );
    if (!popup) {
      setConnecting(false);
    }
  };

  const ctaLabel = connecting
    ? "connecting…"
    : auth.authenticated
      ? "open terminal"
      : "connect to base";

  return (
    <main className="relative min-h-[100dvh] md:h-[100dvh] w-full text-foreground flex flex-col md:overflow-hidden">
      <WaveBackground />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 z-0 h-px"
        style={{
          background:
            "linear-gradient(90deg, transparent, hsl(var(--accent) / 0.4), transparent)",
        }}
      />
      <header className="relative z-10 h-16 w-full px-4 flex items-center justify-between border-b border-border/60 bg-background/70 backdrop-blur shrink-0">
        <div className="flex items-center gap-2">
          <img src={logo} alt="logo" className="h-12 w-auto" />
        </div>
      </header>
      <section className="relative z-10 flex-1 min-h-0 flex flex-col items-center justify-center px-6 py-8 text-center">
        <h1 className="text-4xl sm:text-6xl md:text-7xl font-semibold tracking-tight max-w-4xl">
          The first open-source{" "}
          <a
            href="https://base.org"
            target="_blank"
            rel="noreferrer"
            className="text-accent hover:opacity-90"
          >
            @base
          </a>{" "}
          <span className="text-muted-foreground">agent</span>
        </h1>

        <p className="mt-6 max-w-xl text-base md:text-lg text-muted-foreground leading-relaxed">built on the base stack. built for anyone, free.</p>

        <div className="mt-10 flex items-center justify-center gap-2">
          <button
            type="button"
            onClick={() => void handleConnect()}
            disabled={connecting}
            className="px-3 py-1.5 rounded-md bg-accent text-accent-foreground font-sans text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
            data-testid="button-connect-base-body"
          >
            {ctaLabel}
          </button>
          <button
            type="button"
            disabled
            className="px-3 py-1.5 rounded-md border border-border/70 font-sans text-sm font-medium text-muted-foreground cursor-not-allowed"
            data-testid="button-github-coming-soon"
          >
            github (coming soon)
          </button>
        </div>
      </section>
      <section className="relative z-10 w-full px-6 pb-8 shrink-0">
        <div className="max-w-5xl mx-auto grid gap-px md:grid-cols-4 border border-border/60 rounded-xl overflow-hidden bg-border/60">
          <Pillar
            index="01"
            title="chat & execute"
            body="chat with protocols and execute transactions directly."
          />
          <Pillar
            index="02"
            title="research"
            body="in-built data sources for research and analysis."
          />
          <Pillar
            index="03"
            title="action system"
            body="create and share actions that run 24/7."
          />
          <Pillar
            index="04"
            title="build"
            body="fork it, add features, and support the community."
          />
        </div>
      </section>
      <Footer />
    </main>
  );
}

function Pillar({
  index,
  title,
  body,
}: {
  index: string;
  title: string;
  body: string;
}) {
  return (
    <div className="bg-background p-6 flex flex-col gap-2 hover:bg-background/80 transition-colors">
      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        {index}
      </span>
      <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
      <p className="text-sm text-muted-foreground leading-relaxed">{body}</p>
    </div>
  );
}
