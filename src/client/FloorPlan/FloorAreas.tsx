import { sectionLoad, type Area, type Room } from "../../domain";
import { dividers, sectionBoxes, suites } from "./geometry";

/** Non-interactive room structure: areas, suites, divider walls and section outlines. */
export function FloorAreas({ room, openDividers }: { room: Room; openDividers: Set<string> }) {
  const walls = dividers(room);
  const openRooms = new Set(
    walls.filter((d) => openDividers.has(d.key)).flatMap((d) => d.key.split(" | ")),
  );
  return (
    <g aria-hidden="true">
      {suites(room).map((s) => (
        <g key={s.id} className="suite">
          <rect
            x={s.box.x - 0.6}
            y={s.box.y - 3}
            width={s.box.w + 1.2}
            height={s.box.h + 3.6}
            rx={0.8}
          />
          <text className="suite-label" x={s.box.x + 0.2} y={s.box.y - 1.9}>
            Private suite {s.id} · dividers open between neighbouring rooms
          </text>
        </g>
      ))}

      {room.areas.map((a) => (
        <AreaShape key={a.id} area={a} open={openRooms.has(a.name)} />
      ))}

      {sectionBoxes(room).map(({ section, box }) => (
        <g key={section} className="section">
          <rect x={box.x} y={box.y} width={box.w} height={box.h} rx={0.8} />
          <circle cx={box.x + 0.2} cy={box.y + 0.2} r={0.95} />
          <text x={box.x + 0.2} y={box.y + 0.25}>
            {section}
          </text>
          <LoadBadge room={room} section={section} x={box.x + 1.4} y={box.y + 0.2} />
        </g>
      ))}

      {walls.map((d) => (
        <line
          key={d.key}
          className={openDividers.has(d.key) ? "divider is-open" : "divider"}
          x1={d.x1}
          y1={d.y1}
          x2={d.x2}
          y2={d.y2}
        />
      ))}
    </g>
  );
}

function shortName(a: Area): string {
  return a.name;
}

function AreaShape({ area: a, open }: { area: Area; open: boolean }) {
  const cx = a.x + a.w / 2;
  const cy = a.y + a.h / 2;
  switch (a.kind) {
    case "station":
      return (
        <g className="area-station">
          <rect x={a.x} y={a.y} width={a.w} height={a.h} rx={0.8} />
          <text x={cx} y={cy - 0.4}>
            {a.name}
          </text>
          <text x={cx} y={cy + 1.2} className="area-note">
            no seating
          </text>
        </g>
      );
    case "bar":
      return (
        <g className="area-bar">
          <rect x={a.x} y={a.y} width={a.w} height={a.h} rx={0.8} />
          <rect
            className="bar-counter"
            x={a.x + 3}
            y={a.y + 3}
            width={a.w - 6}
            height={a.h - 6}
            rx={2}
          />
          <text x={cx} y={cy - 0.4}>
            {a.name}
          </text>
          <text x={cx} y={cy + 1.2} className="area-note">
            no table seating
          </text>
        </g>
      );
    case "private":
      return (
        <g className={open ? "area-private is-open" : "area-private"}>
          <rect x={a.x} y={a.y} width={a.w} height={a.h} rx={0.4} />
          <text x={a.x + 0.3} y={a.y - 0.5} className="area-label">
            {shortName(a)}
          </text>
        </g>
      );
    default:
      return (
        <g>
          <rect className="area" x={a.x} y={a.y} width={a.w} height={a.h} rx={0.6} />
          <text className="area-label" x={a.x + 0.2} y={a.y - 0.6}>
            {a.name}
          </text>
        </g>
      );
  }
}

/** Phase balance: how many tables in the section were just sat (seated or drinks). */
function LoadBadge({ room, section, x, y }: { room: Room; section: number; x: number; y: number }) {
  const n = sectionLoad(room, section);
  if (n === 0) return null;
  const text = `${n} just sat`;
  const w = text.length * 0.5 + 0.6;
  return (
    <g className={n >= 3 ? "load-badge is-heavy" : "load-badge"}>
      <rect x={x} y={y - 0.65} width={w} height={1.3} rx={0.65} />
      <text x={x + w / 2} y={y + 0.05}>
        {text}
      </text>
    </g>
  );
}
