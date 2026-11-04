// Large-party requests: parties above the venue's online cap ask through the booking app's request form, a
// diner-side AI agent (a chat app or an MCP client) or in person at the host stand, instead of booking online. A manager sees each one with an AI triage, checks the fit and decides. Nothing here books.
import { z } from "zod";
import { fitRequest, type RequestFit } from "./buildplan";
import { HHMM, Label, type Reservation, type Room } from "./types";
import { clock12, toMinutes } from "./time";
import { countdown } from "./wording";

export const NEEDS = ["accessible", "stroller", "quiet", "view"] as const;

export const SOURCES = ["app", "ai-agent", "walk-in"] as const;
export type RequestSource = (typeof SOURCES)[number];

/** How each source reads on the card and in the activity log. */
export const SOURCE_LABEL: Record<RequestSource, string> = {
  app: "Resy app",
  "ai-agent": "AI agent",
  "walk-in": "Walk-in at the host stand",
};

/** The same, short enough for a one-line inbox row (the full label is the row's tooltip). */
export const SOURCE_SHORT: Record<RequestSource, string> = {
  app: "Resy app",
  "ai-agent": "AI agent",
  "walk-in": "Walk-in",
};

export const GuestRequest = z
  .object({
    id: z.string().regex(/^Q\d{1,4}$/),
    /** Where it came from: the booking app's request form, an AI agent booking for a guest, or the host stand. */
    source: z.enum(SOURCES),
    receivedAt: z.string().regex(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) ([01]\d|2[0-3]):[0-5]\d$/),
    day: z.enum(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]),
    /** The room fixture holding that night's book. */
    bookRoomId: Label,
    time: HHMM,
    partySize: z.number().int().positive().max(500),
    occasion: z.string().max(40).optional(),
    needs: z.array(z.enum(NEEDS)).default([]),
    /** Only private event rooms will do ("a private feel"). */
    privateRoom: z.boolean().default(false),
    /** Fictional contact name. */
    contact: z.string().min(1).max(60),
    /** The guest's own words. Shown to the manager in the request; never logged or shown in the activity log. */
    message: z.string().min(1).max(800),
  })
  .strict();
export type GuestRequest = z.infer<typeof GuestRequest>;

export const RequestBook = z
  .object({
    venue: Label,
    /** Largest party the venue takes online; every request here is above it. */
    onlineCap: z.number().int().positive(),
    requests: z.array(GuestRequest).max(50),
  })
  .strict();
export type RequestBook = z.infer<typeof RequestBook>;

export function parseRequestBook(json: unknown): RequestBook {
  const book = RequestBook.parse(json);
  const ids = new Set<string>();
  for (const r of book.requests) {
    if (ids.has(r.id)) throw new Error(`duplicate request id ${r.id}`);
    ids.add(r.id);
    // walk-ins of any size can ask in person; online sources only reach this inbox above the cap
    if (r.source !== "walk-in" && r.partySize <= book.onlineCap)
      throw new Error(`request ${r.id}: party of ${r.partySize} is within the online cap`);
  }
  return book;
}

export function toReservation(r: GuestRequest): Reservation {
  return { id: r.id, time: r.time, partySize: r.partySize, needs: [...r.needs] };
}

/** The night's service window the fit check plans over. */
export const SERVICE = { from: "17:00", to: "22:00" } as const;

/** Fit check for a request against its night's book. Deterministic; no model involved. */
export function checkRequest(room: Room, r: GuestRequest): RequestFit {
  return fitRequest(room, toReservation(r), SERVICE.from, SERVICE.to, {
    privateOnly: r.privateRoom,
  });
}

/**
 * A reply the manager edits before sending. Template text from the fit check only: it never promises a booking
 * and never names a table.
 */
export function draftReply(r: GuestRequest, fit: RequestFit): string {
  const first = r.contact.split(" ")[0] ?? r.contact;
  const when = `${r.day} at ${r.time}`;
  if (fit.ok)
    return `Hi ${first}, thanks for asking about a party of ${r.partySize} on ${when}. We may be able to host you${
      r.privateRoom ? " in a private room" : ""
    }. Could you confirm the final headcount and any dietary needs? We'll check the details and come back to you.`;
  if (fit.nextFit)
    return `Hi ${first}, thanks for asking about a party of ${r.partySize} on ${when}. We're full for a group that size at ${r.time}, but we could host you from ${fit.nextFit}. Would that work?`;
  return `Hi ${first}, thanks for asking about a party of ${r.partySize} on ${when}. Unfortunately we can't fit a group that size that night. Could another night work?`;
}

/** Card header: "Dana Ruiz, party of 22 · Fri 18:30 (in 3h 30m)". `minutesAway` is from that night's clock. */
export function requestHeader(r: GuestRequest, minutesAway: number | null): string {
  const when = `${r.day} ${r.time}`;
  return `${r.contact}, party of ${r.partySize} · ${when}${
    minutesAway === null ? "" : ` (${countdown(minutesAway)})`
  }`;
}

/**
 * A request taken at the host stand: the host types the size, time, needs and a name. It goes through the same
 * capacity fit and cost as an online request. The note is the host's own words (never logged).
 */
export function walkInRequest(input: {
  id: string;
  day: GuestRequest["day"];
  bookRoomId: string;
  clock: string;
  time: string;
  partySize: number;
  needs: GuestRequest["needs"];
  contact?: string;
  note?: string;
}): GuestRequest {
  return GuestRequest.parse({
    id: input.id,
    source: "walk-in",
    receivedAt: `${input.day} ${input.clock}`,
    day: input.day,
    bookRoomId: input.bookRoomId,
    time: input.time,
    partySize: input.partySize,
    needs: input.needs,
    contact: input.contact?.trim() || "Walk-in guest",
    message:
      input.note?.trim() ||
      `Asked at the host stand: party of ${input.partySize} at ${input.time}${
        input.needs.length ? ` (${input.needs.join(", ")})` : ""
      }.`,
  });
}

/** What the party needs, from the form fields alone (used when there is no AI triage, e.g. a host-stand walk-in). */
export function needsOverview(r: GuestRequest): string {
  const NEED_TEXT: Record<GuestRequest["needs"][number], string> = {
    accessible: "step-free access",
    stroller: "space for a stroller",
    quiet: "a quieter spot",
    view: "a view",
  };
  const parts = [
    r.occasion,
    ...r.needs.map((n) => NEED_TEXT[n]),
    r.privateRoom && "a private room",
  ].filter((x): x is string => Boolean(x));
  const text = parts.join(" · ");
  return text ? `${text.charAt(0).toUpperCase()}${text.slice(1)}.` : "No special needs given.";
}

/** The fictional week the demo nights sit in (requests name only a weekday). */
export const DEMO_WEEK: Record<GuestRequest["day"], string> = {
  Mon: "Nov 2",
  Tue: "Nov 3",
  Wed: "Nov 4",
  Thu: "Nov 5",
  Fri: "Nov 6",
  Sat: "Nov 7",
  Sun: "Nov 8",
};

/**
 * When a request is for, as the manager reads it. "Now" is the floor clock of the night on screen, passed only when
 * that night holds the request's book: a request for that same day reads "Fri 6:30 PM (in 3h 30m)"; any other day reads "Thu Nov 5 · 7:30 PM" with no countdown.
 * `elapsedMin` is demo time that has passed since the page opened.
 */
export function requestWhen(
  r: Pick<GuestRequest, "day" | "time">,
  now: { day: string; clock: string } | null,
  elapsedMin = 0,
): string {
  if (now && now.day === r.day) {
    const away = toMinutes(r.time) - toMinutes(now.clock) - elapsedMin;
    return `${r.day} ${clock12(r.time)} (${countdown(away)})`;
  }
  return `${r.day} ${DEMO_WEEK[r.day]} · ${clock12(r.time)}`;
}
