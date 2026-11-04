import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { applyCombine, comboOf, parseRoom, tableById } from "../../domain";
import { finishParty, revertAction, seatParty } from "./service";

const fixture = parseRoom(
  JSON.parse(readFileSync("fixtures/rooms/dinner-peak.json", "utf8")) as unknown,
);
// T9 and T10 free and next to each other
const room = finishParty(fixture, ["T9"]);

describe("undo of one AI option action", () => {
  it("a seat with a join reverts only its tables; another party seated since stays seated", () => {
    const after = seatParty(room, ["T9", "T10"], 4);
    const later = seatParty(after, ["T29"], 2);
    const undone = revertAction(later, room, after, ["T9", "T10"]);
    expect(tableById(undone, "T29")?.status).toBe("occupied");
    expect(tableById(undone, "T9")?.status).toBe("open");
    expect(tableById(undone, "T10")?.status).toBe("open");
    expect(comboOf(undone, "T9")).toBeUndefined();
  });

  it("a waitlist join splits only its own combo; the host's later changes stay", () => {
    const after = applyCombine(room, ["T9", "T10"]);
    const later = finishParty(after, ["T1"]);
    const undone = revertAction(later, room, after, []);
    expect(comboOf(undone, "T9")).toBeUndefined();
    expect(tableById(undone, "T1")?.status).toBe("open");
  });
});
