import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import bookFriJson from "../../fixtures/rooms/book-fri.json";
import bookThuJson from "../../fixtures/rooms/book-thu.json";
import { demoNight } from "./__fixtures__/build";
import { checkRequest, draftReply, parseRequestBook, type GuestRequest } from "./requests";
import { parseRoom } from "./room";
import type { Room } from "./types";

const book = parseRequestBook(
  JSON.parse(readFileSync("fixtures/requests/requests.json", "utf8")) as unknown,
);
const byId = (id: string) => book.requests.find((r) => r.id === id) as GuestRequest;
const rooms: Record<string, () => Room> = {
  "demo-night": demoNight,
  "book-fri": () => parseRoom(structuredClone(bookFriJson)),
  "book-thu": () => parseRoom(structuredClone(bookThuJson)),
};
const roomFor = (r: GuestRequest) => (rooms[r.bookRoomId] as () => Room)();

describe("request fixture", () => {
  it("holds four fictional requests above the online cap of 8, from both sources", () => {
    expect(book.onlineCap).toBe(8);
    expect(book.requests.map((r) => r.partySize)).toEqual([14, 22, 30, 250]);
    expect(new Set(book.requests.map((r) => r.source))).toEqual(
      new Set(["guest-form", "ai-agent"]),
    );
  });

  it("rejects a request within the online cap and duplicate ids", () => {
    const r = { ...byId("Q1") };
    expect(() => parseRequestBook({ ...book, requests: [{ ...r, partySize: 8 }] })).toThrow(
      /within the online cap/,
    );
    expect(() => parseRequestBook({ ...book, requests: [r, r] })).toThrow(/duplicate/);
  });
});

describe("checkRequest (solver fit check, no model)", () => {
  it("fits the Saturday 14-top without bumping a booking", () => {
    const room = roomFor(byId("Q1"));
    const fit = checkRequest(room, byId("Q1"));
    expect(fit.ok).toBe(true);
    if (!fit.ok) return;
    expect(fit.build.seats).toBeGreaterThanOrEqual(14);
    const placed = new Set(fit.plan.builds.map((b) => b.reservationId));
    expect(placed.has("Q1")).toBe(true);
    // every Saturday booking the planner placed without the request is still placed
    for (const id of ["D1", "D2", "D3", "D4", "D5", "D6", "D7", "D8", "D9", "D10"])
      expect(placed.has(id)).toBe(true);
  });

  it("fits the Friday 22-top on accessible tables with stroller room", () => {
    const room = roomFor(byId("Q2"));
    const fit = checkRequest(room, byId("Q2"));
    expect(fit.ok).toBe(true);
    if (!fit.ok) return;
    const tables = fit.build.tables.map((id) => room.tables.find((t) => t.id === id));
    expect(tables.every((t) => t?.attrs.accessible)).toBe(true);
    expect(tables.some((t) => t?.attrs.strollerSpace)).toBe(true);
  });

  it("says in one line why the Thursday 30-top can't have a private room, and when it could", () => {
    const fit = checkRequest(roomFor(byId("Q3")), byId("Q3"));
    expect(fit.ok).toBe(false);
    if (fit.ok) return;
    expect(fit.nextFit).toBe("20:30");
    expect(fit.reason).toBe(
      "No private-room set for 30 is free at 19:30 without bumping a booking — earliest 20:30.",
    );
    expect(fit.reason).not.toMatch(/\n/);
  });

  it("names the size limit for an impossible party", () => {
    const fit = checkRequest(roomFor(byId("Q4")), byId("Q4"));
    expect(fit.ok).toBe(false);
    if (fit.ok) return;
    expect(fit.reason).toMatch(/^No table set seats 250, even with storage \(largest: \d+\)\.$/);
  });
});

describe("draftReply", () => {
  it("never names a table or promises a booking", () => {
    for (const r of book.requests) {
      const text = draftReply(r, checkRequest(roomFor(r), r));
      expect(text).not.toMatch(/\bT\d+\b/);
      expect(text).not.toMatch(/\b(confirmed|booked)\b/i);
      expect(text).toMatch(new RegExp(`party of ${r.partySize}`));
    }
  });

  it("offers the earliest time when the request can't fit as asked", () => {
    const r = byId("Q3");
    expect(draftReply(r, checkRequest(roomFor(r), r))).toMatch(/from 20:30/);
  });
});
