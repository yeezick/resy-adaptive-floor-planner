import { describe, expect, it } from "vitest";
import type { ActivityRow } from "./activity";
import {
  DEMO_MANAGER,
  feedbackOf,
  filterByFeedback,
  noteRow,
  rateRow,
  type FeedbackRecord,
} from "./feedback";

const M = DEMO_MANAGER;
const note = (n: number) => ({ sha256: `${"ab".repeat(16)}${n}`, length: 10 + n });

describe("activity-log feedback (one entry per row per manager)", () => {
  it("saves a thumb at once as one entry linked to the row", () => {
    const list = rateRow([], { rowId: "row-a", manager: M, rating: "up", at: "t1" });
    expect(list).toEqual([
      {
        id: `fb-${M}-row-a`,
        rowId: "row-a",
        manager: M,
        rating: "up",
        notes: [],
        at: "t1",
        updatedAt: "t1",
      },
    ]);
  });

  it("the other thumb updates the same entry (no duplicate), keeping its notes", () => {
    let list: FeedbackRecord[] = rateRow([], {
      rowId: "row-a",
      manager: M,
      rating: "up",
      at: "t1",
    });
    list = noteRow(list, { rowId: "row-a", manager: M, note: note(1), at: "t2" });
    list = rateRow(list, { rowId: "row-a", manager: M, rating: "down", at: "t3" });
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ rating: "down", at: "t1", updatedAt: "t3", notes: [note(1)] });
    // the same thumb again changes nothing
    expect(rateRow(list, { rowId: "row-a", manager: M, rating: "down", at: "t4" })).toEqual(list);
  });

  it("appends notes to the same entry, as hash + length only", () => {
    let list: FeedbackRecord[] = rateRow([], {
      rowId: "row-a",
      manager: M,
      rating: "down",
      at: "t1",
    });
    list = noteRow(list, { rowId: "row-a", manager: M, note: note(1), at: "t2" });
    list = noteRow(list, { rowId: "row-a", manager: M, note: note(2), at: "t3" });
    expect(list).toHaveLength(1);
    expect(list[0]?.notes).toEqual([note(1), note(2)]);
    expect(Object.keys(list[0]?.notes[0] ?? {})).toEqual(["sha256", "length"]);
  });

  it("ignores a note on an unrated row, and keeps managers apart", () => {
    expect(noteRow([], { rowId: "row-a", manager: M, note: note(1), at: "t1" })).toEqual([]);
    let list: FeedbackRecord[] = rateRow([], {
      rowId: "row-a",
      manager: M,
      rating: "up",
      at: "t1",
    });
    list = rateRow(list, { rowId: "row-a", manager: "other", rating: "down", at: "t2" });
    expect(list).toHaveLength(2);
    expect(feedbackOf(list, "row-a", M)?.rating).toBe("up");
    expect(feedbackOf(list, "row-a", "other")?.rating).toBe("down");
  });

  it("filters rows by any / 👍 / 👎 / unrated", () => {
    const rows = ["row-a", "row-b", "row-c"].map((id) => ({ id }) as ActivityRow);
    let list: FeedbackRecord[] = rateRow([], { rowId: "row-a", manager: M, rating: "up", at: "t" });
    list = rateRow(list, { rowId: "row-b", manager: M, rating: "down", at: "t" });
    const ids = (f: Parameters<typeof filterByFeedback>[3]) =>
      filterByFeedback(rows, list, M, f).map((r) => r.id);
    expect(ids(undefined)).toEqual(["row-a", "row-b", "row-c"]);
    expect(ids("up")).toEqual(["row-a"]);
    expect(ids("down")).toEqual(["row-b"]);
    expect(ids("unrated")).toEqual(["row-c"]);
  });
});
