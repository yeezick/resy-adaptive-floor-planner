import type { Phase, Table } from "../../domain";

/**
 * Table colours as CSS custom properties, so they follow the active theme (see styles.css).
 * Apply them through `style={{ fill, stroke }}`: `var()` is not reliable in SVG presentation attributes.
 */
const v = (token: string) => `var(--${token})`;

/** Occupied tables: dark = just sat (long wait), light = on the check (about to free). */
export function phaseFill(phase: Phase): string {
  return v(`phase-${phase}`);
}

/** Text on a phase fill; each theme pairs every ramp step with an ink that passes AA. */
export function phaseInk(phase: Phase): string {
  return v(`phase-${phase}-ink`);
}

export const STATUS_STYLE = {
  open: {
    fill: v("table-open-fill"),
    stroke: v("table-open-stroke"),
    text: v("table-open-ink"),
  },
  reserved: {
    fill: v("table-open-fill"),
    stroke: v("border-strong"),
    text: v("table-open-ink"),
  },
  blocked: {
    fill: "url(#hatch)",
    stroke: v("table-blocked-stroke"),
    text: v("table-blocked-ink"),
  },
} as const;

/** Dessert and Check: the table is about to free (amber = needs attention). */
export const LATE_PHASES: readonly Phase[] = ["dessert", "check"];

/**
 * Seated tables are graphite with the phase as a word and a thin bar; only about-to-free phases are amber.
 * Open tables keep a green outline; reserved tables are neutral (held).
 */
export function tableColors(t: Table): { fill: string; stroke: string; text: string } {
  if (t.status === "occupied") {
    const late = LATE_PHASES.includes(t.phase ?? "seated");
    return {
      fill: v("tile-busy"),
      stroke: late ? v("phase-bar-late") : v("tile-busy-edge"),
      text: v("tile-busy-ink"),
    };
  }
  return STATUS_STYLE[t.status];
}

/** The 3 px phase bar along a seated tile's top edge. */
export function phaseBar(phase: Phase): string {
  return LATE_PHASES.includes(phase) ? v("phase-bar-late") : v("phase-bar");
}
