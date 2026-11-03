import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { activeScenario } from "./scenarios";
import "./styles.css";

// A scenario that lives on another page (e.g. the activity log) opens there from /?scenario=….
const sc = activeScenario();
if (sc?.path && window.location.pathname === "/")
  window.history.replaceState(null, "", `${sc.path}${window.location.search}`);

const root = document.getElementById("root");
if (!root) throw new Error("missing #root");
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
