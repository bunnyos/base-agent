import { useQuery } from "@tanstack/react-query";

type ProtocolDetail = {
  id: string;
  label: string;
  kind: string;
  source: "mcp" | "api";
  via?: string;
  description: string;
  tools: Array<{ name: string; description: string }>;
};

export function ProtocolTabView({ protocolId }: { protocolId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["/api/protocols", protocolId, "tools"],
    queryFn: async (): Promise<ProtocolDetail | null> => {
      const r = await fetch(
        `/api/protocols/${encodeURIComponent(protocolId)}/tools`,
      );
      if (!r.ok) return null;
      return (await r.json()) as ProtocolDetail;
    },
    staleTime: 60_000,
  });

  return (
    <div className="h-full w-full overflow-y-auto bg-background">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-1">
          <h2 className="font-sans text-lg font-medium">
            {data?.label ?? protocolId}
          </h2>
          <span className="font-mono text-[10px] text-muted-foreground">
            {data?.source === "api" ? `api · ${data.via ?? ""}` : "mcp"}
          </span>
        </div>
        <p className="font-sans text-sm leading-relaxed text-muted-foreground">
          {isLoading ? "loading…" : data?.description ?? "no description"}
        </p>
        {data && (
          <div className="mt-6">
            <h3 className="font-mono text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-3">
              {data.source === "api"
                ? "no mcp tools (http api)"
                : `tools (${data.tools.length})`}
            </h3>
            {data.source === "mcp" && data.tools.length === 0 && !isLoading && (
              <p className="font-mono text-[10px] text-muted-foreground">
                no tools — server not connected
              </p>
            )}
            <ul className="space-y-3">
              {data.tools.map((t) => (
                <li
                  key={t.name}
                  className="border-l-2 border-border pl-3 py-0.5"
                >
                  <div className="font-mono text-xs text-foreground">
                    {t.name}
                  </div>
                  {t.description && (
                    <div className="font-sans text-xs text-muted-foreground leading-snug mt-0.5">
                      {t.description}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
