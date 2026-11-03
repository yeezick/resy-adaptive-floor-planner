// Human labels for the fixture nights (the night picker in the console bar). Fictional venue.
export const NIGHTS: Record<string, { day: string; label: string }> = {
  "dinner-peak": { day: "Fri", label: "Fri · live service 19:10" },
  "book-thu": { day: "Thu", label: "Thu · planning from 15:00" },
  "book-fri": { day: "Fri", label: "Fri · planning from 15:00" },
  "demo-night": { day: "Sat", label: "Sat · demo night from 15:00" },
  "next-day": { day: "Sat", label: "Sat · empty room, next day" },
  "heavy-saturday": { day: "Sat", label: "Sat · overbooked (stress test)" },
};

export function nightLabel(id: string, clock: string): string {
  return NIGHTS[id]?.label ?? `${id}${clock ? ` · ${clock}` : ""}`;
}
