import { toHHMM, toMinutes, type Room } from "../domain";

const SLOT = 15;

/** Booked covers per 15-minute slot across the shift, with a marker at the room clock. */
export function CoversStrip({ room }: { room: Room }) {
  const now = toMinutes(room.clock);
  const times = room.reservations.map((r) => toMinutes(r.time));
  const start = Math.floor(Math.min(now, ...times) / SLOT) * SLOT;
  const end = times.length ? Math.max(...times) + SLOT : start + 8 * SLOT;
  const slots: { t: number; covers: number }[] = [];
  for (let t = start; t < end; t += SLOT) {
    const covers = room.reservations
      .filter((r) => toMinutes(r.time) >= t && toMinutes(r.time) < t + SLOT)
      .reduce((n, r) => n + r.partySize, 0);
    slots.push({ t, covers });
  }
  const total = room.reservations.reduce((n, r) => n + r.partySize, 0);
  const max = Math.max(1, ...slots.map((s) => s.covers));
  const markerPct = ((now - start) / (end - start)) * 100;

  return (
    <section className="covers-strip" aria-label="Booked covers per 15 minutes">
      <div className="covers-head small">
        <strong>{total} covers</strong>
        <span className="muted">
          {" "}
          booked · {toHHMM(start)}–{toHHMM(end)} · per 15 min
        </span>
      </div>
      <div className="covers-bars">
        {markerPct >= 0 && markerPct <= 100 && (
          <span
            className="covers-now"
            style={{ left: `${markerPct}%` }}
            title={`Now ${room.clock}`}
          >
            <span className="covers-now-label">{room.clock}</span>
          </span>
        )}
        {slots.map((s) => (
          <div key={s.t} className="covers-slot" title={`${toHHMM(s.t)}: ${s.covers} covers`}>
            <span className="covers-n">{s.covers || ""}</span>
            <span className="covers-bar" style={{ height: `${(s.covers / max) * 100}%` }} />
            <span className="covers-t">{s.t % 60 === 0 ? toHHMM(s.t) : ""}</span>
          </div>
        ))}
      </div>
      <table className="sr-only">
        <tbody>
          {slots.map((s) => (
            <tr key={s.t}>
              <th scope="row">{toHHMM(s.t)}</th>
              <td>{s.covers} covers</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
