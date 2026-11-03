import { useEffect, useState, type RefObject } from "react";
import type { Room } from "../../domain";
import { intersects, sectionBoxes, type Box } from "./geometry";

/** The part of the floor (in grid units) visible inside the scrolling panel, plus scroll edges. */
export interface ScrollView {
  visible: Box;
  more: { left: boolean; right: boolean; up: boolean; down: boolean };
}

export function useScrollView(
  scrollRef: RefObject<HTMLDivElement | null>,
  svgRef: RefObject<SVGSVGElement | null>,
  box: Box,
  deps: unknown,
): ScrollView | null {
  const [view, setView] = useState<ScrollView | null>(null);
  useEffect(() => {
    const sc = scrollRef.current;
    const svg = svgRef.current;
    if (!sc || !svg) return;
    const update = () => {
      const c = sc.getBoundingClientRect();
      const s = svg.getBoundingClientRect();
      if (!s.width || !s.height) return;
      const ppu = Math.min(s.width / box.w, s.height / box.h);
      const x0 = box.x + Math.max(0, c.left - s.left) / ppu;
      const y0 = box.y + Math.max(0, c.top - s.top) / ppu;
      setView({
        visible: {
          x: x0,
          y: y0,
          w: Math.min(c.width, s.width) / ppu,
          h: Math.min(c.height, s.height) / ppu,
        },
        more: {
          left: sc.scrollLeft > 1,
          right: sc.scrollLeft + sc.clientWidth < sc.scrollWidth - 1,
          up: sc.scrollTop > 1,
          down: sc.scrollTop + sc.clientHeight < sc.scrollHeight - 1,
        },
      });
    };
    update();
    sc.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(sc);
    ro.observe(svg);
    return () => {
      sc.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, [scrollRef, svgRef, box.x, box.y, box.w, box.h, deps]);
  return view;
}

interface Region {
  label: string;
  section: boolean;
  box: Box;
}

function regions(room: Room, view: Box): Region[] {
  const out: Region[] = sectionBoxes(room).map((s) => ({
    label: String(s.section),
    section: true,
    box: s.box,
  }));
  for (const a of room.areas)
    if (a.kind === "private") out.push({ label: a.name, section: false, box: a });
  return out.filter((r) => intersects(r.box, view));
}

type Dir = "right" | "left" | "down" | "up";
const ARROW: Record<Dir, string> = { right: "→", left: "←", down: "↓", up: "↑" };

/** Edge fades and chips naming what is off-screen ("Sections 4, 8 →"); tapping one scrolls to it. */
export function OffscreenCue({
  room,
  box,
  view,
  onReveal,
}: {
  room: Room;
  box: Box;
  view: ScrollView | null;
  onReveal: (target: Box) => void;
}) {
  if (!view) return null;
  const v = view.visible;
  const hidden: Record<Dir, Region[]> = { right: [], left: [], down: [], up: [] };
  for (const r of regions(room, box)) {
    const cx = r.box.x + r.box.w / 2;
    const cy = r.box.y + r.box.h / 2;
    if (cx > v.x + v.w) hidden.right.push(r);
    else if (cx < v.x) hidden.left.push(r);
    else if (cy > v.y + v.h) hidden.down.push(r);
    else if (cy < v.y) hidden.up.push(r);
  }
  const chips = (Object.keys(hidden) as Dir[])
    .filter((d) => hidden[d].length)
    .map((d) => {
      const rs = hidden[d];
      const allSections = rs.every((r) => r.section);
      const names = rs.map((r) => r.label).join(", ");
      const text = allSections ? `${rs.length === 1 ? "Section" : "Sections"} ${names}` : names;
      return { d, text, target: rs[0]?.box };
    });
  const { more } = view;
  return (
    <>
      {more.left && <span className="edge-fade is-left" aria-hidden="true" />}
      {more.right && <span className="edge-fade is-right" aria-hidden="true" />}
      {more.down && <span className="edge-fade is-down" aria-hidden="true" />}
      {chips.length > 0 && (
        <div className="offscreen-chips">
          {chips.map((c) => (
            <button
              key={c.d}
              type="button"
              className={`offscreen-chip is-${c.d}`}
              onClick={() => c.target && onReveal(c.target)}
            >
              {c.d === "left" || c.d === "up"
                ? `${ARROW[c.d]} ${c.text}`
                : `${c.text} ${ARROW[c.d]}`}
            </button>
          ))}
        </div>
      )}
    </>
  );
}
