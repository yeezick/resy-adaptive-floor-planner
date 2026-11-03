/** Tables lit up on the floor by a recommendation or build. `key` identifies the source. */
export interface Highlight {
  key: string;
  ids: string[];
  label: string;
  /** Divider walls this option opens (keys from FloorPlan/geometry dividerKey). */
  dividers?: string[];
  /** "ai" = the assistant's output (dashed accent); default = the planner's (solid neutral). */
  source?: "ai" | "plan";
}

export interface HighlightControls {
  pinnedKey: string | null;
  onHover: (h: Highlight | null) => void;
  onTogglePin: (h: Highlight) => void;
}
