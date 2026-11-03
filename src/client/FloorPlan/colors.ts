import { PHASES, type Phase, type Table } from "../../domain";

/** Occupied tables: dark = just sat (long wait), light = on the check (about to free). */
export const PHASE_FILL: Record<Phase, string> = {
  seated: "#1b3a57",
  drinks: "#1f6a80",
  appetizers: "#28856d",
  entrees: "#8cc36a",
  dessert: "#d8d47a",
  check: "#ecf3d6",
};

export const STATUS_STYLE = {
  open: { fill: "#ffffff", stroke: "#3f8f5a", text: "#1d2327" },
  reserved: { fill: "#fbefd2", stroke: "#b98a2a", text: "#4a3812" },
  blocked: { fill: "url(#hatch)", stroke: "#9aa0a6", text: "#5f6368" },
} as const;

export function tableColors(t: Table): { fill: string; stroke: string; text: string } {
  if (t.status === "occupied") {
    const phase = t.phase ?? "seated";
    const dark = PHASES.indexOf(phase) < 3;
    return { fill: PHASE_FILL[phase], stroke: "#18303f", text: dark ? "#ffffff" : "#13262d" };
  }
  return STATUS_STYLE[t.status];
}
