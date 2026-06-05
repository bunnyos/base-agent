import { useRef, useState } from "react";
import { Download, Upload, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  useListModels,
  useGetCurrentModel,
  useSetCurrentModel,
  getGetCurrentModelQueryKey,
  useGetApiKeyStatus,
  useSetApiKey,
  useClearApiKey,
  getGetApiKeyStatusQueryKey,
  useGetMoralisKeyStatus,
  useSetMoralisKey,
  useClearMoralisKey,
  getGetMoralisKeyStatusQueryKey,
  useGetCoingeckoKeyStatus,
  useSetCoingeckoKey,
  useClearCoingeckoKey,
  getGetCoingeckoKeyStatusQueryKey,
  getListModelsQueryKey,
  useGetMemory,
  useUpdateMemory,
  getGetMemoryQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useT } from "@/i18n";
import { ServicesTab } from "./ServicesTab";

export function ConfigureView() {
  const t = useT();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [keyDraft, setKeyDraft] = useState("");
  const [moralisDraft, setMoralisDraft] = useState("");
  const [coingeckoDraft, setCoingeckoDraft] = useState("");

  const { data: keyStatus } = useGetApiKeyStatus();
  const setApiKey = useSetApiKey();
  const clearApiKey = useClearApiKey();

  const { data: moralisStatus } = useGetMoralisKeyStatus();
  const setMoralisKey = useSetMoralisKey();
  const clearMoralisKey = useClearMoralisKey();

  const { data: coingeckoStatus } = useGetCoingeckoKeyStatus();
  const setCoingeckoKey = useSetCoingeckoKey();
  const clearCoingeckoKey = useClearCoingeckoKey();

  const { data: models = [] } = useListModels({
    query: {
      queryKey: ["/api/models"],
      enabled: Boolean(keyStatus?.configured),
    },
  });
  const { data: currentModelData } = useGetCurrentModel();
  const setCurrentModel = useSetCurrentModel();

  const { data: memory } = useGetMemory({
    query: { queryKey: getGetMemoryQueryKey() },
  });
  const updateMemory = useUpdateMemory();

  const [draft, setDraft] = useState<string | null>(null);
  const serverContent = memory?.content;
  const editorValue = draft ?? serverContent ?? "";
  const dirty = draft !== null && draft !== (serverContent ?? "");

  const currentModelName =
    models.find((m) => m.id === currentModelData?.model)?.name ||
    currentModelData?.model ||
    t("configure.selectModel");

  const handleSaveKey = async () => {
    if (keyDraft.trim().length < 8) return;
    await setApiKey.mutateAsync({ data: { apiKey: keyDraft.trim() } });
    setKeyDraft("");
    queryClient.invalidateQueries({ queryKey: getGetApiKeyStatusQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListModelsQueryKey() });
  };

  const handleClearKey = async () => {
    await clearApiKey.mutateAsync();
    queryClient.invalidateQueries({ queryKey: getGetApiKeyStatusQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListModelsQueryKey() });
  };

  const handleSaveMoralis = async () => {
    if (moralisDraft.trim().length < 8) return;
    await setMoralisKey.mutateAsync({ data: { apiKey: moralisDraft.trim() } });
    setMoralisDraft("");
    queryClient.invalidateQueries({ queryKey: getGetMoralisKeyStatusQueryKey() });
  };

  const handleClearMoralis = async () => {
    await clearMoralisKey.mutateAsync();
    queryClient.invalidateQueries({ queryKey: getGetMoralisKeyStatusQueryKey() });
  };

  const handleSaveCoingecko = async () => {
    if (coingeckoDraft.trim().length < 8) return;
    await setCoingeckoKey.mutateAsync({
      data: { apiKey: coingeckoDraft.trim() },
    });
    setCoingeckoDraft("");
    queryClient.invalidateQueries({
      queryKey: getGetCoingeckoKeyStatusQueryKey(),
    });
  };

  const handleClearCoingecko = async () => {
    await clearCoingeckoKey.mutateAsync();
    queryClient.invalidateQueries({
      queryKey: getGetCoingeckoKeyStatusQueryKey(),
    });
  };

  const handleSelectModel = (modelId: string) => {
    setCurrentModel.mutate(
      { data: { model: modelId } },
      {
        onSuccess: (res) => {
          queryClient.setQueryData(getGetCurrentModelQueryKey(), res);
        },
      },
    );
    setPickerOpen(false);
  };

  const handleSaveMemory = async () => {
    if (draft === null) return;
    try {
      await updateMemory.mutateAsync({ data: { content: draft } });
      queryClient.invalidateQueries({ queryKey: getGetMemoryQueryKey() });
      setDraft(null);
      toast({ description: t("configure.memorySaved"), duration: 1500 });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast({ description: t("configure.saveFailed", { msg }), duration: 4000 });
    }
  };

  const handleRevertMemory = () => setDraft(null);

  const isSavingMemory = updateMemory.isPending;

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExportMemory = () => {
    const blob = new Blob([memory?.content ?? ""], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `bunny-memory-${new Date().toISOString().split("T")[0]}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast({ description: t("configure.memoryExported"), duration: 1500 });
  };

  const handleImportClick = () => fileInputRef.current?.click();

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const text = await file.text();
      await updateMemory.mutateAsync({ data: { content: text } });
      queryClient.invalidateQueries({ queryKey: getGetMemoryQueryKey() });
      setDraft(null);
      toast({ description: t("configure.memoryImported"), duration: 2000 });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast({ description: t("configure.importFailed", { msg }), duration: 4000 });
    }
  };

  return (
    <div className="h-full w-full overflow-y-auto bg-background">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6">
        <div className="mb-4">
          <h2 className="font-sans text-lg font-medium">{t("common.configure")}</h2>
          <p className="font-sans text-xs text-muted-foreground mt-1">
            {t("configure.subtitle")}
          </p>
        </div>

        <Tabs defaultValue="api" className="mt-2">
          <TabsList className="grid grid-cols-2 sm:grid-cols-4 w-full h-auto font-mono text-xs">
            <TabsTrigger value="api">{t("configure.tabApi")}</TabsTrigger>
            <TabsTrigger value="llm">{t("configure.tabLlm")}</TabsTrigger>
            <TabsTrigger value="services">{t("configure.tabServices")}</TabsTrigger>
            <TabsTrigger value="memory">{t("configure.tabMemory")}</TabsTrigger>
          </TabsList>

          <TabsContent value="api" className="space-y-5 py-3 font-mono">
            <div className="rounded-md border border-border/60 bg-secondary/30 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
              {t("configure.keysIntroPrefix")}{" "}
              <span className="text-foreground">
                {t("configure.keysIntroRequired")}
              </span>{" "}
              {t("configure.keysIntroSuffix")}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="api-key" className="text-xs">
                  {t("configure.openrouterKeyLabel")}{" "}
                  <span className="text-red ml-1">{t("configure.requiredMark")}</span>
                </Label>
                <a
                  href="https://openrouter.ai/credits"
                  target="_blank"
                  rel="noreferrer"
                  className="text-[10px] text-accent hover:opacity-90 inline-flex items-center gap-1"
                  data-testid="link-openrouter-topup"
                >
                  {t("configure.topUp")} <ExternalLink className="h-2.5 w-2.5" />
                </a>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  id="api-key"
                  type="password"
                  placeholder={
                    keyStatus?.configured ? keyStatus.masked : "sk-or-v1-..."
                  }
                  value={keyDraft}
                  onChange={(e) => setKeyDraft(e.target.value)}
                  className="font-mono text-xs h-8"
                  data-testid="input-api-key"
                />
                <Button
                  size="sm"
                  className="h-8 text-xs font-mono"
                  onClick={handleSaveKey}
                  disabled={keyDraft.trim().length < 8 || setApiKey.isPending}
                  data-testid="button-save-key"
                >
                  {t("common.save")}
                </Button>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span
                  className={
                    keyStatus?.configured
                      ? "text-green"
                      : "text-muted-foreground"
                  }
                >
                  {keyStatus?.configured
                    ? keyStatus.userProvided
                      ? t("configure.userKeyStatus", { masked: keyStatus.masked })
                      : t("configure.envKeyStatus", { masked: keyStatus.masked })
                    : t("configure.noKeySet")}
                </span>
                {keyStatus?.userProvided && (
                  <button
                    className="text-muted-foreground hover:text-red underline-offset-2 hover:underline"
                    onClick={handleClearKey}
                    data-testid="button-clear-key"
                  >
                    {t("configure.clear")}
                  </button>
                )}
              </div>
              <p className="text-[10px] text-muted-foreground leading-relaxed">
                {t("configure.openrouterHelp")}
              </p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="moralis-key" className="text-xs">
                  {t("configure.moralisKeyLabel")}{" "}
                  <span className="text-red ml-1">{t("configure.requiredMark")}</span>
                </Label>
                <a
                  href="https://admin.moralis.com"
                  target="_blank"
                  rel="noreferrer"
                  className="text-[10px] text-accent hover:opacity-90 inline-flex items-center gap-1"
                  data-testid="link-moralis-signup"
                >
                  {t("configure.getFreeKey")} <ExternalLink className="h-2.5 w-2.5" />
                </a>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  id="moralis-key"
                  type="password"
                  placeholder={
                    moralisStatus?.configured ? moralisStatus.masked : "eyJ..."
                  }
                  value={moralisDraft}
                  onChange={(e) => setMoralisDraft(e.target.value)}
                  className="font-mono text-xs h-8"
                  data-testid="input-moralis-key"
                />
                <Button
                  size="sm"
                  className="h-8 text-xs font-mono"
                  onClick={handleSaveMoralis}
                  disabled={
                    moralisDraft.trim().length < 8 || setMoralisKey.isPending
                  }
                  data-testid="button-save-moralis-key"
                >
                  {t("common.save")}
                </Button>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span
                  className={
                    moralisStatus?.configured
                      ? "text-green"
                      : "text-muted-foreground"
                  }
                >
                  {moralisStatus?.configured
                    ? moralisStatus.userProvided
                      ? t("configure.userKeyStatus", { masked: moralisStatus.masked })
                      : t("configure.envKeyStatus", { masked: moralisStatus.masked })
                    : t("configure.noKeySet")}
                </span>
                {moralisStatus?.userProvided && (
                  <button
                    className="text-muted-foreground hover:text-red underline-offset-2 hover:underline"
                    onClick={handleClearMoralis}
                    data-testid="button-clear-moralis-key"
                  >
                    {t("configure.clear")}
                  </button>
                )}
              </div>
              <p className="text-[10px] text-muted-foreground leading-relaxed">
                {t("configure.moralisHelp")}
              </p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="coingecko-key" className="text-xs">
                  {t("configure.coingeckoKeyLabel")}{" "}
                  <span className="text-red ml-1">{t("configure.requiredMark")}</span>
                </Label>
                <a
                  href="https://www.coingecko.com/en/api/pricing"
                  target="_blank"
                  rel="noreferrer"
                  className="text-[10px] text-accent hover:opacity-90 inline-flex items-center gap-1"
                  data-testid="link-coingecko-signup"
                >
                  {t("configure.getFreeKey")} <ExternalLink className="h-2.5 w-2.5" />
                </a>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  id="coingecko-key"
                  type="password"
                  placeholder={
                    coingeckoStatus?.configured ? coingeckoStatus.masked : "CG-xxxx..."
                  }
                  value={coingeckoDraft}
                  onChange={(e) => setCoingeckoDraft(e.target.value)}
                  className="font-mono text-xs h-8"
                  data-testid="input-coingecko-key"
                />
                <Button
                  size="sm"
                  className="h-8 text-xs font-mono"
                  onClick={handleSaveCoingecko}
                  disabled={coingeckoDraft.trim().length < 8 || setCoingeckoKey.isPending}
                  data-testid="button-save-coingecko-key"
                >
                  {t("common.save")}
                </Button>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span
                  className={
                    coingeckoStatus?.configured
                      ? "text-green"
                      : "text-muted-foreground"
                  }
                >
                  {coingeckoStatus?.configured
                    ? coingeckoStatus.userProvided
                      ? t("configure.userKeyStatus", { masked: coingeckoStatus.masked })
                      : t("configure.envKeyStatus", { masked: coingeckoStatus.masked })
                    : t("configure.noKeySet")}
                </span>
                {coingeckoStatus?.userProvided && (
                  <button
                    className="text-muted-foreground hover:text-red underline-offset-2 hover:underline"
                    onClick={handleClearCoingecko}
                    data-testid="button-clear-coingecko-key"
                  >
                    {t("configure.clear")}
                  </button>
                )}
              </div>
              <p className="text-[10px] text-muted-foreground leading-relaxed">
                {t("configure.coingeckoHelp")}
              </p>
            </div>

          </TabsContent>

          <TabsContent value="llm" className="space-y-5 py-3 font-mono">
            <div className="space-y-2">
              <Label className="text-xs">{t("configure.modelLabel")}</Label>
              <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 w-full justify-between text-xs font-mono"
                    disabled={!keyStatus?.configured}
                    data-testid="button-model-picker"
                  >
                    <span className="truncate">{currentModelName}</span>
                    <span className="text-muted-foreground ml-2">▾</span>
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[calc(100vw-2rem)] sm:w-[440px] p-0" align="start">
                  <Command>
                    <CommandInput
                      placeholder={t("configure.searchModels")}
                      className="font-mono text-xs"
                    />
                    <CommandList>
                      <CommandEmpty className="text-xs p-4 text-center font-mono">
                        {t("configure.noModelsFound")}
                      </CommandEmpty>
                      <CommandGroup>
                        {models.map((model) => (
                          <CommandItem
                            key={model.id}
                            value={model.name}
                            onSelect={() => handleSelectModel(model.id)}
                            className="font-mono text-xs flex justify-between items-center cursor-pointer"
                          >
                            <span className="truncate mr-2">{model.name}</span>
                            {model.free ? (
                              <span className="text-green shrink-0">{t("configure.free")}</span>
                            ) : (
                              <span className="text-muted-foreground shrink-0">
                                ${model.price_input}
                              </span>
                            )}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
              {!keyStatus?.configured && (
                <p className="text-[10px] text-muted-foreground">
                  {t("configure.setKeyToLoadModels")}
                </p>
              )}
            </div>
          </TabsContent>

          <TabsContent value="services" className="py-3 font-mono">
            <ServicesTab />
          </TabsContent>

          <TabsContent value="memory" className="space-y-3 py-3 font-mono">
            <div className="flex items-center justify-end gap-1">
              <input
                ref={fileInputRef}
                type="file"
                accept="text/markdown,text/plain,.md,.txt"
                onChange={handleImportFile}
                className="hidden"
                data-testid="input-memory-import"
              />
              <button
                onClick={handleImportClick}
                disabled={isSavingMemory}
                className="px-2 py-1 bg-secondary hover:bg-secondary/80 rounded font-mono text-[10px] text-foreground transition-colors inline-flex items-center gap-1 disabled:opacity-50"
                data-testid="button-memory-import"
                title={t("configure.importMemoryTitle")}
              >
                <Upload className="h-3 w-3" />
                {t("configure.importLabel")}
              </button>
              <button
                onClick={handleExportMemory}
                className="px-2 py-1 bg-secondary hover:bg-secondary/80 rounded font-mono text-[10px] text-foreground transition-colors inline-flex items-center gap-1"
                data-testid="button-memory-export"
                title={t("configure.exportMemoryTitle")}
              >
                <Download className="h-3 w-3" />
                {t("configure.exportLabel")}
              </button>
            </div>
            <Textarea
              value={editorValue}
              onChange={(e) => setDraft(e.target.value)}
              className="font-mono text-xs min-h-[200px] sm:min-h-[320px] resize-y bg-background"
              spellCheck={false}
              placeholder={t("configure.memoryPlaceholder")}
              data-testid="memory-editor"
            />
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] text-muted-foreground">
                {t("configure.memoryHelp")}
              </p>
              <div className="flex gap-2 shrink-0">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs font-mono"
                  onClick={handleRevertMemory}
                  disabled={!dirty || isSavingMemory}
                  data-testid="button-memory-revert"
                >
                  {t("configure.revert")}
                </Button>
                <Button
                  size="sm"
                  className="h-7 text-xs font-mono"
                  onClick={handleSaveMemory}
                  disabled={!dirty || isSavingMemory}
                  data-testid="button-memory-save"
                >
                  {isSavingMemory ? t("configure.saving") : t("common.save")}
                </Button>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
