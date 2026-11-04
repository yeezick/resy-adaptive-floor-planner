import type { ReactNode } from "react";
import { clock12, toMinutes, type Room } from "../domain";
import { planHolds } from "./lib/holds";
import { NIGHTS } from "./nights";
import { decisionOf, useRequests, type RequestsState } from "./requests/store";

export type PanelMode = "details" | "walkin" | "assistant" | "shift" | "reservation" | "request";

interface Props {
  room: Room;
  roomSelect: ReactNode;
  layoutName: string;
  edited: boolean;
  mode: PanelMode;
  onMode: (m: PanelMode) => void;
  onReset: () => void;
}

function todayLabel(): string {
  return new Date().toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

export function roomCounts(room: Room) {
  const occupied = room.tables.filter((t) => t.status === "occupied");
  const inService = room.tables.filter((t) => t.status !== "blocked");
  // A party on combined tables is counted once (largest recorded party size in the combo).
  const parties = new Map<string, number>();
  for (const t of occupied) {
    const key = room.combos.find((c) => c.includes(t.id))?.join("+") ?? t.id;
    parties.set(key, Math.max(parties.get(key) ?? 0, t.partySize ?? t.seats));
  }
  return {
    covers: [...parties.values()].reduce((n, p) => n + p, 0),
    seatsInService: inService.reduce((n, t) => n + t.seats, 0),
    seatedTables: occupied.length,
    open: room.tables.filter((t) => t.status === "open").length,
    held: room.tables.filter((t) => t.status === "reserved").length,
    inService: inService.length,
  };
}

/**
 * Tables held on this night: reserved in the room plus every table an accepted large-party plan holds for it
 * (counted once).
 */
export function heldCount(room: Room, s: Pick<RequestsState, "book" | "decisions">): number {
  const ids = new Set(room.tables.filter((t) => t.status === "reserved").map((t) => t.id));
  for (const r of s.book?.requests ?? []) {
    if (r.bookRoomId !== room.id) continue;
    const d = decisionOf(s, r.id);
    if (d.kind === "accepted") for (const id of d.tables) ids.add(id);
  }
  return ids.size;
}

export function ConsoleBar({ room, roomSelect, layoutName, edited, mode, onMode, onReset }: Props) {
  const c = roomCounts(room);
  const reqs = useRequests();
  const held = heldCount(room, reqs);
  // holds that start later tonight say when (planning clock): "9 from 5:00 PM"
  const holdStarts = [...planHolds(room, reqs).values()].map((h) => h.from).sort();
  const firstHold = holdStarts[0];
  const heldText =
    firstHold && toMinutes(firstHold) > toMinutes(room.clock)
      ? `${held} from ${clock12(firstHold)}`
      : String(held);
  return (
    <div className="console-bar">
      <div className="cb-room">
        <div className="cb-title">
          <h1 className="room-name" title={room.name}>
            {room.name.replace(/\s*\(fictional\)$/, "")}
          </h1>
          <div className="cb-sub" title={`Layout in use: ${layoutName} — change it in Shift setup`}>
            {NIGHTS[room.id] ? (
              <span>{NIGHTS[room.id]?.day}</span>
            ) : (
              <time dateTime={new Date().toLocaleDateString("en-CA")}>{todayLabel()}</time>
            )}{" "}
            · {layoutName}
          </div>
        </div>
        {roomSelect}
      </div>
      <div className="cb-clock" aria-label={`Service clock ${clock12(room.clock)}`}>
        {clock12(room.clock)}
      </div>
      <dl className="cb-stats">
        <Stat k="Covers seated" v={c.covers} />
        <Stat k="Tables seated" v={c.seatedTables} />
        <Stat k="Open tables" v={`${c.open} of ${room.tables.length}`} />
        <Stat k="Held" v={heldText} />
      </dl>
      <div className="cb-actions" role="group" aria-label="Host actions">
        <button
          type="button"

          aria-pressed={mode === "walkin"}
          onClick={() => onMode("walkin")}
        >
          + Walk-in
        </button>
        <button type="button" aria-pressed={mode === "shift"} onClick={() => onMode("shift")}>
          Shift setup
        </button>
        <button
          type="button"
          aria-pressed={mode === "assistant"}
          onClick={() => onMode("assistant")}
        >
          AI Planner
        </button>
      </div>
      <div className="cb-right">
        {edited && (
          <span className="pill pill-accent" title="The AI Planner sees your current layout">
            Edited
          </span>
        )}
        {edited && (
          <button type="button" onClick={onReset}>
            Reset
          </button>
        )}
      </div>
    </div>
  );
}

function Stat({ k, v }: { k: string; v: string | number }) {
  return (
    <div>
      <dt>{k}</dt>
      <dd>{v}</dd>
    </div>
  );
}
