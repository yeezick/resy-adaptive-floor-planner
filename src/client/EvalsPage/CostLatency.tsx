import type { Rollups } from "../../shared/evals";
import { duration, pct, usd } from "../lib/format";

export function CostLatency({ rollups: r }: { rollups: Rollups }) {
  const total = r.spendUsd.total || r.spendUsd.agent + r.spendUsd.judge;
  const agentShare = total > 0 ? r.spendUsd.agent / total : 0;
  return (
    <section className="card" aria-label="Cost and latency">
      <h2 className="section-title">Cost &amp; latency</h2>
      <div className="stat-grid">
        <Tile label="$ per recommendation" value={usd(r.costPerRecommendationUsd)} />
        <Tile label="Projected $ / 1,000" value={usd(r.projectedUsdPer1000, 2)} />
        <Tile label="Latency p50" value={duration(r.latencyP50Ms)} />
        <Tile label="Latency p95" value={duration(r.latencyP95Ms)} />
        <Tile label="Avg tool turns" value={r.avgToolTurns.toFixed(1)} />
        <Tile
          label="Validator rejects"
          value={pct(r.validatorRejectRate, 1)}
          hint="per recommendation"
        />
      </div>
      <h3 className="section-title">Spend split</h3>
      <div
        className="split-bar"
        role="img"
        aria-label={`Agent ${usd(r.spendUsd.agent)}, judge ${usd(r.spendUsd.judge)}`}
      >
        <span className="split-agent" style={{ width: `${agentShare * 100}%` }} />
        <span className="split-judge" style={{ width: `${(1 - agentShare) * 100}%` }} />
      </div>
      <div className="split-legend small">
        <span>
          <span className="dot dot-agent" /> Agent {usd(r.spendUsd.agent)}
        </span>
        <span>
          <span className="dot dot-judge" /> Judge {usd(r.spendUsd.judge)}
        </span>
        <span className="muted">Total {usd(total)}</span>
      </div>
      <p className="muted small">Based on {r.recommendations} recommendations in this run.</p>
    </section>
  );
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="stat">
      <div className="stat-value">{value}</div>
      <div className="stat-label">
        {label}
        {hint && <span className="muted"> · {hint}</span>}
      </div>
    </div>
  );
}
