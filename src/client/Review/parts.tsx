/** A person glyph next to the party count (decorative; the count carries the meaning). */
export function PersonIcon() {
  return (
    <svg className="person-icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <circle cx="8" cy="5" r="3" />
      <path d="M2.5 14.5c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5Z" />
    </svg>
  );
}

/** What the edits on the review screen changed, and the capacity check before → after. */
export function ReviewDiff({
  lines,
  before,
  after,
}: {
  lines: readonly string[];
  before: string;
  after: { ok: boolean; text: string };
}) {
  if (!lines.length) return null;
  return (
    <div className="review-diff small" role="status" aria-label="Your changes">
      <ul>
        {lines.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
      <p>
        <span className="muted">Capacity check: </span>
        {before} →{" "}
        <span className={`verdict ${after.ok ? "verdict-real" : "verdict-unsure"}`}>
          {after.ok ? "capacity fit ✓" : after.text}
        </span>
      </p>
    </div>
  );
}

/** Back and the one verb (no button says "Confirm"). */
export function ReviewFoot({
  onBack,
  backLabel,
  primary,
  disabled,
  title,
  onConfirm,
}: {
  onBack: () => void;
  backLabel: string;
  primary: string;
  disabled?: boolean;
  title?: string;
  onConfirm: () => void;
}) {
  return (
    <div className="review-foot btn-row">
      <button type="button" className="link-btn review-back" onClick={onBack}>
        {backLabel}
      </button>
      <span className="spacer" />
      <button
        type="button"
        className="primary review-go"
        disabled={disabled}
        title={title}
        onClick={onConfirm}
      >
        {primary}
      </button>
    </div>
  );
}
