// Large-party requests: parties above the venue's online cap ask through a form or a diner-side AI agent instead
// of booking online. A manager sees each one with an AI triage, checks the fit and decides. Nothing here books.
import { z } from "zod";
import { fitRequest, type RequestFit } from "./buildplan";
import { HHMM, Label, type Reservation, type Room } from "./types";

export const NEEDS = ["accessible", "stroller", "quiet", "view"] as const;

export const GuestRequest = z
  .object({
    id: z.string().regex(/^Q\d{1,4}$/),
    /** Where it came from: the venue's web form, or an AI agent booking for a guest. */
    source: z.enum(["guest-form", "ai-agent"]),
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
    if (r.partySize <= book.onlineCap)
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
