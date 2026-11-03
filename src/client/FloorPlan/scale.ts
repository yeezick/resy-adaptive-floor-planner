import { createContext, useContext, useEffect, useState, type RefObject } from "react";
import type { Box } from "./geometry";

/** The editor always labels every table, whatever the zoom. */
export const AlwaysShowIds = createContext(false);

/** Screen pixels per grid unit for the current floor view (after fit and zoom). */
export const PxPerUnit = createContext(8);

/** Convert a size in screen pixels to grid units, so labels keep a minimum on-screen size. */
export function usePx(): (px: number) => number {
  const ppu = useContext(PxPerUnit);
  return (px) => px / ppu;
}

export function usePpu(): number {
  return useContext(PxPerUnit);
}

/** Measure the rendered SVG to know how big one grid unit is on screen. */
export function useMeasuredPpu(ref: RefObject<SVGSVGElement | null>, box: Box): number {
  const [ppu, setPpu] = useState(8);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      if (r.width && r.height) setPpu(Math.min(r.width / box.w, r.height / box.h));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, box.w, box.h]);
  return ppu;
}
