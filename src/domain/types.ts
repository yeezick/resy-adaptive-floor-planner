// Room schema. Human-only tier: change only with an ADR (see CLAUDE.md).
import { z } from "zod";

export const PHASES = ["seated", "drinks", "appetizers", "entrees", "dessert", "check"] as const;
export const Phase = z.enum(PHASES);
export type Phase = z.infer<typeof Phase>;

export const TableStatus = z.enum(["open", "occupied", "reserved", "blocked"]);
export type TableStatus = z.infer<typeof TableStatus>;

/** Short identifier / label (keeps client-sent rooms small and free of long injected text). */
export const Label = z.string().min(1).max(48);

export const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "time must be HH:MM");

export const TableAttrs = z
  .object({
    accessible: z.boolean(), // wheelchair-height top and a clear approach
    strollerSpace: z.boolean(), // room beside the table for a stroller
    quiet: z.boolean(), // away from the bar and kitchen doors
    view: z.boolean(), // window or patio view
    booth: z.boolean(),
  })
  .strict();
export type TableAttrs = z.infer<typeof TableAttrs>;

export const Table = z
  .object({
    id: z.string().regex(/^T\d{1,4}$/),
    area: Label,
    section: z.number().int().positive(),
    x: z.number(),
    y: z.number(),
    w: z.number().positive(),
    h: z.number().positive(),
    shape: z.enum(["rect", "diamond", "round", "booth"]), // diamond = a square set at 45°, never joined
    /** Chairs that can be squeezed in from storage (e.g. a header seat at the end of a row). */
    maxExtraChairs: z.number().int().min(0).max(2).default(0),
    /** Smallest party the venue seats here on its own (a 6-top is not given to a 2). */
    minSeats: z.number().int().positive().default(1),
    seats: z.number().int().positive(),
    joinable: z.boolean(),
    attrs: TableAttrs,
    status: TableStatus,
    phase: Phase.optional(), // set when occupied (host-marked today; POS signals later)
    partySize: z.number().int().positive().optional(),
    reservedAt: HHMM.optional(), // set when reserved: the time the held party arrives
  })
  .strict();
export type Table = z.infer<typeof Table>;

export const Area = z
  .object({
    id: Label,
    name: Label,
    kind: z.enum(["dining", "private", "station", "bar"]).default("dining"),
    x: z.number(),
    y: z.number(),
    w: z.number(),
    h: z.number(),
    /** Private rooms in one suite have divider walls that open into one space. */
    suite: Label.optional(),
    /** Position within the suite; rooms with consecutive order are neighbours. */
    order: z.number().int().optional(),
    /** Floor space for this many extra tables brought out of storage. */
    spareSlots: z.number().int().min(0).default(0),
  })
  .strict();
export type Area = z.infer<typeof Area>;

export const Reservation = z
  .object({
    id: Label,
    time: HHMM,
    partySize: z.number().int().positive(),
    area: Label.optional(),
    needs: z.array(z.enum(["accessible", "stroller", "quiet", "view", "booth"])).default([]),
  })
  .strict();
export type Reservation = z.infer<typeof Reservation>;

/** Upper bounds that keep every room (including one posted by a client) cheap to reason over. */
export const MAX_TABLES = 200;
export const MAX_NEIGHBOURS = 4;

export const Room = z
  .object({
    id: Label,
    name: Label,
    clock: HHMM,
    areas: z.array(Area).max(40),
    tables: z.array(Table).min(1).max(MAX_TABLES),
    joins: z.array(z.tuple([z.string().max(8), z.string().max(8)])).max(2 * MAX_TABLES), // joinable neighbours
    combos: z
      .array(z.array(z.string().max(8)).min(2).max(6))
      .max(MAX_TABLES)
      .default([]), // pushed together
    /** What is in storage tonight, beyond the tables on the floor. */
    inventory: z
      .object({
        extenders: z.number().int().min(0),
        spareChairs: z.number().int().min(0),
        spareTables: z
          .array(
            z
              .object({ seats: z.number().int().positive(), count: z.number().int().min(0) })
              .strict(),
          )
          .default([]),
      })
      .strict(),
    reservations: z.array(Reservation).max(120).default([]),
  })
  .strict();
export type Room = z.infer<typeof Room>;

export type Need = Reservation["needs"][number];
