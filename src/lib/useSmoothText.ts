// Smooth "typewriter" reveal for streamed assistant text.
//
// Atlas already streams token deltas over the websocket (RTS-113), but the
// store appends each delta to `message.text` the instant it arrives, so the
// text is painted in network-sized bursts — a few words, a pause, a sentence,
// a pause. ChatGPT and the Claude apps look *fluid* because they decouple the
// render cadence from network arrival: deltas land in a buffer and a steady
// loop reveals characters at an even pace.
//
// This hook is that buffer. The store stays the source of truth (it holds the
// full text); this only meters how fast the text is painted. On each animation
// frame it reveals a fraction of the outstanding backlog — fast catch-up after
// a burst, ~1 char/frame as it drains — which reads like an even typewriter.
// Once the turn finishes (`streaming` false) or the user prefers reduced
// motion, the whole string shows at once.

import { useEffect, useRef, useState } from "react";

const CATCHUP_DIVISOR = 7; // reveal ~1/7 of the backlog per frame (ease-out)
const MIN_STEP = 1; // always make progress while there's backlog
const MAX_STEP = 16; // cap a single frame so a whole-block arrival still types

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function useSmoothText(target: string, streaming: boolean): string {
  // Only animate a live turn, and only when motion is welcome.
  const animate = streaming && !prefersReducedMotion();

  const [revealed, setRevealed] = useState(animate ? 0 : target.length);
  const revealedRef = useRef(revealed);
  revealedRef.current = revealed;
  // The loop reads the latest target off a ref so new deltas feed the same
  // animation frame loop without re-arming the effect on every delta.
  const targetRef = useRef(target);
  targetRef.current = target;
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!animate) {
      // Turn done (or historical / reduced-motion): show everything, stop.
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      setRevealed(targetRef.current.length);
      return;
    }

    const tick = () => {
      const full = targetRef.current.length;
      const shown = revealedRef.current;
      if (shown < full) {
        const step = Math.min(
          MAX_STEP,
          Math.max(MIN_STEP, Math.ceil((full - shown) / CATCHUP_DIVISOR)),
        );
        setRevealed(Math.min(full, shown + step));
      }
      // Keep the loop alive while streaming so freshly arrived deltas drain
      // even after we've momentarily caught up. The caught-up path does no
      // setState, so there's no re-render churn while idle.
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [animate]);

  if (!animate) return target;
  return target.slice(0, Math.min(revealed, target.length));
}
