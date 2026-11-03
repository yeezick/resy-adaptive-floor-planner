import type { KeyboardEvent, PointerEvent } from "react";
import { PHASES, type Table } from "../../domain";
import { tableColors } from "./colors";

interface Props {
  table: Table;
  selected: boolean;
  lit: boolean;
  dim: boolean;
  dragging: boolean;
  onPointerDown: (e: PointerEvent<SVGGElement>) => void;
  onPointerMove: (e: PointerEvent<SVGGElement>) => void;
  onPointerUp: (e: PointerEvent<SVGGElement>) => void;
  onPointerCancel: () => void;
  onKeyDown: (e: KeyboardEvent<SVGGElement>) => void;
}

function describe(t: Table): string {
  const state =
    t.status === "occupied"
      ? `occupied, ${t.phase ?? "seated"}${t.partySize ? `, party of ${t.partySize}` : ""}`
      : t.status === "reserved"
        ? `reserved for ${t.reservedAt ?? "later"}`
        : t.status;
  const shape = t.shape === "diamond" ? "diamond (square at 45°)" : t.shape;
  return `Table ${t.id}, ${t.seats} seats, ${shape}, ${t.area}, section ${t.section}, ${state}`;
}

function diamond(cx: number, cy: number, rx: number, ry: number): string {
  return `${cx},${cy - ry} ${cx + rx},${cy} ${cx},${cy + ry} ${cx - rx},${cy}`;
}

export function TableShape({ table: t, selected, lit, dim, dragging, ...handlers }: Props) {
  const c = tableColors(t);
  const cx = t.x + t.w / 2;
  const cy = t.y + t.h / 2;
  const size = Math.min(t.w, t.h);
  const idSize = Math.min(1.5, Math.max(0.95, size * 0.3));
  const seatSize = idSize * 0.7;
  const cls = [
    "table",
    selected && "is-selected",
    lit && "is-lit",
    dim && "is-dim",
    dragging && "is-dragging",
  ]
    .filter(Boolean)
    .join(" ");
  const g = 0.5; // ring gap

  let body;
  let ring;
  if (t.shape === "round") {
    body = <ellipse cx={cx} cy={cy} rx={t.w / 2} ry={t.h / 2} fill={c.fill} stroke={c.stroke} />;
    ring = <ellipse className="ring" cx={cx} cy={cy} rx={t.w / 2 + g} ry={t.h / 2 + g} />;
  } else if (t.shape === "diamond") {
    body = <polygon points={diamond(cx, cy, t.w / 2, t.h / 2)} fill={c.fill} stroke={c.stroke} />;
    ring = (
      <polygon className="ring" points={diamond(cx, cy, t.w / 2 + g * 1.4, t.h / 2 + g * 1.4)} />
    );
  } else {
    body = (
      <rect
        x={t.x}
        y={t.y}
        width={t.w}
        height={t.h}
        rx={t.shape === "booth" ? 0.9 : 0.3}
        fill={c.fill}
        stroke={c.stroke}
      />
    );
    ring = (
      <rect
        className="ring"
        x={t.x - g}
        y={t.y - g}
        width={t.w + 2 * g}
        height={t.h + 2 * g}
        rx={0.7}
      />
    );
  }

  return (
    <g
      className={cls}
      data-id={t.id}
      tabIndex={0}
      role="button"
      aria-pressed={selected}
      aria-label={describe(t)}
      {...handlers}
    >
      {(selected || lit) && ring}
      {body}
      {t.shape === "booth" && (
        <rect
          className="booth-back"
          x={t.x + 0.3}
          y={t.y + 0.25}
          width={t.w - 0.6}
          height={0.45}
          rx={0.2}
          fill={c.stroke}
        />
      )}
      <text x={cx} y={cy - seatSize * 0.45} fontSize={idSize} fill={c.text} className="t-id">
        {t.id.slice(1)}
      </text>
      {t.status === "occupied" ? (
        <PhasePips table={t} cx={cx} y={cy + idSize * 0.6} color={c.text} />
      ) : (
        <text x={cx} y={cy + idSize * 0.62} fontSize={seatSize} fill={c.text} className="t-seats">
          {t.seats}
        </text>
      )}
    </g>
  );
}

/** Six-step meal progress under the number: filled up to the current phase. */
function PhasePips({
  table: t,
  cx,
  y,
  color,
}: {
  table: Table;
  cx: number;
  y: number;
  color: string;
}) {
  const step = PHASES.indexOf(t.phase ?? "seated");
  // Diamonds narrow towards the bottom, so keep their pip row inside the shape.
  const span =
    t.shape === "diamond" ? Math.max(1.4, t.w - 2 * (y - (t.y + t.h / 2)) - 0.6) : t.w - 0.9;
  const pw = Math.min(0.5, span / 6.6);
  const gap = pw * 0.12;
  const total = 6 * pw + 5 * gap;
  return (
    <g aria-hidden="true">
      {PHASES.map((p, i) => (
        <rect
          key={p}
          x={cx - total / 2 + i * (pw + gap)}
          y={y - pw * 0.35}
          width={pw}
          height={pw * 0.7}
          rx={pw * 0.2}
          fill={color}
          opacity={i <= step ? 0.95 : 0.28}
        />
      ))}
    </g>
  );
}
