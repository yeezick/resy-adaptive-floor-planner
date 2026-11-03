// Deterministic plan checks (no model, no cost): for every fixture night and every large-party request, the
// fit + cost the planner reports must be internally true. Run by `pnpm evals:deterministic` and gate CI.
//   1 holds     — every placed party has a hold on exactly its floor tables, starting no later than its build,
//                 with covers lost recomputed from seats × time held ÷ one turn
//   2 section   — the sections are exactly those of the party's tables; "spans" iff more than one
//   3 aisle     — every join in every placed build clears the venue minimum; every rejected option names a
//                 failing join with its inches; no failing join is ever built
//   4 can't-fit — every unplaced party (and every request that can't fit) has a one-line reason with its size
//                 and time
import {
  BUILD_LEAD_MIN,
  checkJoin,
  checkRequest,
  clearanceFor,
  generateTonight,
  partyFits,
  rowJoins,
  tableById,
  toMinutes,
  toReservation,
  TURN_MIN,
  type PartyFit,
  type RequestBook,
  type Room,
} from "../src/domain";

export interface PlanCheck {
  check: "holds" | "section" | "aisle" | "cant-fit";
  case: string;
  ok: boolean;
  detail?: string;
}

const WINDOW = { from: "17:00", to: "22:00" };
/** The default demo night must show at most one honest can't-fit, with its best partial option. */
export const DEMO_NIGHT = "demo-night";

function checkParty(room: Room, f: PartyFit, label: string, serviceFrom: string): PlanCheck[] {
  const out: PlanCheck[] = [];
  const floor = f.tables.filter((id) => tableById(room, id));
  const buildStart = toMinutes(f.time) - BUILD_LEAD_MIN;
  const h = f.hold;
  const seats = floor.reduce((n, id) => n + (tableById(room, id)?.seats ?? 0), 0);
  const maxLost = Math.round((seats * Math.max(0, buildStart - toMinutes(serviceFrom))) / TURN_MIN);
  const holdsOk =
    h.tables.join() === floor.join() &&
    toMinutes(h.from) <= buildStart &&
    toMinutes(h.from) >= Math.min(toMinutes(serviceFrom), buildStart) &&
    h.until === f.time &&
    h.seats === seats &&
    h.coversLost >= 0 &&
    h.coversLost <= Math.min(seats, maxLost);
  out.push({
    check: "holds",
    case: label,
    ok: holdsOk,
    detail: holdsOk ? undefined : JSON.stringify({ hold: h, floor, seats, maxLost }),
  });

  const sections = [...new Set(floor.map((id) => tableById(room, id)?.section))].sort(
    (a, b) => (a ?? 0) - (b ?? 0),
  );
  const sectionOk =
    sections.join() === f.sections.join() && f.spansSections === f.sections.length > 1;
  out.push({
    check: "section",
    case: label,
    ok: sectionOk,
    detail: sectionOk ? undefined : `${f.sections}`,
  });

  const c = clearanceFor(room);
  const failing = f.aisle.checked.filter((j) => !j.ok);
  const rejectsOk = f.aisle.rejected.every((r) =>
    /leaves \d+ in of aisle \(needs \d+ in\)|no aisle measurement/.test(r.reason),
  );
  const aisleOk = !c || (f.aisle.ok && failing.length === 0 && rejectsOk);
  out.push({
    check: "aisle",
    case: label,
    ok: aisleOk,
    detail: aisleOk ? undefined : failing.map((j) => j.reason).join("; ") || "bad reject reason",
  });
  return out;
}

function oneLine(reason: string, size: number, time: string): boolean {
  return (
    !reason.includes("\n") &&
    reason.length <= 160 &&
    reason.includes(String(size)) &&
    (reason.includes(time) || /earliest|tonight|storage/.test(reason))
  );
}

export function runPlanChecks(rooms: Map<string, Room>, requests: RequestBook): PlanCheck[] {
  const out: PlanCheck[] = [];
  for (const [id, room] of rooms) {
    if (!clearanceFor(room)) continue;
    const from = toMinutes(room.clock) > toMinutes(WINDOW.from) ? room.clock : WINDOW.from;
    const p = generateTonight(room, from, WINDOW.to);
    for (const f of p.parties) out.push(...checkParty(room, f, `${id}/${f.reservationId}`, from));
    // no failing join is ever built, even outside the per-party list
    const c = clearanceFor(room);
    const built = p.variant.combos.flatMap((combo) => rowJoins(room, [combo]));
    const bad = c ? built.filter(([a, b]) => !checkJoin(c, a, b).ok) : [];
    out.push({
      check: "aisle",
      case: `${id}/all-joins`,
      ok: bad.length === 0,
      detail: bad.length ? bad.map((j) => j.join("+")).join(", ") : undefined,
    });
    if (id === DEMO_NIGHT)
      out.push({
        check: "cant-fit",
        case: `${id}/at-most-one`,
        ok: p.infeasible.length <= 1 && p.infeasible.every((x) => !!x.partial),
        detail: `${p.infeasible.length} can't-fit; partial: ${p.infeasible.map((x) => x.partial ?? "none").join("; ")}`,
      });
    for (const x of p.infeasible) {
      const time = room.reservations.find((r) => r.id === x.reservationId)?.time ?? "";
      out.push({
        check: "cant-fit",
        case: `${id}/${x.reservationId}`,
        ok: oneLine(x.reason, x.partySize, time),
        detail: x.reason,
      });
    }
  }
  for (const r of requests.requests) {
    const room = rooms.get(r.bookRoomId);
    if (!room) {
      out.push({ check: "cant-fit", case: `request/${r.id}`, ok: false, detail: "unknown book" });
      continue;
    }
    const fit = checkRequest(room, r);
    if (fit.ok) {
      const withR = { ...room, reservations: [...room.reservations, toReservation(r)] };
      const f = partyFits(withR, fit.plan.builds, WINDOW.from, {
        privateOnly: r.privateRoom ? [r.id] : [],
      }).find((x) => x.reservationId === r.id);
      if (f) out.push(...checkParty(withR, f, `request/${r.id}`, WINDOW.from));
      else out.push({ check: "holds", case: `request/${r.id}`, ok: false, detail: "no fit row" });
    } else {
      out.push({
        check: "cant-fit",
        case: `request/${r.id}`,
        ok: oneLine(fit.reason, r.partySize, r.time),
        detail: fit.reason,
      });
    }
  }
  return out;
}
