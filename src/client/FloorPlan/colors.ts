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
    fill: v("table-reserved-fill"),
    stroke: v("table-reserved-stroke"),
    text: v("table-reserved-ink"),
  },
  blocked: {
    fill: "url(#hatch)",
    stroke: v("table-blocked-stroke"),
    text: v("table-blocked-ink"),
  },
} as const;

export function tableColors(t: Table): { fill: string; stroke: string; text: string } {
  if (t.status === "occupied") {
    const phase = t.phase ?? "seated";
    return { fill: phaseFill(phase), stroke: v("phase-stroke"), text: phaseInk(phase) };
  }
  return STATUS_STYLE[t.status];
}
