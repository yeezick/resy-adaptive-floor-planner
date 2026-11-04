import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import bookFriJson from "../../fixtures/rooms/book-fri.json";
import { partyFits } from "./fit";
import { impactsOf } from "./impacts";
import {
  checkRequest,
  parseRequestBook,
  SERVICE,
  toReservation,
  type GuestRequest,
} from "./requests";
import { parseRoom } from "./room";

const book = parseRequestBook(
  JSON.parse(readFileSync("fixtures/requests/requests.json", "utf8")) as unknown,
);
const q2 = book.requests.find((r) => r.id === "Q2") as GuestRequest;

function friday22() {
  const room = parseRoom(structuredClone(bookFriJson));
  const fit = checkRequest(room, q2);
  if (!fit.ok) throw new Error("Q2 should fit");
  const withR = { ...room, reservations: [...room.reservations, toReservation(q2)] };
  const f = partyFits(withR, fit.plan.builds, SERVICE.from).find((x) => x.reservationId === "Q2");
  if (!f) throw new Error("no cost for Q2");
  return { room, fit, f };
}

describe("impacts of saying yes (pros and cons, solver only)", () => {
  it("lists the Friday 22-top's pros and cons, with covers lost labelled est.", () => {
    const { room, fit, f } = friday22();
    const { pros, cons } = impactsOf(room, { fit: f, needs: q2.needs, moved: fit.moved });
    expect(pros[0]).toBe("+22 covers in one booking");
    expect(pros.some((p) => p.startsWith("Aisle clear for a wheelchair and a stroller"))).toBe(
      true,
    );
    expect(cons).toContain(`Tables held ${f.hold.from}–18:30`);
    expect(cons).toContain(`~${f.hold.coversLost} covers lost over one turn (est.)`);
    expect(cons.some((c) => /^Sections \d+ \+ \d+ both take on the party/.test(c))).toBe(true);
  });

  it("shows the aisle as a pro only when the party needs wheelchair or stroller access", () => {
    const { room, f } = friday22();
    const { pros } = impactsOf(room, { fit: f, needs: ["quiet"], moved: [] });
    expect(pros.some((p) => p.startsWith("Aisle"))).toBe(false);
    expect(pros).toContain("No reservations moved");
  });

  it("names moved parties as a con instead of claiming nothing moved", () => {
    const { room, f } = friday22();
    const { pros, cons } = impactsOf(room, { fit: f, needs: [], moved: ["F3", "F7"] });
    expect(pros).not.toContain("No reservations moved");
    expect(cons).toContain("2 other large parties move to other tables");
  });

  it("a failing aisle is a con, whatever the party asked for", () => {
    const { room, f } = friday22();
    const bad = { ...f, aisle: { ...f.aisle, ok: false, narrowestIn: 30 } };
    const { cons } = impactsOf(room, { fit: bad, needs: [], moved: [] });
    expect(cons).toContain("Aisle too narrow at a join: 30 in (needs 36 in)");
  });
});

describe("named moves", () => {
  it("replace the count line when given", () => {
    const { room, f } = friday22();
    const out = impactsOf(room, {
      fit: f,
      needs: [],
      moved: ["F1"],
      movedDetail: ["Moves X (12) from tables 63–66 to tables 77–80"],
    });
    expect(out.cons).toContain("Moves X (12) from tables 63–66 to tables 77–80");
    expect(out.cons.join(" ")).not.toMatch(/other large part/);
  });
});
