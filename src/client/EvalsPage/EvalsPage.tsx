import { useState } from "react";
import type { EvalResults } from "../../shared/evals";
import { fetchEvalResults } from "../api";
import { pct } from "../lib/format";
import { useAsync } from "../lib/useAsync";
import { CalibrationPanel } from "./CalibrationPanel";
import { CostLatency } from "./CostLatency";
import { ScenarioTable } from "./ScenarioTable";

const loadResults = () => fetchEvalResults();

export function EvalsPage() {
  const [retry, setRetry] = useState(0);
  const result = useAsync(`evals#${retry}`, loadResults);

  return (
    <div className="evals">
      <div className="evals-head">
        <h1>Evals</h1>
        <p className="muted">
          How the seating agent scores on a fixed scenario set: deterministic assertions, an LLM
          judge checked against human labels, and what each recommendation costs.
        </p>
      </div>
      {result === undefined && <div className="state-card">Loading results…</div>}
      {result && !result.ok && result.error.code === "not_found" && (
        <div className="state-card">
          <h2>No eval run published yet</h2>
          <p className="muted">
            Results appear here once <code>evals/run.ts</code> writes{" "}
            <code>public/evals/results.json</code>.
          </p>
        </div>
      )}
      {result && !result.ok && result.error.code !== "not_found" && (
        <div className="state-card error" role="alert">
          <h2>Couldn't read the eval results</h2>
          <pre className="error-detail">{result.error.message}</pre>
          <button type="button" onClick={() => setRetry((n) => n + 1)}>
            Retry
          </button>
        </div>
      )}
      {result?.ok && <Results r={result.data} />}
    </div>
  );
}

function RunMeta({ r }: { r: EvalResults }) {
  return (
    <section className="card meta-card" aria-label="Run metadata">
      <dl className="meta">
        <Meta k="Run" v={new Date(r.runAt).toLocaleString()} />
        <Meta k="Commit" v={r.gitSha.slice(0, 7)} mono />
        <Meta k="Prompt" v={r.promptVersion} mono />
        <Meta k="Model" v={r.model} mono />
        <Meta k="Judge" v={r.judgeModel ?? "none"} mono />
        <Meta k="Mode" v={r.mode === "replay" ? "replay (recorded responses)" : "live"} />
      </dl>
    </section>
  );
}

function KnownLimits({ limits }: { limits: string[] }) {
  return (
    <section className="card" aria-label="Known limits">
      <h2 className="section-title">Known limits</h2>
      {limits.length ? (
        <ul>
          {limits.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      ) : (
        <p className="muted small">None listed.</p>
      )}
    </section>
  );
}

/** A results file with no scenarios: say so plainly instead of showing zeros. */
function NoRun({ r }: { r: EvalResults }) {
  return (
    <>
      <section className="state-card no-run" aria-label="No evaluation run yet">
        <h2>No evaluation run is published yet</h2>
        <p className="muted">
          When one is, this page shows how often the AI Planner's recommendations pass a fixed set
          of checks, what each recommendation costs and how long it takes. Until then there is
          nothing to score, so no numbers are shown.
        </p>
        <h3 className="section-title">What a run will report</h3>
        <ul className="small">
          <li>
            Pass rate on a fixed set of seating scenarios, with a 95% confidence range and the
            number of scenarios stated, so a small sample is read as a direction, not a verdict.
          </li>
          <li>
            A second opinion from an automated reviewer, counted only once it agrees closely enough
            with people who scored the same answers by hand.
          </li>
          <li>Cost and response time per recommendation.</li>
        </ul>
        <h3 className="section-title">Limits to keep in mind</h3>
        <ul className="small">
          <li>All restaurants and bookings are fictional.</li>
          <li>Meal-length timings are stated assumptions, not measurements.</li>
          <li>Checks test consistency with the floor plan, not real guest outcomes.</li>
        </ul>
        <p className="muted small">
          Configured for prompt {r.promptVersion} on {r.model}.
        </p>
      </section>
    </>
  );
}

export function Results({ r }: { r: EvalResults }) {
  const n = r.scenarios.length;
  if (n === 0) return <NoRun r={r} />;
  return (
    <>
      <RunMeta r={r} />

      <div className="evals-grid">
        <section className="card" aria-label="Pass rates">
          <h2 className="section-title">Assertion pass rate</h2>
          <div className="big-number">{pct(r.assertionPassRate)}</div>
          <div className="muted small">
            {pct(r.assertionInterval.low)}–{pct(r.assertionInterval.high)} (
            {r.assertionInterval.method})
          </div>
          <p className="n-note">
            {n} scenario{n === 1 ? "" : "s"} — small n, read as directional.
          </p>
          <h3 className="section-title">By category</h3>
          <table className="data">
            <thead>
              <tr>
                <th scope="col">Category</th>
                <th scope="col" className="num">
                  n
                </th>
                <th scope="col" className="num">
                  Pass
                </th>
                <th scope="col" aria-label="Bar" />
              </tr>
            </thead>
            <tbody>
              {r.byCategory.map((c) => (
                <tr key={c.category}>
                  <td>{c.category}</td>
                  <td className="num">{c.n}</td>
                  <td className="num">{pct(c.assertionPassRate)}</td>
                  <td className="bar-cell">
                    <span
                      className="bar"
                      style={{ width: `${Math.round(c.assertionPassRate * 100)}%` }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <CostLatency rollups={r.rollups} />
      </div>

      <div className="evals-grid">
        <section className="card" aria-label="Failure taxonomy">
          <h2 className="section-title">Failure taxonomy</h2>
          {r.failureTaxonomy.length === 0 ? (
            <p className="muted small">No failures recorded in this run.</p>
          ) : (
            <ul className="taxonomy">
              {[...r.failureTaxonomy]
                .sort((a, b) => b.count - a.count)
                .map((f) => (
                  <li key={f.mode}>
                    <div className="tax-head">
                      <strong>{f.mode}</strong>
                      <span className="pill">{f.count}</span>
                    </div>
                    <div className="muted small">e.g. {f.example}</div>
                  </li>
                ))}
            </ul>
          )}
        </section>
        <CalibrationPanel calibration={r.calibration} />
      </div>

      <ScenarioTable scenarios={r.scenarios} />

      <KnownLimits limits={r.knownLimits} />
    </>
  );
}

function Meta({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div>
      <dt>{k}</dt>
      <dd className={mono ? "mono" : undefined}>{v}</dd>
    </div>
  );
}
