// Tiny UI sound engine. Uses the Web Audio API to synthesize short blips
// at runtime so we don't have to ship any asset files. Three timbres:
//
//   "click"   — soft single blip (60ms). For low-stakes affirmations
//               like "hide", "unhide", tab switches.
//   "confirm" — two-note rising chirp (~120ms). For high-stakes /
//               dopamine-bearing actions: send chat, execute a
//               recommendation, create an action, enter the terminal.
//   "soft"    — even quieter click for noisy taps.
//
// All sounds can be silenced via a `bunny:sound-muted` localStorage
// toggle so we can wire a mute control later without code changes here.

type Sound = "click" | "confirm" | "soft";

let ctx: AudioContext | null = null;
let unlocked = false;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) return null;
    try {
      ctx = new Ctor();
    } catch {
      return null;
    }
  }
  return ctx;
}

// Most browsers require a user gesture before AudioContext makes noise.
// Wire a one-shot resume on the first pointer/keydown so the very first
// playSound() call after page load actually plays.
function ensureUnlocked(): void {
  if (unlocked || typeof window === "undefined") return;
  const ac = getCtx();
  if (!ac) return;
  const resume = () => {
    if (ac.state === "suspended") void ac.resume();
    unlocked = true;
    window.removeEventListener("pointerdown", resume);
    window.removeEventListener("keydown", resume);
  };
  window.addEventListener("pointerdown", resume, { once: true });
  window.addEventListener("keydown", resume, { once: true });
}

if (typeof window !== "undefined") ensureUnlocked();

function isMuted(): boolean {
  try {
    if (typeof window === "undefined") return false;
    if (window.localStorage.getItem("bunny:sound-muted") === "1") return true;
    return false;
  } catch {
    return false;
  }
}

function blip(
  ac: AudioContext,
  freq: number,
  durationMs: number,
  startOffsetMs: number,
  peakGain: number,
  type: OscillatorType = "sine",
): void {
  const now = ac.currentTime + startOffsetMs / 1000;
  const end = now + durationMs / 1000;
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, now);
  // Quick attack, exponential-ish decay. Setting to 0 with exponentialRamp
  // throws, so end at a very small positive value.
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.linearRampToValueAtTime(peakGain, now + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, end);
  osc.connect(gain);
  gain.connect(ac.destination);
  osc.start(now);
  osc.stop(end + 0.02);
}

export function playSound(kind: Sound = "click"): void {
  if (isMuted()) return;
  const ac = getCtx();
  if (!ac) return;
  // If still locked, the resume listener above will fire on this same
  // gesture; the scheduled tones below will play once it transitions.
  if (ac.state === "suspended") void ac.resume();

  switch (kind) {
    case "confirm":
      // Two-note rising chirp. C5 → E5-ish. Triangle wave gives a
      // slightly warmer, "satisfying" timbre than a pure sine.
      blip(ac, 523.25, 70, 0, 0.08, "triangle");
      blip(ac, 783.99, 90, 55, 0.07, "triangle");
      return;
    case "soft":
      blip(ac, 660, 35, 0, 0.025, "sine");
      return;
    case "click":
    default:
      blip(ac, 880, 50, 0, 0.05, "sine");
      return;
  }
}
