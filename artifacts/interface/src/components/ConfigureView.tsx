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
  useGetCmcKeyStatus,
  useSetCmcKey,
  useClearCmcKey,
  getGetCmcKeyStatusQueryKey,
  getListModelsQueryKey,
  useGetMemory,
  useUpdateMemory,
  getGetMemoryQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { ServicesTab } from "./ServicesTab";

export function ConfigureView() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [keyDraft, setKeyDraft] = useState("");
  const [moralisDraft, setMoralisDraft] = useState("");
  const [cmcDraft, setCmcDraft] = useState("");

  const { data: keyStatus } = useGetApiKeyStatus();
  const setApiKey = useSetApiKey();
  const clearApiKey = useClearApiKey();

  const { data: moralisStatus } = useGetMoralisKeyStatus();
  const setMoralisKey = useSetMoralisKey();
  const clearMoralisKey = useClearMoralisKey();

  const { data: cmcStatus } = useGetCmcKeyStatus();
  const setCmcKey = useSetCmcKey();
  const clearCmcKey = useClearCmcKey();

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
    "select model";

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

  const handleSaveCmc = async () => {
    if (cmcDraft.trim().length < 8) return;
    await setCmcKey.mutateAsync({
      data: { apiKey: cmcDraft.trim() },
    });
    setCmcDraft("");
    queryClient.invalidateQueries({
      queryKey: getGetCmcKeyStatusQueryKey(),
    });
  };

  const handleClearCmc = async () => {
    await clearCmcKey.mutateAsync();
    queryClient.invalidateQueries({
      queryKey: getGetCmcKeyStatusQueryKey(),
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
      toast({ description: "memory saved", duration: 1500 });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast({ description: `save failed: ${msg}`, duration: 4000 });
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
    toast({ description: "memory exported", duration: 1500 });
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
      toast({ description: "memory imported", duration: 2000 });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast({ description: `import failed: ${msg}`, duration: 4000 });
    }
  };

  return (
    <div className="h-full w-full overflow-y-auto bg-background">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6">
        <div className="mb-4">
          <h2 className="font-sans text-lg font-medium">configure</h2>
          <p className="font-sans text-xs text-muted-foreground mt-1">
            api keys + llm + services + memory.
          </p>
        </div>

        <Tabs defaultValue="api" className="mt-2">
          <TabsList className="grid grid-cols-2 sm:grid-cols-4 w-full h-auto font-mono text-xs">
            <TabsTrigger value="api">api</TabsTrigger>
            <TabsTrigger value="llm">llm</TabsTrigger>
            <TabsTrigger value="services">services</TabsTrigger>
            <TabsTrigger value="memory">memory</TabsTrigger>
          </TabsList>

          <TabsContent value="api" className="space-y-5 py-3 font-mono">
            <div className="rounded-md border border-border/60 bg-secondary/30 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
              both keys below are <span className="text-foreground">required</span>{" "}
              for bunnyOS to work. they unlock the model and the on-chain data
              the agent reasons over.
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="api-key" className="text-xs">
                  openrouter api key{" "}
                  <span className="text-red ml-1">*required</span>
                </Label>
                <a
                  href="https://openrouter.ai/credits"
                  target="_blank"
                  rel="noreferrer"
                  className="text-[10px] text-accent hover:opacity-90 inline-flex items-center gap-1"
                  data-testid="link-openrouter-topup"
                >
                  top up $1 <ExternalLink className="h-2.5 w-2.5" />
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
                  save
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
                      ? `● user key · ${keyStatus.masked}`
                      : `● env key · ${keyStatus.masked}`
                    : "○ no key set"}
                </span>
                {keyStatus?.userProvided && (
                  <button
                    className="text-muted-foreground hover:text-red underline-offset-2 hover:underline"
                    onClick={handleClearKey}
                    data-testid="button-clear-key"
                  >
                    clear
                  </button>
                )}
              </div>
              <p className="text-[10px] text-muted-foreground leading-relaxed">
                grab a key at openrouter.ai/keys and add ~$1 in credits — pays
                for thousands of agent turns on cheap models.
              </p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="moralis-key" className="text-xs">
                  moralis api key{" "}
                  <span className="text-red ml-1">*required</span>
                </Label>
                <a
                  href="https://admin.moralis.com"
                  target="_blank"
                  rel="noreferrer"
                  className="text-[10px] text-accent hover:opacity-90 inline-flex items-center gap-1"
                  data-testid="link-moralis-signup"
                >
                  get free key <ExternalLink className="h-2.5 w-2.5" />
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
                  save
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
                      ? `● user key · ${moralisStatus.masked}`
                      : `● env key · ${moralisStatus.masked}`
                    : "○ no key set"}
                </span>
                {moralisStatus?.userProvided && (
                  <button
                    className="text-muted-foreground hover:text-red underline-offset-2 hover:underline"
                    onClick={handleClearMoralis}
                    data-testid="button-clear-moralis-key"
                  >
                    clear
                  </button>
                )}
              </div>
              <p className="text-[10px] text-muted-foreground leading-relaxed">
                free tier unlocks wallet history, nfts, defi positions, token
                data across all evm chains. used on every agent turn.
              </p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="cmc-key" className="text-xs">
                  coinmarketcap api key{" "}
                  <span className="text-red ml-1">*required</span>
                </Label>
                <a
                  href="https://coinmarketcap.com/api/"
                  target="_blank"
                  rel="noreferrer"
                  className="text-[10px] text-accent hover:opacity-90 inline-flex items-center gap-1"
                  data-testid="link-cmc-signup"
                >
                  get free key <ExternalLink className="h-2.5 w-2.5" />
                </a>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  id="cmc-key"
                  type="password"
                  placeholder={
                    cmcStatus?.configured ? cmcStatus.masked : "xxxx-xxxx-..."
                  }
                  value={cmcDraft}
                  onChange={(e) => setCmcDraft(e.target.value)}
                  className="font-mono text-xs h-8"
                  data-testid="input-cmc-key"
                />
                <Button
                  size="sm"
                  className="h-8 text-xs font-mono"
                  onClick={handleSaveCmc}
                  disabled={cmcDraft.trim().length < 8 || setCmcKey.isPending}
                  data-testid="button-save-cmc-key"
                >
                  save
                </Button>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span
                  className={
                    cmcStatus?.configured
                      ? "text-green"
                      : "text-muted-foreground"
                  }
                >
                  {cmcStatus?.configured
                    ? cmcStatus.userProvided
                      ? `● user key · ${cmcStatus.masked}`
                      : `● env key · ${cmcStatus.masked}`
                    : "○ no key set"}
                </span>
                {cmcStatus?.userProvided && (
                  <button
                    className="text-muted-foreground hover:text-red underline-offset-2 hover:underline"
                    onClick={handleClearCmc}
                    data-testid="button-clear-cmc-key"
                  >
                    clear
                  </button>
                )}
              </div>
              <p className="text-[10px] text-muted-foreground leading-relaxed">
                bunnyOS needs this for token pricing, market data, and new
                listing discovery. free Basic tier (no card) — 30 req/min,
                10k req/month.
              </p>
            </div>

          </TabsContent>

          <TabsContent value="llm" className="space-y-5 py-3 font-mono">
            <div className="space-y-2">
              <Label className="text-xs">model</Label>
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
                      placeholder="search models..."
                      className="font-mono text-xs"
                    />
                    <CommandList>
                      <CommandEmpty className="text-xs p-4 text-center font-mono">
                        no models found.
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
                              <span className="text-green shrink-0">free</span>
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
                  set an api key to load the model list.
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
                title="import memory (.md)"
              >
                <Upload className="h-3 w-3" />
                import
              </button>
              <button
                onClick={handleExportMemory}
                className="px-2 py-1 bg-secondary hover:bg-secondary/80 rounded font-mono text-[10px] text-foreground transition-colors inline-flex items-center gap-1"
                data-testid="button-memory-export"
                title="export memory (.md)"
              >
                <Download className="h-3 w-3" />
                export
              </button>
            </div>
            <Textarea
              value={editorValue}
              onChange={(e) => setDraft(e.target.value)}
              className="font-mono text-xs min-h-[200px] sm:min-h-[320px] resize-y bg-background"
              spellCheck={false}
              placeholder="freeform notes for bunnyOS: risk tolerance, time horizon, tokens to avoid, recurring intents…"
              data-testid="memory-editor"
            />
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] text-muted-foreground">
                bunnyOS reads this on every request. plain markdown.
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
                  revert
                </Button>
                <Button
                  size="sm"
                  className="h-7 text-xs font-mono"
                  onClick={handleSaveMemory}
                  disabled={!dirty || isSavingMemory}
                  data-testid="button-memory-save"
                >
                  {isSavingMemory ? "saving…" : "save"}
                </Button>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
