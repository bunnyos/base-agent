import { useQuery } from "@tanstack/react-query";
import { useT } from "@/i18n";

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
  const t = useT();
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
            {data?.source === "api"
              ? t("protocolTab.apiVia", { via: data.via ?? "" })
              : t("protocolTab.mcp")}
          </span>
        </div>
        <p className="font-sans text-sm leading-relaxed text-muted-foreground">
          {isLoading
            ? t("protocolTab.loading")
            : data?.description ?? t("protocolTab.noDescription")}
        </p>
        {data && (
          <div className="mt-6">
            <h3 className="font-mono text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-3">
              {data.source === "api"
                ? t("protocolTab.noMcpTools")
                : t("protocolTab.toolsCount", { count: data.tools.length })}
            </h3>
            {data.source === "mcp" && data.tools.length === 0 && !isLoading && (
              <p className="font-mono text-[10px] text-muted-foreground">
                {t("protocolTab.noToolsDisconnected")}
              </p>
            )}
            <ul className="space-y-3">
              {data.tools.map((tool) => (
                <li
                  key={tool.name}
                  className="border-l-2 border-border pl-3 py-0.5"
                >
                  <div className="font-mono text-xs text-foreground">
                    {tool.name}
                  </div>
                  {tool.description && (
                    <div className="font-sans text-xs text-muted-foreground leading-snug mt-0.5">
                      {tool.description}
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
