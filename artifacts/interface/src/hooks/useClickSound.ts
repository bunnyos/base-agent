import { useCallback, useRef } from "react";

type ClickVariant = "tap" | "drop";

// Synthesizes short UI feedback ticks via the Web Audio API so we don't have
// to ship binary assets. Lazy-creates a single AudioContext on first call
// (browsers block one created at page load before any user gesture).
export function useClickSound() {
  const ctxRef = useRef<AudioContext | null>(null);

  return useCallback((variant: ClickVariant = "tap") => {
    try {
      if (!ctxRef.current) {
        const Ctor =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext })
            .webkitAudioContext;
        if (!Ctor) return;
        ctxRef.current = new Ctor();
      }
      const ctx = ctxRef.current;
      if (ctx.state === "suspended") void ctx.resume();

      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      // A higher snap for taps, a softer thunk for drops.
      const freq = variant === "drop" ? 520 : 880;
      const peak = variant === "drop" ? 0.05 : 0.07;
      const tail = variant === "drop" ? 0.09 : 0.06;
      osc.frequency.setValueAtTime(freq, now);
      osc.frequency.exponentialRampToValueAtTime(freq * 0.6, now + tail);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(peak, now + 0.005);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + tail);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now);
      osc.stop(now + tail + 0.02);
    } catch {
      // Ignore — audio is purely decorative.
    }
  }, []);
}
