// Smooth "typewriter" reveal for streamed assistant text — v2 (RTS-119).
//
// Atlas streams token deltas over the websocket (RTS-113); the store appends
// each delta to `message.text` the instant it arrives. This hook decouples
// paint cadence from network arrival so the text reads fluid instead of
// bursty. The store stays the source of truth (full text); this only meters
// how fast it is painted.
//
// v1 (RTS-115) revealed ceil(backlog / 7) chars per frame, clamped to
// [1, 16]. That tied the *speed itself* to the backlog: every network burst
// kicked the reveal to 16 chars/frame, which then decayed frame-by-frame to a
// 1 char/frame crawl until the next burst — a visible surge-and-stall
// rubber-band. It was also frame-rate dependent (a 120 Hz display typed twice
// as fast) and quantized to whole chars per frame.
//
// v2 is a rate controller, the way ChatGPT/Claude paint:
//   - target velocity = drain the current backlog over HORIZON_S seconds,
//     so the pace naturally matches the model's arrival rate with a small,
//     constant latency buffer behind the stream
//   - velocity is low-pass filtered (time constant TAU_S) so it *glides*
//     between rates instead of stepping with every burst
//   - position advances by velocity × dt with a fractional accumulator, so
//     motion is continuous and identical on any refresh rate
// Turn end or prefers-reduced-motion snaps to the full string (as in v1).

import { useEffect, useRef, useState } from "react";

const HORIZON_S = 0.45; // aim to drain the backlog over ~this long
const TAU_S = 0.18; // velocity smoothing time constant (higher = calmer)
const V_MIN = 30; // chars/sec floor while backlog exists — keeps motion alive
const V_MAX = 2600; // chars/sec ceiling — a pasted wall sprints, not strobes

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
  // animation-frame loop without re-arming the effect on every delta.
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

    let pos = revealedRef.current; // fractional reveal position
    let v = V_MIN; // current velocity, chars/sec
    let last = performance.now();

    const tick = (now: number) => {
      // Clamp dt so a background tab that resumes doesn't teleport the text.
      const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
      last = now;

      const full = targetRef.current.length;
      if (pos > full) pos = full; // target can only grow, but be safe
      const backlog = full - pos;
      const alpha = 1 - Math.exp(-dt / TAU_S);

      if (backlog > 0) {
        const vTarget = Math.min(V_MAX, Math.max(V_MIN, backlog / HORIZON_S));
        v += (vTarget - v) * alpha;
        pos = Math.min(full, pos + v * dt);
        const next = Math.floor(pos);
        if (next !== revealedRef.current) setRevealed(next);
      } else {
        // Caught up: relax toward the floor so the next burst eases in
        // rather than opening at full sprint. No setState — no idle churn.
        v += (V_MIN - v) * alpha;
      }
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
