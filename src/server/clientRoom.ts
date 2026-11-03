// A room posted by the client: an edited one-day layout of a known room. Tables may be added, removed, moved
// and re-specified, and joins, combos, storage and the book may change — but it must keep the id of a known
// fixture, and parseRoom must accept it (schema limits: ≤200 tables, ≤4 neighbours per table, labels ≤48
// characters, consistent statuses, joins and combos naming real tables). Every client string reaches the model
// only as data: the room label inside the user turn's data tags, the rest inside tool results.
import { parseRoom, type Room } from "../domain";

export type MergeResult = { ok: true; room: Room } | { ok: false; error: string };

export function mergeClientRoom(fixture: Room | undefined, client: unknown): MergeResult {
  if (!fixture) return { ok: false, error: "not a known room" };
  const id = (client as { id?: unknown } | null)?.id;
  if (id !== fixture.id) return { ok: false, error: "room id does not match roomId" };
  try {
    return { ok: true, room: parseRoom(client) };
  } catch (e) {
    const issue = (e as { issues?: { path: PropertyKey[]; message: string }[] }).issues?.[0];
    return {
      ok: false,
      error: issue
        ? `${issue.path.map(String).join(".")}: ${issue.message}`
        : e instanceof Error
          ? e.message.slice(0, 200)
          : "invalid room",
    };
  }
}
