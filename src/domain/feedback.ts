// Manager feedback on AI Planner actions: one 👍 / 👎 entry per activity-log row per manager, with optional notes.
// Clicking the other thumb updates the same entry; a note is appended to it (never a second row). Notes are
// stored as a hash + length only, like guest text. This is the data a later tuning loop would read; nothing in
// the prototype trains on it.
import { z } from "zod";
import { TextHash, type ActivityRow } from "./activity";

/** The prototype has one signed-in manager. */
export const DEMO_MANAGER = "manager-demo";

export const Rating = z.enum(["up", "down"]);
export type Rating = z.infer<typeof Rating>;

export const FeedbackRecord = z
  .object({
    id: z.string(),
    /** The activity-log row it rates (ActivityRow.id). */
    rowId: z.string(),
    manager: z.string(),
    rating: Rating,
    notes: z.array(TextHash).max(20),
    at: z.string(),
    updatedAt: z.string(),
  })
  .strict();
export type FeedbackRecord = z.infer<typeof FeedbackRecord>;

export const feedbackId = (rowId: string, manager: string) => `fb-${manager}-${rowId}`;

export function feedbackOf(
  list: readonly FeedbackRecord[],
  rowId: string,
  manager: string,
): FeedbackRecord | undefined {
  return list.find((f) => f.rowId === rowId && f.manager === manager);
}

/** Save a thumb: creates the row's entry, or changes the rating on the same entry (notes kept). */
export function rateRow(
  list: readonly FeedbackRecord[],
  x: { rowId: string; manager: string; rating: Rating; at: string },
): FeedbackRecord[] {
  const cur = feedbackOf(list, x.rowId, x.manager);
  if (!cur)
    return [
      ...list,
      {
        id: feedbackId(x.rowId, x.manager),
        rowId: x.rowId,
        manager: x.manager,
        rating: x.rating,
        notes: [],
        at: x.at,
        updatedAt: x.at,
      },
    ];
  if (cur.rating === x.rating) return [...list];
  return list.map((f) => (f === cur ? { ...f, rating: x.rating, updatedAt: x.at } : f));
}

/** Append a note (hash + length) to the row's entry. A row must be rated first; otherwise nothing changes. */
export function noteRow(
  list: readonly FeedbackRecord[],
  x: { rowId: string; manager: string; note: TextHash; at: string },
): FeedbackRecord[] {
  const cur = feedbackOf(list, x.rowId, x.manager);
  if (!cur || x.note.length === 0 || cur.notes.length >= 20) return [...list];
  return list.map((f) => (f === cur ? { ...f, notes: [...f.notes, x.note], updatedAt: x.at } : f));
}

export type FeedbackFilter = Rating | "unrated";

export function filterByFeedback(
  rows: readonly ActivityRow[],
  list: readonly FeedbackRecord[],
  manager: string,
  f: FeedbackFilter | undefined,
): ActivityRow[] {
  if (!f) return [...rows];
  return rows.filter((r) => {
    const fb = feedbackOf(list, r.id, manager);
    return f === "unrated" ? !fb : fb?.rating === f;
  });
}
