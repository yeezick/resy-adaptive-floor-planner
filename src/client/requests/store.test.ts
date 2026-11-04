import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseRequestBook } from "../../domain/requests";
import triageJson from "../../../fixtures/scenarios/triage.json";
import { NIGHTS } from "../nights";
import { currentRequest, pendingCount, requestsBy, type RequestsState } from "./store";

const book = parseRequestBook(
  JSON.parse(readFileSync("fixtures/requests/requests.json", "utf8")) as unknown,
);
const state = (over: Partial<RequestsState> = {}) =>
  ({ book, decisions: {}, adjust: {}, ...over }) as RequestsState;

describe("one request state per night", () => {
  it("the live service night is Wednesday; the Friday book plans from 3:00 PM", () => {
    expect(NIGHTS["dinner-peak"]).toEqual({ day: "Wed", label: "Wed · live service 7:10 PM" });
    expect(NIGHTS["book-fri"]?.day).toBe("Fri");
  });

  it("the Wednesday live floor lists only requests received by Wed 7:10 PM", () => {
    const ids = requestsBy(state(), { roomId: "dinner-peak", clock: "19:10" }).map((r) => r.id);
    expect(ids).toEqual(["Q1", "Q2", "Q3", "Q4"]);
    expect(pendingCount(state(), { roomId: "dinner-peak", clock: "19:10" })).toBe(4);
    expect(requestsBy(state(), { roomId: "book-fri", clock: "15:00" })).toHaveLength(6);
  });

  it("the host-stand request arrives Fri 2:40 PM for tomorrow (Saturday)", () => {
    const q6 = book.requests.find((r) => r.id === "Q6");
    expect(q6).toMatchObject({ receivedAt: "Fri 14:40", day: "Sat", time: "20:30" });
    expect(q6?.message).toContain("tomorrow");
    expect(q6?.message).not.toContain("tonight");
  });

  it("the recorded triage was made from the request as it reads now (same hash and length)", async () => {
    const { createHash } = await import("node:crypto");
    const results = (
      triageJson as { results: Record<string, { input: { sha256: string; length: number } }> }
    ).results;
    for (const r of book.requests) {
      const rec = results[r.id];
      if (!rec) continue;
      expect(rec.input).toEqual({
        sha256: createHash("sha256").update(r.message).digest("hex"),
        length: r.message.length,
      });
    }
  });

  it("the Wednesday live floor doesn't list the Friday walk-in; Friday and Saturday do", () => {
    const s = state();
    const ids = (roomId: string, clock: string) =>
      requestsBy(s, { roomId, clock }).map((r) => r.id);
    expect(ids("dinner-peak", "19:10")).not.toContain("Q6");
    expect(ids("dinner-peak", "19:10")).toHaveLength(4);
    expect(ids("book-fri", "15:00")).toContain("Q6");
    expect(ids("demo-night", "15:00")).toHaveLength(6);
    expect(requestsBy(s)).toHaveLength(6);
    expect(pendingCount(s, { roomId: "dinner-peak", clock: "19:10" })).toBe(4);
  });

  it("the row reads the request as changed in chat (26 at 7:00 PM), not as first asked", () => {
    const q2 = book.requests.find((r) => r.id === "Q2");
    if (!q2) throw new Error("Q2 missing");
    const s = state({
      adjust: {
        Q2: { tableRange: null, partySize: 26, time: "19:00", needs: q2.needs, notes: [] },
      },
    });
    expect(currentRequest(s, q2)).toMatchObject({ partySize: 26, time: "19:00" });
    expect(currentRequest(state(), q2)).toBe(q2);
  });
});
