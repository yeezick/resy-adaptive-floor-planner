import { describe, expect, it } from "vitest";
import { loadRequestBook } from "../src/server/requests";
import { runActivityChecks, scriptedSession } from "./activity-checks";

describe("activity checks", () => {
  const book = loadRequestBook();
  it("all pass on the seed week and a scripted session", () => {
    expect(runActivityChecks(book).filter((c) => !c.ok)).toEqual([]);
  });
  it("the scripted session includes a duplicate delivery and a stale action", () => {
    const s = scriptedSession(book);
    const ids = s.events.map((e) => e.traceId);
    expect(new Set(ids).size).toBe(ids.length - 1);
    expect(s.actions.some((a) => a.applied === "stale")).toBe(true);
  });
});
