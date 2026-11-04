// The demo clock: the floor clock of the night on screen, in the fictional demo week. Every stamp the demo
// writes (decisions, replies, chat turns, activity rows) reads this clock, never the wall clock, so a decision
// made on the Friday planning floor reads "Fri 3:00 PM" whatever day the demo is opened.
import { DEMO_WEEK_ISO } from "../../domain/requests";
import { toMinutes } from "../../domain/time";
import { NIGHTS } from "../nights";

type Day = keyof typeof DEMO_WEEK_ISO;
const DAYS: Day[] = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Before any floor opens (e.g. /activity first): the default night, the live service. */
let night: { day: Day; clock: string } = { day: "Wed", clock: "19:10" };
/** Orders stamps taken at the same demo minute (ms past the minute; never shown). */
let tick = 0;

/** The planner calls this when a night opens. Nights with no weekday (e.g. a custom room) keep the last one. */
export function setDemoNight(roomId: string, clock: string): void {
  const day = NIGHTS[roomId]?.day as Day | undefined;
  if (day && DAYS.includes(day) && /^\d\d:\d\d$/.test(clock)) night = { day, clock };
}

export function demoNow(): { day: Day; clock: string } {
  return night;
}

/** "Fri 15:00" + its ISO time in the demo week, for a manager action taken now. */
export function demoStamp(): { at: string; iso: string } {
  const base = new Date(`${DEMO_WEEK_ISO[night.day]}T${night.clock}:00`);
  tick = (tick + 1) % 1000;
  return { at: `${night.day} ${night.clock}`, iso: new Date(base.getTime() + tick).toISOString() };
}

/** A "Tue 09:12" label from the fixtures as an ISO time in the demo week. */
export function demoIso(label: string): string {
  const [day, hm] = label.split(" ");
  const d = DAYS.includes(day as Day) ? (day as Day) : night.day;
  return new Date(`${DEMO_WEEK_ISO[d]}T${hm ?? "00:00"}:00`).toISOString();
}

/** True when a "Fri 14:40" label is at or before the night's clock ("Wed 19:10" → false). */
export function receivedBy(label: string, day: string, clock: string): boolean {
  const [d, hm] = label.split(" ");
  const a = DAYS.indexOf(d as Day);
  const b = DAYS.indexOf(day as Day);
  if (a < 0 || b < 0) return true;
  return a < b || (a === b && toMinutes(hm ?? "00:00") <= toMinutes(clock));
}

/** Tests only. */
export function resetDemoClock(): void {
  night = { day: "Wed", clock: "19:10" };
  tick = 0;
}
