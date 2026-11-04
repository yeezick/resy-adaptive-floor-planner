// Human labels for the fixture nights (the night picker in the console bar). Fictional venue.
import { clock12 } from "../domain/time";
export const NIGHTS: Record<string, { day: string; label: string }> = {
  "dinner-peak": { day: "Fri", label: "Fri · live service 7:10 PM" },
  "book-thu": { day: "Thu", label: "Thu · planning from 3:00 PM" },
  "book-fri": { day: "Fri", label: "Fri · planning from 3:00 PM" },
  "demo-night": { day: "Sat", label: "Sat · planning from 3:00 PM" },
  "next-day": { day: "Sat", label: "Sat · next-day setup from 3:00 PM" },
  "heavy-saturday": { day: "Sat", label: "Sat · overbooked · planning from 3:00 PM" },
};

export function nightLabel(id: string, clock: string): string {
  return NIGHTS[id]?.label ?? `${id}${clock ? ` · ${clock12(clock)}` : ""}`;
}
