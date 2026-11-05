import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { finalAnswer, scripted } from "./agent/fake";
import type { CreateMessage } from "./agent/loop";
import { getRoom } from "./rooms";
import { DailyBudget } from "./guards/budget";
import { RateLimiter } from "./guards/rateLimit";
import { createApp, type AppOptions } from "./index";

let server: Server | undefined;
const savedKey = process.env.ANTHROPIC_API_KEY;

async function start(opts: AppOptions = {}): Promise<string> {
  server = createApp(opts).listen(0);
  await new Promise<void>((r) => server?.once("listening", () => r()));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const post = (base: string, body: unknown) =>
  fetch(`${base}/api/agent`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const answer = {
  answer: "T11 is open now and seats 4.",
  clarifyingQuestion: null,
  recommendations: [
    { rank: 1, tables: ["T11"], seats: 4, waitMin: 0, reasoning: "open now", tradeoffs: [] },
  ],
};

beforeEach(() => {
  delete process.env.ANTHROPIC_API_KEY;
});
afterEach(() => {
  server?.close();
  server = undefined;
  if (savedKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = savedKey;
});

describe("server", () => {
  it("serves health and rooms", async () => {
    const base = await start();
    expect(await (await fetch(`${base}/healthz`)).json()).toEqual({ ok: true });
    const rooms = (await (await fetch(`${base}/api/rooms`)).json()) as { id: string }[];
    expect(rooms.map((r) => r.id)).toContain("dinner-peak");
    const room = (await (await fetch(`${base}/api/rooms/dinner-peak`)).json()) as { clock: string };
    expect(room.clock).toBe("19:10");
    const missing = await fetch(`${base}/api/rooms/nope`);
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ code: "bad_request" });
  });

  it("returns 503 no_key when no API key is configured", async () => {
    const base = await start();
    const res = await post(base, { roomId: "dinner-peak", message: "party of 4" });
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: "no_key" });
  });

  it("rejects bad bodies, long messages and invalid rooms with 400", async () => {
    const base = await start({ create: scripted([]).create });
    expect((await post(base, { roomId: "dinner-peak" })).status).toBe(400);
    expect((await post(base, { roomId: "dinner-peak", message: "x".repeat(501) })).status).toBe(
      400,
    );
    const badRoom = await post(base, {
      roomId: "x",
      message: "hi",
      room: {
        id: "x",
        name: "x",
        clock: "19:00",
        areas: [],
        tables: [],
        joins: [],
        inventory: { extenders: 0, spareChairs: 0 },
      },
    });
    expect(badRoom.status).toBe(400);
    const malformed = await fetch(`${base}/api/agent`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    });
    expect(malformed.status).toBe(400);
  });

  it("rate-limits per client", async () => {
    const base = await start({ limiter: new RateLimiter(1) });
    expect((await post(base, { roomId: "dinner-peak", message: "a" })).status).toBe(503);
    const res = await post(base, { roomId: "dinner-peak", message: "b" });
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ code: "rate_limited" });
  });

  it("stops at the daily budget", async () => {
    const base = await start({ create: scripted([]).create, budget: new DailyBudget(0) });
    const res = await post(base, { roomId: "dinner-peak", message: "party of 4" });
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({
      code: "budget",
      error: expect.stringMatching(/demo budget reached/),
    });
  });

  it("runs the agent and charges the budget", async () => {
    const budget = new DailyBudget(5);
    const base = await start({ create: scripted([finalAnswer(answer)]).create, budget });
    const res = await post(base, { roomId: "dinner-peak", message: "party of 4" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { recommendations: unknown[]; metrics: { costUsd: number } };
    expect(body.recommendations).toHaveLength(1);
    expect(budget.spentToday()).toBeCloseTo(body.metrics.costUsd, 12);
  });

  it("passes the screen's party size and open requests to the agent; rejects bad ones", async () => {
    const { create, requests } = scripted([finalAnswer(answer), finalAnswer(answer)]);
    const base = await start({ create });
    const ok = await post(base, {
      roomId: "dinner-peak",
      message: "where can they go?",
      partySize: 6,
      openRequests: [{ name: "Whitaker", partySize: 22, time: "21:00", needs: [] }],
    });
    expect(ok.status).toBe(200);
    // T11 seats 4 (+1 header chair): fewer than the party of 6, though no tool gave a size
    const body = (await ok.json()) as {
      recommendations: unknown[];
      validator: { notes: string[] };
    };
    expect(body.recommendations).toEqual([]);
    expect(body.validator.notes.join(" ")).toMatch(/fewer than the party of 6/);
    const sent = JSON.stringify(requests[0]?.messages.at(-1)?.content);
    expect(sent).toContain("<party_size>6</party_size>");
    expect(sent).toContain("Whitaker · party of 22 · 21:00");

    const bad = (extra: object) => post(base, { roomId: "dinner-peak", message: "hi", ...extra });
    expect((await bad({ partySize: 0 })).status).toBe(400);
    expect((await bad({ partySize: 501 })).status).toBe(400);
    expect((await bad({ partySize: 2.5 })).status).toBe(400);
    const brief = { name: "Whitaker", partySize: 22, time: "21:00", needs: [] };
    expect((await bad({ openRequests: Array(13).fill(brief) })).status).toBe(400);
    expect((await bad({ openRequests: [{ ...brief, id: "Q2" }] })).status).toBe(400);
    expect((await bad({ openRequests: [{ ...brief, time: "9 PM" }] })).status).toBe(400);
  });

  it("maps agent failures to upstream", async () => {
    const base = await start({ create: scripted([]).create });
    const res = await post(base, { roomId: "dinner-peak", message: "party of 4" });
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ code: "upstream" });
  });

  it("never lets 8 parallel runs overshoot a $0.01 budget by more than one call's reservation", async () => {
    const budget = new DailyBudget(0.01);
    let calls = 0;
    const create: CreateMessage = async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 20));
      return finalAnswer(answer);
    };
    const base = await start({
      create,
      budget,
      limiter: new RateLimiter(100),
      maxConcurrentRuns: 8,
      agent: { maxTokens: 300 },
    });
    const results = await Promise.all(
      Array.from({ length: 8 }, () => post(base, { roomId: "dinner-peak", message: "party of 4" })),
    );
    const codes = results.map((r) => r.status);
    expect(codes.filter((c) => c === 200).length).toBeGreaterThanOrEqual(1);
    expect(codes.every((c) => c === 200 || c === 429)).toBe(true);
    expect(budget.inFlightUsd()).toBeCloseTo(0, 12);
    expect(budget.spentToday()).toBeLessThanOrEqual(0.01 + budget.largestReservation);
    expect(calls).toBe(codes.filter((c) => c === 200).length);
  });

  it("caps concurrent runs with 429 rate_limited", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    const create: CreateMessage = async () => {
      await gate;
      return finalAnswer(answer);
    };
    const base = await start({ create, limiter: new RateLimiter(100), maxConcurrentRuns: 1 });
    const first = post(base, { roomId: "dinner-peak", message: "party of 4" });
    await new Promise((r) => setTimeout(r, 30));
    const second = await post(base, { roomId: "dinner-peak", message: "party of 4" });
    expect(second.status).toBe(429);
    expect(await second.json()).toMatchObject({
      code: "rate_limited",
      error: expect.stringMatching(/busy/),
    });
    release();
    expect((await first).status).toBe(200);
  });

  it("accepts an edited layout of a known room", async () => {
    const fixture = getRoom("dinner-peak");
    if (!fixture) throw new Error("fixture missing");
    const base = await start({
      create: async () => finalAnswer(answer),
      limiter: new RateLimiter(100),
    });
    const edited = {
      ...fixture,
      tables: fixture.tables.map((t) => (t.id === "T11" ? { ...t, x: t.x + 1 } : t)),
    };
    expect((await post(base, { roomId: "dinner-peak", message: "4", room: edited })).status).toBe(
      200,
    );
    // Edited layouts are allowed (labels stay data); parseRoom limits still apply.
    const renamed = { ...fixture, name: "Saturday layout" };
    expect((await post(base, { roomId: "dinner-peak", message: "4", room: renamed })).status).toBe(
      200,
    );
    const tooLong = { ...fixture, name: "x".repeat(49) };
    expect((await post(base, { roomId: "dinner-peak", message: "4", room: tooLong })).status).toBe(
      400,
    );
    const otherId = { ...fixture, id: "elsewhere" };
    expect((await post(base, { roomId: "elsewhere", message: "4", room: otherId })).status).toBe(
      400,
    );
    expect((await post(base, { roomId: "dinner-peak", message: "4", room: otherId })).status).toBe(
      400,
    );
    const bigger = {
      ...fixture,
      tables: fixture.tables.map((t) => (t.id === "T11" ? { ...t, seats: 40 } : t)),
    };
    expect((await post(base, { roomId: "dinner-peak", message: "4", room: bigger })).status).toBe(
      200,
    );
  });

  it("lists every fixture", async () => {
    const base = await start();
    const rooms = (await (await fetch(`${base}/api/rooms`)).json()) as { id: string }[];
    expect(rooms.map((r) => r.id).sort()).toEqual([
      "book-fri",
      "book-thu",
      "demo-night",
      "dinner-peak",
      "heavy-saturday",
      "next-day",
    ]);
  });

  it("lists the large-party requests", async () => {
    const base = await start();
    const book = (await (await fetch(`${base}/api/requests`)).json()) as {
      onlineCap: number;
      requests: { id: string }[];
    };
    expect(book.onlineCap).toBe(8);
    expect(book.requests.map((r) => r.id)).toEqual(["Q1", "Q2", "Q3", "Q4", "Q5", "Q6"]);
  });

  it("triages a request once, then serves the cached result", async () => {
    const f = scripted([
      finalAnswer({
        verdict: "real",
        reason: "Specific date, time and headcount.",
        summary: ["Birthday for 14, Saturday 19:00.", "Wants one long table."],
      }),
    ]);
    const base = await start({ create: f.create });
    const triage = () => fetch(`${base}/api/requests/Q1/triage`, { method: "POST" });
    const first = (await (await triage()).json()) as { verdict: string; cached?: boolean };
    expect(first).toMatchObject({ verdict: "real" });
    expect(first.cached).toBeUndefined();
    const second = (await (await triage()).json()) as { cached?: boolean };
    expect(second.cached).toBe(true);
    expect(f.requests).toHaveLength(1);
    expect((await fetch(`${base}/api/requests/Q99/triage`, { method: "POST" })).status).toBe(404);
  });

  it("returns 503 no_key for triage without an API key", async () => {
    const base = await start();
    const res = await fetch(`${base}/api/requests/Q2/triage`, { method: "POST" });
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: "no_key" });
  });

  it("turns a chat message about one request into validated constraints", async () => {
    const f = scripted([
      finalAnswer({
        tableRange: { from: 30, to: 50 },
        partySize: null,
        time: null,
        addNeeds: [],
        removeNeeds: [],
        notes: [],
        clarify: null,
      }),
    ]);
    const base = await start({ create: f.create });
    const body = {
      message: "find another space between tables 30–50",
      request: { partySize: 22, day: "Fri", time: "18:30", needs: ["accessible"] },
      constraints: {
        tableRange: null,
        partySize: null,
        time: null,
        needs: ["accessible"],
        notes: [],
      },
    };
    const post = (id: string, b: unknown) =>
      fetch(`${base}/api/requests/${id}/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(b),
      });
    const res = await post("Q2", body);
    expect(res.status).toBe(200);
    const out = (await res.json()) as {
      output: { tableRange: unknown };
      input: { length: number };
    };
    expect(out.output.tableRange).toEqual({ from: 30, to: 50 });
    expect(out.input.length).toBe(body.message.length);
    // the manager's words go to the model fenced as data, never into the response
    expect(JSON.stringify(f.requests[0]?.messages)).toContain("<message>");
    expect((await post("Q2", { ...body, message: "" })).status).toBe(400);
    expect((await post("bad-id", body)).status).toBe(404);
  });

  it("returns 503 no_key for the request chat without an API key", async () => {
    const base = await start();
    const res = await fetch(`${base}/api/requests/Q2/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message: "headcount is now 26",
        request: { partySize: 22, day: "Fri", time: "18:30", needs: [] },
        constraints: { tableRange: null, partySize: null, time: null, needs: [], notes: [] },
      }),
    });
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: "no_key" });
  });

  it("logs a manager decision with ids and enums only", async () => {
    const base = await start();
    const post = (id: string, body: unknown) =>
      fetch(`${base}/api/requests/${id}/decision`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    expect((await post("Q3", { kind: "declined", reason: "fit" })).status).toBe(200);
    expect((await post("Q3", { kind: "declined", note: "free text" })).status).toBe(400);
    expect((await post("Q99", { kind: "accepted" })).status).toBe(404);
  });
});
