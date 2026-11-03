import { describe, expect, it } from "vitest";
import { finalAnswer, scripted } from "./agent/fake";
import { requestChatTurn, type RequestChatConfig } from "./requestChat";
import type { RequestChatBody } from "../shared/api";

const none = {
  tableRange: null,
  partySize: null,
  time: null,
  addNeeds: [],
  removeNeeds: [],
  notes: [],
  clarify: null,
};
const body: RequestChatBody = {
  message: "headcount is now 26",
  request: { partySize: 22, day: "Fri", time: "18:30", needs: [] },
  constraints: { tableRange: null, partySize: null, time: null, needs: [], notes: [] },
};
const cfg = (create: RequestChatConfig["create"]): RequestChatConfig => ({
  create,
  model: "claude-haiku-5-5",
  maxTokens: 500,
  timeoutMs: 5000,
});

describe("requestChatTurn", () => {
  it("returns validated constraints with cost and a hash of the message", async () => {
    const f = scripted([finalAnswer({ ...none, partySize: 26 })]);
    const r = await requestChatTurn("Q2", body, "c1", cfg(f.create));
    expect(r).toMatchObject({ escalated: false, validatorRejects: 0, output: { partySize: 26 } });
    expect(r.input.length).toBe(body.message.length);
    expect(r.metrics.calls[0]?.role).toBe("request-chat");
  });

  it("retries once when the answer invents a number, then escalates", async () => {
    const bad = finalAnswer({ ...none, partySize: 24 });
    const retried = scripted([bad, finalAnswer({ ...none, partySize: 26 })]);
    const ok = await requestChatTurn("Q2", body, "c2", cfg(retried.create));
    expect(ok).toMatchObject({ validatorRejects: 1, output: { partySize: 26 } });
    expect(JSON.stringify(retried.requests[1]?.messages)).toMatch(/rejected: headcount/);

    const twice = await requestChatTurn("Q2", body, "c3", cfg(scripted([bad, bad]).create));
    expect(twice).toMatchObject({ escalated: true, output: null, validatorRejects: 2 });
    expect(twice.note).toMatch(/use the controls/);
  });
});
