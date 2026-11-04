import { Thumb } from "./Thumb";
import { DEMO_MANAGER, feedbackOf } from "../../domain/feedback";
import { activityActions, FEEDBACK_REASONS, useFeedback, useFeedbackReasons } from "./store";

/**
 * 👍 / 👎 next to one AI output (triage, AI Planner answer). Voluntary and non-blocking; a 👎 offers optional
 * reason chips. Saved to the activity log row of the same AI action.
 */
export function SourceFeedback({
  rowId,
  what,
  compact = false,
}: {
  rowId: string;
  what: string;
  /** In a card header: thumbs only; reason chips drop to their own line. */
  compact?: boolean;
}) {
  const fb = feedbackOf(useFeedback(), rowId, DEMO_MANAGER);
  const reasons = useFeedbackReasons()[rowId] ?? [];
  return (
    <div
      className={`source-fb small${compact ? " is-compact" : ""}`}
      role="group"
      aria-label={`Rate this ${what}`}
    >
      <button
        type="button"
        className={`fb-thumb${fb?.rating === "up" ? " is-on" : ""}`}
        aria-pressed={fb?.rating === "up"}
        aria-label="Helpful"
        title="Helpful"
        onClick={() => activityActions.rate(rowId, "up")}
      >
        <Thumb />
      </button>
      <button
        type="button"
        className={`fb-thumb${fb?.rating === "down" ? " is-on" : ""}`}
        aria-pressed={fb?.rating === "down"}
        aria-label="Not helpful"
        title="Not helpful"
        onClick={() => activityActions.rate(rowId, "down")}
      >
        <Thumb down />
      </button>
      {fb?.rating === "down" && (
        <span className="fb-reasons">
          {FEEDBACK_REASONS.map((r) => (
            <button
              key={r}
              type="button"
              className="chip"
              aria-pressed={reasons.includes(r)}
              onClick={() => activityActions.toggleReason(rowId, r)}
            >
              {r}
            </button>
          ))}
        </span>
      )}
      {fb && !compact && <span className="muted">Saved to this log only (prototype).</span>}
    </div>
  );
}
