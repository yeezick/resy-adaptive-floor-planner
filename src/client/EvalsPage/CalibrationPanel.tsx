import type { Calibration } from "../../shared/evals";
import { pct } from "../lib/format";

export function CalibrationPanel({ calibration: c }: { calibration: Calibration | null }) {
  return (
    <section className="card" aria-label="Judge calibration">
      <h2 className="section-title">Judge calibration</h2>
      {!c ? (
        <div className="empty small">
          <strong>Judge not yet calibrated.</strong>
          <p className="muted">
            Judge verdicts are shown per scenario but not trusted until compared against human
            labels.
          </p>
        </div>
      ) : (
        <>
          <div className="badges">
            <span className={`pill ${c.trusted ? "pill-ok" : "pill-warn"}`}>
              {c.trusted ? "Trusted" : "Untrusted"}
            </span>
            <span className="muted small">needs TPR and TNR ≥ {pct(c.threshold)}</span>
            {c.stale && (
              <span
                className="pill pill-warn"
                title="Prompt version or model changed since calibration"
              >
                Stale
              </span>
            )}
          </div>
          <dl className="kv">
            <dt>Human labels (n)</dt>
            <dd>{c.n}</dd>
            <dt>TPR</dt>
            <dd>
              {pct(c.tpr)} <span className="muted small">judge passes what humans pass</span>
            </dd>
            <dt>TNR</dt>
            <dd>
              {pct(c.tnr)} <span className="muted small">judge fails what humans fail</span>
            </dd>
            <dt>Raw agreement</dt>
            <dd>{pct(c.rawAgreement)}</dd>
            <dt>Observed pass</dt>
            <dd>{pct(c.observedPassRate)}</dd>
            <dt>Corrected pass</dt>
            <dd>
              {pct(c.correctedPassRate)}
              {c.correctedInterval && (
                <span className="muted small">
                  {" "}
                  ({pct(c.correctedInterval.low)}–{pct(c.correctedInterval.high)},{" "}
                  {c.correctedInterval.method})
                </span>
              )}
            </dd>
          </dl>
          {c.stale && (
            <p className="warn-text small">
              The prompt or model changed since calibration — re-run calibration before trusting the
              judge.
            </p>
          )}
        </>
      )}
    </section>
  );
}
