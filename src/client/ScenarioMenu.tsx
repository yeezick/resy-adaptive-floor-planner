import { useEffect, useRef } from "react";
import { activeScenario, SCENARIOS, scenarioUrl } from "./scenarios";

/**
 * Header menu of named demo states. Each is a plain link to a stable URL, so a full page load always starts
 * from the same fixture state (shareable, deterministic, no model call).
 */
export function ScenarioMenu() {
  const current = activeScenario();
  const ref = useRef<HTMLDetailsElement>(null);
  // a tap outside or Escape closes the menu (it opens over the floor)
  useEffect(() => {
    const close = (e: Event) => {
      const el = ref.current;
      if (!el?.open) return;
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !el.contains(e.target as Node))
        el.open = false;
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, []);
  return (
    <details className="scenario-menu" ref={ref}>
      <summary>
        Scenarios
        {current ? <span className="sr-only"> · {current.title}</span> : null}{" "}
        <span aria-hidden="true">▾</span>
      </summary>
      <ul role="list" aria-label="Demo scenarios">
        {SCENARIOS.map((s, i) => (
          <li key={s.id}>
            <a href={scenarioUrl(s.id)} aria-current={current?.id === s.id ? "page" : undefined}>
              <span className="scenario-n">{i + 1}</span>
              <span>{s.title}</span>
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
