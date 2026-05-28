import { getMemoryMd, setMemoryMd } from "./settings";

// Single user-authored markdown memory blob. Lives on the user_settings row
// and is served from the in-memory settings cache (sync). Injected into
// every agent prompt.

export function getContext(): string {
  const md = getMemoryMd();
  return `=== BUNNY MEMORY ===\n\n${md}\n====================\n`;
}

export function readMemory(): string {
  return getMemoryMd();
}

export async function writeMemory(content: string): Promise<void> {
  await setMemoryMd(content);
}
