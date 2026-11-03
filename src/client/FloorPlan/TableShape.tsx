import { useContext, type KeyboardEvent, type PointerEvent } from "react";
import { ELAPSED_EST_MIN, type Table } from "../../domain";
import { PHASE_ABBR } from "../lib/service";
import { AlwaysShowIds, usePpu, usePx } from "./scale";
import { tableColors } from "./colors";
import { tableNo } from "../../domain/wording";

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
  return `Table ${tableNo(t.id)}, ${t.seats} seats, ${shape}, ${t.area}, section ${t.section}, ${state}`;
}

function diamond(cx: number, cy: number, rx: number, ry: number): string {
  return `${cx},${cy - ry} ${cx + rx},${cy} ${cx},${cy + ry} ${cx - rx},${cy}`;
}

/** Invisible target so every table is at least 44px square on screen. */
function HitArea({ table: t }: { table: Table }) {
  const px = usePx();
  const w = Math.max(t.w, px(44));
  const h = Math.max(t.h, px(44));
  return (
    <rect
      className="hit"
      x={t.x + t.w / 2 - w / 2}
      y={t.y + t.h / 2 - h / 2}
      width={w}
      height={h}
      fill="transparent"
    />
  );
}

export function TableShape({ table: t, selected, lit, dim, dragging, ...handlers }: Props) {
  const c = tableColors(t);
  const cx = t.x + t.w / 2;
  const cy = t.y + t.h / 2;
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
    body = (
      <ellipse
        cx={cx}
        cy={cy}
        rx={t.w / 2}
        ry={t.h / 2}
        style={{ fill: c.fill, stroke: c.stroke }}
      />
    );
    ring = <ellipse className="ring" cx={cx} cy={cy} rx={t.w / 2 + g} ry={t.h / 2 + g} />;
  } else if (t.shape === "diamond") {
    body = (
      <polygon
        points={diamond(cx, cy, t.w / 2, t.h / 2)}
        style={{ fill: c.fill, stroke: c.stroke }}
      />
    );
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
        style={{ fill: c.fill, stroke: c.stroke }}
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
      <HitArea table={t} />
      {(selected || lit) && ring}
      <Chairs table={t} />
      {body}
      {t.shape === "booth" && (
        <rect
          className="booth-back"
          x={t.x + 0.3}
          y={t.y + 0.25}
          width={t.w - 0.6}
          height={0.45}
          rx={0.2}
          style={{ fill: c.stroke }}
        />
      )}
      <TableLabels table={t} color={c.text} />
    </g>
  );
}

/** One dot per seat, just outside the table edge (booths are benches: none). */
function Chairs({ table: t }: { table: Table }) {
  if (t.shape === "booth") return null;
  const n = t.seats;
  const cx = t.x + t.w / 2;
  const cy = t.y + t.h / 2;
  const off = 0.42;
  const r = 0.2;
  const dots: [number, number][] = [];
  if (t.shape === "round" || t.shape === "diamond") {
    const rx = t.w / 2 + off;
    const ry = t.h / 2 + off;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * 2 * Math.PI - Math.PI / 2 + (t.shape === "diamond" ? Math.PI / n : 0);
      dots.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
    }
  } else {
    // seats along the two long sides; a 2-top faces across the short axis
    const horizontal = t.w >= t.h;
    const perSide = Math.max(1, Math.ceil(n / 2));
    const len = horizontal ? t.w : t.h;
    for (let side = 0; side < 2; side++) {
      const k = side === 0 ? perSide : n - perSide;
      for (let i = 0; i < k; i++) {
        const along = ((i + 0.5) / k) * len;
        if (horizontal) dots.push([t.x + along, side === 0 ? t.y - off : t.y + t.h + off]);
        else dots.push([side === 0 ? t.x - off : t.x + t.w + off, t.y + along]);
      }
    }
  }
  return (
    <g className="chairs" aria-hidden="true">
      {dots.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={r} />
      ))}
    </g>
  );
}

/**
 * Estimated time since the party sat (from meal phase), centred under the table. On tables too small for
 * the phase word inside, the word goes here too (stacked), so phase is never colour alone.
 */
function Elapsed({ table: t, phase }: { table: Table; phase: string | null }) {
  const px = usePx();
  const m = ELAPSED_EST_MIN[t.phase ?? "seated"];
  const font = Math.max(px(10), 0.62);
  const x = t.x + t.w / 2;
  const y = t.y + t.h + (t.shape === "booth" ? 0.25 : 0.7) + font * 0.8;
  return (
    <text className="t-elapsed" x={x} y={y} fontSize={font}>
      <title>{`about ${m} min since seated (estimated from meal phase)`}</title>
      {phase && (
        <tspan x={x} className="t-elapsed-phase">
          {phase}
        </tspan>
      )}
      <tspan x={x} dy={phase ? font * 1.1 : 0}>
        {m}m est.
      </tspan>
    </text>
  );
}

const CHAR_W = 0.62; // average glyph width / font size for the system UI font

/** ID (≥12px on screen) and, for seated tables, the meal phase as a word (SEAT…CHK). */
/** Below this on-screen size a table shows colour + a corner tick instead of a phase word. */
const WORD_MIN_PX = 24;
/** Below this the ID itself is hidden until hover / focus (e.g. the whole-room overview). */
const ID_MIN_PX = 22;

/** ID (≥12px on screen) and, on tables big enough, the meal phase as a word (SEAT…CHK). */
function TableLabels({ table: t, color }: { table: Table; color: string }) {
  const px = usePx();
  const ppu = usePpu();
  const alwaysIds = useContext(AlwaysShowIds);
  const cx = t.x + t.w / 2;
  const cy = t.y + t.h / 2;
  const shownPx = Math.min(t.w, t.h) * ppu;
  const compact = !alwaysIds && shownPx < ID_MIN_PX;
  const inner = t.shape === "diamond" ? t.w * 0.5 : t.shape === "round" ? t.w * 0.72 : t.w * 0.86;
  const idFont = Math.max(px(12), Math.min(1.5, Math.min(t.w, t.h) * 0.3));
  const occupied = t.status === "occupied";
  const word = occupied ? PHASE_ABBR[t.phase ?? "seated"] : String(t.seats);
  const fitFont = inner / (word.length * CHAR_W);
  const wordFont = Math.min(fitFont, Math.max(px(10), idFont * 0.72));
  // A phase word must fit inside the shape at a readable size, on a table big enough to hold it.
  const showWord = !compact && (!occupied || shownPx >= WORD_MIN_PX) && wordFont >= px(8);
  const gap = idFont * 0.08;
  const total = showWord ? idFont + gap + wordFont : idFont;
  const top = cy - total / 2;
  return (
    <>
      <text
        x={cx}
        y={top + idFont / 2}
        fontSize={idFont}
        style={{ fill: color }}
        className={compact ? "t-id is-compact" : "t-id"}
      >
        {t.id.slice(1)}
      </text>
      {showWord && (
        <text
          x={cx}
          y={top + idFont + gap + wordFont / 2}
          fontSize={wordFont}
          style={{ fill: color }}
          className={occupied ? "t-phase" : "t-seats"}
        >
          {word}
        </text>
      )}
      {occupied && !showWord && <CornerTick table={t} color={color} />}
      {occupied && <Elapsed table={t} phase={showWord ? null : PHASE_ABBR[t.phase ?? "seated"]} />}
    </>
  );
}

/** Small mark in the top-right corner: "seated", for tables too small to carry a phase word. */
function CornerTick({ table: t, color }: { table: Table; color: string }) {
  const s = Math.min(t.w, t.h) * 0.34;
  if (t.shape === "rect" || t.shape === "booth") {
    const x = t.x + t.w;
    return (
      <polygon
        className="t-tick"
        points={`${x - s},${t.y} ${x},${t.y} ${x},${t.y + s}`}
        style={{ fill: color }}
      />
    );
  }
  return (
    <circle
      className="t-tick"
      cx={t.x + t.w / 2}
      cy={t.y + s * 0.6}
      r={s * 0.28}
      style={{ fill: color }}
    />
  );
}
