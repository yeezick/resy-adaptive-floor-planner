import { useEffect, useState } from "react";

// The demo clock: each night's fixture clock, advanced by the minutes since the page loaded, so a countdown
// like "(in 2h 10m)" ticks down live. Opening a page always starts from the fixture clock (deterministic).
const loadedAt = Date.now();

/** Whole minutes since the page loaded; re-renders about every 15 s. */
export function useElapsedMinutes(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, []);
  return Math.floor((now - loadedAt) / 60_000);
}
