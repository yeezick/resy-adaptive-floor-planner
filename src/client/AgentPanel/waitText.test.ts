import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseRoom } from "../../domain";
import { waitText } from "./RecommendationCard";

const room = parseRoom(
  JSON.parse(readFileSync("fixtures/rooms/dinner-peak.json", "utf8")) as unknown,
);
const onCheck = room.tables.find((t) => t.status === "occupied" && t.phase === "check");
const open = room.tables.find((t) => t.status === "open");

describe("waitText", () => {
  it("free now when the wait is 0", () => {
    expect(waitText(room, { tables: [open?.id ?? "T1"], waitMin: 0 })).toBe("free now");
  });
  it("shows the basis when the slowest seated table adds up to the wait", () => {
    expect(waitText(room, { tables: [onCheck?.id ?? "T1"], waitMin: 11 })).toBe(
      "~11 min est. (check ~6 + reset 5)",
    );
  });
  it("says est. without a basis when it doesn't add up or nothing is seated", () => {
    expect(waitText(room, { tables: [onCheck?.id ?? "T1"], waitMin: 20 })).toBe("~20 min est.");
    expect(waitText(room, { tables: [open?.id ?? "T1"], waitMin: 15 })).toBe("~15 min est.");
  });
});
