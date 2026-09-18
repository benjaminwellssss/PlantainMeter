import { useState, useLayoutEffect, type RefObject } from "react";

/**
 * The whole channel row is one proportional system built from a single unit:
 * the width of one fader/knob control. Outer margins (all 4 sides) are
 * `marginMultiplier` units; the gap between controls is `gapMultiplier`
 * units — both user-adjustable (see the sliders in App.tsx), defaulting to
 * 1 and 0.5. Everything scales together as the window resizes instead of
 * being tuned by hand with independent clamp() values that drift out of
 * sync with each other.
 *
 * Solving "N controls + (N-1) gaps + 2 margins = available width" for the unit:
 *   available = N*u + (N-1)*gapMul*u + 2*marginMul*u
 *             = u * (N + (N-1)*gapMul + 2*marginMul)
 *   u = available / (N + (N-1)*gapMul + 2*marginMul)
 */
export function useControlUnit(
  containerRef: RefObject<HTMLElement | null>,
  count: number,
  minUnit: number,
  maxUnit: number,
  gapMultiplier: number,
  marginMultiplier: number,
): number {
  const [unit, setUnit] = useState(minUnit);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const compute = (width: number) => {
      const n = Math.max(count, 1);
      const denom = n + (n - 1) * gapMultiplier + 2 * marginMultiplier;
      const raw = width / Math.max(denom, 0.01);
      setUnit(Math.min(maxUnit, Math.max(minUnit, raw)));
    };

    compute(el.clientWidth);

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        compute(entry.contentRect.width);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [containerRef, count, minUnit, maxUnit, gapMultiplier, marginMultiplier]);

  return unit;
}

/** Same formula as the hook above, for computing the enforced window minimum. */
export function minWidthForUnit(
  count: number,
  unitMin: number,
  gapMultiplier: number,
  marginMultiplier: number,
): number {
  const n = Math.max(count, 1);
  return unitMin * (n + (n - 1) * gapMultiplier + 2 * marginMultiplier);
}
