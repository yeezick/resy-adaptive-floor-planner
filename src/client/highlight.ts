/** Tables lit up on the floor by a recommendation or build. `key` identifies the source. */
export interface Highlight {
  key: string;
  ids: string[];
  label: string;
  /** Divider walls this option opens (keys from FloorPlan/geometry dividerKey). */
  dividers?: string[];
  /**
   * "ai" = the AI Planner's output (dashed accent); "fit" = a request's proposed join (green, with readiness
   * bubbles); default = the planner's (solid neutral).
   */
  source?: "ai" | "plan" | "fit";
  /** Per-table bubble text ("now", "~25m"): readiness of a proposed join. */
  badges?: Record<string, string>;
}

export interface HighlightControls {
  pinnedKey: string | null;
  onHover: (h: Highlight | null) => void;
  onTogglePin: (h: Highlight) => void;
}
