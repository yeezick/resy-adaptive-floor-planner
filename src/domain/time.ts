export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export function toHHMM(minutes: number): string {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** A 24-hour "HH:MM" as a manager reads it: "17:00" → "5:00 PM". Anything else is returned unchanged. */
export function clock12(hhmm: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return hhmm;
  const h = Number(m[1]);
  return `${h % 12 === 0 ? 12 : h % 12}:${m[2]} ${h < 12 ? "AM" : "PM"}`;
}

const T = String.raw`(?<![\d:])([01]?\d|2[0-3]):([0-5]\d)(?![\d:])`;
/** One time, or a range of two ("16:30–18:00"), matched in a single pass so output is never re-read. */
const TIMES = new RegExp(`${T}(?:\\s?[–-]\\s?${T})?`, "g");

/**
 * Every 24-hour time inside a display string, as 12-hour AM/PM ("held 16:30–18:00" → "held 4:30–6:00 PM").
 * The domain, the API and the evals keep "HH:MM"; this runs only where a person reads the text.
 */
export function times12(text: string): string {
  return text.replace(TIMES, (_, h1: string, m1: string, h2?: string, m2?: string) => {
    const a = clock12(`${h1}:${m1}`);
    if (h2 === undefined || m2 === undefined) return a;
    const b = clock12(`${h2}:${m2}`);
    return a.slice(-2) === b.slice(-2) ? `${a.slice(0, -3)}–${b}` : `${a}–${b}`;
  });
}
