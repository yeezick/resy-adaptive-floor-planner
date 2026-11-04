import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import type { LayoutChange, Room, Table } from "../../domain";
import { ChangeOverlay, ChangeUnderlay, openedDividers } from "./ChangeOverlay";
import type { Highlight } from "../highlight";
import { FloorAreas } from "./FloorAreas";
import { defaultTab, intersects, roomTabs, viewBox, type Box, type ViewPreset } from "./geometry";
import { OffscreenCue, useScrollView } from "./OffscreenCue";
import { FloorLegend } from "./Legend";
import { PxPerUnit, useMeasuredPpu, usePx } from "./scale";
import { PartyBubbles, TableShape } from "./TableShape";
import "./floor15.css";

interface Props {
  room: Room;
  selected: string[];
  highlight: Highlight | null;
  onToggle: (id: string) => void;
  onMove: (id: string, x: number, y: number) => void;
  /** Proposal change view: ghosts, arrows, joins and storage pulls drawn over the room. */
  changes?: readonly LayoutChange[];
  /** Open on this tab instead of the screen-size default (the preview opens on a single room). */
  initialTab?: "first" | ViewPreset;
  /** When this changes (a sheet opened or closed and the canvas resized), the floor returns to Fit. */
  fitKey?: string;
  /** Tables held by accepted large-party plans for this night. */
  held?: ReadonlySet<string>;
  /** Size of the party on each table (seated, held or booked), shown as a small bubble. */
  parties?: ReadonlyMap<string, number>;
}

interface Drag {
  id: string;
  pointerId: number;
  startX: number;
  startY: number;
  origX: number;
  origY: number;
  x: number;
  y: number;
  moved: boolean;
}

const SNAP = 0.5;
const ZOOMS = [1, 1.5, 2, 3, 4];
const snap = (v: number) => Math.round(v / SNAP) * SNAP;

export function FloorPlan({
  room,
  selected,
  highlight,
  onToggle,
  onMove,
  changes,
  initialTab,
  fitKey,
  held,
  parties,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const panRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [zoom, setZoom] = useState(1);
  // Fit = the whole room in the panel. Off, a single room keeps a touch-sized minimum width and scrolls.
  const [fitted, setFitted] = useState(false);
  const [fitFor, setFitFor] = useState(fitKey);
  if (fitFor !== fitKey) {
    setFitFor(fitKey);
    setZoom(1);
    setFitted(false);
  }
  // The floor fills whatever height its column gives it (the planner page is a fixed-height shell).
  const [floorH, setFloorH] = useState<number | null>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => {
      const h = Math.floor(e?.contentRect.height ?? 0);
      setFloorH(h > 120 ? h : null);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const [preset, setPreset] = useState<ViewPreset>(() =>
    initialTab === "first"
      ? (roomTabs(room)[0]?.id ?? "all")
      : (initialTab ?? defaultTab(room, window.innerWidth)),
  );

  // Tables at their on-screen position (a table being dragged follows the pointer).
  const tables = useMemo(
    () =>
      room.tables.map((t) =>
        drag && drag.id === t.id && drag.moved ? { ...t, x: drag.x, y: drag.y } : t,
      ),
    [room.tables, drag],
  );
  const byId = useMemo(() => new Map(tables.map((t) => [t.id, t])), [tables]);
  const box = useMemo(() => viewBox(room, preset), [room, preset]);
  const ppu = useMeasuredPpu(svgRef, box);

  const lit = new Set(highlight?.ids ?? []);
  const dimOthers = lit.size > 0;
  const openDividers = new Set([...(highlight?.dividers ?? []), ...openedDividers(changes ?? [])]);
  const outside =
    highlight !== null &&
    highlight.ids.some((id) => {
      const t = byId.get(id);
      return t !== undefined && !intersects(t, box);
    });

  // When zoomed in, bring highlighted tables into the scroll viewport.
  // Bring highlighted (suggested / recommended) or changed tables into view when the panel scrolls.
  const firstChanged = changes?.find(
    (c) => c.kind === "move" || c.kind === "pull-table" || c.kind === "join",
  )?.tables[0];
  const focusId = highlight?.ids[0] ?? firstChanged ?? "";
  useEffect(() => {
    const sc = scrollRef.current;
    if (!sc || !focusId) return;
    if (sc.scrollWidth <= sc.clientWidth && sc.scrollHeight <= sc.clientHeight) return;
    const el = sc.querySelector(`[data-id="${focusId}"]`);
    if (!el) return;
    const r = el.getBoundingClientRect();
    const c = sc.getBoundingClientRect();
    if (r.left < c.left || r.right > c.right)
      sc.scrollLeft += r.left - c.left - c.width / 2 + r.width / 2;
    if (r.top < c.top || r.bottom > c.bottom)
      sc.scrollTop += r.top - c.top - c.height / 2 + r.height / 2;
  }, [focusId, zoom, preset]);

  const view = useScrollView(scrollRef, svgRef, box, `${zoom}|${preset}`);
  const reveal = (target: Box) => {
    const sc = scrollRef.current;
    if (!sc || !view) return;
    const v = view.visible;
    sc.scrollBy({
      left: (target.x + target.w / 2 - (v.x + v.w / 2)) * ppu,
      top: (target.y + target.h / 2 - (v.y + v.h / 2)) * ppu,
      behavior: "smooth",
    });
  };

  const toGrid = (e: PointerEvent): { x: number; y: number } | null => {
    const ctm = svgRef.current?.getScreenCTM();
    if (!ctm) return null;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  };

  const onTableDown = (e: PointerEvent<SVGGElement>, t: Table) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const p = toGrid(e);
    if (!p) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({
      id: t.id,
      pointerId: e.pointerId,
      startX: p.x,
      startY: p.y,
      origX: t.x,
      origY: t.y,
      x: t.x,
      y: t.y,
      moved: false,
    });
  };
  const onTableMove = (e: PointerEvent<SVGGElement>, t: Table) => {
    if (!drag || drag.id !== t.id || drag.pointerId !== e.pointerId) return;
    const p = toGrid(e);
    if (!p) return;
    const dx = p.x - drag.startX;
    const dy = p.y - drag.startY;
    const moved = drag.moved || Math.hypot(dx, dy) > 0.4;
    setDrag({ ...drag, moved, x: snap(drag.origX + dx), y: snap(drag.origY + dy) });
  };
  const onTableUp = (e: PointerEvent<SVGGElement>, t: Table) => {
    if (!drag || drag.id !== t.id) return;
    setDrag(null);
    if (!drag.moved) onToggle(t.id);
    else if (drag.x !== drag.origX || drag.y !== drag.origY) onMove(t.id, drag.x, drag.y);
    e.currentTarget.releasePointerCapture(e.pointerId);
  };
  const onTableKey = (e: KeyboardEvent<SVGGElement>, t: Table) => {
    const step = e.shiftKey ? 2 : SNAP;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const mv = moves[e.key];
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onToggle(t.id);
    } else if (mv) {
      e.preventDefault();
      onMove(t.id, t.x + mv[0], t.y + mv[1]);
    }
  };

  // Drag the empty floor to pan when zoomed in.
  const onPanDown = (e: PointerEvent<SVGSVGElement>) => {
    const sc = scrollRef.current;
    if (!sc || e.button !== 0) return;
    // pan only when the view is bigger than the panel (zoomed, or a room shown at touch scale)
    if (sc.scrollWidth <= sc.clientWidth && sc.scrollHeight <= sc.clientHeight) return;
    panRef.current = { x: e.clientX, y: e.clientY, left: sc.scrollLeft, top: sc.scrollTop };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPanMove = (e: PointerEvent<SVGSVGElement>) => {
    const sc = scrollRef.current;
    const pan = panRef.current;
    if (!sc || !pan) return;
    sc.scrollLeft = pan.left - (e.clientX - pan.x);
    sc.scrollTop = pan.top - (e.clientY - pan.y);
  };
  const onPanUp = () => {
    panRef.current = null;
  };

  const zi = ZOOMS.indexOf(zoom);
  // at 100% a single room is shown at touch scale; one more step out fits the whole room
  const canFit = preset !== "all" && !fitted;
  const isFit = zoom === 1 && (fitted || preset === "all");
  const tabs = roomTabs(room);

  return (
    <div className="floor-wrap">
      <div className="floor-tools">
        {tabs.length > 1 && (
          <div className="room-tabs" role="tablist" aria-label="Rooms">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={preset === t.id}
                onClick={() => {
                  setPreset(t.id);
                  setFitted(false);
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}
        <div className="seg" role="group" aria-label="Zoom">
          <button
            type="button"
            aria-label="Zoom out"
            disabled={zi <= 0 && !canFit}
            onClick={() => (zi <= 0 ? setFitted(true) : setZoom(ZOOMS[zi - 1] ?? 1))}
          >
            −
          </button>
          <button
            type="button"
            aria-label="Fit to panel"
            aria-pressed={isFit}
            // Fit again returns a single room to touch scale (it scrolls)
            onClick={() => {
              setZoom(1);
              setFitted(preset === "all" || !isFit);
            }}
          >
            {zoom === 1 ? "Fit" : `${Math.round(zoom * 100)}%`}
          </button>
          <button
            type="button"
            aria-label="Zoom in"
            disabled={zi >= ZOOMS.length - 1}
            onClick={() => setZoom(ZOOMS[zi + 1] ?? zoom)}
          >
            +
          </button>
        </div>
      </div>
      <div className="floor-sub">
        <FloorLegend live={room.tables.some((t) => t.status === "occupied")} />
        <span
          className={`floor-highlight-tag small${
            highlight?.source === "ai" ? " is-ai" : highlight?.source === "fit" ? " is-fit" : ""
          }`}
          aria-live="polite"
          hidden={!highlight}
        >
          {highlight?.label}
          {outside && " · outside this view"}
        </span>
      </div>
      <div className="floor-viewport">
        <OffscreenCue room={room} box={box} view={view} onReveal={reveal} />
        <div
          ref={scrollRef}
          className={zoom > 1 ? "floor-scroll is-zoomed" : "floor-scroll"}
          style={
            {
              "--zoom": zoom,
              ...(floorH ? { "--floor-h": `${floorH}px` } : {}),
              "--ar": box.w / box.h,
              // single rooms keep ≥11px per grid unit on tablets (2-tops ≥32px); the panel scrolls
              "--min-w": preset === "all" || fitted ? "0px" : `${box.w * 11}px`,
            } as CSSProperties
          }
        >
          <PxPerUnit.Provider value={ppu}>
            <svg
              ref={svgRef}
              className={
                highlight?.source === "ai"
                  ? "floor lit-ai"
                  : highlight?.source === "fit"
                    ? "floor lit-fit"
                    : "floor"
              }
              viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}
              preserveAspectRatio="xMidYMid meet"
              role="group"
              aria-label={`Floor plan of ${room.name}. Tab to a table; Enter selects, arrow keys move it.`}
              onPointerDown={onPanDown}
              onPointerMove={onPanMove}
              onPointerUp={onPanUp}
              onPointerCancel={onPanUp}
            >
              <defs>
                <pattern
                  id="hatch"
                  width="0.8"
                  height="0.8"
                  patternUnits="userSpaceOnUse"
                  patternTransform="rotate(45)"
                >
                  <rect width="0.8" height="0.8" style={{ fill: "var(--hatch-bg)" }} />
                  <line
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="0.8"
                    strokeWidth="0.3"
                    style={{ stroke: "var(--hatch-line)" }}
                  />
                </pattern>
                <clipPath id="view-clip">
                  <rect x={box.x} y={box.y} width={box.w} height={box.h} />
                </clipPath>
              </defs>

              <g clipPath="url(#view-clip)">
                <FloorAreas room={room} openDividers={openDividers} view={box} />

                {changes && <ChangeUnderlay room={room} changes={changes} />}

                {room.combos.map((ids) => (
                  <Combo
                    key={ids.join("+")}
                    room={room}
                    ids={ids}
                    byId={byId}
                    // a Held tag or a ready bubble sits on these tables' top edge: the badge goes above it
                    lift={ids.some(
                      (id) =>
                        !!highlight?.badges?.[id] ||
                        (held?.has(id) ?? false) ||
                        byId.get(id)?.status === "reserved",
                    )}
                  />
                ))}

                {tables.map((t) => (
                  <TableShape
                    key={t.id}
                    table={t}
                    selected={selected.includes(t.id)}
                    lit={lit.has(t.id)}
                    badge={highlight?.badges?.[t.id]}
                    dim={dimOthers && !lit.has(t.id)}
                    dragging={drag?.id === t.id && drag.moved}
                    held={(held?.has(t.id) ?? false) || t.status === "reserved"}
                    party={parties?.get(t.id)}
                    onPointerDown={(e) => onTableDown(e, t)}
                    onPointerMove={(e) => onTableMove(e, t)}
                    onPointerUp={(e) => onTableUp(e, t)}
                    onPointerCancel={() => setDrag(null)}
                    onKeyDown={(e) => onTableKey(e, t)}
                  />
                ))}

                {parties && <PartyBubbles tables={tables} parties={parties} />}

                {changes && <ChangeOverlay room={room} changes={changes} />}
              </g>
            </svg>
          </PxPerUnit.Provider>
        </div>
      </div>
    </div>
  );
}

const seats = (ts: Table[]) => ts.reduce((n, t) => n + t.seats, 0);

/** "4+5 · 8": the joined tables and their seats, on the combo's top edge. */
function ComboBadge({ x, y, text }: { x: number; y: number; text: string }) {
  const px = usePx();
  const font = px(10);
  const h = font * 1.5;
  const w = text.length * font * 0.6 + font;
  return (
    <g className="combo-badge">
      <rect x={x + 0.4} y={y - h / 2} width={w} height={h} rx={h / 2} />
      <text x={x + 0.4 + w / 2} y={y} fontSize={font}>
        {text}
      </text>
    </g>
  );
}

function Combo({
  room,
  ids,
  byId,
  lift = false,
}: {
  room: Room;
  ids: string[];
  byId: Map<string, Table>;
  /** Raise the badge clear of the tags on the tables' top edge (Held, ready). */
  lift?: boolean;
}) {
  const px = usePx();
  const ts = ids.map((id) => byId.get(id)).filter((t): t is Table => t !== undefined);
  if (!ts.length) return null;
  const m = 0.6;
  const x = Math.min(...ts.map((t) => t.x)) - m;
  const y = Math.min(...ts.map((t) => t.y)) - m;
  const w = Math.max(...ts.map((t) => t.x + t.w)) - x + m;
  const h = Math.max(...ts.map((t) => t.y + t.h)) - y + m;
  const links = room.joins.filter(([a, b]) => ids.includes(a) && ids.includes(b));
  const centre = (t: Table) => [t.x + t.w / 2, t.y + t.h / 2] as const;
  return (
    <g className="combo" aria-hidden="true">
      <rect x={x} y={y} width={w} height={h} rx={0.8} />
      <ComboBadge
        x={x}
        y={lift ? y - px(9) * 1.45 - px(4) : y}
        text={`${ts.map((t) => t.id.slice(1)).join("+")} · ${seats(ts)}`}
      />
      {links.map(([a, b]) => {
        const ta = byId.get(a);
        const tb = byId.get(b);
        if (!ta || !tb) return null;
        const [x1, y1] = centre(ta);
        const [x2, y2] = centre(tb);
        return <line key={`${a}-${b}`} x1={x1} y1={y1} x2={x2} y2={y2} />;
      })}
    </g>
  );
}
