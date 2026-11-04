import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import bookFriJson from "../../fixtures/rooms/book-fri.json";
import { holdConflicts, holdStartFor, partyFits, type PartyFit } from "./fit";
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

describe("hold starts per table (a later party never holds a table an earlier party still sits at)", () => {
  function fridayPlan() {
    const { room, fit } = friday22();
    const withR = { ...room, reservations: [...room.reservations, toReservation(q2)] };
    return partyFits(withR, fit.plan.builds, SERVICE.from);
  }

  it("keeps the 22-top's hold at 5:00–6:30 PM on one run of tables, covers lost 24", () => {
    const f = fridayPlan().find((x) => x.reservationId === "Q2") as PartyFit;
    expect(f.hold.from).toBe("17:00");
    expect(f.hold.until).toBe("18:30");
    expect(f.hold.coversLost).toBe(24);
    expect(f.hold.runs).toHaveLength(1);
  });

  it("holds the 9:00 PM 24-top's shared Garden Room tables only from when the 22-top leaves", () => {
    const fits = fridayPlan();
    const q2fit = fits.find((x) => x.reservationId === "Q2") as PartyFit;
    const late = fits.find((x) => x.reservationId === "F4") as PartyFit;
    const shared = late.tables.filter((id) => q2fit.tables.includes(id));
    expect(shared.length).toBeGreaterThan(0);
    for (const id of shared) expect(holdStartFor(late.hold, id)).toBe("20:00");
    expect(late.hold.runs.map((r) => r.from)).toEqual(["19:00", "20:00"]);
    expect(holdConflicts(fits)).toEqual([]);
  });

  it("says so in the cons when the hold starts at different times", () => {
    const { room, fit } = friday22();
    const late = fridayPlan().find((x) => x.reservationId === "F4") as PartyFit;
    const { cons } = impactsOf(room, { fit: late, needs: [], moved: fit.moved });
    expect(cons).toContain("Tables held until 21:00: 67–69 from 19:00, 57–61 from 20:00");
  });

  it("flags a hold or setup that starts while an earlier party is still seated", () => {
    const fits = fridayPlan();
    const late = fits.find((x) => x.reservationId === "F4") as PartyFit;
    const early = {
      ...late,
      hold: {
        ...late.hold,
        runs: [{ ...(late.hold.runs[1] as PartyFit["hold"]["runs"][number]), from: "19:00" }],
      },
    };
    const bad = holdConflicts(fits.map((f) => (f === late ? early : f)));
    expect(bad.length).toBeGreaterThan(0);
    expect(bad[0]).toMatchObject({
      reservationId: "F4",
      seatedId: "Q2",
      from: "19:00",
      seatedUntil: "20:00",
    });
    expect(holdConflicts(fits, { F4: "19:30" })[0]).toMatchObject({
      from: "19:30",
      seatedUntil: "20:00",
    });
  });
});
