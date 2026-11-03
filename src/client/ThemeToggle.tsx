import { useState } from "react";

export type Theme = "dark" | "light";
const KEY = "afp-theme";

/** The theme index.html applied before first paint (dark unless the host chose light). */
function currentTheme(): Theme {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  try {
    window.localStorage.setItem(KEY, theme);
  } catch {
    /* storage blocked: the choice lasts for this page only */
  }
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(currentTheme);
  const pick = (t: Theme) => {
    applyTheme(t);
    setTheme(t);
  };
  return (
    <div className="theme-toggle" role="group" aria-label="Theme">
      {(["dark", "light"] as const).map((t) => (
        <button key={t} type="button" aria-pressed={theme === t} onClick={() => pick(t)}>
          {t === "dark" ? "Dark" : "Light"}
        </button>
      ))}
    </div>
  );
}
