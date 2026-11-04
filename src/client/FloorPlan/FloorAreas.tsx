import { sectionLoad, type Area, type Room } from "../../domain";
import { dividers, sectionBoxes, suites, type Box } from "./geometry";
import { usePx } from "./scale";

const CHAR_W = 0.58;

/** Non-interactive room structure: areas, suites, divider walls and section outlines. */
export function FloorAreas({
  room,
  openDividers,
  view,
}: {
  room: Room;
  openDividers: Set<string>;
  /** The part of the floor on screen: a room name that would be cut off at its edge moves or is left out. */
  view?: Box;
}) {
  const px = usePx();
  const caption = Math.max(1.15, px(11));
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
            y={s.box.y - caption - 1.2}
            width={s.box.w + 1.2}
            height={s.box.h + caption + 1.8}
            rx={0.8}
          />
          <text className="suite-label" x={s.box.x + 0.2} y={s.box.y - 0.6} fontSize={caption}>
            {s.id} suite
          </text>
        </g>
      ))}

      {room.areas.map((a) => (
        <AreaShape key={a.id} area={a} open={openRooms.has(a.name)} caption={caption} view={view} />
      ))}

      {sectionBoxes(room).map(({ section, box }) => {
        const r = Math.max(0.95, px(10));
        return (
          <g key={section} className="section">
            <rect x={box.x} y={box.y} width={box.w} height={box.h} rx={0.8} />
            {/* number and "just sat" sit on the line above the outline, clear of the tables */}
            <circle cx={box.x + r} cy={box.y - r + 0.2} r={r} />
            <text x={box.x + r} y={box.y - r + 0.25} fontSize={Math.max(1.05, px(11))}>
              {section}
            </text>
            <LoadBadge room={room} section={section} x={box.x + 2 * r + 0.4} y={box.y - r + 0.2} />
          </g>
        );
      })}

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

function AreaShape({
  area: a,
  open,
  caption,
  view,
}: {
  area: Area;
  open: boolean;
  caption: number;
  view?: Box;
}) {
  const cx = a.x + a.w / 2;
  const cy = a.y + a.h / 2;
  const fits = (text: string) => text.length * CHAR_W * caption < a.w - 1;
  switch (a.kind) {
    case "station":
    case "bar":
      return (
        <g className={a.kind === "bar" ? "area-bar" : "area-station"}>
          <rect x={a.x} y={a.y} width={a.w} height={a.h} rx={0.8} />
          {a.kind === "bar" && (
            <rect
              className="bar-counter"
              x={a.x + 2}
              y={a.y + 2}
              width={a.w - 4}
              height={a.h - 4}
              rx={1.5}
            />
          )}
          <text x={cx} y={cy - caption * 0.15} fontSize={caption}>
            {a.name}
          </text>
          {fits("no table seating") && (
            <text x={cx} y={cy + caption * 1.05} className="area-note" fontSize={caption * 0.9}>
              {a.kind === "bar" ? "no table seating" : "no seating"}
            </text>
          )}
        </g>
      );
    case "private":
      return (
        <g className={open ? "area-private is-open" : "area-private"}>
          <rect x={a.x} y={a.y} width={a.w} height={a.h} rx={0.4} />
          <text
            x={a.x + a.w + 0.8}
            y={a.y + a.h / 2}
            className="area-label room-label"
            fontSize={caption}
          >
            {a.name}
          </text>
        </g>
      );
    default: {
      const labelY = areaLabelY(a, caption, view);
      return (
        <g>
          <rect className="area" x={a.x} y={a.y} width={a.w} height={a.h} rx={0.6} />
          {labelY !== null && (
            <text className="area-label" x={a.x + 0.2} y={labelY} fontSize={caption}>
              {a.name}
            </text>
          )}
        </g>
      );
    }
  }
}

/** Phase balance: how many tables in the section were just sat (seated or drinks). */
function LoadBadge({ room, section, x, y }: { room: Room; section: number; x: number; y: number }) {
  const px = usePx();
  const n = sectionLoad(room, section);
  if (n === 0) return null;
  const text = `${n} just sat`;
  const font = Math.max(0.8, px(11));
  const h = font * 1.45;
  const w = text.length * CHAR_W * font + font;
  return (
    <g className={n >= 3 ? "load-badge is-heavy" : "load-badge"}>
      <rect x={x} y={y - h / 2} width={w} height={h} rx={h / 2} />
      <text x={x + w / 2} y={y + font * 0.05} fontSize={font}>
        {text}
      </text>
    </g>
  );
}

/**
 * Where a room's name goes: just above the room, else just inside its top edge, whichever is wholly on screen;
 * null when neither is (a room peeking in at the edge of another room's view shows no cut-off name).
 */
export function areaLabelY(a: Area, caption: number, view?: Box): number | null {
  const above = a.y - 0.6;
  if (!view) return above;
  const fits = (baseline: number) =>
    baseline - caption * 0.85 >= view.y && baseline + caption * 0.3 <= view.y + view.h;
  if (fits(above)) return above;
  const inside = a.y + 0.4 + caption * 0.85;
  if (inside + caption * 0.3 <= a.y + a.h && fits(inside)) return inside;
  return null;
}
