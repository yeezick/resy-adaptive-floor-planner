import { describe, expect, it } from "vitest";
import { namesIn, partyName, surname } from "./names";

describe("party names", () => {
  it("a request shows its contact's surname", () => {
    expect(partyName("Q2")).toBe("Whitaker");
    expect(partyName("Q6")).toBe("Okafor");
    expect(surname("free dinner")).toBe("free dinner");
  });

  it("a reservation gets a stable fictional name, distinct within a night", () => {
    expect(partyName("F1")).toMatch(/^[A-Z][A-Za-z']+, [A-Z]\.$/);
    expect(partyName("F1")).toBe(partyName("F1"));
    const fri = Array.from({ length: 51 }, (_, i) => partyName(`D${i + 1}`));
    expect(new Set(fri).size).toBe(51);
  });

  it("other ids pass through", () => {
    expect(partyName("T41")).toBe("T41");
    expect(partyName("seed-a1")).toBe("seed-a1");
  });

  it("replaces party ids inside a sentence, not table ids", () => {
    const out = namesIn("Split P6's tables; T41 stays");
    expect(out).not.toMatch(/\bP6\b/);
    expect(out).toContain("T41");
  });

  it("names the party in tonight's crew action and reason only at display time", () => {
    expect(namesIn("After ~19:00, split the tables R1 used")).toBe(
      `After ~19:00, split the tables ${partyName("R1")} used`,
    );
    expect(namesIn("R1 (10) → Main · one long table of 3")).toBe(
      `${partyName("R1")} (10) → Main · one long table of 3`,
    );
  });
});
