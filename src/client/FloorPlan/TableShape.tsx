import { useContext, type KeyboardEvent, type PointerEvent } from "react";
import { clock12, estimateFreeTime, type Table } from "../../domain";
import { PHASE_ABBR } from "../lib/service";
import { AlwaysShowIds, usePpu, usePx } from "./scale";
import { LATE_PHASES, phaseBar, tableColors } from "./colors";
import { tableNo } from "../../domain/wording";

interface Props {
  table: Table;
  selected: boolean;
  lit: boolean;
  /** Readiness bubble on a proposed-join table: "now" (green) or "~25m" until free (red, est.). */
  badge?: string;
  dim: boolean;
  dragging: boolean;
  /** Held by an accepted large-party plan (neutral dashed outline + "Held"; never "blocked"). */
  held?: boolean;
  /** Size of the party on this table (seated, held or booked): a small bubble in the bottom-right corner. */
  party?: number;
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
        ? `reserved for ${t.reservedAt ? clock12(t.reservedAt) : "later"}`
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

export function TableShape({
  table: t,
  selected,
  lit,
  badge,
  dim,
  dragging,
  held = false,
  party,
  ...handlers
}: Props) {
  const c = tableColors(t);
  const cx = t.x + t.w / 2;
  const cy = t.y + t.h / 2;
  const cls = [
    "table",
    selected && "is-selected",
    lit && "is-lit",
    dim && "is-dim",
    dragging && "is-dragging",
    held && "is-held",
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
      aria-label={`${describe(t)}${held ? ", held for a large party" : ""}${party && t.status !== "occupied" ? `, party of ${party}` : ""}${badge ? `, ${badgeWords(badge)}` : ""}`}
      {...handlers}
    >
      <HitArea table={t} />
      {held && (
        <rect
          className="held-outline"
          x={t.x - 0.35}
          y={t.y - 0.35}
          width={t.w + 0.7}
          height={t.h + 0.7}
          rx={0.5}
        />
      )}
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
      {t.status === "occupied" && <PhaseBar table={t} />}
      <TableLabels table={t} color={c.text} />
      {badge ? (
        <ReadyBubble table={t} text={badge} />
      ) : held ? (
        <ReadyBubble table={t} text="Held" kind="is-held" />
      ) : null}
    </g>
  );
}

function badgeWords(b: string): string {
  if (b === "now") return "free now";
  if (b === "free") return "free by the hold start";
  if (b === "blocked") return "blocked this service";
  if (/[AP]M$/.test(b)) return `busy until about ${b.slice(1)} (estimated from meal phase)`;
  return `free in about ${b.replace(/[~m]/g, "")} minutes (estimated from meal phase)`;
}

/** Readiness bubble on the table's top edge: green "now" / "free", red "~25m" or "~5:20 PM" (est.). */
function ReadyBubble({ table: t, text, kind }: { table: Table; text: string; kind?: string }) {
  const px = usePx();
  const font = px(9);
  const h = font * 1.45;
  const w = Math.max(h, text.length * font * CHAR_W + font * 0.8);
  // centred on the top edge, so bubbles on a row of joined tables don't collide; mostly above the edge, so
  // it never runs over the table number
  const x = t.x + t.w / 2 - w / 2;
  const y = t.y - h * 0.95;
  return (
    <g
      className={`ready-bubble ${kind ?? (text === "now" || text === "free" ? "is-now" : "is-wait")}`}
      aria-hidden="true"
    >
      <rect x={x} y={y} width={w} height={h} rx={h / 2} />
      <text x={x + w / 2} y={y + h / 2} fontSize={font}>
        {text}
      </text>
    </g>
  );
}

/**
 * Tiles smaller than this on screen show no party bubble (whole-room views), so it never covers the number;
 * a seated tile carries a phase word too, so it needs more room.
 */
const PARTY_MIN_PX = 26;
const PARTY_MIN_PX_SEATED = 40;

/**
 * The size of the party on each table (seated, held or booked), in the tile's bottom-right corner (10 px text
 * on screen, inverted colours): distinct from the seat count under the number. Drawn above every tile, so a
 * neighbouring tile never hides it. Tables are read by their own label (aria); this layer is decoration.
 */
export function PartyBubbles({
  tables,
  parties,
}: {
  tables: readonly Table[];
  parties: ReadonlyMap<string, number>;
}) {
  const px = usePx();
  const ppu = usePpu();
  const font = px(10);
  const h = font * 1.5;
  return (
    <g className="party-bubbles" aria-hidden="true">
      {tables.map((t) => {
        const size = parties.get(t.id);
        const min = t.status === "occupied" ? PARTY_MIN_PX_SEATED : PARTY_MIN_PX;
        if (!size || Math.min(t.w, t.h) * ppu < min) return null;
        const text = String(size);
        const w = Math.max(h, text.length * font * CHAR_W + font * 0.7);
        // just past the corner, clear of the number, the seat count and the phase word
        const x = t.x + t.w - w * 0.6;
        const y = t.y + t.h - h * 0.6;
        return (
          <g key={t.id} className="party-bubble" data-table={t.id}>
            <rect x={x} y={y} width={w} height={h} rx={h / 2} />
            <text x={x + w / 2} y={y + h / 2} fontSize={font}>
              {text}
            </text>
          </g>
        );
      })}
    </g>
  );
}

/** A 3 px bar along the top inside edge of a seated table: its meal phase at a glance (amber = about to free). */
function PhaseBar({ table: t }: { table: Table }) {
  const px = usePx();
  const h = px(3);
  const inset = t.shape === "round" ? t.w * 0.22 : t.shape === "diamond" ? t.w * 0.3 : 0.25;
  const y =
    t.shape === "round" ? t.y + t.h * 0.12 : t.shape === "diamond" ? t.y + t.h * 0.28 : t.y + 0.2;
  return (
    <rect
      className="phase-bar"
      x={t.x + inset}
      y={y}
      width={Math.max(0.5, t.w - 2 * inset)}
      height={h}
      rx={h / 2}
      style={{ fill: phaseBar(t.phase ?? "seated") }}
      aria-hidden="true"
    />
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
 * On a seated table ≤30 min from free: "free ~20m" (est., amber) under the tile. Elapsed time lives in Table
 * details. On tables too small for the phase word inside, the word goes here (stacked), so phase is never
 * colour alone.
 */
function Elapsed({ table: t, phase }: { table: Table; phase: string | null }) {
  const px = usePx();
  const ppu = usePpu();
  const free = estimateFreeTime(t).minutes;
  const soon = free !== null && free <= FREE_SOON_MIN;
  // below this on-screen width, a tile shows its number only (labels underneath would collide)
  if (t.w * ppu < LABEL_MIN_PX) return null;
  if (!soon && !phase) return null;
  // 15 px at touch scale; never wider than the tile it labels (whole-room views)
  // up to 15 px; the label may run ~30 px past a tile's edges but no further
  const font = Math.min(px(15), Math.max(px(9), px((t.w * ppu + 30) / 5.4)));
  const x = t.x + t.w / 2;
  const y = t.y + t.h + (t.shape === "booth" ? 0.25 : 0.7) + font * 0.8;
  return (
    <text className={soon ? "t-elapsed is-soon" : "t-elapsed"} x={x} y={y} fontSize={font}>
      {soon && <title>{`free in about ${free} min (estimated from meal phase)`}</title>}
      {phase && (
        <tspan x={x} className="t-elapsed-phase" fontSize={Math.min(px(12), font)}>
          {phase}
        </tspan>
      )}
      {soon && (
        <tspan x={x} dy={phase ? font * 1.1 : 0}>
          free ~{free}m
        </tspan>
      )}
    </text>
  );
}

/** Narrower tiles carry their number only (whole-room views). */
const LABEL_MIN_PX = 34;
/** Tables this close to free show a live "free ~Nm" on the floor. */
const FREE_SOON_MIN = 30;

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
  // words stay well inside the tile so neighbouring tiles' words never run together
  const inner = t.shape === "diamond" ? t.w * 0.5 : t.shape === "round" ? t.w * 0.66 : t.w * 0.72;
  // table number ~20 px bold at Fit (never below 12 px; numbers are never dropped)
  const idFont = Math.max(px(12), Math.min(px(20), Math.min(t.w, t.h) * 0.42));
  const occupied = t.status === "occupied";
  // an about-to-free tile too small for "free ~Nm" underneath shows its time inside instead of the phase
  const free = estimateFreeTime(t).minutes;
  const lateSmall =
    occupied &&
    t.w * ppu < LABEL_MIN_PX &&
    free !== null &&
    free <= FREE_SOON_MIN &&
    LATE_PHASES.includes(t.phase ?? "seated");
  const word = lateSmall
    ? `~${free}m`
    : occupied
      ? PHASE_ABBR[t.phase ?? "seated"]
      : String(t.seats);
  const fitFont = inner / (word.length * CHAR_W);
  const wordFont = Math.min(fitFont, px(12));
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
