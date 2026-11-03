import { activeScenario, SCENARIOS, scenarioUrl } from "./scenarios";

/**
 * Header menu of named demo states. Each is a plain link to a stable URL, so a full page load always starts
 * from the same fixture state (shareable, deterministic, no model call).
 */
export function ScenarioMenu() {
  const current = activeScenario();
  return (
    <details className="scenario-menu">
      <summary>Scenarios{current ? <span className="muted"> · {current.id}</span> : null}</summary>
      <ul role="list" aria-label="Demo scenarios">
        {SCENARIOS.map((s, i) => (
          <li key={s.id}>
            <a href={scenarioUrl(s.id)} aria-current={current?.id === s.id ? "page" : undefined}>
              <span className="scenario-n">{i + 1}</span>
              <span>
                {s.title}
                <span className="mono muted small"> {scenarioUrl(s.id)}</span>
              </span>
            </a>
          </li>
        ))}
        <li>
          <a href="/">Clear · start from the live demo</a>
        </li>
      </ul>
    </details>
  );
}
