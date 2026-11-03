import { useMemo, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import type { Room, Table } from "../../domain";
import { FloorAreas } from "../FloorPlan/FloorAreas";
import { intersects, viewBox } from "../FloorPlan/geometry";
import { AlwaysShowIds, PxPerUnit, useMeasuredPpu } from "../FloorPlan/scale";
import { TableShape } from "../FloorPlan/TableShape";
import { snap } from "./edit";

interface Props {
  room: Room;
  selected: string[];
  zoom: number;
  onSelect: (ids: string[]) => void;
  onMoveCommit: (ids: string[], dx: number, dy: number) => void;
}

type Gesture =
  | {
      kind: "drag";
      ids: string[];
      sx: number;
      sy: number;
      dx: number;
      dy: number;
      moved: boolean;
      id: string;
      shift: boolean;
    }
  | { kind: "box"; sx: number; sy: number; x: number; y: number; shift: boolean };

/** Grid canvas: click / shift-click to select, drag a box to select many, drag tables to move. */
export function EditorCanvas({ room, selected, zoom, onSelect, onMoveCommit }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [g, setG] = useState<Gesture | null>(null);
  const box = useMemo(() => viewBox(room, "all"), [room]);
  const ppu = useMeasuredPpu(svgRef, box);

  const toGrid = (e: PointerEvent) => {
    const ctm = svgRef.current?.getScreenCTM();
    if (!ctm) return null;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  };

  const shown: Table[] = room.tables.map((t) =>
    g?.kind === "drag" && g.moved && g.ids.includes(t.id)
      ? { ...t, x: snap(t.x + g.dx), y: snap(t.y + g.dy) }
      : t,
  );

  const onTableDown = (e: PointerEvent<SVGGElement>, t: Table) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const p = toGrid(e);
    if (!p) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    let ids = selected;
    if (e.shiftKey)
      ids = selected.includes(t.id) ? selected.filter((x) => x !== t.id) : [...selected, t.id];
    else if (!selected.includes(t.id)) ids = [t.id];
    onSelect(ids);
    setG({
      kind: "drag",
      ids: ids.includes(t.id) ? ids : [],
      sx: p.x,
      sy: p.y,
      dx: 0,
      dy: 0,
      moved: false,
      id: t.id,
      shift: e.shiftKey,
    });
  };
  const onBgDown = (e: PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    const p = toGrid(e);
    if (!p) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setG({ kind: "box", sx: p.x, sy: p.y, x: p.x, y: p.y, shift: e.shiftKey });
  };
  const onMove = (e: PointerEvent) => {
    if (!g) return;
    const p = toGrid(e);
    if (!p) return;
    if (g.kind === "drag") {
      const dx = p.x - g.sx;
      const dy = p.y - g.sy;
      setG({ ...g, dx, dy, moved: g.moved || Math.hypot(dx, dy) > 0.4 });
    } else setG({ ...g, x: p.x, y: p.y });
  };
  const onUp = () => {
    if (!g) return;
    if (g.kind === "drag") {
      if (g.moved && g.ids.length) onMoveCommit(g.ids, snap(g.dx), snap(g.dy));
      else if (!g.shift && selected.length > 1) onSelect([g.id]);
    } else {
      const r = boxRect(g);
      if (r.w < 0.3 && r.h < 0.3) {
        if (!g.shift) onSelect([]);
      } else {
        const hit = room.tables.filter((t) => intersects(r, t)).map((t) => t.id);
        onSelect(g.shift ? [...new Set([...selected, ...hit])] : hit);
      }
    }
    setG(null);
  };

  return (
    <div
      className={zoom > 1 ? "floor-scroll is-zoomed" : "floor-scroll"}
      style={
        {
          "--zoom": zoom,
          "--ar": box.w / box.h,
          // tablets: edit at touch scale and scroll, rather than shrinking labels away
          "--min-w": `${box.w * 10}px`,
        } as CSSProperties
      }
    >
      <PxPerUnit.Provider value={ppu}>
        <AlwaysShowIds.Provider value={true}>
          <svg
            ref={svgRef}
            className="floor editor-canvas"
            viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}
            role="group"
            aria-label="Layout editor canvas. Click to select, shift-click to add, drag a box to select many, drag tables to move."
            onPointerDown={onBgDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={() => setG(null)}
          >
            <defs>
              <pattern id="grid-1" width="1" height="1" patternUnits="userSpaceOnUse">
                <path d="M1 0 L0 0 0 1" className="grid-minor" />
              </pattern>
              <pattern id="grid-5" width="5" height="5" patternUnits="userSpaceOnUse">
                <rect width="5" height="5" fill="url(#grid-1)" />
                <path d="M5 0 L0 0 0 5" className="grid-major" />
              </pattern>
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
            </defs>
            <rect x={box.x} y={box.y} width={box.w} height={box.h} fill="url(#grid-5)" />
            <FloorAreas room={room} openDividers={new Set()} />
            {room.joins.map(([a, b]) => {
              const ta = shown.find((t) => t.id === a);
              const tb = shown.find((t) => t.id === b);
              if (!ta || !tb) return null;
              return (
                <line
                  key={`${a}-${b}`}
                  className="join-link"
                  x1={ta.x + ta.w / 2}
                  y1={ta.y + ta.h / 2}
                  x2={tb.x + tb.w / 2}
                  y2={tb.y + tb.h / 2}
                />
              );
            })}
            {shown.map((t) => (
              <TableShape
                key={t.id}
                table={t}
                selected={selected.includes(t.id)}
                lit={false}
                dim={false}
                dragging={g?.kind === "drag" && g.moved && g.ids.includes(t.id)}
                onPointerDown={(e) => onTableDown(e, t)}
                onPointerMove={onMove}
                onPointerUp={onUp}
                onPointerCancel={() => setG(null)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelect(e.shiftKey ? [...selected, t.id] : [t.id]);
                  }
                }}
              />
            ))}
            {g?.kind === "box" && <rect className="select-box" {...toAttrs(boxRect(g))} />}
          </svg>
        </AlwaysShowIds.Provider>
      </PxPerUnit.Provider>
    </div>
  );
}

function boxRect(g: { sx: number; sy: number; x: number; y: number }) {
  return {
    x: Math.min(g.sx, g.x),
    y: Math.min(g.sy, g.y),
    w: Math.abs(g.x - g.sx),
    h: Math.abs(g.y - g.sy),
  };
}

function toAttrs(r: { x: number; y: number; w: number; h: number }) {
  return { x: r.x, y: r.y, width: r.w, height: r.h };
}
