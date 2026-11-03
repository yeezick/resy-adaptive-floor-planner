import { Banner } from "./Banner";
import { EvalsPage } from "./EvalsPage/EvalsPage";
import { Link } from "./Link";
import { PlannerPage } from "./PlannerPage";
import { usePath } from "./lib/router";

export function App() {
  const path = usePath();
  return (
    <>
      <Banner />
      <header className="topbar">
        <span className="wordmark">Adaptive Floor Planner</span>
        <span className="topbar-sub">concept prototype</span>
        <nav aria-label="Main">
          <Link href="/">Floor</Link>
          <Link href="/evals">Evals</Link>
        </nav>
      </header>
      <main>{path === "/evals" ? <EvalsPage /> : <PlannerPage />}</main>
    </>
  );
}
