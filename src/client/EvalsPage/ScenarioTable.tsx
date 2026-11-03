import type { ScenarioResult } from "../../shared/evals";
import { duration, usd } from "../lib/format";

function Verdict({ pass, title }: { pass: boolean | null; title?: string }) {
  if (pass === null) return <span className="muted">—</span>;
  return (
    <span className={`pill ${pass ? "pill-ok" : "pill-fail"}`} title={title}>
      {pass ? "pass" : "fail"}
    </span>
  );
}

export function ScenarioTable({ scenarios }: { scenarios: ScenarioResult[] }) {
  return (
    <section className="card" aria-label="Scenarios">
      <h2 className="section-title">Scenarios</h2>
      <div className="table-scroll">
        <table className="data">
          <thead>
            <tr>
              <th scope="col">Scenario</th>
              <th scope="col">Category</th>
              <th scope="col">Assertions</th>
              <th scope="col">Judge</th>
              <th scope="col">Human</th>
              <th scope="col">Failure modes</th>
              <th scope="col" className="num">
                Latency
              </th>
              <th scope="col" className="num">
                Cost
              </th>
            </tr>
          </thead>
          <tbody>
            {scenarios.map((s) => {
              const asserts = Object.entries(s.assertions);
              const passed = asserts.filter(([, v]) => v).length;
              const failed = asserts.filter(([, v]) => !v).map(([k]) => k);
              return (
                <tr key={s.id}>
                  <th scope="row" title={s.prompt}>
                    <span className="mono">{s.id}</span>
                    <div className="muted small clamp">{s.prompt}</div>
                  </th>
                  <td>{s.category}</td>
                  <td>
                    <Verdict
                      pass={s.assertionsPass}
                      title={failed.length ? `failed: ${failed.join(", ")}` : undefined}
                    />
                    <span className="muted small">
                      {" "}
                      {passed}/{asserts.length}
                    </span>
                  </td>
                  <td>
                    <Verdict pass={s.judge?.pass ?? null} title={s.judge?.critique} />
                  </td>
                  <td>
                    <Verdict pass={s.human?.pass ?? null} title={s.human?.reason} />
                  </td>
                  <td className="small">
                    {s.failureModes.length ? (
                      s.failureModes.join(", ")
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td className="num">{duration(s.latencyMs)}</td>
                  <td className="num">{usd(s.costUsd)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
